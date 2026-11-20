'use strict';
// [2026-11-20] RADARUL PE SERVER — tranzactiile din TRECUT (dinainte de b391).
//
// Cerut: „sa mearga tot" — si pentru tranzactiile deja inchise, care n-au fost vazute
// de radar (telefon inchis, radarul exista doar in aplicatie). Le refacem din ce a
// PASTRAT serverul, numai date reale:
//   • deciziile creierului (brain_decisions, la 30 s pe utilizator si moneda): RSI, ADX,
//     SuperTrend, funding, OI, regim, voturile bull/bear, confluenta, portile, ATR;
//   • lumanarile istorice Binance (5m pentru indicatori, 1m pentru pret si PnL).
// Din ele ies TREND, VOLUME, VOLATILITY, MOMENTUM, STRUCTURE, LIQ (niveluri ATR), OI,
// FUNDING. FLOW, DELTA, IMBALANCE si SENTIMENT n-au fost pastrate atunci ⇒ NULL („—"),
// nu inventate. Fara decizie in apropiere (tranzactie manuala), indicatorii se calculeaza
// din lumanari cu aceleasi functii ca serverul (teacherIndicators).
//
// Rezultatul: o inregistrare in brain_captures marcata `reconstructed: true`, un cadru la
// 30 s, de la 5 minute inainte de intrare pana la iesire. Ultimele 30 de zile, pe
// monedele radarului fiecaruia (lista de ACUM — regula 2 a jurnalului), cate o
// tranzactie la 5 s, prin poarta Binance. Ruleaza o data dupa pornire, apoi zilnic.

const zlib = require('zlib');
const logger = require('./logger');
const RA = require('./radarAxes');

const DAYS = 30;
const STEP_MS = 30_000;
const PRE_MS = 5 * 60_000;
const PACE_MS = 5_000;
const MAX_FRAMES = 3600;
const BAR5 = 5 * 60_000;

let _running = false, _timer = null;
const _stats = { done: 0, skipped: 0, failed: 0, lastErr: null, lastRun: 0 };
const _bars5 = new Map();               // sym -> [{time, open, high, low, close, volume}] (ms)

const _db = () => require('./database').db;
const RC = () => require('./radarCapture');

async function _get(url, weight) {
    const gw = require('./binanceGateway');
    const r = await gw.fetch(url, { __weight: weight, __src: 'radar:backfill', signal: AbortSignal.timeout(12000) });
    if (!r || !r.ok) throw new Error('http_' + (r && r.status));
    return r.json();
}
const _kl = (rows) => (Array.isArray(rows) ? rows : []).map((k) => ({ time: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));

/** Lumanari 5m pentru o moneda pe [from, to], cu cache (o singura aducere pe moneda si zi). */
async function _bars5For(sym, from, to) {
    let have = _bars5.get(sym) || [];
    const lo = have.length ? have[0].time : Infinity, hi = have.length ? have[have.length - 1].time : -Infinity;
    if (from >= lo && to <= hi + BAR5) return have;
    const out = new Map(have.map((b) => [b.time, b]));
    for (let t = from; t <= to; t += 1500 * BAR5) {
        const rows = _kl(await _get(`https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(sym)}&interval=5m&startTime=${t}&endTime=${Math.min(to, t + 1500 * BAR5)}&limit=1500`, 10));
        for (const b of rows) out.set(b.time, b);
    }
    have = [...out.values()].sort((a, b) => a.time - b.time);
    _bars5.set(sym, have);
    return have;
}
async function _bars1For(sym, from, to) {
    const out = [];
    for (let t = from; t <= to; t += 1500 * 60_000) {
        out.push(..._kl(await _get(`https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(sym)}&interval=1m&startTime=${t}&endTime=${Math.min(to, t + 1500 * 60_000)}&limit=1500`, 10)));
    }
    return out;
}

/** Ultima valoare cu timp ≤ t (cautare binara). */
function lastAtOrBefore(arr, t, key = 'time') {
    let lo = 0, hi = arr.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m][key] <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans;
}

/**
 * PURA: cadrele reconstruite. `bars5` = lumanari 5m (ms), `bars1` = 1m pentru pret,
 * `decisions` = [{ts, d}] sortate, `pos` = pozitia (side, price, sl, tp, lev, ts, closeTs),
 * `thr` = pragul. Fara decizie in ultimele 90 s → indicatorii din lumanari.
 */
function buildFrames({ bars5, bars1, decisions, pos, thr, compute, confluence }) {
    const frames = [];
    const entry = Number(pos.ts), exit = Number(pos.closeTs) || entry;
    const span = exit - (entry - PRE_MS);
    const step = Math.max(STEP_MS, Math.ceil(span / MAX_FRAMES / 1000) * 1000);
    for (let t = entry - PRE_MS; t <= exit; t += step) {
        const i5 = lastAtOrBefore(bars5, t - BAR5);              // doar lumanari INCHISE la momentul t
        if (i5 < 30) continue;
        const win = bars5.slice(Math.max(0, i5 - 99), i5 + 1);
        const i1 = lastAtOrBefore(bars1, t - 60_000);
        const price = i1 >= 0 ? bars1[i1].close : win[win.length - 1].close;
        const di = lastAtOrBefore(decisions, t, 'ts');
        const dec = di >= 0 && t - decisions[di].ts <= 90_000 ? decisions[di].d : null;
        let ind, rsi, bull, bear, fr = null, oi = null, oiPrev = null, regime, sc = null, atr, reasons = null;
        if (dec) {
            ind = { stDir: dec.stDir, macdDir: dec.macdDir, regime: dec.regime };
            rsi = dec.rsi5m; bull = dec.confBullDirs; bear = dec.confBearDirs; fr = dec.fr; oi = dec.oi;
            // OI: NU din decizii. OI-ul serverului era citit o singura data la pornire (bug raportat),
            // deci in decizii e o valoare inghetata — „nicio schimbare" ar fi falsa. Ramane null.
            oi = null; oiPrev = null;
            regime = dec.regime; sc = dec.confScore; atr = dec.atr; reasons = dec.gateReasons || [];
            ind.adx = dec.adx;
        } else {
            ind = compute(win) || {};
            rsi = ind.rsi; regime = ind.regime; atr = ind.atr;
            const c = confluence({ price, rsi: { '5m': rsi }, fr: null, oi: null, oiPrev: null }, ind);
            bull = c ? c.bullDirs : 0; bear = c ? c.bearDirs : 0; sc = c ? c.score : null;
        }
        const ax = RA.axesFrom({
            bars: win, price, adx: ind.adx, stDir: ind.stDir, rsi, bull, bear, fr,
            oi, oiPrev: oi != null ? oiPrev : null,
            liqAbove: atr > 0 ? price + atr : null, liqBelow: atr > 0 ? price - atr : null,
            regime,
        });
        const g = reasons ? RC().gatesFrom(reasons) : { failing: [], unknown: [0, 1, 2, 3, 4, 5, 6] };
        const f = { t, rt: ax.rt, b: ax.bull, r: ax.bear, rg: ax.regime, c: sc, h: thr, f: g.failing, u: g.unknown };
        if (t >= entry && price > 0 && pos.price > 0) {
            const dir = pos.side === 'SHORT' ? -1 : 1;
            f.p = { pct: Math.round(((price - pos.price) / pos.price) * dir * (Number(pos.lev) || 1) * 10000) / 100,
                prog: RC().progressOf(pos.side, Number(pos.price), price, Number(pos.sl), Number(pos.tp)), noTp: !(Number(pos.tp) > 0) };
        }
        frames.push(f);
    }
    return frames;
}

/** Forma, starea dinainte si restul inregistrarii, din cadrele reconstruite. PURA. */
function entryFrom(frames, pos, meta) {
    const pre = frames.filter((f) => !f.p);
    const at = pre.length ? pre[pre.length - 1] : frames[0] || null;
    const lens = RC().lensesOf(pre);
    return {
        pre: at ? RC().preMoodOf(at.rt, lens.sl, at.c, at.h, at.f) : null,
        v: 2, seq: pos.seq, symbol: pos.symbol, side: pos.side, env: meta.env, entryTs: Number(pos.ts),
        entryPrice: +pos.price || null, sl: +pos.sl || null, tp: +pos.tp || null, size: +pos.size || null, lev: +pos.lev || null,
        entryShape: at ? RC().entryShapeOf(at.rt) : null, rt: at ? at.rt : null,
        conf: at ? at.c : null, thr: meta.thr, profile: meta.profile, regime: meta.regime || null,
        radarRegime: at ? at.rg : null, bull: at ? at.b : null, bear: at ? at.r : null,
        gatesFailing: at ? at.f : [], gatesUnknown: at ? at.u : [0, 1, 2, 3, 4, 5, 6],
        radarCoins: meta.coins, late: false, preFrames: pre.length, source: 'server', reconstructed: true,
    };
}

function _envOf(d) { const e = String(d.env || '').toUpperCase(); return e === 'DEMO' || e === 'TESTNET' || e === 'REAL' ? e : String(d.mode || '') === 'demo' ? 'DEMO' : null; }

async function _one(uid, d) {
    const db = _db();
    const sym = String(d.symbol).toUpperCase(), seq = Number(d.seq);
    const exists = db.prepare('SELECT 1 FROM brain_captures WHERE user_id = ? AND seq = ?').get(uid, seq);
    if (exists) { _stats.skipped++; return; }
    const env = _envOf(d);
    if (!env || !(d.price > 0) || !(d.ts > 0)) { _stats.skipped++; return; }
    const closeTs = Number(d.closeTs) || Number(d.ts);
    const pos = { seq, symbol: sym, side: d.side === 'SHORT' ? 'SHORT' : 'LONG', price: d.price, sl: d.sl, tp: d.tp, size: d.size, lev: d.lev, ts: d.ts, closeTs };
    const from = d.ts - PRE_MS - 105 * BAR5;
    const bars5 = await _bars5For(sym, from, closeTs);
    const bars1 = await _bars1For(sym, d.ts - PRE_MS - 120_000, closeTs);
    const decisions = db.prepare('SELECT ts, data FROM brain_decisions WHERE user_id = ? AND symbol = ? AND ts BETWEEN ? AND ? ORDER BY ts ASC')
        .all(uid, sym, d.ts - PRE_MS - 120_000, closeTs)
        .map((r) => { try { return { ts: r.ts, d: JSON.parse(r.data) }; } catch (_) { return null; } }).filter(Boolean);
    const T = require('../shared/teacher/teacherIndicators');
    const compute = (win) => {
        const ind = T.teacherComputeIndicators(win) || {};
        const rs = T.teacherCalcRSI(win.map((b) => b.close));
        ind.rsi = rs && rs.length ? rs[rs.length - 1] : null;
        return ind;
    };
    let thr = 65, settings = null;
    try { const stc = require('./serverBrain').getSTC(uid); if (Number(stc.confMin) > 0) thr = Number(stc.confMin); } catch (_) {}
    try { const r = db.prepare('SELECT data FROM user_settings WHERE user_id = ?').get(uid); settings = r ? JSON.parse(r.data) : null; } catch (_) {}
    const frames = buildFrames({ bars5, bars1, decisions, pos, thr, compute, confluence: require('./serverBrain')._calcConfluence });
    if (!frames.length) { _stats.skipped++; return; }
    const linked = db.prepare('SELECT data FROM brain_decisions WHERE user_id = ? AND linked_seq = ? LIMIT 1').get(uid, seq);
    let regime = null; try { regime = linked ? JSON.parse(linked.data).regime : null; } catch (_) {}
    const entry = entryFrom(frames, pos, { env, thr, profile: RC().profileOf(settings, env), regime, coins: RC().coinsFor(uid).filter(Boolean) });
    const blob = zlib.deflateSync(Buffer.from(JSON.stringify(frames)));
    db.prepare(`INSERT OR IGNORE INTO brain_captures (user_id, seq, symbol, env, side, entry_ts, exit_ts, status, entry, frames, n_frames, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'closed', ?, ?, ?, ?)`)
        .run(uid, seq, sym, env, pos.side, Number(d.ts), closeTs, JSON.stringify(entry), blob, frames.length, Date.now());
    _stats.done++;
}

/** Tranzactiile de refacut: reale (definitia unica), ultimele 30 de zile, pe radarul fiecaruia. */
function pending(now = Date.now()) {
    const { REAL_TRADE_SQL } = require('./ml/_voice/omegaContext');
    const rows = _db().prepare(`SELECT user_id, data FROM at_closed WHERE closed_at > ? AND ${REAL_TRADE_SQL} ORDER BY closed_at DESC`).all(now - DAYS * 864e5);
    const have = new Set(_db().prepare('SELECT user_id || \':\' || seq k FROM brain_captures').all().map((r) => r.k));
    const out = [];
    for (const r of rows) {
        let d; try { d = JSON.parse(r.data); } catch (_) { continue; }
        if (!d || d.seq == null || have.has(r.user_id + ':' + d.seq)) continue;
        if (!RC().coinsFor(r.user_id).includes(String(d.symbol || '').toUpperCase())) continue;
        out.push({ uid: r.user_id, d });
    }
    return out;
}

async function run() {
    if (_running) return;
    _running = true; _stats.lastRun = Date.now();
    try {
        // v1 (primele ore de b395) avea OI din deciziile cu OI inghetat: se refac.
        try { _db().prepare("DELETE FROM brain_captures WHERE json_extract(entry, '$.reconstructed') = 1 AND coalesce(json_extract(entry, '$.v'), 1) < 2").run(); } catch (_) {}
        const list = pending();
        logger.info('RADAR', `backfill: ${list.length} past trades to rebuild (last ${DAYS} days, radar coins)`);
        for (const { uid, d } of list) {
            try { await _one(uid, d); } catch (e) { _stats.failed++; _stats.lastErr = String(e && e.message || e).slice(0, 80); }
            await new Promise((r) => setTimeout(r, PACE_MS));
        }
        logger.info('RADAR', `backfill done: rebuilt ${_stats.done}, skipped ${_stats.skipped}, failed ${_stats.failed}` + (_stats.lastErr ? ` lastErr=${_stats.lastErr}` : ''));
    } finally { _running = false; _bars5.clear(); }
}

function start() {
    const t = setTimeout(() => { run().catch(() => {}); }, 3 * 60_000);
    if (t.unref) t.unref();
    _timer = setInterval(() => { run().catch(() => {}); }, 24 * 3600_000);
    if (_timer.unref) _timer.unref();
}
function stop() { if (_timer) clearInterval(_timer); _timer = null; }
function health() { return { running: _running, ..._stats }; }

module.exports = { start, stop, run, pending, health, buildFrames, entryFrom, lastAtOrBefore };

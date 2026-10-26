'use strict';
// ══════════════════════════════════════════════════════════════════
// Memoria predicţiei — ca procentul să fie NUMĂRAT, nu afirmat
// ══════════════════════════════════════════════════════════════════
//
// [LIQ-PREDICT 2026-10-26] Un semnal fără urmărire e o părere. Modulul ăsta
// salvează fiecare semnal împreună cu preţul din clipa aceea, şi mai târziu îi
// pune verdictul din klines REALE. Rata afişată în panou vine din rândurile de
// aici — nu dintr-o formulă.
//
// De ce trei orizonturi: efectul de combustibil ars e de ordinul orelor, dar
// nu ştiu care oră, şi nu vreau să aleg ghicind. Măsurăm 1h / 4h / 24h şi lăsăm
// datele să spună unde are semnalul tracţiune. Dacă pe 24h e la 50%, asta se va
// vedea în panou ca 50%, nu se va ascunde.

const db = require('./database');
const LP = require('./liqPredict');

const HORIZONS_MS = [3600000, 4 * 3600000, 24 * 3600000];
// Un semnal nu se renotează la fiecare tick: altfel o singură cascadă ar
// produce sute de rânduri „independente" şi rata ar măsura cascada, nu semnalul.
const DEDUPE_MS = 15 * 60000;
const RETENTION_DAYS = 180;
// Marjă după orizont, ca bara care închide fereastra să existe pe REST.
const SETTLE_MS = 6 * 60000;

let _st = null;
function _s() {
    if (_st) return _st;
    _st = {
        insert: db.db.prepare(
            'INSERT INTO liq_predict_snapshots (symbol, ts, horizon_ms, side, strength, price_at,'
            + ' target_price, imbalance, long_burned_usd, short_burned_usd, crowd_long_pct, oi_change_pct)'
            + ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
        lastFor: db.db.prepare(
            'SELECT ts FROM liq_predict_snapshots WHERE symbol = ? AND horizon_ms = ?'
            + ' ORDER BY ts DESC LIMIT 1'),
        due: db.db.prepare(
            'SELECT id, symbol, ts, horizon_ms, side, price_at, target_price FROM liq_predict_snapshots'
            + ' WHERE resolved_at IS NULL AND (ts + horizon_ms) <= ? ORDER BY ts ASC LIMIT ?'),
        resolve: db.db.prepare(
            'UPDATE liq_predict_snapshots SET resolved_at = ?, outcome = ?, rule = ?, ret_pct = ?,'
            + ' extreme_pct = ?, control_outcome = ?, target_pct = ? WHERE id = ?'),
        stats: db.db.prepare(
            "SELECT COUNT(*) AS resolved, SUM(CASE WHEN outcome = 'HIT' THEN 1 ELSE 0 END) AS hits,"
            + " SUM(CASE WHEN control_outcome IS NOT NULL THEN 1 ELSE 0 END) AS controlResolved,"
            + " SUM(CASE WHEN control_outcome = 'HIT' THEN 1 ELSE 0 END) AS controlHits,"
            + ' AVG(ABS(target_pct)) AS avgTargetPct'
            + ' FROM liq_predict_snapshots WHERE symbol = ? AND horizon_ms = ? AND resolved_at IS NOT NULL'),
        pending: db.db.prepare(
            'SELECT COUNT(*) AS n FROM liq_predict_snapshots WHERE symbol = ? AND resolved_at IS NULL'),
        recent: db.db.prepare(
            'SELECT ts, side, strength, price_at, target_price, horizon_ms, outcome, rule, ret_pct'
            + ' FROM liq_predict_snapshots WHERE symbol = ? ORDER BY ts DESC LIMIT ?'),
        // Lotizat, ca retenţia de la G-5: better-sqlite3 e SINCRON.
        pruneBatch: db.db.prepare(
            'DELETE FROM liq_predict_snapshots WHERE rowid IN'
            + ' (SELECT rowid FROM liq_predict_snapshots WHERE ts < ? LIMIT ?)'),
    };
    return _st;
}

/**
 * Salvează un semnal pe toate orizonturile. Întoarce câte rânduri a scris.
 *
 * Un semnal 'NONE' NU se salvează: nu are ce să nimerească, iar dacă l-am
 * număra, rata ar fi diluată de tăceri şi ar arăta mai prost (sau mai bine)
 * decât e. Se măsoară numai ce panoul a chiar afirmat.
 */
function record(signal, now = Date.now()) {
    if (!signal || (signal.side !== 'UP' && signal.side !== 'DOWN')) return 0;
    const sym = String(signal.symbol || '').toUpperCase();
    if (!sym) return 0;
    const price = Number(signal.price != null ? signal.price : signal.priceAt);
    if (!Number.isFinite(price) || price <= 0) return 0;

    let n = 0;
    for (const h of HORIZONS_MS) {
        const last = _s().lastFor.get(sym, h);
        if (last && now - Number(last.ts) < DEDUPE_MS) continue;
        _s().insert.run(
            sym, now, h, signal.side, Math.round(Number(signal.strength) || 0), price,
            signal.target && Number.isFinite(Number(signal.target.price)) ? Number(signal.target.price) : null,
            Number.isFinite(Number(signal.imbalance)) ? Number(signal.imbalance) : null,
            Number(signal.longBurnedUsd) || 0, Number(signal.shortBurnedUsd) || 0,
            Number.isFinite(Number(signal.crowdLongPct)) ? Number(signal.crowdLongPct) : null,
            Number.isFinite(Number(signal.oiChangePct)) ? Number(signal.oiChangePct) : null);
        n++;
    }
    return n;
}

/** Rândurile cărora le-a trecut orizontul şi aşteaptă verdictul. */
function due(now = Date.now(), limit = 40) {
    return _s().due.all(now - SETTLE_MS, limit);
}

/**
 * Pune verdictul pe un rând, din barele ferestrei lui.
 * Barele vin cu `time` în SECUNDE (forma lui marketFeed.fetchKlines).
 */
function resolveWith(row, bars, now = Date.now()) {
    if (!row || !Array.isArray(bars)) return null;
    const from = Number(row.ts) / 1000;
    const to = (Number(row.ts) + Number(row.horizon_ms)) / 1000;
    const win = bars.filter(b => {
        const t = Number(b && b.time);
        return Number.isFinite(t) && t >= from && t <= to;
    });
    const r = LP.evaluate({
        side: row.side, priceAt: row.price_at, targetPrice: row.target_price, bars: win,
    });
    // Fără bare în fereastră rândul rămâne NEREZOLVAT, nu se închide ca MISS.
    // Un MISS inventat ar trage rata în jos exact acolo unde n-avem date.
    if (!r) return null;
    _s().resolve.run(now, r.outcome, r.rule, r.retPct, r.extremePct,
        r.controlOutcome, r.targetPct, row.id);
    return r;
}

/** Rata măsurată pe un orizont, plus câte aşteaptă încă. */
function stats(symbol, horizonMs) {
    const sym = String(symbol || '').toUpperCase();
    const row = _s().stats.get(sym, horizonMs)
        || { resolved: 0, hits: 0, controlResolved: 0, controlHits: 0, avgTargetPct: null };
    const hr = LP.hitRate({ resolved: row.resolved, hits: row.hits });
    hr.horizonMs = horizonMs;
    hr.pendingTotal = (_s().pending.get(sym) || { n: 0 }).n;
    // Oglinda: fara ea procentul nu se poate citi (vezi migraţia 422).
    const lf = LP.lift({
        resolved: row.resolved, hits: row.hits,
        controlResolved: row.controlResolved, controlHits: row.controlHits,
    });
    hr.controlPct = hr.calibrating ? null : lf.controlPct;
    hr.lift = hr.calibrating ? null : (lf.ratio === null ? null : Math.round(lf.ratio * 100) / 100);
    hr.controlResolved = Number(row.controlResolved) || 0;
    hr.avgTargetPct = Number.isFinite(Number(row.avgTargetPct)) ? Number(row.avgTargetPct) : null;
    return hr;
}

function recent(symbol, limit = 20) {
    return _s().recent.all(String(symbol || '').toUpperCase(), limit);
}

function prune(days = RETENTION_DAYS, batch = 500) {
    const cutoff = Date.now() - days * 86400000;
    return _s().pruneBatch.run(cutoff, batch).changes;
}

module.exports = { record, due, resolveWith, stats, recent, prune, HORIZONS_MS, DEDUPE_MS, RETENTION_DAYS, SETTLE_MS };

'use strict';
// [SERVER-ARES 2026-06-07] ARES engine — server-side migration of the client
// engine (engine/ares.ts + aresDecision + aresExecute + aresMonitor).
// Operator directive: "migrează și ARES server-side acum".
//
// Architecture (operator-approved): decisions here (aresRules.js, pure,
// tested), EXECUTION through serverAT.processBrainDecision with
// decision.owner='ARES' — inherits the entire hardened money-path for free
// (exchange SL + server net, watchdog, recon, emergency-close queue, kill
// gate, id-length/rounding fixes). Exits run on serverAT's DSL (equivalent
// trailing profile); ARES wallet accounting closes the loop via the
// _persistClose hook (serverAT calls onPositionClosed for owner==='ARES').
//
// State lives in the `ares_state` table (already client-synced — the wallet
// seeds from the operator's existing balance, nothing is lost).
// Gating: MF.SERVER_ARES === true AND serverAT.serverFullyOwnsEntries(userId)
// (testnet cutover only — REAL stays blocked upstream).

const logger = require('./logger');
const db = require('./database');
const MF = require('../migrationFlags');
const { evaluateAres, aresSizing, computeAresConfidence, computeAresEngineState, applyRealCaps } = require('./aresRules');

const SYMBOL = 'BTCUSDT';            // ARES is BTC-only (1:1 with client)
const TARGET = 1000000;              // mission target
const DAYS_MAX = 365;
const FEE_TAKER = 0.00055;

// ── State I/O ───────────────────────────────────────────────────────────────
// Canonical shape (migrates the legacy flat client snapshot on first load):
// { wallet: {balance, locked, realizedPnL, fundedTotal},
//   engine: {tradeHistory[], consecutiveLoss, consecutiveWin, lastLossTs,
//            lastTradeTs, winRate10, totalTrades, totalWins, totalLosses},
//   mission: {startBalance, startTs},
//   lastDecision: {...} }
function _defaultState() {
    return {
        wallet: { balance: 0, locked: 0, realizedPnL: 0, fundedTotal: 0 },
        engine: { tradeHistory: [], consecutiveLoss: 0, consecutiveWin: 0, lastLossTs: 0, lastTradeTs: 0, winRate10: 0, totalTrades: 0, totalWins: 0, totalLosses: 0 },
        mission: { startBalance: null, startTs: null },
        lastDecision: null,
        // [2026-06-23] REAL-money consent (server-authoritative). ARES will NOT place a REAL
        // autonomous entry unless realOptIn === true. Default false = fail-closed. Set only via
        // setRealOptIn() (server side); stripped from any client sync (see _stripDangerousKeys).
        realOptIn: false,
        realOptInTs: null,
        // [2026-06-23] Daily-loss circuit breaker (REAL only). lossUsd accrues realized losses
        // for the UTC day; when it reaches startBalance × cap, REAL entries pause until next day.
        dailyLoss: { day: null, lossUsd: 0, startBalance: 0 },
        // [2026-06-23] Persistent kill-switch (all envs). Survives restart (unlike the per-cycle
        // killActive). Server-authoritative; set only via setKillSwitch(); stripped from client sync.
        killSwitch: false,
        // [2026-06-24] Per-user ARES ACTIVE toggle (mutual exclusion with AT/Brain). When true:
        // ARES trades on this account AND the AT/Brain/ML entry path is blocked for this user — so
        // the two engines can never open conflicting positions on the same symbol (exchange nets
        // them → 1 position). Default false = ARES off, AT free. Server-authoritative; stripped
        // from client sync; set only via setAresActive() (which also forces AT off).
        aresActive: false,
        aresActiveTs: null,
    };
}

// [2026-06-23] Roll the daily-loss window to the current UTC day. Resets the accumulator and
// snapshots the day's starting balance (the cap reference) on a new day. PURE-ish (mutates st).
function _rollDailyWindow(st, now) {
    const dayKey = new Date(Number.isFinite(+now) ? +now : Date.now()).toISOString().slice(0, 10);
    if (!st.dailyLoss || st.dailyLoss.day !== dayKey) {
        st.dailyLoss = { day: dayKey, lossUsd: 0, startBalance: Math.max(0, +st.wallet.balance || 0) };
    }
    return st.dailyLoss;
}
function _capNumAres(envVal, def, lo, hi) {
    const n = Number(envVal);
    if (!Number.isFinite(n) || n <= 0) return def;
    return Math.min(hi, Math.max(lo, n));
}
const REAL_MAX_DAILY_LOSS_PCT = _capNumAres(process.env.ARES_REAL_MAX_DAILY_LOSS_PCT, 0.06, 0.005, 0.50); // default 6% of day-start balance

function _loadState(userId) {
    let raw = null;
    try { raw = db.getAresState(userId); } catch (e) { logger.warn('ARES', `state load failed uid=${userId}: ${e.message}`); }
    if (!raw || typeof raw !== 'object') return _defaultState();
    if (raw.wallet && raw.engine) return Object.assign(_defaultState(), raw);
    // Legacy flat client snapshot {balance, locked, realizedPnL, fundedTotal, ...} → migrate.
    const st = _defaultState();
    if (Number.isFinite(+raw.balance)) st.wallet.balance = +raw.balance;
    if (Number.isFinite(+raw.locked)) st.wallet.locked = Math.max(0, +raw.locked);
    if (Number.isFinite(+raw.realizedPnL)) st.wallet.realizedPnL = +raw.realizedPnL;
    if (Number.isFinite(+raw.fundedTotal)) st.wallet.fundedTotal = +raw.fundedTotal;
    st._migratedFromLegacy = true;
    return st;
}

function _saveState(userId, st) {
    try { db.saveAresState(userId, st); } catch (e) { logger.error('ARES', `state save failed uid=${userId}: ${e.message}`); }
}

// ── ML journal entry context ──────────────────────────────────────────────
// Persist the entry decision context per-seq in ares_state so the close hook
// can journal it (survives a restart between open and close). Pruned to 24h.
function _pruneOpenCtx(st) {
    if (!st || !st.openCtx) return;
    const cutoff = Date.now() - 24 * 3600 * 1000;
    for (const k of Object.keys(st.openCtx)) {
        if (((st.openCtx[k] && st.openCtx[k]._ts) || 0) < cutoff) delete st.openCtx[k];
    }
}
function _recordEntryContext(userId, seq, ctx) {
    try {
        const st = _loadState(userId);
        st.openCtx = st.openCtx || {};
        st.openCtx[String(seq)] = Object.assign({}, ctx, { _ts: Date.now() });
        _pruneOpenCtx(st);
        _saveState(userId, st);
    } catch (_) { /* journal context is best-effort, never block trading */ }
}
function _sessionName(h) {
    const x = +h;
    if (x >= 7 && x < 13) return 'LONDON';
    if (x >= 13 && x < 21) return 'NY';
    return 'ASIA';
}

// ── Mission trajectory (port of _calcTrajectory) ───────────────────────────
function _trajectory(st, now) {
    const bal = st.wallet.balance;
    if (!st.mission.startBalance || !st.mission.startTs) {
        st.mission.startBalance = bal > 0 ? bal : 1000;
        st.mission.startTs = now;
    }
    const daysPassed = Math.max(1, (now - st.mission.startTs) / 86400000);
    const dailyRate = Math.pow(TARGET / st.mission.startBalance, 1 / DAYS_MAX) - 1;
    const expectedNow = st.mission.startBalance * Math.pow(1 + dailyRate, daysPassed);
    const delta = bal > 0 ? ((bal - expectedNow) / expectedNow * 100) : 0;
    return { delta: +delta.toFixed(2), daysPassed: +daysPassed.toFixed(1), expectedNow };
}

// ── Open ARES positions via serverAT (lazy require — circular dep) ─────────
function _serverAT() { return require('./serverAT'); }
function _openAresPositions(userId) {
    try {
        const all = _serverAT().getOpenPositions(userId) || [];
        return all.filter(p => p && p.owner === 'ARES');
    } catch (_) { return []; }
}

// ── [2026-06-23] REAL exchange balance — ARES trades the user's ACTUAL money on a real account.
// tick() is synchronous; getBalance() is an async exchange call. So we cache the live
// availableBalance per user and refresh it asynchronously (throttled, stampede-guarded). On REAL,
// sizing uses this real available balance (binance OR bybit, whichever the user's account is on —
// exchangeOps routes automatically). Fail-closed: balance unknown (0) → no trade until first fetch.
const _realBal = new Map(); // userId -> { avail:number, ts:number, inflight:boolean }
const REAL_BAL_TTL_MS = 45000;
function _refreshRealBalanceAsync(userId) {
    const now = Date.now();
    const c = _realBal.get(userId);
    if (c && c.inflight) return;
    if (c && (now - c.ts) < REAL_BAL_TTL_MS) return; // still fresh
    const entry = c || { avail: 0, ts: 0, inflight: false };
    entry.inflight = true;
    _realBal.set(userId, entry);
    Promise.resolve()
        .then(() => require('./exchangeOps').getBalance(userId))
        .then((bal) => {
            const avail = parseFloat((bal && bal.availableBalance) || 0);
            _realBal.set(userId, { avail: Number.isFinite(avail) && avail > 0 ? avail : 0, ts: Date.now(), inflight: false });
        })
        .catch((e) => {
            const prev = _realBal.get(userId) || entry;
            _realBal.set(userId, { avail: prev.avail || 0, ts: Date.now(), inflight: false }); // keep last, back off TTL
            try { logger.warn('ARES', `[real-balance] uid=${userId} refresh failed: ${e && e.message}`); } catch (_) { }
        });
}
function _realAvailable(userId) {
    const c = _realBal.get(userId);
    return c && Number.isFinite(c.avail) ? c.avail : 0;
}
// [2026-06-24 HARDENING] Stale-balance visibility. The cache keeps the last-known balance when a
// refresh fails (so ARES isn't blinded by one network blip), but a balance used for a REAL trade
// that is much older than the TTL must be SURFACED — silently sizing off a 5-min-old balance is a
// money-path hazard. STALE = older than 2× TTL.
const REAL_BAL_STALE_MS = REAL_BAL_TTL_MS * 2;
function _realBalanceMeta(userId) {
    const c = _realBal.get(userId);
    if (!c || !Number.isFinite(c.avail)) return { avail: 0, ageMs: null, stale: true, known: false };
    const ageMs = Date.now() - (c.ts || 0);
    return { avail: c.avail, ageMs, stale: ageMs > REAL_BAL_STALE_MS, known: c.ts > 0 };
}
// [2026-06-24 HARDENING] Entry-in-flight guard for the withdraw race. The wallet `locked` reserve
// (set before dispatch) already blocks withdraw, but this explicit per-user flag closes the window
// belt-and-suspenders and documents intent (also survives any future async refactor of the tick).
const _entryInFlight = new Set();
function _setRealBalanceForTest(userId, avail, ageMs) { _realBal.set(userId, { avail: +avail || 0, ts: Date.now() - (+ageMs || 0), inflight: false }); }
function _resetRealBalanceForTest() { _realBal.clear(); }
function _setEntryInFlightForTest(userId, on) { if (on) _entryInFlight.add(userId); else _entryInFlight.delete(userId); }

// ── Tick — called from serverBrain's per-user BTCUSDT cycle ────────────────
// mctx: { price, regime: {regime, confidence, trendBias}, confluenceScore,
//         atrPct, killActive }
function tick(userId, mctx) {
    if (MF.SERVER_ARES !== true) return null;
    let ownsEntries = false;
    try { ownsEntries = _serverAT().serverFullyOwnsEntries(userId) === true; } catch (_) { }
    if (!ownsEntries) return null; // testnet cutover only — fail-closed
    if (!mctx || !Number.isFinite(+mctx.price) || +mctx.price <= 0) return null;

    const now = Date.now();
    const st = _loadState(userId);
    // [2026-06-23] Persistent kill-switch — if the user (or operator) hard-stopped ARES, do
    // nothing until it is explicitly re-enabled. Survives restart (unlike per-cycle killActive).
    if (st.killSwitch === true) { return null; }
    // [2026-06-24] ARES only trades when the user has explicitly ACTIVATED it for this account.
    // While off, AT/Brain runs normally; while on, AT/Brain is blocked (mutual exclusion in
    // serverAT). Default off → fail-closed (ARES never trades unless deliberately turned on).
    if (st.aresActive !== true) { return null; }
    const traj = _trajectory(st, now);
    const eng = st.engine;

    const engState = computeAresEngineState({
        consecutiveLoss: eng.consecutiveLoss, consecutiveWin: eng.consecutiveWin,
        winRate10: eng.winRate10, trajectoryDelta: traj.delta,
        lastLossTs: eng.lastLossTs, now, killActive: mctx.killActive === true,
    });
    const confidence = computeAresConfidence({
        regime: mctx.regime ? mctx.regime.regime : 'UNKNOWN',
        regimeConf: mctx.regime ? mctx.regime.confidence : 0,
        entryScore: +mctx.confluenceScore || 0,
        trajectoryDelta: traj.delta,
        // No history yet → null (neutral 50 inside) — see aresRules deadlock note.
        winRate10: eng.tradeHistory.length > 0 ? eng.winRate10 : null,
    });

    // [2026-06-23] Resolve execution env + the correct sizing BALANCE *before* the gate matrix, so
    // evaluateAres' funds gate (and sizing) see the REAL exchange balance on a real account — NOT
    // the empty virtual wallet (which would block every real entry on the min-balance gate).
    let _execEnv = null;
    try { _execEnv = (_serverAT().resolveExecutionEnv(userId) || {}).env; } catch (_) { _execEnv = null; }

    // Consent gate (fail-closed): never auto-trade REAL capital without explicit opt-in.
    if (_execEnv === 'REAL' && st.realOptIn !== true) {
        try { logger.info('ARES', `[consent] uid=${userId} REAL entry blocked — no real opt-in (fail-closed)`); } catch (_) { }
        _saveState(userId, st);
        return null;
    }

    // Sizing base: REAL → live exchange available balance (cached async; binance/bybit auto-routed).
    // Fail-closed if not yet known. testnet/demo → virtual wallet.
    let _sizeBalance = st.wallet.balance;
    let _sizeAvail = Math.max(0, st.wallet.balance - st.wallet.locked);
    if (_execEnv === 'REAL') {
        _refreshRealBalanceAsync(userId);
        const _bm = _realBalanceMeta(userId);
        const realAvail = _bm.avail;
        if (!(realAvail > 0)) {
            try { logger.info('ARES', `[real-balance] uid=${userId} REAL entry skipped — exchange balance not known yet (fetching)`); } catch (_) { }
            _saveState(userId, st);
            return null;
        }
        // [2026-06-24 HARDENING] Surface a stale balance (kept from a failed/old refresh) — the
        // entry still proceeds on the last-known value (better than blinding ARES on one blip), but
        // the operator MUST see it. Loud so a persistently-stale balance is noticed in the logs.
        if (_bm.stale) {
            try { logger.warn('ARES', `[real-balance] uid=${userId} sizing off STALE balance $${realAvail} (age ${Math.round((_bm.ageMs || 0) / 1000)}s > ${Math.round(REAL_BAL_STALE_MS / 1000)}s) — exchange refresh lagging`); } catch (_) { }
        }
        _sizeBalance = realAvail;
        _sizeAvail = realAvail;

        // Daily-loss circuit breaker (REAL only) — referenced to the REAL day-opening balance.
        const dl = _rollDailyWindow(st, now);
        if (dl.lossUsd === 0 || !(dl.startBalance > 0)) dl.startBalance = realAvail; // track real opening equity
        const cap = dl.startBalance * REAL_MAX_DAILY_LOSS_PCT;
        if (cap > 0 && dl.lossUsd >= cap) {
            try { logger.info('ARES', `[daily-loss] uid=${userId} REAL entry paused — day loss $${dl.lossUsd.toFixed(2)} ≥ cap $${cap.toFixed(2)}`); } catch (_) { }
            _saveState(userId, st);
            return null;
        }
    }

    const decision = evaluateAres({
        now,
        balance: _sizeBalance,
        available: _sizeAvail,
        openAresCount: _openAresPositions(userId).length,
        killActive: mctx.killActive === true,
        lastTradeTs: eng.lastTradeTs,
        regime: mctx.regime ? mctx.regime.regime : 'UNKNOWN',
        sessionHourUtc: new Date(now).getUTCHours(),
        stateId: engState.id,
        consecutiveLoss: eng.consecutiveLoss, lastLossTs: eng.lastLossTs, winRate10: eng.winRate10,
        entryScore: +mctx.confluenceScore || 0,
        confidence,
        trendBias: mctx.regime ? mctx.regime.trendBias : 'neutral',
        atrPct: +mctx.atrPct || 0,
    });

    st.lastDecision = { ts: now, shouldTrade: decision.shouldTrade, side: decision.side, confidence, stateId: engState.id, reasons: decision.reasons.slice(0, 8) };

    if (!decision.shouldTrade) { _saveState(userId, st); return null; }

    let sizing = aresSizing({ balance: _sizeBalance, available: _sizeAvail, confidence, atrPct: +mctx.atrPct || 0 });
    // REAL-money safety caps — clamp stake-fraction + leverage off the real balance (testnet/demo
    // unchanged). Never risk the aggressive 25%/20x testnet geometry with real capital.
    sizing = applyRealCaps(sizing, _execEnv, { balance: _sizeBalance });
    if (sizing.capped) {
        try { logger.info('ARES', `[caps] uid=${userId} REAL caps applied: stake ${sizing.capsApplied.fromStake}→${sizing.stake}, lev ${sizing.capsApplied.fromLeverage}→${sizing.leverage}`); } catch (_) { }
    }
    if (!Number.isFinite(sizing.stake) || sizing.stake < 5) { _saveState(userId, st); return null; }

    // Virtual wallet reserve FIRST (released on entry failure / close).
    st.wallet.locked = Math.min(st.wallet.balance, st.wallet.locked + sizing.stake);
    _saveState(userId, st);

    const aresDecision = {
        ts: now, cycle: 0, symbol: SYMBOL,
        price: +mctx.price, priceTs: +mctx.priceTs || now,
        owner: 'ARES',
        fusion: {
            dir: decision.side, decision: 'SMALL', confidence,
            score: +mctx.confluenceScore || 0,
            reasons: ['ares'].concat(decision.reasons.slice(0, 4)),
        },
        regime: mctx.regime || null,
    };
    // stc: ARES sizing → serverAT geometry. maxPos = current user total + 1 so
    // the serverAT MAX_POSITIONS gate (counts ALL user positions) never blocks
    // the single ARES slot while AT holds its own positions; the ARES-side
    // MAX_OPEN=1 was already enforced in evaluateAres via openAresCount.
    let _userOpen = 0;
    try { _userOpen = (_serverAT().getOpenPositions(userId) || []).length; } catch (_) { }
    const stc = {
        size: sizing.stake, lev: sizing.leverage,
        slPct: sizing.slPct, rr: sizing.rr,
        maxPos: _userOpen + 1,
        cooldownMs: 0,           // ARES cooldown handled in evaluateAres
        dslMode: 'fast',
        symbols: [SYMBOL],
    };

    let entry = null;
    _entryInFlight.add(userId); // [2026-06-24 HARDENING] block withdraw across the dispatch window
    try {
        entry = _serverAT().processBrainDecision(aresDecision, stc, userId, sizing.stake);
    } catch (e) {
        logger.error('ARES', `entry dispatch failed uid=${userId}: ${e.message}`);
    } finally {
        _entryInFlight.delete(userId);
    }
    if (!entry) {
        // Entry refused/failed → release the reservation.
        const st2 = _loadState(userId);
        st2.wallet.locked = Math.max(0, st2.wallet.locked - sizing.stake);
        _saveState(userId, st2);
        return null;
    }

    const st3 = _loadState(userId);
    st3.engine.lastTradeTs = now;
    st3.lastDecision = Object.assign({}, st3.lastDecision, { executedSeq: entry.seq, stake: sizing.stake, leverage: sizing.leverage });
    _saveState(userId, st3);
    // ML journal: stash the entry decision context keyed by seq for the close hook.
    _recordEntryContext(userId, entry.seq, {
        side: decision.side, entryPrice: +mctx.price, leverage: sizing.leverage,
        notional: sizing.stake * sizing.leverage, confidence,
        entryScore: +mctx.confluenceScore || 0,
        regime: mctx.regime ? mctx.regime.regime : 'UNKNOWN',
        session: new Date(now).getUTCHours(),
        reasons: decision.reasons.slice(0, 6), openedAt: now,
    });
    logger.info('ARES', `[ARES OPEN] uid=${userId} ${decision.side} ${SYMBOL} seq=${entry.seq} stake=$${sizing.stake} lev=${sizing.leverage}x conf=${confidence}`);
    try { require('./audit').record('ARES_ENTRY', { userId, seq: entry.seq, side: decision.side, stake: sizing.stake, leverage: sizing.leverage, confidence }, 'SERVER_ARES'); } catch (_) { }
    return entry;
}

// ── Close hook — called by serverAT._persistClose for owner==='ARES' ───────
function onPositionClosed(pos) {
    try {
        if (!pos || pos.owner !== 'ARES' || !pos.userId) return;
        const st = _loadState(pos.userId);
        const eng = st.engine;
        // Stake release: lastDecision.stake is best-effort; fall back to margin.
        // [2026-06-23] null-safe: st.lastDecision can be null (e.g. close after a restart with no
        // in-memory decision). The old form threw on null.executedSeq → close hook silently failed
        // → wallet/PnL/daily-loss never recorded. Guard lastDecision first.
        const stake = (st.lastDecision && Number.isFinite(+st.lastDecision.stake) && st.lastDecision.executedSeq === pos.seq)
            ? +st.lastDecision.stake : (+pos.margin || 0);
        st.wallet.locked = Math.max(0, st.wallet.locked - stake);
        const gross = +pos.closePnl || 0;
        const fees = (Number.isFinite(+pos.size) && Number.isFinite(+pos.lev)) ? (+pos.size * +pos.lev * FEE_TAKER * 2) : 0;
        const net = gross - fees;
        st.wallet.balance = Math.max(0, st.wallet.balance + net);
        st.wallet.realizedPnL += net;
        // [2026-06-23] Accrue the day's realized loss for the daily-loss circuit breaker. Recorded
        // for every env (cheap accounting); the breaker only ACTS on REAL (see tick). Roll first so
        // startBalance reflects the day's opening equity.
        const dl = _rollDailyWindow(st, Date.now());
        if (net < 0) dl.lossUsd += -net;

        const isWin = net > 0;
        eng.tradeHistory.unshift(isWin);
        if (eng.tradeHistory.length > 10) eng.tradeHistory = eng.tradeHistory.slice(0, 10);
        eng.totalTrades++;
        if (isWin) { eng.consecutiveWin++; eng.consecutiveLoss = 0; eng.totalWins++; }
        else if (net !== 0) { eng.consecutiveLoss++; eng.consecutiveWin = 0; eng.lastLossTs = Date.now(); eng.totalLosses++; }
        const wins = eng.tradeHistory.filter(Boolean).length;
        eng.winRate10 = eng.tradeHistory.length > 0 ? Math.round(wins / eng.tradeHistory.length * 100) : 0;
        _saveState(pos.userId, st);
        // ── ML journal row (server-side dataset; survives phone-closed) ──
        try {
            const ec = (st.openCtx && st.openCtx[String(pos.seq)]) || null;
            db.insertAresJournal(pos.userId, {
                symbol: pos.symbol || SYMBOL,
                side: pos.side || (ec && ec.side) || 'LONG',
                entry_price: ec ? ec.entryPrice : (+pos.entryPrice || null),
                exit_price: Number.isFinite(+pos.markPrice) ? +pos.markPrice : (+pos.closePrice || null),
                leverage: ec ? ec.leverage : (+pos.lev || null),
                notional: ec ? ec.notional : (((+pos.size || 0) * (+pos.lev || 0)) || null),
                confidence: ec ? ec.confidence : null,
                pnl: net,
                fees,
                reason: pos.closeReason || null,
                regime: ec ? ec.regime : null,
                session: ec ? _sessionName(ec.session) : null,
                opened_at: ec ? ec.openedAt : (+pos.openedAt || null),
                closed_at: Date.now(),
                decision_json: ec ? JSON.stringify({ reasons: ec.reasons, entryScore: ec.entryScore }) : null,
            });
            if (st.openCtx && st.openCtx[String(pos.seq)]) { delete st.openCtx[String(pos.seq)]; _saveState(pos.userId, st); }
        } catch (e) { try { logger.error('ARES', `journal write failed seq=${pos.seq}: ${e.message}`); } catch (_) { } }
        logger.info('ARES', `[ARES CLOSE] uid=${pos.userId} seq=${pos.seq} net=$${net.toFixed(2)} balance=$${st.wallet.balance.toFixed(2)} wr10=${eng.winRate10}%`);
        try { require('./audit').record('ARES_CLOSE', { userId: pos.userId, seq: pos.seq, net: +net.toFixed(2), balance: +st.wallet.balance.toFixed(2) }, 'SERVER_ARES'); } catch (_) { }
    } catch (e) {
        logger.error('ARES', `close hook failed seq=${pos && pos.seq}: ${e.message}`);
    }
}

// ── Wallet ops (API-driven; client buttons call these) ─────────────────────
function fund(userId, amount) {
    const v = +amount;
    if (!Number.isFinite(v) || v <= 0) return { ok: false, error: 'Invalid amount' };
    const st = _loadState(userId);
    st.wallet.balance += v;
    st.wallet.fundedTotal += v;
    _saveState(userId, st);
    return { ok: true, balance: st.wallet.balance };
}

function withdraw(userId, amount) {
    const v = +amount;
    if (!Number.isFinite(v) || v <= 0) return { ok: false, error: 'Invalid amount' };
    // [2026-06-24 HARDENING] withdraw race — refuse while an ARES entry is mid-dispatch (the live
    // order may be landing but not yet reflected in locked/positions). Belt-and-suspenders on top
    // of the locked/open-position checks below.
    if (_entryInFlight.has(userId)) return { ok: false, error: 'Entry in progress — try again in a moment' };
    const st = _loadState(userId);
    if (st.wallet.locked > 0 || _openAresPositions(userId).length > 0) return { ok: false, error: 'Open positions / locked funds' };
    if (v > st.wallet.balance) return { ok: false, error: 'Insufficient balance' };
    st.wallet.balance -= v;
    _saveState(userId, st);
    return { ok: true, balance: st.wallet.balance };
}

// ── Public state for sync payload / UI ─────────────────────────────────────
function getPublicState(userId) {
    const st = _loadState(userId);
    const now = Date.now();
    const traj = _trajectory(st, now);
    return {
        enabled: MF.SERVER_ARES === true,
        wallet: {
            balance: +st.wallet.balance.toFixed(2),
            locked: +st.wallet.locked.toFixed(2),
            available: +Math.max(0, st.wallet.balance - st.wallet.locked).toFixed(2),
            realizedPnL: +st.wallet.realizedPnL.toFixed(2),
            fundedTotal: +st.wallet.fundedTotal.toFixed(2),
        },
        engine: {
            winRate10: st.engine.winRate10,
            consecutiveLoss: st.engine.consecutiveLoss,
            consecutiveWin: st.engine.consecutiveWin,
            totalTrades: st.engine.totalTrades,
            totalWins: st.engine.totalWins,
            totalLosses: st.engine.totalLosses,
        },
        trajectory: { delta: traj.delta, daysPassed: traj.daysPassed },
        openPositions: _openAresPositions(userId).length,
        lastDecision: st.lastDecision,
        serverSide: true,
        // [2026-06-23] Safety controls (read) for the opt-in/kill UI.
        realOptIn: st.realOptIn === true,
        realOptInTs: st.realOptInTs || null,
        killSwitch: st.killSwitch === true,
        dailyLoss: st.dailyLoss ? { day: st.dailyLoss.day, lossUsd: +(+st.dailyLoss.lossUsd || 0).toFixed(2) } : null,
        // [2026-06-23] Live REAL exchange balance ARES would trade with (0 if not on real / not yet fetched).
        realBalance: +(_realAvailable(userId) || 0).toFixed(2),
        // [2026-06-24 HARDENING] Stale-balance visibility for the UI.
        realBalanceStale: _realBalanceMeta(userId).stale === true && _realAvailable(userId) > 0,
        // [2026-06-24] ARES active toggle (mutual exclusion with AT) for the UI.
        aresActive: st.aresActive === true,
    };
}

// [2026-06-23] REAL-money consent — server-authoritative setter/getter. The ONLY way realOptIn
// flips true; an operator/user endpoint or admin action calls setRealOptIn. Never set by client sync.
function setRealOptIn(userId, value, now) {
    const st = _loadState(userId);
    st.realOptIn = value === true;
    st.realOptInTs = st.realOptIn ? (Number.isFinite(+now) ? +now : Date.now()) : null;
    _saveState(userId, st);
    try { logger.info('ARES', `[consent] uid=${userId} realOptIn → ${st.realOptIn}`); } catch (_) { }
    return st.realOptIn;
}
function getRealOptIn(userId) {
    try { return _loadState(userId).realOptIn === true; } catch (_) { return false; }
}
// [2026-06-23] Persistent kill-switch — server-authoritative. True = ARES hard-stopped for the
// user across restarts until explicitly re-enabled. Stripped from client sync.
function setKillSwitch(userId, value) {
    const st = _loadState(userId);
    st.killSwitch = value === true;
    _saveState(userId, st);
    try { logger.info('ARES', `[kill] uid=${userId} killSwitch → ${st.killSwitch}`); } catch (_) { }
    return st.killSwitch;
}
function getKillSwitch(userId) {
    try { return _loadState(userId).killSwitch === true; } catch (_) { return false; }
}
// [2026-06-24] Per-user ARES ACTIVE toggle (mutual exclusion with AT/Brain). Turning ARES ON
// FORCES AT off for BOTH modes on this account (so only ARES trades — no conflicting positions
// on the same symbol). Server-authoritative; stripped from client sync.
function setAresActive(userId, value, now) {
    const on = value === true;
    if (on) {
        // Stop AT first (defense-in-depth: AT entries are also blocked in processBrainDecision
        // while aresActive, but we flip the visible toggle off too). Best-effort; never throws.
        try {
            const at = _serverAT();
            if (at && typeof at.toggleActive === 'function') {
                at.toggleActive(userId, false, 'demo');
                at.toggleActive(userId, false, 'live');
            }
        } catch (e) { try { logger.warn('ARES', `[active] uid=${userId} could not force AT off: ${e && e.message}`); } catch (_) { } }
    }
    const st = _loadState(userId);
    st.aresActive = on;
    st.aresActiveTs = on ? (Number.isFinite(+now) ? +now : Date.now()) : null;
    _saveState(userId, st);
    try { logger.info('ARES', `[active] uid=${userId} aresActive → ${on}${on ? ' (AT forced off)' : ''}`); } catch (_) { }
    return on;
}
function getAresActive(userId) {
    try { return _loadState(userId).aresActive === true; } catch (_) { return false; }
}

module.exports = {
    tick, onPositionClosed, fund, withdraw, getPublicState, _recordEntryContext,
    setRealOptIn, getRealOptIn, setKillSwitch, getKillSwitch, setAresActive, getAresActive,
    _loadStateForTest: _loadState, _saveStateForTest: _saveState, _trajectoryForTest: _trajectory,
    _setRealBalanceForTest, _resetRealBalanceForTest, _realAvailableForTest: _realAvailable,
    _realBalanceMetaForTest: _realBalanceMeta, _setEntryInFlightForTest,
};

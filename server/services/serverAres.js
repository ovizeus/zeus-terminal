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
    };
}

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

    const decision = evaluateAres({
        now,
        balance: st.wallet.balance,
        available: Math.max(0, st.wallet.balance - st.wallet.locked),
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

    // ── GO: sizing + dispatch through serverAT ──
    let sizing = aresSizing({ balance: st.wallet.balance, available: Math.max(0, st.wallet.balance - st.wallet.locked), confidence, atrPct: +mctx.atrPct || 0 });
    // [2026-06-23] REAL-money safety caps — clamp stake-fraction + leverage on a REAL account
    // (testnet/demo unchanged). Defense layer for autonomous real trading: never risk the
    // aggressive 25%/20x testnet geometry with real capital. env from serverAT's single source.
    let _execEnv = null;
    try { _execEnv = (_serverAT().resolveExecutionEnv(userId) || {}).env; } catch (_) { _execEnv = null; }
    // [2026-06-23] REAL-money consent gate (fail-closed): never auto-trade real capital for a user
    // who has not explicitly opted in. env resolution can throw → _execEnv null → not REAL → safe.
    if (_execEnv === 'REAL' && st.realOptIn !== true) {
        try { logger.info('ARES', `[consent] uid=${userId} REAL entry blocked — no real opt-in (fail-closed)`); } catch (_) { }
        _saveState(userId, st);
        return null;
    }
    sizing = applyRealCaps(sizing, _execEnv, { balance: st.wallet.balance });
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
    try {
        entry = _serverAT().processBrainDecision(aresDecision, stc, userId, sizing.stake);
    } catch (e) {
        logger.error('ARES', `entry dispatch failed uid=${userId}: ${e.message}`);
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
        const stake = Number.isFinite(+(st.lastDecision && st.lastDecision.stake)) && st.lastDecision.executedSeq === pos.seq
            ? +st.lastDecision.stake : (+pos.margin || 0);
        st.wallet.locked = Math.max(0, st.wallet.locked - stake);
        const gross = +pos.closePnl || 0;
        const fees = (Number.isFinite(+pos.size) && Number.isFinite(+pos.lev)) ? (+pos.size * +pos.lev * FEE_TAKER * 2) : 0;
        const net = gross - fees;
        st.wallet.balance = Math.max(0, st.wallet.balance + net);
        st.wallet.realizedPnL += net;

        const isWin = net > 0;
        eng.tradeHistory.unshift(isWin);
        if (eng.tradeHistory.length > 10) eng.tradeHistory = eng.tradeHistory.slice(0, 10);
        eng.totalTrades++;
        if (isWin) { eng.consecutiveWin++; eng.consecutiveLoss = 0; eng.totalWins++; }
        else if (net !== 0) { eng.consecutiveLoss++; eng.consecutiveWin = 0; eng.lastLossTs = Date.now(); eng.totalLosses++; }
        const wins = eng.tradeHistory.filter(Boolean).length;
        eng.winRate10 = eng.tradeHistory.length > 0 ? Math.round(wins / eng.tradeHistory.length * 100) : 0;
        _saveState(pos.userId, st);
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

module.exports = {
    tick, onPositionClosed, fund, withdraw, getPublicState,
    setRealOptIn, getRealOptIn,
    _loadStateForTest: _loadState, _saveStateForTest: _saveState, _trajectoryForTest: _trajectory,
};

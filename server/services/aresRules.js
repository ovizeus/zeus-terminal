'use strict';
// [SERVER-ARES 2026-06-07] ARES decision + sizing rules — PURE, no I/O.
// Ported from client engine/aresDecision.ts + aresExecute.ts + ares.ts
// (_computeState/_computeConfidence) with SERVER inputs:
//  - regime: server taxonomy (TREND/TREND_UP/TREND_DOWN/BREAKOUT/RANGE/SQUEEZE/VOLATILE)
//    — client used lowercase {trend, breakout} from the client BRAIN classifier.
//  - entryScore: server confluence score (client used w.BM.entryScore).
//  - side: regime direction (TREND_UP/DOWN) or trendBias (client used
//    w.S.signalData bull/bear counts — not available server-side).
// Thresholds kept 1:1. Callers (serverAres.js) supply resolved context.

const MIN_CONFIDENCE = 68;
const MIN_ENTRY_SCORE = 55;
const MAX_OPEN_POSITIONS = 1;
const MIN_BALANCE_USDT = 5;
const COOLDOWN_MS = 5 * 60 * 1000;
const LOSS_STREAK_BLOCK = 3;
const REVENGE_COOLDOWN_MS = 10 * 60 * 1000;
const TRADE_REGIMES = new Set(['TREND', 'TREND_UP', 'TREND_DOWN', 'BREAKOUT']);

// [2026-06-23] REAL-money safety caps. On a REAL account ARES must NOT use the
// aggressive testnet geometry (up to 25% of balance / 20x). These hard caps clamp
// stake-fraction and leverage when env==='REAL'. Conservative defaults, overridable
// via env vars. TESTNET/DEMO are unchanged (caps only bite on REAL). Fail-closed:
// any unparseable override falls back to the conservative default.
function _capNum(envVal, def, lo, hi) {
    const n = Number(envVal);
    if (!Number.isFinite(n) || n <= 0) return def;
    return Math.min(hi, Math.max(lo, n));
}
const REAL_MAX_STAKE_PCT = _capNum(process.env.ARES_REAL_MAX_STAKE_PCT, 0.02, 0.001, 0.10); // soft cap: 2% of balance
const REAL_MAX_LEVERAGE = _capNum(process.env.ARES_REAL_MAX_LEVERAGE, 5, 1, 20);             // 5x
// [2026-06-23] Small-account viability. On a tiny real account the 2% soft cap would size a trade
// below the exchange minimum notional (e.g. $50 × 2% = $1) → ARES could never trade. So allow a
// MIN-notional floor, but never let that floor exceed a HARD ceiling fraction of balance. Below
// the ceiling-vs-min threshold the account is too small to trade at all (returns stake 0).
const REAL_MIN_NOTIONAL = _capNum(process.env.ARES_REAL_MIN_NOTIONAL, 5, 1, 100);            // min placeable stake $
const REAL_CEILING_PCT = _capNum(process.env.ARES_REAL_CEILING_PCT, 0.25, 0.05, 0.50);       // hard per-trade ceiling

/**
 * Clamp ARES sizing for REAL accounts. PURE. Returns a NEW sizing object; never mutates input.
 * - env !== 'REAL' (TESTNET/DEMO/null) → returned unchanged (caps only apply to real money).
 * - env === 'REAL' → leverage ≤ REAL_MAX_LEVERAGE; stake = soft-capped to balance × REAL_MAX_STAKE_PCT,
 *   raised to REAL_MIN_NOTIONAL if below (so small accounts can still place a valid trade), but never
 *   above the hard ceiling balance × REAL_CEILING_PCT. If even the ceiling < min notional → stake 0
 *   (account too small to trade safely). Adds capped/capsApplied telemetry.
 */
function applyRealCaps(sizing, env, ctx) {
    const s = sizing || {};
    if (env !== 'REAL') return { ...s, capped: false, capsApplied: null };
    const bal = Math.max(0, +(ctx && ctx.balance) || 0);
    const inStake = +s.stake || 0;
    const inLev = +s.leverage || 0;
    const leverage = Math.max(1, Math.min(inLev, REAL_MAX_LEVERAGE));
    const ceiling = bal * REAL_CEILING_PCT;
    let stake;
    if (ceiling < REAL_MIN_NOTIONAL) {
        stake = 0; // account too small for a viable, safely-bounded trade
    } else {
        const soft = Math.min(inStake, bal * REAL_MAX_STAKE_PCT);
        stake = Math.min(Math.max(soft, REAL_MIN_NOTIONAL), ceiling);
    }
    stake = Math.round(stake * 100) / 100;
    const capped = stake !== Math.round(inStake * 100) / 100 || leverage < inLev;
    return {
        ...s, stake, leverage, capped,
        capsApplied: capped
            ? { maxStakePct: REAL_MAX_STAKE_PCT, maxLeverage: REAL_MAX_LEVERAGE, minNotional: REAL_MIN_NOTIONAL, ceilingPct: REAL_CEILING_PCT, fromStake: inStake, fromLeverage: inLev }
            : null,
    };
}

function _session(hourUtc) {
    if (hourUtc >= 1 && hourUtc < 8) return 'ASIA';
    if (hourUtc >= 7 && hourUtc < 12) return 'LONDON';
    if (hourUtc >= 13 && hourUtc < 21) return 'NEW YORK';
    return 'OFF-HOURS';
}

/**
 * Evaluate the full ARES gate matrix. Returns
 * { shouldTrade, side, confidence, reasons[], session }.
 * reasons = block list when blocked, GO rationale when tradeable.
 */
function evaluateAres(ctx) {
    const c = ctx || {};
    const now = c.now || 0;
    const blocks = [];
    const reasons = [];

    const bal = +c.balance || 0;
    if (bal < MIN_BALANCE_USDT) blocks.push(`Wallet too low: $${bal.toFixed(2)} < $${MIN_BALANCE_USDT}`);
    const avail = +c.available || 0;
    if (avail < MIN_BALANCE_USDT) blocks.push(`No available funds: $${avail.toFixed(2)}`);
    if ((+c.openAresCount || 0) >= MAX_OPEN_POSITIONS) blocks.push(`Max open positions reached: ${c.openAresCount}/${MAX_OPEN_POSITIONS}`);
    if (c.killActive === true) blocks.push('Kill switch active');

    const lastTradeTs = +c.lastTradeTs || 0;
    if (lastTradeTs > 0 && (now - lastTradeTs) < COOLDOWN_MS) {
        blocks.push(`Cooldown active: ${Math.round((COOLDOWN_MS - (now - lastTradeTs)) / 1000)}s remaining`);
    }

    const regime = String(c.regime || 'UNKNOWN');
    if (!TRADE_REGIMES.has(regime)) blocks.push(`Regime not favorable: ${regime} (need TREND*/BREAKOUT)`);

    const session = _session(+c.sessionHourUtc);
    if (session !== 'LONDON' && session !== 'NEW YORK') blocks.push(`Session inactive: ${session}`);

    const stateId = String(c.stateId || 'DETERMINED');
    if (stateId === 'DEFENSIVE' || stateId === 'REVENGE_GUARD') blocks.push(`ARES state: ${stateId} — blocking trades`);

    const cl = +c.consecutiveLoss || 0;
    if (cl >= LOSS_STREAK_BLOCK) {
        const sinceLoss = now - (+c.lastLossTs || 0);
        if (sinceLoss < REVENGE_COOLDOWN_MS) {
            blocks.push(`Loss streak ${cl} — revenge cooldown: ${Math.round((REVENGE_COOLDOWN_MS - sinceLoss) / 1000)}s`);
        }
    }

    const entryScore = +c.entryScore || 0;
    if (entryScore < MIN_ENTRY_SCORE) blocks.push(`Entry score too low: ${entryScore} < ${MIN_ENTRY_SCORE}`);

    const confidence = +c.confidence || 0;
    if (confidence < MIN_CONFIDENCE) blocks.push(`Confidence too low: ${confidence} < ${MIN_CONFIDENCE}`);

    // Direction: directional regimes dictate; plain TREND/BREAKOUT need a bias.
    let side = null;
    if (regime === 'TREND_UP') side = 'LONG';
    else if (regime === 'TREND_DOWN') side = 'SHORT';
    else if (c.trendBias === 'bullish') side = 'LONG';
    else if (c.trendBias === 'bearish') side = 'SHORT';
    if (!side) blocks.push(`No clear signal direction (regime=${regime} bias=${c.trendBias || 'n/a'})`);
    else reasons.push(`Direction ${side} (regime=${regime} bias=${c.trendBias || 'n/a'})`);

    const atrPct = +c.atrPct || 0;
    if (atrPct > 3.0) blocks.push(`Extreme volatility: ATR ${atrPct.toFixed(2)}% > 3%`);

    if (blocks.length > 0) {
        return { shouldTrade: false, side: null, confidence: 0, reasons: blocks, session };
    }
    reasons.push(`Regime: ${regime}`, `Session: ${session}`, `Confidence: ${confidence}`, `EntryScore: ${entryScore}`, `Balance: $${bal.toFixed(2)}`);
    return { shouldTrade: true, side, confidence, reasons, session };
}

/**
 * Stake / leverage / SL geometry — port of aresExecute sizing.
 * Returns { stake, leverage, slPct, rr }.
 * slPct = 1.5×ATR (SL distance), TP = 2×ATR ⇒ rr = 4/3.
 */
function aresSizing(ctx) {
    const c = ctx || {};
    const bal = +c.balance || 0;
    const avail = +c.available || 0;
    const confidence = +c.confidence || 50;
    const atrPct = (Number.isFinite(+c.atrPct) && +c.atrPct > 0) ? +c.atrPct : 1.5;

    let stakePct;
    if (bal < 300) stakePct = 0.10;
    else if (bal < 1000) stakePct = 0.12;
    else if (bal < 5000) stakePct = 0.15;
    else if (bal < 10000) stakePct = 0.18;
    else stakePct = 0.20;
    if (confidence >= 80) stakePct += 0.03;
    const volScore = Math.min(100, Math.round(atrPct / 3 * 100));
    if (volScore >= 80) stakePct -= 0.05;
    stakePct = Math.min(0.25, Math.max(0.05, stakePct));

    let stake = bal * stakePct;
    stake = Math.max(5, Math.min(stake, avail, bal * 0.25));
    stake = Math.round(stake * 100) / 100;

    const leverage = Math.min(20, Math.max(5, Math.round(10 + 0.5 * confidence - 2 * atrPct)));

    return { stake, leverage, slPct: atrPct * 1.5, rr: 4 / 3 };
}

/** Port of ares.ts _computeConfidence with server inputs. Clamped [1,99]. */
function computeAresConfidence(ctx) {
    const c = ctx || {};
    let score = 50;
    const regime = String(c.regime || '');
    if (regime === 'TREND_UP' || regime === 'TREND_DOWN') score += 15;       // strong directional
    else if (regime === 'TREND' || regime === 'BREAKOUT') score += 8;
    else if (regime === 'RANGE') score -= 10;
    const es = +c.entryScore || 0;
    if (es >= 80) score += 12; else if (es >= 65) score += 5; else if (es < 45) score -= 12;
    const delta = +c.trajectoryDelta || 0;
    if (delta > 5) score += 8; else if (delta > 0) score += 3; else if (delta < -10) score -= 15; else if (delta < -3) score -= 7;
    // winRate10 = null/undefined ⇒ NO trade history yet ⇒ neutral 50. A
    // literal port (0 ⇒ −15) deadlocks a fresh server engine: confidence can
    // never reach the 68 entry bar, so it can never earn the history that
    // would raise the win rate. The client never hit this because its
    // localStorage carried years of history.
    const wr = (c.winRate10 == null) ? 50 : +c.winRate10;
    score += Math.round((wr - 50) * 0.3);
    return Math.min(99, Math.max(1, score));
}

/** Port of ares.ts _computeState. Returns { id }. */
function computeAresEngineState(ctx) {
    const c = ctx || {};
    const cl = +c.consecutiveLoss || 0;
    const cw = +c.consecutiveWin || 0;
    const wr = +c.winRate10 || 0;
    const delta = +c.trajectoryDelta || 0;
    const timeSinceLoss = (c.now || 0) - (+c.lastLossTs || 0);
    if (cl >= 3 && timeSinceLoss < 300000) return { id: 'REVENGE_GUARD' };
    if (cl >= 4 || delta < -15 || c.killActive === true) return { id: 'DEFENSIVE' };
    if (cl >= 3 || delta < -8) return { id: 'FRUSTRATED' };
    if (cw >= 3 && wr >= 65) return { id: 'MOMENTUM' };
    if (delta > 5 && wr >= 55) return { id: 'STRATEGIC' };
    if (wr < 50 || delta < -3) return { id: 'FOCUSED' };
    if (cl >= 1 && cl <= 2) return { id: 'RESILIENT' };
    return { id: 'DETERMINED' };
}

module.exports = { evaluateAres, aresSizing, computeAresConfidence, computeAresEngineState, applyRealCaps, REAL_MAX_STAKE_PCT, REAL_MAX_LEVERAGE, REAL_MIN_NOTIONAL, REAL_CEILING_PCT };

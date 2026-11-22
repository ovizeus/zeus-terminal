'use strict';

/**
 * ML Plan v3 Phase 5 — Influence Eligibility Gate.
 *
 * Decides whether a (userId, env, symbol, regime) cell may enter the Day 3
 * influence pipeline. Composes:
 *   1. banditPosteriors L4 observationCount >= MIN_OBSERVATIONS
 *   2. versionRegistry has active version for ('ring5-bandit-influence', 'phase4')
 *   3. preRegistration has non-terminal entry for that version
 *   4. preReg eval window not expired
 *
 * On any failure, returns eligible=false with specific reason — caller (wrap)
 * falls back to shadow mode with audit row gate_status='skipped'.
 */

const bp = require('./banditPosteriors');
const versionRegistry = require('../R5B_governance/versionRegistry');
const preRegistration = require('../R5B_governance/preRegistration');
const MF = require('../../../migrationFlags');

const MIN_OBSERVATIONS = 30;
const INFLUENCE_COMPONENT_TYPE = 'model';
const INFLUENCE_COMPONENT_ID = 'ring5-bandit-influence-phase4';
const TERMINAL_PREREG_STATES = new Set(['PASS', 'FAIL', 'INVALID']);

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`influenceEligibility: missing ${k}`);
    return p[k];
}

function checkEligibility(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'env');
    const symbol = _required(params, 'symbol');
    const regime = _required(params, 'regime');
    const nowTs = _required(params, 'nowTs');

    if (!MF.ML_PIPELINE_SHADOW) {
        return {
            eligible: false,
            reason: 'ml_pipeline_shadow_disabled',
            observationCount: 0,
            preRegStatus: null,
            versionId: null,
        };
    }

    const envUpper = (env || '').toUpperCase();
    const envAllowed =
        (envUpper === 'DEMO' && MF.ML_DEMO_INFLUENCE_ENABLED) ||
        (envUpper === 'TESTNET' && MF.ML_TESTNET_INFLUENCE_ENABLED) ||
        (envUpper === 'REAL' && MF.ML_LIVE_INFLUENCE_ENABLED);
    if (!envAllowed) {
        return {
            eligible: false,
            reason: 'influence_disabled_for_env',
            observationCount: 0,
            preRegStatus: null,
            versionId: null,
            env: envUpper,
        };
    }

    // [REAL-GATE P0-3 2026-06-09] Real money requires the user's explicit,
    // audited consent — checked HERE so no downstream math can bypass it.
    // ML_LIVE_OPTIN_REQUIRED defaults TRUE (fail-closed); ONLY an explicit
    // boolean false disables the gate — a missing/undefined flag means the
    // gate stays ON. Setting it false is a deliberate operator escape hatch
    // (see REAL-GATE-CHECKLIST runbook).
    if (envUpper === 'REAL' && MF.ML_LIVE_OPTIN_REQUIRED !== false) {
        const mlLiveOptin = require('../mlLiveOptin');
        if (!mlLiveOptin.isOptedIn(userId)) {
            return {
                eligible: false,
                reason: 'live_optin_missing',
                observationCount: 0,
                preRegStatus: null,
                versionId: null,
                env: envUpper,
            };
        }
    }

    // [2026-11-22] Celula contului (L4) SAU, daca e prea subtire, celula comuna tuturor
    // conturilor pe acelasi mediu/moneda/regim (L3). Pana azi doar L4 conta: 7 celule din
    // 240 aveau 30 de observatii, desi L3 strange sute. DEMO nu se amesteca cu TESTNET
    // (cheia L3 contine mediul). Asa merge pentru toti utilizatorii, si pentru cei noi.
    const l4 = bp.getPosterior({ level: 4, cellKey: `${userId}:${env}:${symbol}:${regime}` });
    const l4Count = l4 ? l4.observationCount : 0;
    let observationCount = l4Count;
    let cellLevel = 4;
    if (l4Count < MIN_OBSERVATIONS) {
        const l3Key = typeof bp.buildCellKey === 'function'
            ? bp.buildCellKey({ level: 3, env, symbol, regime })
            : `${env}:${symbol}:${regime}`;
        const l3 = bp.getPosterior({ level: 3, cellKey: l3Key });
        const l3Count = l3 ? l3.observationCount : 0;
        if (l3Count >= MIN_OBSERVATIONS) { observationCount = l3Count; cellLevel = 3; }
    }

    if (observationCount < MIN_OBSERVATIONS) {
        return {
            eligible: false,
            reason: 'insufficient_observations',
            observationCount,
            preRegStatus: null,
            versionId: null
        };
    }

    const activeVersion = versionRegistry.getActive(INFLUENCE_COMPONENT_TYPE, INFLUENCE_COMPONENT_ID);
    if (!activeVersion) {
        return {
            eligible: false,
            reason: 'no_active_version',
            observationCount,
            preRegStatus: null,
            versionId: null
        };
    }

    const activeReg = currentRegistration(activeVersion.id, nowTs);
    if (!activeReg) {
        const everRegistered = preRegistration.getRegistrationsForVersion(activeVersion.id).length > 0;
        return {
            eligible: false,
            reason: everRegistered ? 'eval_window_expired' : 'no_active_pre_registration',
            observationCount,
            preRegStatus: null,
            versionId: activeVersion.id
        };
    }

    return {
        eligible: true,
        reason: 'all_checks_passed',
        observationCount,
        cellLevel,
        preRegStatus: activeReg.state,
        versionId: activeVersion.id
    };
}

// [2026-11-22] Fereastra de evaluare care ACOPERA acum. Fereastra din iunie (#6554) s-a
// terminat pe 9 iulie 2026 si de atunci Ring5 a respins tot cu `eval_window_expired`,
// in tacere, desi panoul arata ACTIVE. Acum: o fereastra de ROLLING_WINDOW_DAYS se
// reinnoieste singura — cea expirata se inchide INVALID (nemasurata), apoi se
// inregistreaza una noua. Incercarea e limitata la o data pe ora.
const ROLLING_WINDOW_DAYS = 30;
const RENEW_RETRY_MS = 3600_000;
let _lastRenewAttempt = 0;

function _covering(regs, nowTs) {
    return regs.find(r => !TERMINAL_PREREG_STATES.has(r.state)
        && nowTs >= r.eval_window_from && nowTs <= r.eval_window_to) || null;
}

function currentRegistration(versionId, nowTs) {
    const regs = preRegistration.getRegistrationsForVersion(versionId);
    const cur = _covering(regs, nowTs);
    if (cur) return cur;
    // Reinnoirea continua o ipoteza inregistrata de operator; nu o inventeaza de la zero.
    if (regs.length === 0) return null;
    if (nowTs - _lastRenewAttempt < RENEW_RETRY_MS) return null;
    _lastRenewAttempt = nowTs;
    try {
        for (const r of regs) {
            if (!TERMINAL_PREREG_STATES.has(r.state) && nowTs > r.eval_window_to) {
                preRegistration.expireUnevaluated({ id: r.id, nowTs });
            }
        }
        preRegistration.registerHypothesis({
            versionId,
            hypothesis: 'Ring5 confidence delta proposer (boost/cut) yields net-positive impact on closed-trade outcomes vs phase2-only baseline (rolling window).',
            predictedMetrics: { winRateDelta: 0.03 },
            successCriteria: [{ metric: 'winRateDelta', op: '>=', value: 0.00 }],
            evalWindow: { fromMs: nowTs, toMs: nowTs + ROLLING_WINDOW_DAYS * 86400000 },
            actor: 'system:rolling-window',
        });
    } catch (_) { /* governance error → stays not eligible (fail-closed) */ }
    return _covering(preRegistration.getRegistrationsForVersion(versionId), nowTs);
}

function _resetRenewThrottleForTest() { _lastRenewAttempt = 0; }

module.exports = {
    MIN_OBSERVATIONS,
    ROLLING_WINDOW_DAYS,
    currentRegistration,
    _resetRenewThrottleForTest,
    INFLUENCE_COMPONENT_TYPE,
    INFLUENCE_COMPONENT_ID,
    checkEligibility
};

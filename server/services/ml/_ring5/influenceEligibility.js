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

    const cellKey = `${userId}:${env}:${symbol}:${regime}`;
    const l4 = bp.getPosterior({ level: 4, cellKey });
    const observationCount = l4 ? l4.observationCount : 0;

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

    const regs = preRegistration.getRegistrationsForVersion(activeVersion.id);
    const activeReg = regs.find(r => !TERMINAL_PREREG_STATES.has(r.state));
    if (!activeReg) {
        return {
            eligible: false,
            reason: 'no_active_pre_registration',
            observationCount,
            preRegStatus: null,
            versionId: activeVersion.id
        };
    }

    if (nowTs > activeReg.eval_window_to) {
        return {
            eligible: false,
            reason: 'eval_window_expired',
            observationCount,
            preRegStatus: activeReg.state,
            versionId: activeVersion.id
        };
    }

    return {
        eligible: true,
        reason: 'all_checks_passed',
        observationCount,
        preRegStatus: activeReg.state,
        versionId: activeVersion.id
    };
}

module.exports = {
    MIN_OBSERVATIONS,
    INFLUENCE_COMPONENT_TYPE,
    INFLUENCE_COMPONENT_ID,
    checkEligibility
};

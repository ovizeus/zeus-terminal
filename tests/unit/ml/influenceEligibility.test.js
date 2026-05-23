'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r5-elig-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const bp = require('../../../server/services/ml/_ring5/banditPosteriors');
const versionRegistry = require('../../../server/services/ml/R5B_governance/versionRegistry');
const preRegistration = require('../../../server/services/ml/R5B_governance/preRegistration');
const elig = require('../../../server/services/ml/_ring5/influenceEligibility');

const _now = () => Date.now();
const _cellKey = (uid, env, symbol, regime) => `${uid}:${env}:${symbol}:${regime}`;

function _seedObservations(cellKey, count) {
    for (let i = 0; i < count; i++) {
        bp.updatePosterior({ level: 4, cellKey, outcomeClass: 'positive', ts: _now() });
    }
}

function _seedActiveVersion() {
    const proposed = versionRegistry.proposeVersion({
        componentType: 'model',
        componentId: 'ring5-bandit-influence-phase4',
        version: 'v1.0.0',
        config: { thresholds: { POS_BANDIT: 0.70 } },
        motivation: 'test',
        actor: 'test'
    });
    versionRegistry.activateVersion({ id: proposed.id });
    return proposed.id;
}

function _seedActivePreReg(versionId, evalToMs) {
    return preRegistration.registerHypothesis({
        versionId,
        hypothesis: 'Ring5 confidence delta improves win rate by 3%',
        predictedMetrics: { winRateDelta: 0.03 },
        successCriteria: [{ metric: 'winRateDelta', op: '>=', value: 0.02 }],
        evalWindow: { fromMs: _now() - 86400000, toMs: evalToMs },
        actor: 'test'
    });
}

function clean() {
    db.prepare("DELETE FROM ml_bandit_posteriors").run();
    db.prepare("DELETE FROM ml_hypothesis_pre_registrations").run();
    db.prepare("DELETE FROM ml_governance_versions").run();
}

describe('influenceEligibility.checkEligibility', () => {
    beforeEach(clean);

    test('exposes MIN_OBSERVATIONS = 30 constant', () => {
        expect(elig.MIN_OBSERVATIONS).toBe(30);
    });

    test('returns eligible=false reason=insufficient_observations when bandit untrained', () => {
        const r = elig.checkEligibility({
            userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: _now()
        });
        expect(r.eligible).toBe(false);
        expect(r.reason).toBe('insufficient_observations');
        expect(r.observationCount).toBe(0);
    });

    test('returns eligible=false reason=no_active_version when bandit trained but no version', () => {
        _seedObservations(_cellKey(1, 'DEMO', 'BTCUSDT', 'trending'), 30);
        const r = elig.checkEligibility({
            userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: _now()
        });
        expect(r.eligible).toBe(false);
        expect(r.reason).toBe('no_active_version');
        expect(r.observationCount).toBe(30);
        expect(r.versionId).toBeNull();
    });

    test('returns eligible=false reason=no_active_pre_registration when version exists but no preReg', () => {
        _seedObservations(_cellKey(1, 'DEMO', 'BTCUSDT', 'trending'), 30);
        const versionId = _seedActiveVersion();
        const r = elig.checkEligibility({
            userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: _now()
        });
        expect(r.eligible).toBe(false);
        expect(r.reason).toBe('no_active_pre_registration');
        expect(r.versionId).toBe(versionId);
        expect(r.preRegStatus).toBeNull();
    });

    test('returns eligible=true when all gates pass', () => {
        _seedObservations(_cellKey(1, 'DEMO', 'BTCUSDT', 'trending'), 30);
        const versionId = _seedActiveVersion();
        _seedActivePreReg(versionId, _now() + 86400000);
        const r = elig.checkEligibility({
            userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: _now()
        });
        expect(r.eligible).toBe(true);
        expect(r.reason).toBe('all_checks_passed');
        expect(r.observationCount).toBe(30);
        expect(r.versionId).toBe(versionId);
        expect(r.preRegStatus).toBe('REGISTERED');
    });

    test('returns eligible=false reason=eval_window_expired when nowTs > eval_window_to_ms', () => {
        _seedObservations(_cellKey(1, 'DEMO', 'BTCUSDT', 'trending'), 30);
        const versionId = _seedActiveVersion();
        _seedActivePreReg(versionId, _now() - 1000);
        const r = elig.checkEligibility({
            userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: _now()
        });
        expect(r.eligible).toBe(false);
        expect(r.reason).toBe('eval_window_expired');
    });

    test('per-cell isolation: user 1 trained, user 2 not -> only user 1 eligible', () => {
        _seedObservations(_cellKey(1, 'DEMO', 'BTCUSDT', 'trending'), 30);
        const versionId = _seedActiveVersion();
        _seedActivePreReg(versionId, _now() + 86400000);

        const r1 = elig.checkEligibility({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: _now() });
        const r2 = elig.checkEligibility({ userId: 2, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: _now() });

        expect(r1.eligible).toBe(true);
        expect(r2.eligible).toBe(false);
        expect(r2.reason).toBe('insufficient_observations');
    });
});

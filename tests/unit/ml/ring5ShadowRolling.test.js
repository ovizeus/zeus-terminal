'use strict';
// [2026-11-22] Ring5 in UMBRA pentru toti utilizatorii: fereastra de evaluare care se
// reinnoieste singura, celula comuna (L3) cand celula contului (L4) e subtire,
// decizia notata dar NEAPLICATA cat RING5_INFLUENCE_APPLY e oprit.
const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r5-shadow-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

let APPLY = false;
jest.mock('../../../server/migrationFlags', () => {
    const actual = jest.requireActual('../../../server/migrationFlags');
    const ON = new Set(['ML_PIPELINE_SHADOW', 'ML_INGEST_ENABLED', 'ML_DEMO_INFLUENCE_ENABLED', 'ML_TESTNET_INFLUENCE_ENABLED', 'ML_LIVE_INFLUENCE_ENABLED']);
    return new Proxy(actual, { get: (t, p) => (p === 'RING5_INFLUENCE_APPLY' ? APPLY : ON.has(p) ? true : t[p]) });
});

const { db } = require('../../../server/services/database');
const bp = require('../../../server/services/ml/_ring5/banditPosteriors');
const versionRegistry = require('../../../server/services/ml/R5B_governance/versionRegistry');
const preRegistration = require('../../../server/services/ml/R5B_governance/preRegistration');
const elig = require('../../../server/services/ml/_ring5/influenceEligibility');

function seedVersion(withWindow = true) {
    const v = versionRegistry.proposeVersion({ componentType: 'model', componentId: 'ring5-bandit-influence-phase4', version: 'v1.0.0', config: {}, motivation: 't', actor: 't' });
    versionRegistry.activateVersion({ id: v.id });
    if (withWindow) preRegistration.registerHypothesis({ versionId: v.id, hypothesis: 'h', predictedMetrics: {}, successCriteria: [], evalWindow: { fromMs: Date.now() - 1000, toMs: Date.now() + 86400000 }, actor: 't' });
    return v.id;
}
function seed(level, cellKey, n, cls = 'negative') {
    for (let i = 0; i < n; i++) bp.updatePosterior({ level, cellKey, outcomeClass: cls, ts: Date.now() });
}
beforeEach(() => {
    db.prepare('DELETE FROM ml_bandit_posteriors').run();
    db.prepare('DELETE FROM ml_hypothesis_pre_registrations').run();
    db.prepare('DELETE FROM ml_governance_versions').run();
    db.prepare('DELETE FROM ml_influence_audit').run();
    elig._resetRenewThrottleForTest();
    APPLY = false;
});
afterAll(() => { try { db.close(); } catch (_) {} try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {} });

describe('fereastra de evaluare care se reinnoieste singura', () => {
    test('fereastra expirata (ca #6554, 9 iulie) se inchide INVALID si se deschide una noua de 30 de zile', () => {
        const vid = seedVersion(false);
        const now = Date.now();
        const old = preRegistration.registerHypothesis({ versionId: vid, hypothesis: 'h', predictedMetrics: {}, successCriteria: [], evalWindow: { fromMs: now - 60 * 86400000, toMs: now - 30 * 86400000 }, actor: 't' });
        seed(4, '1:DEMO:BTCUSDT:TREND', 30);
        const r = elig.checkEligibility({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'TREND', nowTs: now });
        expect(r.eligible).toBe(true);
        expect(preRegistration.getRegistration(Number(old.id)).state).toBe('INVALID');
        const cur = elig.currentRegistration(vid, now);
        expect(cur.eval_window_to - cur.eval_window_from).toBe(30 * 86400000);
        expect(cur.actor).toBe('system:rolling-window');
    });
    test('fereastra deschisa nu se atinge', () => {
        const vid = seedVersion(false);
        const now = Date.now();
        const live = preRegistration.registerHypothesis({ versionId: vid, hypothesis: 'h', predictedMetrics: {}, successCriteria: [], evalWindow: { fromMs: now - 1000, toMs: now + 86400000 }, actor: 't' });
        expect(elig.currentRegistration(vid, now).id).toBe(Number(live.id));
        expect(preRegistration.getRegistrationsForVersion(vid).length).toBe(1);
    });
    test('nicio inregistrare vreodata → NU se inventeaza una (no_active_pre_registration)', () => {
        seedVersion(false);
        seed(4, '1:DEMO:BTCUSDT:TREND', 30);
        const r = elig.checkEligibility({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'TREND', nowTs: Date.now() });
        expect(r.eligible).toBe(false);
        expect(r.reason).toBe('no_active_pre_registration');
    });
    test('fara versiune activa → NU eligibil (fail-closed)', () => {
        seed(4, '1:DEMO:BTCUSDT:TREND', 30);
        const r = elig.checkEligibility({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'TREND', nowTs: Date.now() });
        expect(r.eligible).toBe(false);
        expect(r.reason).toBe('no_active_version');
    });
});

describe('celula comuna pentru toti utilizatorii (L3)', () => {
    test('un cont nou (fara istoric) e eligibil prin celula comuna a mediului', () => {
        seedVersion();
        seed(3, 'DEMO:ETHUSDT:TREND', 40);
        const r = elig.checkEligibility({ userId: 999, env: 'DEMO', symbol: 'ETHUSDT', regime: 'TREND', nowTs: Date.now() });
        expect(r.eligible).toBe(true);
        expect(r.cellLevel).toBe(3);
    });
    test('DEMO nu imprumuta din TESTNET', () => {
        seedVersion();
        seed(3, 'TESTNET:ETHUSDT:TREND', 40);
        const r = elig.checkEligibility({ userId: 999, env: 'DEMO', symbol: 'ETHUSDT', regime: 'TREND', nowTs: Date.now() });
        expect(r.eligible).toBe(false);
        expect(r.reason).toBe('insufficient_observations');
    });
    test('celula contului are prioritate cand e plina', () => {
        seedVersion();
        seed(4, '5:DEMO:SOLUSDT:RANGE', 30);
        seed(3, 'DEMO:SOLUSDT:RANGE', 300);
        expect(elig.checkEligibility({ userId: 5, env: 'DEMO', symbol: 'SOLUSDT', regime: 'RANGE', nowTs: Date.now() }).cellLevel).toBe(4);
    });
});

describe('umbra: decizia se noteaza, creierul o primeste neatinsa', () => {
    const svc = require('../../../server/services/ml/ring5LearningService');
    const ts = require('../../../server/services/ml/_ring5/thompsonSampler');
    const prop = require('../../../server/services/ml/_ring5/influenceProposer');
    const gate = require('../../../server/services/ml/_ring5/reflectionGate');
    afterEach(() => jest.restoreAllMocks());
    function setupCut() {
        seedVersion();
        seed(4, '1:DEMO:BTCUSDT:TREND', 40);
        jest.spyOn(ts, 'drawSample').mockReturnValue({ sample: 0.1, level: 4, cellKey: '1:DEMO:BTCUSDT:TREND', alpha: 1, beta: 9 });
        jest.spyOn(prop, 'propose').mockImplementation(({ phase2Decision }) => ({ hasProposal: true, proposedDecision: { ...phase2Decision, confidence: phase2Decision.confidence - 15 }, rationale: 'cut' }));
        jest.spyOn(gate, 'evaluate').mockImplementation(({ proposedDecision }) => ({ accepted: true, finalDecision: proposedDecision, reflectionResult: { totalPenalty: 0 } }));
    }
    const phase2 = { dir: 'LONG', confidence: 70, score: 50, reasons: ['x'], ts: 1, decision: 'SMALL' };
    const call = () => svc.wrap({ userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', phase2Decision: phase2, mode: 'influence', regime: 'TREND', nowTs: Date.now(), tierFor: (c) => (c < 65 ? 'NO_TRADE' : 'SMALL') });

    test('RING5_INFLUENCE_APPLY oprit → decizia creierului NEATINSA, audit shadow_accepted cu treapta', () => {
        setupCut();
        const out = call();
        expect(out.layeredBy).toBe('ring5-influence-shadow');
        expect(out.confidence).toBe(70);
        expect(out.ring5Would.confidence).toBe(55);
        const row = db.prepare("SELECT * FROM ml_influence_audit ORDER BY id DESC LIMIT 1").get();
        expect(row.gate_status).toBe('skipped');
        expect(row.gate_reason).toBe('shadow_accepted');
        const rat = JSON.parse(row.rationale_json);
        expect(rat.phase2Tier).toBe('SMALL');
        expect(rat.wouldTier).toBe('NO_TRADE');
    });
    test('RING5_INFLUENCE_APPLY pornit → decizia aplicata (ce serverBrain foloseste)', () => {
        setupCut();
        APPLY = true;
        const out = call();
        expect(out.layeredBy).toBe('ring5-influence-applied');
        expect(out.confidence).toBe(55);
    });
    test('„skipped" se scrie o data la 10 minute pe celula, nu la fiecare ciclu', () => {
        svc._resetSkipAuditForTest();
        const t0 = Date.now();
        for (let i = 0; i < 5; i++) svc.wrap({ userId: 2, resolvedEnv: 'DEMO', symbol: 'XRPUSDT', phase2Decision: phase2, mode: 'influence', regime: 'RANGE', nowTs: t0 + i * 1000 });
        expect(db.prepare("SELECT COUNT(*) c FROM ml_influence_audit WHERE symbol='XRPUSDT'").get().c).toBe(1);
        svc.wrap({ userId: 2, resolvedEnv: 'DEMO', symbol: 'XRPUSDT', phase2Decision: phase2, mode: 'influence', regime: 'RANGE', nowTs: t0 + 11 * 60_000 });
        expect(db.prepare("SELECT COUNT(*) c FROM ml_influence_audit WHERE symbol='XRPUSDT'").get().c).toBe(2);
    });
});

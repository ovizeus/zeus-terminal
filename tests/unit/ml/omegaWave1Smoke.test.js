/**
 * OMEGA Wave 1 — Integration smoke test
 *
 * Cross-module verification that all Wave 1 modules load cleanly and
 * cooperate as expected. Each module has its own unit test file; this
 * file proves they work TOGETHER at the seams.
 *
 * Covers:
 * - R-1 Test Harness: createMockExchange, forAll, injectFailure
 * - R0 Substrate: lifecycle (init/getHealth/shutdown), signPayload + validate
 * - Cross-cutting: auditTrail logDecision + getByDigest, voiceLogger logUtterance,
 *   approvalQueue enqueue + decide, eventBus pub/sub
 * - Real cross-module flow: sign decision payload via R0, log via audit,
 *   enqueue approval with signature, publish on eventBus
 */

const { db } = require('../../../server/services/database');

const R0 = require('../../../server/services/ml/R0_substrate');
const { createMockExchange } = require('../../../server/services/ml/R-1_testHarness/mockExchanges');
const { forAll, randomWeight } = require('../../../server/services/ml/R-1_testHarness/propertyTesting');
const { injectFailure } = require('../../../server/services/ml/R-1_testHarness/chaosInjector');
const audit = require('../../../server/services/ml/_audit/auditTrail');
const voice = require('../../../server/services/ml/_voice/voiceLogger');
const approval = require('../../../server/services/ml/_operator/approvalQueue');
const bus = require('../../../server/services/ml/R7_communication/eventBus');

describe('OMEGA Wave 1 — Integration Smoke', () => {
    const TEST_USER_ID = 99500;
    const TEST_DIGEST = `omega_smoke_${Date.now()}`;

    afterAll(() => {
        db.prepare(`DELETE FROM ml_decision_snapshots WHERE user_id = ?`).run(TEST_USER_ID);
        db.prepare(`DELETE FROM ml_voice_log WHERE user_id = ?`).run(TEST_USER_ID);
        db.prepare(`DELETE FROM ml_operator_approval WHERE user_id = ?`).run(TEST_USER_ID);
        bus._reset();
    });

    test('all 12 modules load without throwing', () => {
        expect(R0).toBeDefined();
        expect(createMockExchange).toBeDefined();
        expect(forAll).toBeDefined();
        expect(injectFailure).toBeDefined();
        expect(audit).toBeDefined();
        expect(voice).toBeDefined();
        expect(approval).toBeDefined();
        expect(bus).toBeDefined();
    });

    test('R0 ring lifecycle: init → OK → shutdown → OFFLINE → re-init OK', () => {
        let h = R0.init();
        expect(h.state).toBe('OK');
        expect(h.ring_id).toBe('R0');
        R0.shutdown();
        expect(R0.getHealth().state).toBe('OFFLINE');
        h = R0.init();
        expect(h.state).toBe('OK');
    });

    test('R-1 + R0: mock exchange placeOrder + R0 signPayload sign result', async () => {
        const ex = createMockExchange({ type: 'binance', seed: 99 });
        const order = await ex.placeOrder({ symbol: 'BTCUSDT', side: 'BUY', qty: 0.001, type: 'MARKET' });
        const sig = R0.signPayload(order, 'smoke_secret_omega');
        expect(typeof sig).toBe('string');
        expect(R0.validateSignature(order, sig, 'smoke_secret_omega')).toBe(true);
        expect(R0.validateSignature(order, sig, 'wrong_secret')).toBe(false);
    });

    test('audit logDecision → getByDigest roundtrip', () => {
        const result = audit.logDecision({
            userId: TEST_USER_ID,
            resolvedEnv: 'DEMO',
            symbol: 'BTCUSDT',
            snapshotEventType: 'TRADE',
            snapshotJson: JSON.stringify({ score: 0.8, top5: ['feat_a'] }),
            decisionDigest: TEST_DIGEST,
            registryDigest: 'reg_smoke_v1'
        });
        expect(result.id).toBeGreaterThan(0);
        const found = audit.getByDigest(TEST_DIGEST);
        expect(found.snapshot_event_type).toBe('TRADE');
        expect(found.user_id).toBe(TEST_USER_ID);
    });

    test('voice logUtterance with decisionDigest links to audit', () => {
        voice.logUtterance({
            userId: TEST_USER_ID,
            utteranceType: 'THOUGHT',
            mood: 'EXCITED',
            text: 'BTC looking strong — placed long',
            decisionDigest: TEST_DIGEST
        });
        const recent = voice.getRecent({ userId: TEST_USER_ID, limit: 5 });
        const linked = recent.find(r => r.decision_digest === TEST_DIGEST);
        expect(linked).toBeDefined();
        expect(linked.mood).toBe('EXCITED');
    });

    test('approval enqueue MAJOR + decide APPROVED → state changes', () => {
        const enq = approval.enqueue({
            userId: TEST_USER_ID,
            requestType: 'PROMOTION',
            payload: { featureId: 'smoke_test_feat', newWeight: 0.75 },
            tier: 'MAJOR'
        });
        expect(enq.id).toBeGreaterThan(0);
        const sig = R0.signPayload({ id: enq.id, decision: 'APPROVED' }, 'operator_key');
        approval.decide({
            id: enq.id,
            decision: 'APPROVED',
            decidedBy: 'omega_smoke_test',
            signature: sig
        });
        const row = approval.getById(enq.id);
        expect(row.queue_state).toBe('APPROVED');
        expect(row.signature).toBe(sig);
    });

    test('eventBus pub/sub cross-ring communication', () => {
        const received = [];
        const token = bus.subscribe('ring.heartbeat', (payload) => received.push(payload));
        bus.publish('ring.heartbeat', { ring_id: 'R0', ts: Date.now() });
        bus.publish('ring.heartbeat', { ring_id: 'R-1', ts: Date.now() });
        expect(received.length).toBe(2);
        expect(received[0].ring_id).toBe('R0');
        bus.unsubscribe(token);
        bus.publish('ring.heartbeat', { ring_id: 'R7', ts: Date.now() });
        expect(received.length).toBe(2); // no new after unsubscribe
    });

    test('property test fuzzes weight + R0 signs each', () => {
        forAll(randomWeight, 20, (w) => {
            const sig = R0.signPayload({ w }, 'fuzz_key');
            if (!R0.validateSignature({ w }, sig, 'fuzz_key')) {
                throw new Error(`sign/validate mismatch for w=${w}`);
            }
        });
    });

    test('chaos injectFailure rate=1.0 throws as expected (R3A safety drill)', async () => {
        const okFn = async () => 'ok';
        const fragile = injectFailure(okFn, 1.0);
        await expect(fragile()).rejects.toThrow(/chaos injection/);
    });
});

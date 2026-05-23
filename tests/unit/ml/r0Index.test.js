/**
 * R0 Substrate — index.js (orchestrator) tests
 *
 * Verifies the substrate ring's lifecycle (init/shutdown) + health reporting.
 * Aggregates timeIntegrity + opsec + dr modules under a single ring interface.
 */

const r0 = require('../../../server/services/ml/R0_substrate');

describe('R0 Substrate — index (ring orchestrator)', () => {
    test('re-exports timeIntegrity primitives', () => {
        expect(typeof r0.monotonicNow).toBe('function');
        expect(typeof r0.detectTimeSkew).toBe('function');
        expect(typeof r0.validateTimestamp).toBe('function');
    });

    test('re-exports opsec primitives', () => {
        expect(typeof r0.redactSecret).toBe('function');
        expect(typeof r0.signPayload).toBe('function');
        expect(typeof r0.validateSignature).toBe('function');
    });

    test('re-exports dr primitives', () => {
        expect(typeof r0.saveSnapshot).toBe('function');
        expect(typeof r0.loadSnapshot).toBe('function');
        expect(typeof r0.listSnapshots).toBe('function');
        expect(typeof r0.integrityCheck).toBe('function');
    });

    test('exposes RING_ID = "R0"', () => {
        expect(r0.RING_ID).toBe('R0');
    });

    test('init returns health status object', () => {
        const status = r0.init();
        expect(status).toHaveProperty('ring_id');
        expect(status.ring_id).toBe('R0');
        expect(status).toHaveProperty('state');
        expect(['OK', 'INITIALIZING', 'DEGRADED']).toContain(status.state);
    });

    test('getHealth returns current ring state', () => {
        r0.init();
        const health = r0.getHealth();
        expect(health.ring_id).toBe('R0');
        expect(['OK', 'INITIALIZING', 'DEGRADED', 'OFFLINE', 'DISABLED']).toContain(health.state);
        expect(typeof health.last_heartbeat).toBe('number');
    });

    test('shutdown sets state to OFFLINE', () => {
        r0.init();
        r0.shutdown();
        const health = r0.getHealth();
        expect(health.state).toBe('OFFLINE');
        // Re-init for other tests / runtime
        r0.init();
    });
});

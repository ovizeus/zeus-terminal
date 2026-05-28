'use strict';

// Task G — Graceful shutdown drain for serverAT
// drainPending lets _gracefulShutdown wait for in-flight _executeLiveEntry calls
// to settle before closing exchange connections / DB. Without this, PM2 restart
// during entry creates orphan orders (exchange holds it, DB doesn't know).
//
// Contract:
//  - drainPending(maxWaitMs) returns Promise<{settled, timedOut, pending}>
//  - settled=true when _pendingEntries reaches 0 within maxWaitMs
//  - settled=false + timedOut=true if maxWaitMs elapses
//  - Test-only _testIncPending / _testDecPending helpers to simulate in-flight

const path = require('path');

describe('serverAT — drainPending for graceful shutdown', () => {
    let serverAT;

    beforeEach(() => {
        jest.resetModules();
        serverAT = require('../../server/services/serverAT');
    });

    test('drainPending is an exported function returning a Promise', async () => {
        expect(typeof serverAT.drainPending).toBe('function');
        const p = serverAT.drainPending(50);
        expect(p && typeof p.then).toBe('function');
        await p;
    });

    test('resolves immediately when no in-flight entries (pending=0)', async () => {
        const t0 = Date.now();
        const result = await serverAT.drainPending(5000);
        expect(Date.now() - t0).toBeLessThan(150);
        expect(result.settled).toBe(true);
        expect(result.timedOut).toBe(false);
        expect(result.pending).toBe(0);
    });

    test('waits up to maxWaitMs then resolves with timedOut=true if in-flight stuck', async () => {
        serverAT._testIncPending();
        const t0 = Date.now();
        const result = await serverAT.drainPending(300);
        const elapsed = Date.now() - t0;
        expect(elapsed).toBeGreaterThanOrEqual(280);
        expect(elapsed).toBeLessThan(500);
        expect(result.timedOut).toBe(true);
        expect(result.settled).toBe(false);
        expect(result.pending).toBe(1);
        // Cleanup
        serverAT._testDecPending();
    });

    test('resolves early when pending drops to 0 mid-wait', async () => {
        serverAT._testIncPending();
        const drainPromise = serverAT.drainPending(5000);
        // Simulate _executeLiveEntry settling after 100ms
        setTimeout(() => serverAT._testDecPending(), 100);
        const t0 = Date.now();
        const result = await drainPromise;
        const elapsed = Date.now() - t0;
        expect(elapsed).toBeGreaterThanOrEqual(80);
        expect(elapsed).toBeLessThan(300);
        expect(result.settled).toBe(true);
        expect(result.timedOut).toBe(false);
    });

    test('counter does not go negative on extra dec calls', () => {
        serverAT._testDecPending();
        serverAT._testDecPending();
        // No throw, no negative state
        return serverAT.drainPending(50).then(r => {
            expect(r.pending).toBe(0);
        });
    });

    test('multiple pending entries all tracked', async () => {
        serverAT._testIncPending();
        serverAT._testIncPending();
        serverAT._testIncPending();
        const result = await serverAT.drainPending(100);
        expect(result.pending).toBe(3);
        expect(result.timedOut).toBe(true);
        // Cleanup
        serverAT._testDecPending();
        serverAT._testDecPending();
        serverAT._testDecPending();
    });

    test('default maxWaitMs=5000 if not provided or invalid', async () => {
        // We don't want to actually wait 5s; just verify the function accepts no-arg call.
        const result = await serverAT.drainPending();
        expect(result.settled).toBe(true);
    });
});

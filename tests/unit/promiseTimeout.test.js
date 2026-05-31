'use strict';

// [BUG-MULTI 2026-05-31] withTimeout guards an awaited async step from hanging
// indefinitely. The /api/order/place Path B awaited _placeProtectionForExistingEntry;
// when the 2nd rapid position's real-SL placement stalled, the await never settled, so
// registerManualPosition (the next line) never ran → the filled exchange position became
// an untracked orphan. Wrapping the protection await in withTimeout turns a hang into a
// catchable rejection → the existing catch proceeds to registration (LIVE_NO_SL + watchdog).

const { withTimeout } = require('../../server/utils/promiseTimeout');

describe('withTimeout', () => {
    it('resolves to the wrapped value when it settles before the timeout', async () => {
        const r = await withTimeout(Promise.resolve(42), 1000, 'X');
        expect(r).toBe(42);
    });

    it('rejects with the label when the wrapped promise hangs past the timeout', async () => {
        let err;
        const t0 = Date.now();
        try { await withTimeout(new Promise(() => {}), 50, 'PB_PROTECTION_TIMEOUT'); }
        catch (e) { err = e; }
        expect(err).toBeDefined();
        expect(err.message).toMatch(/PB_PROTECTION_TIMEOUT/);
        expect(Date.now() - t0).toBeLessThan(500); // fired ~promptly, did NOT hang
    });

    it('propagates the wrapped promise rejection (not the timeout) when it rejects first', async () => {
        let err;
        try { await withTimeout(Promise.reject(new Error('inner-fail')), 1000, 'X'); }
        catch (e) { err = e; }
        expect(err.message).toMatch(/inner-fail/);
    });
});

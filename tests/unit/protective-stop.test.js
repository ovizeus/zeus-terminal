'use strict';

// Fix #2 (safety net) 2026-05-29 — recon-discovered live positions must NEVER be naked.
// _syncExternalPosition registers external positions with NO SL ("source=external").
// A position the SYSTEM opened (manual /order/place) that recon classifies external was
// left without a stop. Safety net: compute a correct-side protective stop (markPrice ±
// adversePct) for ANY unprotected position so recon can place it. Pure decision tested here.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-protstop';

let computeProtectiveStop;
beforeAll(() => {
    const serverAT = require('../../server/services/serverAT');
    computeProtectiveStop = serverAT._computeProtectiveStop;
});

describe('_computeProtectiveStop — correct-side markPrice-based safety stop', () => {
    test('LONG → stop BELOW mark (mark × (1 - pct))', () => {
        expect(computeProtectiveStop('LONG', 73000, 0.02)).toBeCloseTo(71540, 0);
    });
    test('SHORT → stop ABOVE mark (mark × (1 + pct))', () => {
        expect(computeProtectiveStop('SHORT', 73000, 0.02)).toBeCloseTo(74460, 0);
    });
    test('BUY normalized to LONG → below', () => {
        expect(computeProtectiveStop('BUY', 100, 0.02)).toBeCloseTo(98, 5);
    });
    test('SELL normalized to SHORT → above', () => {
        expect(computeProtectiveStop('SELL', 100, 0.02)).toBeCloseTo(102, 5);
    });
    test('invalid markPrice (0) → null', () => {
        expect(computeProtectiveStop('LONG', 0, 0.02)).toBeNull();
    });
    test('invalid markPrice (NaN) → null', () => {
        expect(computeProtectiveStop('LONG', NaN, 0.02)).toBeNull();
    });
    test('LONG never returns a stop above mark (sanity)', () => {
        const s = computeProtectiveStop('LONG', 50000, 0.02);
        expect(s).toBeLessThan(50000);
    });
    test('SHORT never returns a stop below mark (sanity)', () => {
        const s = computeProtectiveStop('SHORT', 50000, 0.02);
        expect(s).toBeGreaterThan(50000);
    });
});

'use strict';

// Bug A fix 2026-05-29 — wrong-side safety SL → naked position.
// _executeLiveEntryCore computed closeSide + the 15%-OTM safety SL from
// `entry.side === 'LONG'`. When a caller passed exchange-side convention
// ('BUY'/'SELL') instead of position side ('LONG'/'SHORT'), a LONG got the SHORT
// branch → safety SL placed ABOVE entry → "Order would immediately trigger" →
// SL retries fail → position left NAKED. Fix: normalize side at the core entry.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-sidenorm';

let normalizePositionSide;
beforeAll(() => {
    const serverAT = require('../../server/services/serverAT');
    normalizePositionSide = serverAT._normalizePositionSide;
});

describe('_normalizePositionSide — exchange side → position side', () => {
    test('BUY → LONG', () => {
        expect(normalizePositionSide('BUY')).toBe('LONG');
    });
    test('SELL → SHORT', () => {
        expect(normalizePositionSide('SELL')).toBe('SHORT');
    });
    test('LONG stays LONG (idempotent)', () => {
        expect(normalizePositionSide('LONG')).toBe('LONG');
    });
    test('SHORT stays SHORT (idempotent)', () => {
        expect(normalizePositionSide('SHORT')).toBe('SHORT');
    });
    test('lowercase buy → LONG (case-insensitive)', () => {
        expect(normalizePositionSide('buy')).toBe('LONG');
    });
    test('lowercase sell → SHORT', () => {
        expect(normalizePositionSide('sell')).toBe('SHORT');
    });
    test('unknown/garbage passes through uppercased (caller still validates)', () => {
        expect(normalizePositionSide('xyz')).toBe('XYZ');
    });
});

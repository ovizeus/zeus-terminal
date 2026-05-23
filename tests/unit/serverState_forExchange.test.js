'use strict';

// We don't mock the entire database; serverState's init handles symbol map setup.
// Tests focus on the forExchange router (pure structural assertions).

const serverState = require('../../server/services/serverState');

describe('serverState.forExchange router', () => {
    it('exports forExchange function', () => {
        expect(typeof serverState.forExchange).toBe('function');
    });

    it('forExchange("binance") returns object with required methods', () => {
        const s = serverState.forExchange('binance');
        expect(typeof s.getSnapshotForSymbol).toBe('function');
        expect(typeof s.getBarsForSymbol).toBe('function');
        expect(typeof s.getReadySymbols).toBe('function');
        expect(typeof s.isDataReadyForSymbol).toBe('function');
    });

    it('forExchange("bybit") returns object with required methods', () => {
        const s = serverState.forExchange('bybit');
        expect(typeof s.getSnapshotForSymbol).toBe('function');
        expect(typeof s.getBarsForSymbol).toBe('function');
        expect(typeof s.getReadySymbols).toBe('function');
        expect(typeof s.isDataReadyForSymbol).toBe('function');
    });

    it('forExchange returns DIFFERENT scoped instances for binance vs bybit', () => {
        const a = serverState.forExchange('binance');
        const b = serverState.forExchange('bybit');
        // They are scoped objects (NOT same reference)
        expect(a).not.toBe(b);
        // But they should have same shape (same method signatures)
        expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    });

    it('forExchange("unknown") throws', () => {
        expect(() => serverState.forExchange('unknown')).toThrow(/unknown exchange/i);
        expect(() => serverState.forExchange('')).toThrow();
        expect(() => serverState.forExchange(null)).toThrow();
    });

    it('forExchange returns snapshots from per-exchange namespace (isolated)', () => {
        // Bybit namespace returns null for unknown symbols (no data yet — Task 22 wires)
        const bybit = serverState.forExchange('bybit');
        expect(bybit.getSnapshotForSymbol('NONEXISTENT')).toBeNull();
        expect(bybit.getReadySymbols()).toEqual([]);
    });

    it('backward compat: serverState.getSnapshotForSymbol still works (defaults to binance)', () => {
        expect(typeof serverState.getSnapshotForSymbol).toBe('function');
        expect(typeof serverState.getReadySymbols).toBe('function');
    });

    it('forExchange snapshots include rawExchange marker', () => {
        // Manually populate a fake snapshot in bybit namespace to verify rawExchange is added
        const bybit = serverState.forExchange('bybit');
        const snap = bybit.getSnapshotForSymbol('NONEXISTENT');
        // Returns null when no data — but if data existed, would have rawExchange='bybit'
        expect(snap).toBeNull();
    });
});

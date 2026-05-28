// Task S8-P0-1 — Server lockout gate helper
// Tests the small helper used across client modules to check whether the
// server is authoritative for AT. Consolidates the `w._serverATEnabled`
// check pattern (originally inline in autotrade.ts:664) into one place.

import { serverOwnsAT } from '../../client/src/engine/lockoutGate';

describe('lockoutGate.serverOwnsAT', () => {
    afterEach(() => {
        // Clean up window stub between tests
        try {
            if ((global as any).window) delete (global as any).window._serverATEnabled;
        } catch (_) {}
        try { delete (global as any).window; } catch (_) {}
    });

    test('returns false when window is undefined (SSR/non-browser)', () => {
        delete (global as any).window;
        expect(serverOwnsAT()).toBe(false);
    });

    test('returns false when _serverATEnabled is undefined', () => {
        (global as any).window = {};
        expect(serverOwnsAT()).toBe(false);
    });

    test('returns false when _serverATEnabled is false', () => {
        (global as any).window = { _serverATEnabled: false };
        expect(serverOwnsAT()).toBe(false);
    });

    test('returns true when _serverATEnabled is exactly true', () => {
        (global as any).window = { _serverATEnabled: true };
        expect(serverOwnsAT()).toBe(true);
    });

    test('truthy non-boolean values do NOT count as true (strict ===)', () => {
        (global as any).window = { _serverATEnabled: 1 };
        expect(serverOwnsAT()).toBe(false);
        (global as any).window = { _serverATEnabled: 'true' };
        expect(serverOwnsAT()).toBe(false);
    });

    test('does not throw when window access errors (defensive)', () => {
        Object.defineProperty(global, 'window', {
            get() { throw new Error('blocked by CSP'); },
            configurable: true,
        });
        expect(() => serverOwnsAT()).not.toThrow();
        expect(serverOwnsAT()).toBe(false);
        // Restore
        delete (global as any).window;
    });
});

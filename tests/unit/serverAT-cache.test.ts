// Task S8-P0-3 — Pre-arm _serverATEnabled boot cache
// Race fix: between client boot and first /api/at/state response, the
// default _serverATEnabled=false means client AT engine may briefly think
// it's UNLOCKED and fire trades. localStorage cache of last known server
// state lets boot pre-arm correctly within ms.

import { readCached, writeCached, _testReset } from '../../client/src/core/serverATCache';

describe('serverATCache — _serverATEnabled boot persistence', () => {
    let store: Record<string, string> = {};

    beforeEach(() => {
        store = {};
        // jsdom-style localStorage mock
        (global as any).localStorage = {
            getItem: (k: string) => (k in store ? store[k] : null),
            setItem: (k: string, v: string) => { store[k] = v; },
            removeItem: (k: string) => { delete store[k]; },
            clear: () => { store = {}; },
        };
        _testReset();
    });

    afterEach(() => {
        delete (global as any).localStorage;
    });

    test('readCached returns false on empty store (no prior session)', () => {
        expect(readCached()).toBe(false);
    });

    test('writeCached(true) → readCached returns true', () => {
        writeCached(true);
        expect(readCached()).toBe(true);
    });

    test('writeCached(false) → readCached returns false', () => {
        writeCached(true);
        writeCached(false);
        expect(readCached()).toBe(false);
    });

    test('readCached returns false when localStorage throws (fail-safe to UNLOCKED)', () => {
        (global as any).localStorage = {
            getItem: () => { throw new Error('quota exceeded'); },
            setItem: () => { throw new Error('quota exceeded'); },
        };
        expect(readCached()).toBe(false);
    });

    test('writeCached does not throw when localStorage throws', () => {
        (global as any).localStorage = {
            getItem: () => null,
            setItem: () => { throw new Error('quota exceeded'); },
        };
        expect(() => writeCached(true)).not.toThrow();
    });

    test('readCached returns false when localStorage is undefined (SSR / non-browser)', () => {
        delete (global as any).localStorage;
        expect(readCached()).toBe(false);
    });

    test('writeCached is a no-op when localStorage is undefined', () => {
        delete (global as any).localStorage;
        expect(() => writeCached(true)).not.toThrow();
    });

    test('only literal "true" string parsed — any other value is false', () => {
        writeCached(true);
        // Sanity: stored as 'true' string
        expect(store['zeus._serverATEnabled.v1']).toBe('true');
        // Corrupted value
        store['zeus._serverATEnabled.v1'] = '1';
        expect(readCached()).toBe(false);
        store['zeus._serverATEnabled.v1'] = 'yes';
        expect(readCached()).toBe(false);
    });
});

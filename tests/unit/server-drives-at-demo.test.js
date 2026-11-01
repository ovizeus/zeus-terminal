'use strict';
// [DEMO TWO-ENGINE FIX 2026-11-01] Pure matrix for "does the SERVER drive AT for
// this user" — the value shipped to the client as `serverActive`, which is the
// ONLY thing that locks the client-side AT engine (client/src/engine/lockoutGate.ts).
//
// Why this test exists: production ran CLIENT_AT=true AND SERVER_AT_DEMO=true at
// the same time. computeFullOwnership() returns false for engineMode==='demo' by
// design, with the comment "demo is already server-owned via SERVER_AT_DEMO" —
// but SERVER_AT_DEMO only makes the SERVER run; it never locked the CLIENT. So on
// demo the client was told serverActive:false, kept its own engine unlocked, and
// TWO engines opened positions into one book. Measured on the live DB: 82 ownerless
// client-engine positions in October alone, and same-mode LONG+SHORT open together
// (e.g. BTCUSDT SHORT from 2026-10-26 20:48 still open when BTCUSDT LONG opened
// 2026-10-27 12:55) — which the server's own no-mixed-bias guard forbids but cannot
// see, because the guard only reads the server's in-memory book.
const { computeServerDrivesAT } = require('../../server/services/ownership');

const base = {
    legacyServerAT: false, legacyServerBrain: false, fullOwnership: false,
    serverAtDemo: false, serverBrainDemo: false, engineMode: 'demo',
};

describe('computeServerDrivesAT', () => {
    test('legacy pair SERVER_AT+SERVER_BRAIN drives', () => {
        expect(computeServerDrivesAT({ ...base, legacyServerAT: true, legacyServerBrain: true })).toBe(true);
    });
    test('legacy half-pair does NOT drive', () => {
        expect(computeServerDrivesAT({ ...base, legacyServerAT: true })).toBe(false);
        expect(computeServerDrivesAT({ ...base, legacyServerBrain: true })).toBe(false);
    });
    test('full SP2 ownership drives', () => {
        expect(computeServerDrivesAT({ ...base, engineMode: 'live', fullOwnership: true })).toBe(true);
    });

    // ── THE REGRESSION: this is what production was doing ──
    test('demo user with SERVER_AT_DEMO+SERVER_BRAIN_DEMO drives (client must lock)', () => {
        expect(computeServerDrivesAT({ ...base, serverAtDemo: true, serverBrainDemo: true })).toBe(true);
    });
    test('demo carve-out needs BOTH demo flags — AT alone has no decisions to act on', () => {
        expect(computeServerDrivesAT({ ...base, serverAtDemo: true })).toBe(false);
        expect(computeServerDrivesAT({ ...base, serverBrainDemo: true })).toBe(false);
    });
    test('demo carve-out does NOT leak to a live user', () => {
        expect(computeServerDrivesAT({ ...base, engineMode: 'live', serverAtDemo: true, serverBrainDemo: true })).toBe(false);
    });
    test('unknown engineMode never drives (fail-closed)', () => {
        expect(computeServerDrivesAT({ ...base, engineMode: undefined, serverAtDemo: true, serverBrainDemo: true })).toBe(false);
        expect(computeServerDrivesAT({ ...base, engineMode: null, serverAtDemo: true, serverBrainDemo: true })).toBe(false);
    });
    test('empty/missing context never drives', () => {
        expect(computeServerDrivesAT()).toBe(false);
        expect(computeServerDrivesAT({})).toBe(false);
    });
    test('only strict true counts — truthy strings do not drive', () => {
        expect(computeServerDrivesAT({ ...base, serverAtDemo: 'yes', serverBrainDemo: 1 })).toBe(false);
    });
});

'use strict';

// [SP2-a exec gate 2026-06-04] Root cause of "AT decides SHORT but never enters".
// The dispatch gate (serverAT.js ~958) honours the SP2 testnet-exec carve-out
// (SERVER_AT_TESTNET_EXEC + cutover user + testnet creds) so the server TAKES
// ownership of uid=1 and DECIDES the entry — but _executeLiveEntry's Layer-1 gate
// (~1444) hard-required MF.SERVER_AT===true and did NOT honour the carve-out, so
// every decided entry was refused (LIVE_ENTRY_REQUIRES_FULL_SERVER_AT) → zombie
// cleanup. The SP2-a soak never actually executed. This pins the corrected gate
// predicate: testnet-only, fail-closed, REAL impossible.

const at = require('../../server/services/serverAT');
const allow = at._liveExecAllowed;

describe('_liveExecAllowed — SP2-a testnet-exec carve-out (fail-closed, testnet-only)', () => {
    test('full SERVER_AT → allowed regardless of env (legacy behaviour unchanged)', () => {
        expect(allow({ serverAt: true, testnetExec: false, env: 'TESTNET', isCutover: false, credsMode: 'real' })).toBe(true);
        expect(allow({ serverAt: true, testnetExec: false, env: 'REAL', isCutover: false, credsMode: 'real' })).toBe(true);
    });

    test('SERVER_AT off + no testnet-exec → blocked (legacy non-SP2 unchanged)', () => {
        expect(allow({ serverAt: false, testnetExec: false, env: 'TESTNET', isCutover: true, credsMode: 'testnet' })).toBe(false);
    });

    test('THE FIX: cutover user, testnet env + testnet creds, testnet-exec on → allowed', () => {
        expect(allow({ serverAt: false, testnetExec: true, env: 'TESTNET', isCutover: true, credsMode: 'testnet' })).toBe(true);
    });

    test('env is case-insensitive (testnet lowercase still allowed)', () => {
        expect(allow({ serverAt: false, testnetExec: true, env: 'testnet', isCutover: true, credsMode: 'testnet' })).toBe(true);
    });

    test('REAL env → blocked even with testnet-exec + cutover (no real money via this path)', () => {
        expect(allow({ serverAt: false, testnetExec: true, env: 'REAL', isCutover: true, credsMode: 'testnet' })).toBe(false);
    });

    test('non-cutover user → blocked', () => {
        expect(allow({ serverAt: false, testnetExec: true, env: 'TESTNET', isCutover: false, credsMode: 'testnet' })).toBe(false);
    });

    test('creds NOT testnet → blocked (belt-and-suspenders vs env)', () => {
        expect(allow({ serverAt: false, testnetExec: true, env: 'TESTNET', isCutover: true, credsMode: 'real' })).toBe(false);
    });

    test('fail-closed on missing env / creds', () => {
        expect(allow({ serverAt: false, testnetExec: true, env: undefined, isCutover: true, credsMode: 'testnet' })).toBe(false);
        expect(allow({ serverAt: false, testnetExec: true, env: null, isCutover: true, credsMode: 'testnet' })).toBe(false);
        expect(allow({ serverAt: false, testnetExec: true, env: '', isCutover: true, credsMode: 'testnet' })).toBe(false);
        expect(allow({ serverAt: false, testnetExec: true, env: 'TESTNET', isCutover: true, credsMode: null })).toBe(false);
    });
});

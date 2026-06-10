'use strict';
// tests/unit/realGateCoherence.test.js
// [REAL-GATE P0-4 2026-06-09] Flag-combination sanity. Each problem string
// must name the flags involved so the Telegram alert is actionable.

const { checkRealGateCoherence } = require('../../server/services/realGateCoherence');

const SAFE_TODAY = {
    _SRV_POS_REAL_ENABLED: false,
    _USERDATA_STREAM_REAL_ENABLED: false,
    USERDATA_STREAM_ENABLED: true,
    SERVER_AT_FULL_OWNERSHIP: true,
    ML_LIVE_INFLUENCE_ENABLED: false,
    ML_LIVE_OPTIN_REQUIRED: true,
};

describe('realGateCoherence', () => {
    test('today\'s production combination is coherent', () => {
        expect(checkRealGateCoherence(SAFE_TODAY)).toEqual({ coherent: true, problems: [] });
    });

    test('REAL exec without REAL userDataStream → blind fills problem', () => {
        const r = checkRealGateCoherence({ ...SAFE_TODAY, _SRV_POS_REAL_ENABLED: true });
        expect(r.coherent).toBe(false);
        expect(r.problems.join(' ')).toContain('_USERDATA_STREAM_REAL_ENABLED');
    });

    test('REAL exec without full ownership → two-engine race problem', () => {
        const r = checkRealGateCoherence({
            ...SAFE_TODAY,
            _SRV_POS_REAL_ENABLED: true,
            _USERDATA_STREAM_REAL_ENABLED: true,
            SERVER_AT_FULL_OWNERSHIP: false,
        });
        expect(r.coherent).toBe(false);
        expect(r.problems.join(' ')).toContain('SERVER_AT_FULL_OWNERSHIP');
    });

    test('REAL exec with master stream switch off → problem', () => {
        const r = checkRealGateCoherence({
            ...SAFE_TODAY,
            _SRV_POS_REAL_ENABLED: true,
            _USERDATA_STREAM_REAL_ENABLED: true,
            USERDATA_STREAM_ENABLED: false,
        });
        expect(r.coherent).toBe(false);
        expect(r.problems.join(' ')).toContain('USERDATA_STREAM_ENABLED');
    });

    test('ML live influence without opt-in requirement → consent problem', () => {
        const r = checkRealGateCoherence({
            ...SAFE_TODAY,
            ML_LIVE_INFLUENCE_ENABLED: true,
            ML_LIVE_OPTIN_REQUIRED: false,
        });
        expect(r.coherent).toBe(false);
        expect(r.problems.join(' ')).toContain('ML_LIVE_OPTIN_REQUIRED');
    });

    test('fully-armed correct REAL combination is coherent', () => {
        expect(checkRealGateCoherence({
            _SRV_POS_REAL_ENABLED: true,
            _USERDATA_STREAM_REAL_ENABLED: true,
            USERDATA_STREAM_ENABLED: true,
            SERVER_AT_FULL_OWNERSHIP: true,
            ML_LIVE_INFLUENCE_ENABLED: true,
            ML_LIVE_OPTIN_REQUIRED: true,
        }).coherent).toBe(true);
    });

    test('null/garbage input → incoherent, never throws', () => {
        expect(checkRealGateCoherence(null).coherent).toBe(false);
    });
});

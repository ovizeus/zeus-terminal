'use strict';
// tests/unit/influenceEligibility-optin.test.js
// [REAL-GATE P0-3 2026-06-09] env=REAL requires per-user opt-in BEFORE any
// other eligibility math. Audit finding: ML_LIVE_OPTIN_REQUIRED existed as a
// flag but was consulted by NOBODY.

const mockFlags = {
    ML_PIPELINE_SHADOW: true,
    ML_DEMO_INFLUENCE_ENABLED: true,
    ML_TESTNET_INFLUENCE_ENABLED: true,
    ML_LIVE_INFLUENCE_ENABLED: true,   // worst case: someone flipped it
    ML_LIVE_OPTIN_REQUIRED: true,
};
jest.mock('../../server/migrationFlags', () => mockFlags);

let optedIn = false;
jest.mock('../../server/services/ml/mlLiveOptin', () => ({
    isOptedIn: jest.fn(() => optedIn),
}));

// Downstream deps stubbed so the pipeline would otherwise continue:
jest.mock('../../server/services/ml/_ring5/banditPosteriors', () => ({
    getPosterior: () => null, // → insufficient_observations if gate passes
}));
jest.mock('../../server/services/ml/R5B_governance/versionRegistry', () => ({ getActive: () => null }));
jest.mock('../../server/services/ml/R5B_governance/preRegistration', () => ({ getRegistrationsForVersion: () => [] }));

const { checkEligibility } = require('../../server/services/ml/_ring5/influenceEligibility');

const base = { userId: 1, symbol: 'BTCUSDT', regime: 'trend', nowTs: 1000 };

describe('influenceEligibility REAL opt-in gate', () => {
    beforeEach(() => { optedIn = false; mockFlags.ML_LIVE_OPTIN_REQUIRED = true; });

    test('REAL + no opt-in → ineligible with live_optin_missing', () => {
        const r = checkEligibility({ ...base, env: 'REAL' });
        expect(r.eligible).toBe(false);
        expect(r.reason).toBe('live_optin_missing');
    });

    test('REAL + opted in → gate passes through (next check fires)', () => {
        optedIn = true;
        const r = checkEligibility({ ...base, env: 'REAL' });
        expect(r.reason).toBe('insufficient_observations'); // proves we got past opt-in
    });

    test('TESTNET does not require opt-in', () => {
        const r = checkEligibility({ ...base, env: 'TESTNET' });
        expect(r.reason).toBe('insufficient_observations');
    });

    test('env casing: "real" lowercase still gated', () => {
        const r = checkEligibility({ ...base, env: 'real' });
        expect(r.reason).toBe('live_optin_missing');
    });

    test('flag escape hatch: ML_LIVE_OPTIN_REQUIRED=false skips the gate (deliberate)', () => {
        mockFlags.ML_LIVE_OPTIN_REQUIRED = false;
        const r = checkEligibility({ ...base, env: 'REAL' });
        expect(r.reason).toBe('insufficient_observations');
    });
});

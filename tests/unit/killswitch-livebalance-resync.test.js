'use strict';
const serverAT = require('../../server/services/serverAT');

// [T1-2 2026-06-07] Kill-switch liveBalanceRef resync.
// Bug: on engineMode='live', _checkKillSwitch returns early (inert) when
// liveBalanceRef<=0 — and the ref was only ever auto-init on a mode switch.
// A live user whose ref was never set (new REAL account, direct-live boot)
// would have the DAILY-LOSS kill switch silently disabled. Fix: a throttled
// resync that heals the ref, kicked from _checkKillSwitch when it's <=0.

describe('[killswitch] liveBalanceRef resync guard (T1-2)', () => {
    describe('_shouldResyncLiveBalanceRef pure predicate', () => {
        const NOW = 1780000000000;
        test('live + ref<=0 + not throttled → true', () => {
            expect(serverAT._shouldResyncLiveBalanceRef({ engineMode: 'live', liveBalanceRef: 0 }, NOW)).toBe(true);
            expect(serverAT._shouldResyncLiveBalanceRef({ engineMode: 'live', liveBalanceRef: -1 }, NOW)).toBe(true);
        });
        test('live + ref>0 → false (already have a reference)', () => {
            expect(serverAT._shouldResyncLiveBalanceRef({ engineMode: 'live', liveBalanceRef: 2526 }, NOW)).toBe(false);
        });
        test('demo → false (demo uses demoStartBalance, never resyncs)', () => {
            expect(serverAT._shouldResyncLiveBalanceRef({ engineMode: 'demo', liveBalanceRef: 0 }, NOW)).toBe(false);
        });
        test('throttled (recent resync ts) → false', () => {
            expect(serverAT._shouldResyncLiveBalanceRef({ engineMode: 'live', liveBalanceRef: 0, _liveBalRefResyncTs: NOW - 5000 }, NOW)).toBe(false);
        });
        test('throttle window elapsed → true again', () => {
            expect(serverAT._shouldResyncLiveBalanceRef({ engineMode: 'live', liveBalanceRef: 0, _liveBalRefResyncTs: NOW - 60000 }, NOW)).toBe(true);
        });
    });

    describe('_checkKillSwitch integration', () => {
        test('live + ref<=0: does NOT false-trigger but KICKS a resync (was silently inert)', () => {
            const UID = 990010;
            const us = serverAT._uStateForTest(UID);
            us.engineMode = 'live'; us.liveBalanceRef = 0; us.killActive = false;
            us.dailyPnL = -9999; us.pnlAtReset = 0; us.killPct = 4; // huge loss
            us._liveBalRefResyncTs = 0;
            serverAT._checkKillSwitchForTest(UID);
            // can't evaluate without a ref → must NOT trigger on a phantom ref...
            expect(serverAT._uStateForTest(UID).killActive).toBe(false);
            // ...but the resync MUST have been kicked (throttle ts stamped), so the
            // gap self-heals instead of staying silently inert forever.
            expect(serverAT._uStateForTest(UID)._liveBalRefResyncTs).toBeGreaterThan(0);
        });

        test('live + ref>0: normal daily-loss trigger still works (no regression)', () => {
            const UID = 990011;
            const us = serverAT._uStateForTest(UID);
            us.engineMode = 'live'; us.liveBalanceRef = 1000; us.killActive = false;
            us.pnlAtReset = 0; us.killPct = 5; // limit = $50
            us.dailyPnL = -60; // beyond limit
            serverAT._checkKillSwitchForTest(UID);
            expect(serverAT._uStateForTest(UID).killActive).toBe(true);
        });

        test('demo unaffected by the resync path', () => {
            const UID = 990012;
            const us = serverAT._uStateForTest(UID);
            us.engineMode = 'demo'; us.demoStartBalance = 10000; us.killPct = 5; us.killActive = false;
            us.pnlAtReset = 0; us.dailyPnL = -100; // within limit
            serverAT._checkKillSwitchForTest(UID);
            expect(serverAT._uStateForTest(UID).killActive).toBe(false);
            expect(serverAT._uStateForTest(UID)._liveBalRefResyncTs || 0).toBe(0);
        });
    });
});

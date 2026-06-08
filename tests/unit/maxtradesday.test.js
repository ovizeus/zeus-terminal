'use strict';
const serverAT = require('../../server/services/serverAT');

// [T-MAXTRADES 2026-06-07] Server-side MAX TRADES/DAY protection (operator
// request). The "PROTECT: MAX TRADES/DAY (14/10)" badge was CLIENT display-only
// (brain.ts) — client locked (serverOwnsAT), server had NO daily-entry cap
// (only maxPos concurrent) → users blew past it. This makes it a real server
// gate with an operator disable toggle that persists until the next UTC day
// (auto-re-arms at rollover, like dailyTrades).

const DAY = 20000; // arbitrary integer UTC-day for tests

describe('[T-MAXTRADES] shouldBlockMaxTradesDay pure predicate', () => {
    const ctx = (o) => Object.assign({ maxDay: 10, dailyEntries: 0, maxDayProtectOffDay: 0, currentUtcDay: DAY }, o);
    test('no cap configured (maxDay<=0) → never blocks', () => {
        expect(serverAT.shouldBlockMaxTradesDay(ctx({ maxDay: 0, dailyEntries: 99 }))).toBe(false);
    });
    test('under cap → no block', () => {
        expect(serverAT.shouldBlockMaxTradesDay(ctx({ dailyEntries: 9 }))).toBe(false);
    });
    test('at cap → block', () => {
        expect(serverAT.shouldBlockMaxTradesDay(ctx({ dailyEntries: 10 }))).toBe(true);
    });
    test('over cap → block', () => {
        expect(serverAT.shouldBlockMaxTradesDay(ctx({ dailyEntries: 14 }))).toBe(true);
    });
    test('over cap but DISABLED today (offDay === currentUtcDay) → no block', () => {
        expect(serverAT.shouldBlockMaxTradesDay(ctx({ dailyEntries: 14, maxDayProtectOffDay: DAY }))).toBe(false);
    });
    test('over cap, disabled YESTERDAY (offDay !== today) → re-armed, blocks', () => {
        expect(serverAT.shouldBlockMaxTradesDay(ctx({ dailyEntries: 14, maxDayProtectOffDay: DAY - 1 }))).toBe(true);
    });
});

describe('[T-MAXTRADES] computeMaxDayProtectState pure', () => {
    const ctx = (o) => Object.assign({ maxDay: 10, dailyEntries: 0, maxDayProtectOffDay: 0, currentUtcDay: DAY }, o);
    test('configured + armed + under cap', () => {
        const s = serverAT.computeMaxDayProtectState(ctx({ dailyEntries: 4 }));
        expect(s).toMatchObject({ configured: true, maxDay: 10, dailyEntries: 4, active: true, disabledToday: false, atCap: false, blocking: false });
    });
    test('at cap, armed → blocking', () => {
        const s = serverAT.computeMaxDayProtectState(ctx({ dailyEntries: 14 }));
        expect(s).toMatchObject({ atCap: true, active: true, blocking: true });
    });
    test('at cap, disabled today → not blocking', () => {
        const s = serverAT.computeMaxDayProtectState(ctx({ dailyEntries: 14, maxDayProtectOffDay: DAY }));
        expect(s).toMatchObject({ atCap: true, active: false, disabledToday: true, blocking: false });
    });
    test('not configured (maxDay 0)', () => {
        const s = serverAT.computeMaxDayProtectState(ctx({ maxDay: 0, dailyEntries: 99 }));
        expect(s).toMatchObject({ configured: false, active: false, blocking: false });
    });
});

describe('[T-MAXTRADES] setMaxDayProtect toggle (persists until UTC day)', () => {
    test('disable stamps offDay = today; re-enable clears it', () => {
        const UID = 990020;
        const us = serverAT._uStateForTest(UID);
        us.maxDayProtectOffDay = 0;
        const today = Math.floor(Date.now() / 86400000);

        const r1 = serverAT.setMaxDayProtect(UID, false); // disable
        expect(r1.ok).toBe(true);
        expect(serverAT._uStateForTest(UID).maxDayProtectOffDay).toBe(today);
        expect(r1.active).toBe(false);

        const r2 = serverAT.setMaxDayProtect(UID, true); // re-enable
        expect(r2.ok).toBe(true);
        expect(serverAT._uStateForTest(UID).maxDayProtectOffDay).toBe(0);
        expect(r2.active).toBe(true);
    });

    // [MTP-RESET 2026-06-08] Operator: disabling must reset the counter "de la 0"
    // so the badge disappears cleanly and state is fresh (it stays off until the
    // next UTC day anyway via offDay).
    test('disable resets dailyEntries to 0 (de la 0)', () => {
        const UID = 990022;
        const us = serverAT._uStateForTest(UID);
        us.dailyEntries = 14;
        us.maxDayProtectOffDay = 0;

        serverAT.setMaxDayProtect(UID, false); // disable
        expect(serverAT._uStateForTest(UID).dailyEntries).toBe(0);
    });

    test('re-enable does NOT zero the counter (only disable resets)', () => {
        const UID = 990023;
        const us = serverAT._uStateForTest(UID);
        us.dailyEntries = 7;

        serverAT.setMaxDayProtect(UID, true); // re-enable / arm
        expect(serverAT._uStateForTest(UID).dailyEntries).toBe(7);
    });
});

describe('[T-MAXTRADES] daily reset clears dailyEntries', () => {
    test('UTC day rollover zeroes dailyEntries', () => {
        const UID = 990021;
        const us = serverAT._uStateForTest(UID);
        us.dailyEntries = 14;
        us.lastResetDay = 0; // force "new day"
        serverAT._checkDailyResetForTest(UID);
        expect(serverAT._uStateForTest(UID).dailyEntries).toBe(0);
    });
});

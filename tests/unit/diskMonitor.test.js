'use strict';
// [P1 2026-06-09] Disk monitor cron — Master Working Rule: on ANY production
// 500, df -h FIRST. This cron makes that proactive: alert the operator on
// Telegram BEFORE the disk fills (the /tmp artifact leak of 2026-05-20 went
// unnoticed until production broke).

const { _evaluate, _resetForTest } = require('../../server/cron/diskMonitor');

describe('diskMonitor _evaluate (pure)', () => {
    beforeEach(() => _resetForTest());

    test('no alert below threshold', () => {
        const r = _evaluate({ usedPct: 50.0, freeGB: 75.0 });
        expect(r.alert).toBe(false);
    });

    test('alerts at >=90% used with pct and freeGB in message', () => {
        const r = _evaluate({ usedPct: 91.2, freeGB: 13.2 });
        expect(r.alert).toBe(true);
        expect(r.message).toContain('91.2');
        expect(r.message).toContain('13.2');
    });

    test('does not re-alert while still above threshold (no spam)', () => {
        expect(_evaluate({ usedPct: 92.0, freeGB: 12.0 }).alert).toBe(true);
        expect(_evaluate({ usedPct: 93.0, freeGB: 10.5 }).alert).toBe(false);
    });

    test('re-arms after dropping below 85% then alerts again', () => {
        expect(_evaluate({ usedPct: 92.0, freeGB: 12.0 }).alert).toBe(true);
        expect(_evaluate({ usedPct: 80.0, freeGB: 30.0 }).alert).toBe(false);
        expect(_evaluate({ usedPct: 90.5, freeGB: 14.0 }).alert).toBe(true);
    });

    test('ignores malformed input without throwing', () => {
        expect(_evaluate(null).alert).toBe(false);
        expect(_evaluate({}).alert).toBe(false);
    });
});

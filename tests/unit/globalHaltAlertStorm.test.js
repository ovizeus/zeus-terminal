'use strict';
// tests/unit/globalHaltAlertStorm.test.js
// [ALERT STORM FIX 2026-10-07] setGlobalHalt notified on EVERY call, not on
// state transitions. The dead-man switch re-armed ~200×/day for two months, so
// the operator got ~12k identical "GLOBAL HALT ARMED" Telegrams (plus a P0
// doctor event and an audit row each) — which buried every real alert.
// Deduping on the reason text is not enough: the reason carries the staleness
// seconds ("..._stale_245s"), so it differs on every single call. The dedupe
// key must be the state transition.

const path = require('path');

describe('setGlobalHalt notification idempotency', () => {
    let at, telegramMock;

    beforeEach(() => {
        jest.resetModules();
        telegramMock = {
            sendToUser: jest.fn(() => Promise.resolve(true)),
            sendToAll: jest.fn(() => Promise.resolve(true)),
            alertCritical: jest.fn(() => Promise.resolve(true)),
            escapeMarkdown: (t) => String(t == null ? '' : t).replace(/([_*`\[])/g, '\\$1'),
        };
        jest.doMock(path.resolve(__dirname, '../../server/services/telegram'), () => telegramMock);
        at = require('../../server/services/serverAT');
        at.setGlobalHalt(false, 1, 'test_reset');
        telegramMock.sendToUser.mockClear();
    });

    test('first arm notifies exactly once', () => {
        at.setGlobalHalt(true, 1, 'DEAD_MAN_SWITCH:brain_heartbeat_stale_221s');
        expect(telegramMock.sendToUser).toHaveBeenCalledTimes(1);
        expect(at.getGlobalHaltState().active).toBe(true);
    });

    test('re-arming while already armed sends NO further alert, even with a new staleness reason', () => {
        at.setGlobalHalt(true, 1, 'DEAD_MAN_SWITCH:brain_heartbeat_stale_221s');
        telegramMock.sendToUser.mockClear();
        for (const s of [245, 276, 283, 798, 970]) {
            at.setGlobalHalt(true, 1, `DEAD_MAN_SWITCH:brain_heartbeat_stale_${s}s`);
        }
        expect(telegramMock.sendToUser).not.toHaveBeenCalled();
        expect(at.getGlobalHaltState().active).toBe(true);
    });

    test('the newest reason is still persisted for forensics while suppressed', () => {
        at.setGlobalHalt(true, 1, 'DEAD_MAN_SWITCH:brain_heartbeat_stale_221s');
        at.setGlobalHalt(true, 1, 'DEAD_MAN_SWITCH:brain_heartbeat_stale_970s');
        expect(at.getGlobalHaltState().reason).toBe('DEAD_MAN_SWITCH:brain_heartbeat_stale_970s');
    });

    test('disarm after arm notifies (real transition)', () => {
        at.setGlobalHalt(true, 1, 'armed');
        telegramMock.sendToUser.mockClear();
        at.setGlobalHalt(false, 1, 'operator_cleared');
        expect(telegramMock.sendToUser).toHaveBeenCalledTimes(1);
        expect(at.getGlobalHaltState().active).toBe(false);
    });

    test('disarming something already disarmed is silent', () => {
        at.setGlobalHalt(false, 1, 'already_off');
        expect(telegramMock.sendToUser).not.toHaveBeenCalled();
    });

    test('the alert escapes Markdown so a reason with underscores cannot 400', () => {
        // Real failure: "GLOBAL HALT ARMED\nReason: DEAD_MAN_SWITCH:brain_heartbeat_stale_970s"
        // has 5 underscores -> unterminated italic -> Telegram 400
        // "can't parse entities ... byte offset 70" (149× in one day).
        at.setGlobalHalt(true, 1, 'DEAD_MAN_SWITCH:brain_heartbeat_stale_970s');
        const text = telegramMock.sendToUser.mock.calls[0][1];
        const bare = text.replace(/\\_/g, '');
        expect(bare).not.toMatch(/_/);
    });

    test('still throws without an admin user id', () => {
        expect(() => at.setGlobalHalt(true, null, 'x')).toThrow(/byUserId/);
    });
});

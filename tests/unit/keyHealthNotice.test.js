'use strict';

/**
 * [2026-11-07] Telling a user their exchange keys died, in a channel they see.
 *
 * The daily check already sends Telegram, which is the right first channel —
 * but it is OPTIONAL, and three accounts on this box have none linked. For
 * them the warning went nowhere and the first sign was an order that did not
 * place.
 *
 * The dedupe is not a nicety. The check runs daily, so without it the thread
 * would collect an identical message every day until the key is replaced, and
 * that is the same mistake as the circuit-breaker flood: a channel so loud
 * nobody reads it.
 */
const K = require('../../server/services/keyHealthNotice');

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const text = (ex, mode) => K._noticeText(ex, mode);

describe('when to post', () => {
    it('posts when the thread is empty', () => {
        expect(K.shouldNotify([], 'bybit', 'testnet', NOW)).toBe(true);
        expect(K.shouldNotify(null, 'bybit', 'testnet', NOW)).toBe(true);
    });

    it('does NOT post again the next day — this is the whole point', () => {
        const thread = [{ sender: 'admin', message: text('bybit', 'testnet'), created_at: NOW - DAY }];
        expect(K.shouldNotify(thread, 'bybit', 'testnet', NOW)).toBe(false);
    });

    it('posts again after a week, in case it was missed', () => {
        const thread = [{ sender: 'admin', message: text('bybit', 'testnet'), created_at: NOW - 8 * DAY }];
        expect(K.shouldNotify(thread, 'bybit', 'testnet', NOW)).toBe(true);
    });

    it('treats a different exchange as its own problem', () => {
        const thread = [{ sender: 'admin', message: text('bybit', 'testnet'), created_at: NOW - DAY }];
        expect(K.shouldNotify(thread, 'binance', 'testnet', NOW)).toBe(true);
    });

    it('treats a different mode on the same exchange as its own problem', () => {
        const thread = [{ sender: 'admin', message: text('bybit', 'testnet'), created_at: NOW - DAY }];
        expect(K.shouldNotify(thread, 'bybit', 'live', NOW)).toBe(true);
    });

    it('ignores the user\'s own messages, however similar', () => {
        const thread = [{ sender: 'user', message: text('bybit', 'testnet'), created_at: NOW - DAY }];
        expect(K.shouldNotify(thread, 'bybit', 'testnet', NOW)).toBe(true);
    });

    it('an unreadable timestamp counts as recent, not as ancient', () => {
        // repeating a message once is a smaller harm than spamming daily
        const thread = [{ sender: 'admin', message: text('bybit', 'testnet'), created_at: 'not a date' }];
        expect(K.shouldNotify(thread, 'bybit', 'testnet', NOW)).toBe(false);
    });

    it('reads the most recent matching notice, not the oldest', () => {
        const thread = [
            { sender: 'admin', message: text('bybit', 'testnet'), created_at: NOW - 30 * DAY },
            { sender: 'admin', message: text('bybit', 'testnet'), created_at: NOW - DAY },
        ];
        expect(K.shouldNotify(thread, 'bybit', 'testnet', NOW)).toBe(false);
    });

    it('survives a thread full of junk', () => {
        const thread = [null, {}, { sender: 'admin' }, { sender: 'admin', message: 42 }];
        expect(() => K.shouldNotify(thread, 'bybit', 'testnet', NOW)).not.toThrow();
        expect(K.shouldNotify(thread, 'bybit', 'testnet', NOW)).toBe(true);
    });
});

describe('what it posts', () => {
    it('names the exchange, the mode, and what will not work', () => {
        const t = text('bybit', 'testnet');
        expect(t).toContain('BYBIT');
        expect(t).toContain('testnet');
        expect(t).toMatch(/orders.*will not go through/i);
        expect(t).toContain('Settings');
    });

    it('carries a marker so the notice can be recognised later', () => {
        expect(text('bybit', 'live')).toContain(K.MARKER);
    });
});

describe('posting', () => {
    function fakeDb(thread = []) {
        return {
            getSupportThread: jest.fn(() => thread),
            insertSupportMessage: jest.fn(),
        };
    }

    it('writes into the support thread as a system message', () => {
        const db = fakeDb();
        expect(K.notifyKeyHealthFailure(db, 7, 'bybit', 'testnet', NOW)).toBe(true);
        expect(db.insertSupportMessage).toHaveBeenCalledWith(7, 'admin', text('bybit', 'testnet'));
    });

    it('writes nothing when it is not due', () => {
        const db = fakeDb([{ sender: 'admin', message: text('bybit', 'testnet'), created_at: NOW - DAY }]);
        expect(K.notifyKeyHealthFailure(db, 7, 'bybit', 'testnet', NOW)).toBe(false);
        expect(db.insertSupportMessage).not.toHaveBeenCalled();
    });

    it('a failing notice never breaks the health check that found the problem', () => {
        const db = { getSupportThread: () => { throw new Error('db gone'); }, insertSupportMessage: jest.fn() };
        expect(() => K.notifyKeyHealthFailure(db, 7, 'bybit', 'testnet', NOW)).not.toThrow();
        expect(K.notifyKeyHealthFailure(db, 7, 'bybit', 'testnet', NOW)).toBe(false);
    });
});

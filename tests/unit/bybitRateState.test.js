'use strict';

jest.mock('../../server/services/database', () => {
    const Database = require('better-sqlite3');
    const fs = require('fs');
    const TEST_DB = '/tmp/zeus-bybit-rate-test-' + Date.now() + '.db';
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    const db = new Database(TEST_DB);
    db.exec(`
        CREATE TABLE bybit_rate_state (
            id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
            used_weight INTEGER NOT NULL DEFAULT 0, reset_at INTEGER NOT NULL,
            banned_until INTEGER NOT NULL DEFAULT 0, ban_reason TEXT,
            last_request_at INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX idx_bybit_rate_state_user ON bybit_rate_state(user_id);
    `);
    return { db };
});

const brs = require('../../server/services/bybitRateState');

describe('bybitRateState', () => {
    beforeEach(() => {
        const { db } = require('../../server/services/database');
        db.exec(`DELETE FROM bybit_rate_state`);
    });

    it('WINDOW_MS exported (1 minute)', () => {
        expect(brs.WINDOW_MS).toBe(60_000);
    });

    it('load(uid) returns default state for new user', () => {
        const state = brs.load(1);
        expect(state.user_id).toBe(1);
        expect(state.used_weight).toBe(0);
        expect(state.banned_until).toBe(0);
        expect(state.ban_reason).toBeNull();
        expect(typeof state.reset_at).toBe('number');
        expect(state.reset_at).toBeGreaterThan(Date.now());
    });

    it('recordRequest() increments used_weight', () => {
        brs.recordRequest(1, 5);
        const s1 = brs.load(1);
        expect(s1.used_weight).toBe(5);
        brs.recordRequest(1, 3);
        const s2 = brs.load(1);
        expect(s2.used_weight).toBe(8);
    });

    it('recordRequest() resets window when expired', () => {
        // Insert expired state
        const { db } = require('../../server/services/database');
        const pastReset = Date.now() - 5000;
        db.prepare(`INSERT INTO bybit_rate_state (user_id, used_weight, reset_at, banned_until, last_request_at) VALUES (?, ?, ?, ?, ?)`).run(1, 100, pastReset, 0, Date.now() - 60000);
        brs.recordRequest(1, 5);
        const s = brs.load(1);
        expect(s.used_weight).toBe(5); // reset, not incremented from 100
        expect(s.reset_at).toBeGreaterThan(Date.now());
    });

    it('setBan(uid, durationMs, reason) sets banned_until + ban_reason', () => {
        const before = Date.now();
        brs.setBan(1, 60_000, 'rate_limit_exceeded');
        const state = brs.load(1);
        expect(state.banned_until).toBeGreaterThanOrEqual(before + 59_000);
        expect(state.banned_until).toBeLessThanOrEqual(Date.now() + 60_000 + 1000);
        expect(state.ban_reason).toBe('rate_limit_exceeded');
    });

    it('isBanned(uid) returns true while banned_until > now', () => {
        brs.setBan(1, 60_000, 'test');
        expect(brs.isBanned(1)).toBe(true);
    });

    it('isBanned(uid) returns false after ban expired', () => {
        const { db } = require('../../server/services/database');
        db.prepare(`INSERT INTO bybit_rate_state (user_id, used_weight, reset_at, banned_until, last_request_at) VALUES (?, ?, ?, ?, ?)`).run(1, 0, Date.now() + 60000, Date.now() - 10000, Date.now());
        expect(brs.isBanned(1)).toBe(false);
    });

    it('isBanned(uid) returns false for fresh user (no row)', () => {
        expect(brs.isBanned(999)).toBe(false);
    });

    it('resetWindow() zeroes used_weight + updates reset_at', () => {
        brs.recordRequest(1, 10);
        brs.resetWindow(1);
        const state = brs.load(1);
        expect(state.used_weight).toBe(0);
        expect(state.reset_at).toBeGreaterThan(Date.now());
    });

    it('multiple users tracked independently', () => {
        brs.recordRequest(1, 5);
        brs.recordRequest(2, 10);
        expect(brs.load(1).used_weight).toBe(5);
        expect(brs.load(2).used_weight).toBe(10);
    });
});

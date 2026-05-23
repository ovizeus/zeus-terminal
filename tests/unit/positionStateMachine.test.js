'use strict';

jest.mock('../../server/services/database', () => {
    const Database = require('better-sqlite3');
    const fs = require('fs');
    const TEST_DB = '/tmp/zeus-state-machine-test-' + Date.now() + '.db';
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    const db = new Database(TEST_DB);
    db.exec(`
        CREATE TABLE at_positions (
            seq INTEGER PRIMARY KEY, data TEXT, status TEXT DEFAULT 'OPEN',
            user_id INTEGER, exchange TEXT, created_at TEXT, updated_at TEXT
        );
        CREATE TABLE position_events (
            id INTEGER PRIMARY KEY, position_seq INTEGER NOT NULL, user_id INTEGER NOT NULL,
            exchange TEXT NOT NULL, event_type TEXT NOT NULL, from_state TEXT, to_state TEXT,
            payload TEXT NOT NULL DEFAULT '{}', cycle_no INTEGER, ts INTEGER NOT NULL
        )
    `);
    return { db };
});

const psm = require('../../server/services/positionStateMachine');

describe('positionStateMachine', () => {
    beforeEach(() => {
        const { db } = require('../../server/services/database');
        db.prepare(`DELETE FROM at_positions`).run();
        db.prepare(`DELETE FROM position_events`).run();
    });

    it('STATES lists all 9 states', () => {
        expect(psm.STATES).toEqual(expect.arrayContaining([
            'PENDING', 'OPENING', 'OPEN', 'CLOSING', 'CLOSED',
            'ORPHANED', 'RECOVERING', 'EMERGENCY', 'CANCELLED'
        ]));
        expect(psm.STATES.length).toBe(9);
    });

    it('isValidTransition allows correct edges', () => {
        expect(psm.isValidTransition('PENDING', 'OPENING')).toBe(true);
        expect(psm.isValidTransition('PENDING', 'CANCELLED')).toBe(true);
        expect(psm.isValidTransition('OPENING', 'OPEN')).toBe(true);
        expect(psm.isValidTransition('OPENING', 'EMERGENCY')).toBe(true);
        expect(psm.isValidTransition('OPEN', 'CLOSING')).toBe(true);
        expect(psm.isValidTransition('OPEN', 'EMERGENCY')).toBe(true);
        expect(psm.isValidTransition('CLOSING', 'CLOSED')).toBe(true);
        expect(psm.isValidTransition('RECOVERING', 'OPEN')).toBe(true);
        expect(psm.isValidTransition('RECOVERING', 'EMERGENCY')).toBe(true);
        expect(psm.isValidTransition('RECOVERING', 'ORPHANED')).toBe(true);
        expect(psm.isValidTransition('RECOVERING', 'CLOSED')).toBe(true);
        expect(psm.isValidTransition('EMERGENCY', 'CLOSING')).toBe(true);
        expect(psm.isValidTransition('EMERGENCY', 'CLOSED')).toBe(true);
        expect(psm.isValidTransition('ORPHANED', 'CLOSED')).toBe(true);
    });

    it('isValidTransition rejects invalid edges', () => {
        expect(psm.isValidTransition('CLOSED', 'OPEN')).toBe(false);
        expect(psm.isValidTransition('CLOSED', 'OPENING')).toBe(false);
        expect(psm.isValidTransition('PENDING', 'CLOSED')).toBe(false);
        expect(psm.isValidTransition('PENDING', 'OPEN')).toBe(false);
        expect(psm.isValidTransition('OPEN', 'PENDING')).toBe(false);
        expect(psm.isValidTransition('OPEN', 'OPENING')).toBe(false);
        expect(psm.isValidTransition('CANCELLED', 'OPEN')).toBe(false);
    });

    it('isValidTransition handles unknown states', () => {
        expect(psm.isValidTransition('UNKNOWN', 'OPEN')).toBe(false);
        expect(psm.isValidTransition('OPEN', 'UNKNOWN')).toBe(false);
    });

    it('transition() updates at_positions.status + appends event atomically', () => {
        const { db } = require('../../server/services/database');
        db.prepare(`INSERT INTO at_positions (seq, data, status, user_id, exchange) VALUES (?, ?, ?, ?, ?)`).run(100, '{}', 'PENDING', 1, 'binance');
        psm.transition(100, 'PENDING', 'OPENING', { orderId: 'xyz' });
        const row = db.prepare('SELECT status FROM at_positions WHERE seq=100').get();
        expect(row.status).toBe('OPENING');
        const events = db.prepare('SELECT * FROM position_events WHERE position_seq=100').all();
        expect(events.length).toBe(1);
        expect(events[0].from_state).toBe('PENDING');
        expect(events[0].to_state).toBe('OPENING');
        expect(events[0].user_id).toBe(1);
        expect(events[0].exchange).toBe('binance');
        expect(JSON.parse(events[0].payload)).toEqual({ orderId: 'xyz' });
    });

    it('transition() throws on invalid from→to edge', () => {
        const { db } = require('../../server/services/database');
        db.prepare(`INSERT INTO at_positions (seq, data, status, user_id, exchange) VALUES (?, ?, ?, ?, ?)`).run(101, '{}', 'OPEN', 1, 'binance');
        expect(() => psm.transition(101, 'OPEN', 'PENDING', {})).toThrow(/invalid transition/i);
    });

    it('transition() throws when position not in expected from_state (race protection)', () => {
        const { db } = require('../../server/services/database');
        db.prepare(`INSERT INTO at_positions (seq, data, status, user_id, exchange) VALUES (?, ?, ?, ?, ?)`).run(102, '{}', 'OPEN', 1, 'binance');
        expect(() => psm.transition(102, 'PENDING', 'OPENING', {})).toThrow(/state mismatch/i);
    });

    it('transition() throws when position seq does not exist', () => {
        expect(() => psm.transition(99999, 'PENDING', 'OPENING', {})).toThrow(/not found/i);
    });

    it('getCurrentState returns current status or null', () => {
        const { db } = require('../../server/services/database');
        db.prepare(`INSERT INTO at_positions (seq, data, status, user_id, exchange) VALUES (?, ?, ?, ?, ?)`).run(200, '{}', 'OPEN', 1, 'bybit');
        expect(psm.getCurrentState(200)).toBe('OPEN');
        expect(psm.getCurrentState(99999)).toBeNull();
    });

    it('transition() is atomic — UPDATE + INSERT both succeed or both fail', () => {
        const { db } = require('../../server/services/database');
        db.prepare(`INSERT INTO at_positions (seq, data, status, user_id, exchange) VALUES (?, ?, ?, ?, ?)`).run(300, '{}', 'PENDING', 1, 'binance');
        // Valid transition succeeds: both rows present
        psm.transition(300, 'PENDING', 'OPENING', { atomic: 'test' });
        const status = db.prepare('SELECT status FROM at_positions WHERE seq=300').get().status;
        const eventCount = db.prepare('SELECT COUNT(*) AS n FROM position_events WHERE position_seq=300').get().n;
        expect(status).toBe('OPENING');
        expect(eventCount).toBe(1);
    });
});

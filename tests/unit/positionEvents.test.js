'use strict';

jest.mock('../../server/services/database', () => {
    const Database = require('better-sqlite3');
    const fs = require('fs');
    const TEST_DB = '/tmp/zeus-position-events-test-' + Date.now() + '.db';
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    const db = new Database(TEST_DB);
    db.exec(`
        CREATE TABLE position_events (
            id INTEGER PRIMARY KEY, position_seq INTEGER NOT NULL, user_id INTEGER NOT NULL,
            exchange TEXT NOT NULL, event_type TEXT NOT NULL, from_state TEXT, to_state TEXT,
            payload TEXT NOT NULL DEFAULT '{}', cycle_no INTEGER, ts INTEGER NOT NULL
        )
    `);
    return { db };
});

const positionEvents = require('../../server/services/positionEvents');

describe('positionEvents', () => {
    beforeEach(() => {
        const { db } = require('../../server/services/database');
        db.prepare(`DELETE FROM position_events`).run();
    });

    it('append() inserts row with all required fields', () => {
        const id = positionEvents.append({
            position_seq: 1, user_id: 1, exchange: 'binance',
            event_type: 'STATE_CHANGE', from_state: 'PENDING', to_state: 'OPENING',
            payload: { orderId: 'abc123' }, cycle_no: 42
        });
        expect(typeof id).toBe('number');
        expect(id).toBeGreaterThan(0);
    });

    it('append() stores payload as JSON string, queryByPosition deserializes', () => {
        positionEvents.append({
            position_seq: 2, user_id: 1, exchange: 'bybit',
            event_type: 'CREATED', payload: { foo: 'bar', n: 123 }
        });
        const events = positionEvents.queryByPosition(2);
        expect(events.length).toBe(1);
        expect(events[0].payload).toEqual({ foo: 'bar', n: 123 });
    });

    it('queryByPosition returns events ordered by ts ASC', () => {
        positionEvents.append({ position_seq: 3, user_id: 1, exchange: 'binance', event_type: 'A', payload: {}, ts: 1000 });
        positionEvents.append({ position_seq: 3, user_id: 1, exchange: 'binance', event_type: 'B', payload: {}, ts: 2000 });
        positionEvents.append({ position_seq: 3, user_id: 1, exchange: 'binance', event_type: 'C', payload: {}, ts: 1500 });
        const events = positionEvents.queryByPosition(3);
        expect(events.length).toBe(3);
        expect(events[0].event_type).toBe('A');
        expect(events[1].event_type).toBe('C');
        expect(events[2].event_type).toBe('B');
    });

    it('queryByUser returns recent events ordered ts DESC with limit', () => {
        for (let i = 0; i < 5; i++) {
            positionEvents.append({ position_seq: 10, user_id: 1, exchange: 'binance', event_type: `E${i}`, payload: {}, ts: 1000 + i });
        }
        const events = positionEvents.queryByUser(1, { limit: 3 });
        expect(events.length).toBe(3);
        // Most recent first
        expect(events[0].event_type).toBe('E4');
        expect(events[1].event_type).toBe('E3');
        expect(events[2].event_type).toBe('E2');
    });

    it('queryByUser respects since filter', () => {
        positionEvents.append({ position_seq: 20, user_id: 1, exchange: 'binance', event_type: 'OLD', payload: {}, ts: 1000 });
        positionEvents.append({ position_seq: 20, user_id: 1, exchange: 'binance', event_type: 'NEW', payload: {}, ts: 5000 });
        const events = positionEvents.queryByUser(1, { since: 2000 });
        expect(events.length).toBe(1);
        expect(events[0].event_type).toBe('NEW');
    });

    it('append() requires position_seq, user_id, exchange, event_type', () => {
        expect(() => positionEvents.append({})).toThrow(/required/i);
        expect(() => positionEvents.append({ position_seq: 1 })).toThrow(/required/i);
        expect(() => positionEvents.append({ position_seq: 1, user_id: 1 })).toThrow(/required/i);
        expect(() => positionEvents.append({ position_seq: 1, user_id: 1, exchange: 'x' })).toThrow(/required/i);
    });

    it('append() defaults payload to {} if omitted', () => {
        positionEvents.append({ position_seq: 30, user_id: 1, exchange: 'binance', event_type: 'X' });
        const events = positionEvents.queryByPosition(30);
        expect(events[0].payload).toEqual({});
    });

    it('append() defaults ts to Date.now() if omitted', () => {
        const before = Date.now();
        positionEvents.append({ position_seq: 40, user_id: 1, exchange: 'binance', event_type: 'X' });
        const after = Date.now();
        const events = positionEvents.queryByPosition(40);
        expect(events[0].ts).toBeGreaterThanOrEqual(before);
        expect(events[0].ts).toBeLessThanOrEqual(after);
    });
});

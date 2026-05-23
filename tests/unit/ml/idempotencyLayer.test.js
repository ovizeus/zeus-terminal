'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p57-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const idem = require('../../../server/services/ml/R4_execution/idempotencyLayer');

const TEST_USER = 9057;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_execution_intents WHERE user_id IN (?, ?)').run(TEST_USER, 9058);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§57 Migration 102', () => {
    test('table ml_execution_intents exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_execution_intents'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('intent_id has UNIQUE constraint', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_execution_intents
             (intent_id, user_id, resolved_env, action_type,
              payload_hash, payload_json, status, created_at)
             VALUES ('test-unique', ?, ?, 'place_order', 'h', '{}', 'PENDING', ?)`
        ).run(TEST_USER, TEST_ENV, ts);

        expect(() => db.prepare(
            `INSERT INTO ml_execution_intents
             (intent_id, user_id, resolved_env, action_type,
              payload_hash, payload_json, status, created_at)
             VALUES ('test-unique', ?, ?, 'place_order', 'h', '{}', 'PENDING', ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK action_type restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_execution_intents
             (intent_id, user_id, resolved_env, action_type,
              payload_hash, payload_json, status, created_at)
             VALUES ('chk1', ?, ?, 'BOGUS', 'h', '{}', 'PENDING', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK status restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_execution_intents
             (intent_id, user_id, resolved_env, action_type,
              payload_hash, payload_json, status, created_at)
             VALUES ('chk2', ?, ?, 'place_order', 'h', '{}', 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§57 Constants', () => {
    test('ACTION_TYPES has 4 entries', () => {
        expect(idem.ACTION_TYPES).toEqual([
            'place_order', 'cancel_order', 'modify_order', 'close_position'
        ]);
    });

    test('INTENT_STATUSES has 4 entries', () => {
        expect(idem.INTENT_STATUSES).toEqual([
            'PENDING', 'CONFIRMED', 'REJECTED', 'EXPIRED'
        ]);
    });
});

describe('§57 generateIntentId', () => {
    test('same payload + same nonce → same intentId (deterministic)', () => {
        const a = idem.generateIntentId({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actionType: 'place_order',
            payload: { symbol: 'BTC', side: 'LONG', size: 1 },
            nonce: 12345
        });
        const b = idem.generateIntentId({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actionType: 'place_order',
            payload: { symbol: 'BTC', side: 'LONG', size: 1 },
            nonce: 12345
        });
        expect(a.intentId).toBe(b.intentId);
        expect(a.payloadHash).toBe(b.payloadHash);
    });

    test('different payload → different intentId + hash', () => {
        const a = idem.generateIntentId({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actionType: 'place_order',
            payload: { symbol: 'BTC', side: 'LONG', size: 1 }
        });
        const b = idem.generateIntentId({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actionType: 'place_order',
            payload: { symbol: 'BTC', side: 'LONG', size: 2 }
        });
        expect(a.intentId).not.toBe(b.intentId);
        expect(a.payloadHash).not.toBe(b.payloadHash);
    });

    test('payload key order does not affect hash', () => {
        const a = idem.generateIntentId({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actionType: 'place_order',
            payload: { a: 1, b: 2, c: 3 }, nonce: 100
        });
        const b = idem.generateIntentId({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actionType: 'place_order',
            payload: { c: 3, a: 1, b: 2 }, nonce: 100
        });
        expect(a.payloadHash).toBe(b.payloadHash);
    });

    test('throws on invalid actionType', () => {
        expect(() => idem.generateIntentId({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actionType: 'BOGUS', payload: {}
        })).toThrow(/actionType/i);
    });
});

describe('§57 registerIntent', () => {
    test('first register succeeds, PENDING status', () => {
        const r = idem.registerIntent({
            intentId: 'omega-test-001',
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actionType: 'place_order',
            payload: { symbol: 'BTC', size: 1 }
        });
        expect(r.registered).toBe(true);

        const stored = idem.getIntent('omega-test-001');
        expect(stored.status).toBe('PENDING');
    });

    test('duplicate intentId throws', () => {
        idem.registerIntent({
            intentId: 'omega-dup',
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actionType: 'place_order',
            payload: { x: 1 }
        });
        expect(() => idem.registerIntent({
            intentId: 'omega-dup',
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actionType: 'place_order',
            payload: { x: 1 }
        })).toThrow(/duplicate/i);
    });

    test('throws on invalid actionType', () => {
        expect(() => idem.registerIntent({
            intentId: 'omega-bad',
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actionType: 'BOGUS',
            payload: {}
        })).toThrow(/actionType/i);
    });
});

describe('§57 confirmIntent — PENDING → CONFIRMED', () => {
    test('transitions valid PENDING to CONFIRMED', () => {
        idem.registerIntent({
            intentId: 'omega-cf-1',
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actionType: 'place_order',
            payload: { x: 1 }
        });
        const r = idem.confirmIntent({
            intentId: 'omega-cf-1',
            orderId: 'ORD-123',
            fillId: 'FILL-456'
        });
        expect(r.confirmed).toBe(true);

        const stored = idem.getIntent('omega-cf-1');
        expect(stored.status).toBe('CONFIRMED');
        expect(stored.orderId).toBe('ORD-123');
        expect(stored.fillId).toBe('FILL-456');
    });

    test('cannot confirm already CONFIRMED (one-way transition)', () => {
        idem.registerIntent({
            intentId: 'omega-cf-2',
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actionType: 'place_order',
            payload: { x: 1 }
        });
        idem.confirmIntent({
            intentId: 'omega-cf-2', orderId: 'ORD-1'
        });
        expect(() => idem.confirmIntent({
            intentId: 'omega-cf-2', orderId: 'ORD-2'
        })).toThrow(/CONFIRMED/i);
    });

    test('throws when intent not found', () => {
        expect(() => idem.confirmIntent({
            intentId: 'nonexistent', orderId: 'X'
        })).toThrow(/not found/i);
    });
});

describe('§57 rejectIntent — PENDING → REJECTED', () => {
    test('transitions PENDING to REJECTED with reason', () => {
        idem.registerIntent({
            intentId: 'omega-rj-1',
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actionType: 'place_order',
            payload: { x: 1 }
        });
        const r = idem.rejectIntent({
            intentId: 'omega-rj-1', reason: 'exchange_rejected'
        });
        expect(r.rejected).toBe(true);

        const stored = idem.getIntent('omega-rj-1');
        expect(stored.status).toBe('REJECTED');
        expect(stored.rejectReason).toBe('exchange_rejected');
    });

    test('cannot reject already CONFIRMED', () => {
        idem.registerIntent({
            intentId: 'omega-rj-2',
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actionType: 'place_order',
            payload: { x: 1 }
        });
        idem.confirmIntent({ intentId: 'omega-rj-2', orderId: 'X' });
        expect(() => idem.rejectIntent({
            intentId: 'omega-rj-2', reason: 'too_late'
        })).toThrow(/CONFIRMED/i);
    });
});

describe('§57 expireStaleIntents', () => {
    test('expires PENDING older than TTL', () => {
        const now = Date.now();
        idem.registerIntent({
            intentId: 'omega-ex-old',
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actionType: 'place_order',
            payload: { x: 1 },
            ts: now - 120000  // 2 min ago
        });
        idem.registerIntent({
            intentId: 'omega-ex-new',
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actionType: 'place_order',
            payload: { x: 2 },
            ts: now - 5000  // 5 sec ago
        });

        const r = idem.expireStaleIntents({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            olderThanMs: 60000, now
        });
        expect(r.expired).toBe(1);

        expect(idem.getIntent('omega-ex-old').status).toBe('EXPIRED');
        expect(idem.getIntent('omega-ex-new').status).toBe('PENDING');
    });

    test('does not expire CONFIRMED intents', () => {
        const now = Date.now();
        idem.registerIntent({
            intentId: 'omega-ex-c',
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actionType: 'place_order',
            payload: { x: 1 },
            ts: now - 120000
        });
        idem.confirmIntent({ intentId: 'omega-ex-c', orderId: 'X' });

        const r = idem.expireStaleIntents({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            olderThanMs: 60000, now
        });
        expect(r.expired).toBe(0);
    });
});

describe('§57 getIntentByPayloadHash — pre-submit dedup', () => {
    test('finds intent by payload hash', () => {
        const gen = idem.generateIntentId({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actionType: 'place_order',
            payload: { symbol: 'ETH', size: 5 }
        });
        idem.registerIntent({
            intentId: gen.intentId,
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actionType: 'place_order',
            payload: { symbol: 'ETH', size: 5 }
        });

        const found = idem.getIntentByPayloadHash({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            payloadHash: gen.payloadHash
        });
        expect(found).toBeTruthy();
        expect(found.intentId).toBe(gen.intentId);
    });

    test('returns null when hash not found', () => {
        const r = idem.getIntentByPayloadHash({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            payloadHash: 'nonexistent_hash'
        });
        expect(r).toBe(null);
    });
});

describe('§57 isolation', () => {
    test('per (user × env) isolation on payload hash lookup', () => {
        const OTHER_USER = 9058;
        const gen = idem.generateIntentId({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actionType: 'place_order',
            payload: { z: 99 }
        });
        idem.registerIntent({
            intentId: gen.intentId,
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            actionType: 'place_order',
            payload: { z: 99 }
        });

        const r1 = idem.getIntentByPayloadHash({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            payloadHash: gen.payloadHash
        });
        const r2 = idem.getIntentByPayloadHash({
            userId: OTHER_USER, resolvedEnv: TEST_ENV,
            payloadHash: gen.payloadHash
        });
        expect(r1).toBeTruthy();
        expect(r2).toBe(null);
    });
});

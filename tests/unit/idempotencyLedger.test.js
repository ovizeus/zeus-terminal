'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'idem-ledger-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');

const { db } = require('../../server/services/database');
const ledger = require('../../server/services/ml/R4_execution/exactlyOnceLedger');

beforeEach(() => db.prepare("DELETE FROM ml_idempotency_ledger").run());

describe('exactlyOnceLedger', () => {
    test('migration 379 created table', () => {
        const cols = db.prepare("PRAGMA table_info(ml_idempotency_ledger)").all().map(r => r.name);
        expect(cols).toEqual(expect.arrayContaining([
            'idempotency_key', 'payload_hash', 'result_json', 'created_at', 'ttl_ms',
        ]));
    });

    test('seen(key) returns null when key not present', () => {
        expect(ledger.seen('NEW_KEY')).toBeNull();
    });

    test('record(key, payload, result) persists + seen returns the result', () => {
        ledger.record('k1', { sym: 'BTC' }, { orderId: 12345 });
        const got = ledger.seen('k1');
        expect(got).toBeDefined();
        expect(got.result).toEqual({ orderId: 12345 });
    });

    test('record idempotent on duplicate key — does NOT overwrite existing result', () => {
        ledger.record('k2', { sym: 'BTC' }, { orderId: 11111 });
        const r = ledger.record('k2', { sym: 'BTC' }, { orderId: 22222 });
        expect(r.duplicate).toBe(true);
        const got = ledger.seen('k2');
        expect(got.result).toEqual({ orderId: 11111 });
    });

    test('payload_hash matches identical payloads', () => {
        ledger.record('k3a', { sym: 'BTC', side: 'LONG' }, { orderId: 1 });
        ledger.record('k3b', { side: 'LONG', sym: 'BTC' }, { orderId: 2 }); // same content diff order
        const a = ledger.seen('k3a');
        const b = ledger.seen('k3b');
        expect(a.payloadHash).toBe(b.payloadHash);
    });

    test('seen returns null after TTL elapsed', () => {
        ledger.record('k4', { sym: 'BTC' }, { ok: true }, { ttlMs: 50 });
        return new Promise(resolve => setTimeout(() => {
            expect(ledger.seen('k4')).toBeNull();
            resolve();
        }, 100));
    });

    test('purgeExpired removes only TTL-elapsed rows', () => {
        ledger.record('k_old', { v: 1 }, { ok: true }, { ttlMs: 30 });
        ledger.record('k_new', { v: 2 }, { ok: true }, { ttlMs: 60000 });
        return new Promise(resolve => setTimeout(() => {
            const purged = ledger.purgeExpired();
            expect(purged).toBeGreaterThanOrEqual(1);
            expect(ledger.seen('k_new')).toBeDefined();
            expect(ledger.seen('k_old')).toBeNull();
            resolve();
        }, 80));
    });

    test('payload_hash mismatch on same key returns conflict flag', () => {
        ledger.record('k5', { sym: 'BTC', side: 'LONG' }, { orderId: 1 });
        const r = ledger.record('k5', { sym: 'BTC', side: 'SHORT' }, { orderId: 2 });
        expect(r.duplicate).toBe(true);
        expect(r.payloadHashMismatch).toBe(true);
    });
});

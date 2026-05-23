'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-chain-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');

const { db } = require('../../server/services/database');
const chain = require('../../server/services/ml/_audit/chainedTrail');

beforeEach(() => {
    db.prepare("DELETE FROM ml_audit_chain").run();
    // Reset AUTOINCREMENT so test ids start at 1 each time
    try { db.prepare("DELETE FROM sqlite_sequence WHERE name='ml_audit_chain'").run(); } catch (_) {}
});

describe('chainedTrail.append + verify', () => {
    test('migration 378 created table', () => {
        const cols = db.prepare("PRAGMA table_info(ml_audit_chain)").all().map(r => r.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'prev_hash', 'entry_hash', 'kind', 'payload_json', 'ts',
        ]));
    });

    test('first append has prev_hash = GENESIS', () => {
        const r = chain.append({ kind: 'TEST', payload: { x: 1 } });
        expect(r.prev_hash).toBe('GENESIS');
        expect(r.entry_hash).toBeTruthy();
        expect(r.entry_hash.length).toBe(64); // sha256 hex
    });

    test('subsequent append links to previous entry_hash', () => {
        const r1 = chain.append({ kind: 'TEST', payload: { x: 1 } });
        const r2 = chain.append({ kind: 'TEST', payload: { x: 2 } });
        expect(r2.prev_hash).toBe(r1.entry_hash);
        expect(r2.entry_hash).not.toBe(r1.entry_hash);
    });

    test('verify returns ok=true for unmodified chain', () => {
        chain.append({ kind: 'A', payload: { v: 1 } });
        chain.append({ kind: 'B', payload: { v: 2 } });
        chain.append({ kind: 'C', payload: { v: 3 } });
        const v = chain.verify();
        expect(v.ok).toBe(true);
        expect(v.entries).toBe(3);
        expect(v.firstBroken).toBeNull();
    });

    test('verify detects tampering on entry payload', () => {
        chain.append({ kind: 'A', payload: { v: 1 } });
        const r2 = chain.append({ kind: 'B', payload: { v: 2 } });
        chain.append({ kind: 'C', payload: { v: 3 } });
        // Tamper: modify entry 2 payload directly
        db.prepare("UPDATE ml_audit_chain SET payload_json = ? WHERE id = ?")
          .run(JSON.stringify({ v: 999 }), 2);
        const v = chain.verify();
        expect(v.ok).toBe(false);
        expect(v.firstBroken).toBe(2);
    });

    test('verify detects broken prev_hash link', () => {
        chain.append({ kind: 'A', payload: { v: 1 } });
        chain.append({ kind: 'B', payload: { v: 2 } });
        // Tamper: change prev_hash on entry 2
        db.prepare("UPDATE ml_audit_chain SET prev_hash = 'FAKE' WHERE id = 2").run();
        const v = chain.verify();
        expect(v.ok).toBe(false);
        expect(v.firstBroken).toBe(2);
    });

    test('recent(N) returns last N entries DESC', () => {
        for (let i = 0; i < 5; i++) chain.append({ kind: 'X', payload: { i } });
        const recent = chain.recent(3);
        expect(recent.length).toBe(3);
        expect(recent[0].ts).toBeGreaterThanOrEqual(recent[2].ts);
    });

    test('head() returns latest entry_hash', () => {
        chain.append({ kind: 'A', payload: { v: 1 } });
        const r = chain.append({ kind: 'B', payload: { v: 2 } });
        const h = chain.head();
        expect(h.entry_hash).toBe(r.entry_hash);
    });

    test('head() returns null when chain empty', () => {
        expect(chain.head()).toBeNull();
    });

    test('verify with fromTs/toTs window', async () => {
        const t1 = chain.append({ kind: 'A', payload: { v: 1 } });
        await new Promise(r => setTimeout(r, 3));
        const t2 = chain.append({ kind: 'B', payload: { v: 2 } });
        await new Promise(r => setTimeout(r, 3));
        const t3 = chain.append({ kind: 'C', payload: { v: 3 } });
        const v = chain.verify({ fromTs: t2.ts, toTs: t3.ts });
        expect(v.ok).toBe(true);
        expect(v.entries).toBe(2);
    });
});

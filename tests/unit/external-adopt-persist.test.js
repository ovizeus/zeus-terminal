'use strict';
// [ADOPT-PERSIST FIX 2026-06-08] _syncExternalPosition adopted a recon orphan
// into the in-memory book (+ protective SL) but did NOT persist it to
// at_positions (only _persistState, never _persistPosition). So an adopted
// orphan vanished on restart and was re-orphaned (recon re-adopts ~2min later).
// Persisting makes the adoption durable across restarts — it must show up in
// db.atLoadOpenPositions (the boot-restore source).
const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'adopt-persist-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');

const database = require('../../server/services/database');
const { db } = database; // raw handle for seeding
const serverAT = require('../../server/services/serverAT');

function seedUser(uid) {
    try {
        db.prepare(`INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)`)
          .run(uid, `u${uid}@test.local`, 'x');
    } catch (_) {}
}

describe('[ADOPT-PERSIST] _syncExternalPosition persists the adopted orphan', () => {
    test('adopted orphan is durable — appears in atLoadOpenPositions (survives restart)', () => {
        const UID = 880011;
        seedUser(UID);
        serverAT.reset(UID);

        const res = serverAT._syncExternalPosition({
            userId: UID, symbol: 'SOLUSDT', side: 'LONG',
            entryPrice: 95.13, qty: 50, markPrice: 95.13, exchange: 'binance',
        });
        expect(res.ok).toBe(true);

        // Must be PERSISTED to at_positions (durable), not only in memory.
        const persisted = database.atLoadOpenPositions(UID) || [];
        const sol = persisted.find(p => p.symbol === 'SOLUSDT' && p.side === 'LONG');
        expect(sol).toBeTruthy();
        expect(sol.seq).toBe(res.seq);
        expect(sol.source).toBe('external');
    });
});

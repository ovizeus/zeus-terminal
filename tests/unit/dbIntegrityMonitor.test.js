'use strict';
// tests/unit/dbIntegrityMonitor.test.js
// [FREEZE ROOT FIX 2026-10-07] `PRAGMA integrity_check` used to run INLINE in
// the doctor analyzer tick (every 5 min). On a grown DB (7.9 GB) that full scan
// is synchronous better-sqlite3 work → froze the whole event loop for 3-7 min,
// which starved serverBrain's heartbeat → brainWatchdog armed GLOBAL_HALT and
// trading stopped for 2 months. The check now runs OFF the main thread and the
// analyzer only reads a cached verdict.

const fs = require('fs');
const os = require('os');
const path = require('path');

let monitor;
beforeAll(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-dbintegrity-'));
    process.env.ZEUS_DB_PATH = path.join(tmp, 'test.db');
    monitor = require('../../server/services/ml/_doctor/dbIntegrityMonitor');
});

afterEach(() => { monitor.resetForTest(); });

describe('dbIntegrityMonitor', () => {
    test('reports no failure before any check has run (never false-alarms on boot)', () => {
        const r = monitor.getLastResult();
        expect(r.fail).toBe(false);
        expect(r.lastCheckTs).toBe(0);
        expect(r.everChecked).toBe(false);
    });

    test('caches a healthy verdict after a check returning ok', async () => {
        monitor._setRunnerForTest(async () => ({ rows: [{ integrity_check: 'ok' }], durationMs: 12 }));
        await monitor.runCheckNow(1000);
        const r = monitor.getLastResult();
        expect(r.fail).toBe(false);
        expect(r.everChecked).toBe(true);
        expect(r.lastCheckTs).toBe(1000);
    });

    test('caches a FAIL verdict when the pragma reports corruption', async () => {
        monitor._setRunnerForTest(async () => ({ rows: [{ integrity_check: '*** in database main ***' }], durationMs: 9 }));
        await monitor.runCheckNow(2000);
        expect(monitor.getLastResult().fail).toBe(true);
    });

    test('a thrown runner marks fail (DB unreadable) and does not escape', async () => {
        monitor._setRunnerForTest(async () => { throw new Error('disk I/O error'); });
        await expect(monitor.runCheckNow(3000)).resolves.toBeUndefined();
        expect(monitor.getLastResult().fail).toBe(true);
    });

    test('an empty row set is treated as FAIL (not silently healthy)', async () => {
        monitor._setRunnerForTest(async () => ({ rows: [], durationMs: 3 }));
        await monitor.runCheckNow(4000);
        expect(monitor.getLastResult().fail).toBe(true);
    });

    test('overlapping runs are coalesced — never two scans at once', async () => {
        let started = 0;
        monitor._setRunnerForTest(() => {
            started++;
            return new Promise(res => setTimeout(() => res({ rows: [{ integrity_check: 'ok' }], durationMs: 1 }), 30));
        });
        await Promise.all([monitor.runCheckNow(5000), monitor.runCheckNow(5001), monitor.runCheckNow(5002)]);
        expect(started).toBe(1);
    });
});

// ── Regression guard: the analyzer tick must never touch the DB for integrity ──
describe('analyzer no longer scans the DB inline', () => {
    test('analyze() runs no PRAGMA integrity/quick_check on its tick', () => {
        const dbapi = require('../../server/services/database');
        const analyzer = require('../../server/services/ml/_doctor/analyzer');
        const seen = [];
        const realPrepare = dbapi.db.prepare.bind(dbapi.db);
        dbapi.db.prepare = (sql) => { seen.push(String(sql)); return realPrepare(sql); };
        try {
            analyzer.analyze({ nowTs: Date.now() });
        } finally {
            dbapi.db.prepare = realPrepare;
        }
        const pragmas = seen.filter(s => /integrity_check|quick_check/i.test(s));
        expect(pragmas).toEqual([]);
    });

    test('a FAIL verdict from the monitor still reaches the cognitive state', () => {
        const analyzer = require('../../server/services/ml/_doctor/analyzer');
        const healthy = analyzer.computeCognitiveState({
            activeP0: 0, activeP1: 0, hotPathCriticalQuarantined: 0,
            hotPathAssistQuarantined: 0, doctorHeartbeatStale: false,
            moneyFrozen: false, dbIntegrityFail: false, nowTs: Date.now(),
        });
        const corrupt = analyzer.computeCognitiveState({
            activeP0: 0, activeP1: 0, hotPathCriticalQuarantined: 0,
            hotPathAssistQuarantined: 0, doctorHeartbeatStale: false,
            moneyFrozen: false, dbIntegrityFail: true, nowTs: Date.now(),
        });
        expect(healthy.state).toBe('HEALTHY');
        expect(corrupt.state).not.toBe('HEALTHY');
    });
});

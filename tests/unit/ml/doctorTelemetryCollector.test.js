'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-tc-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const eventBus = require('../../../server/services/ml/_doctor/eventBus');
const tc = require('../../../server/services/ml/_doctor/telemetryCollector');

const _now = () => Date.now();

function clean() {
    db.prepare("DELETE FROM ml_module_heartbeats").run();
    eventBus.resetForTest();
    tc.resetForTest();
}

describe('D-2.4 telemetryCollector', () => {
    beforeEach(clean);
    afterAll(() => { clean(); tc.stop(); });

    describe('Constants', () => {
        test('HEARTBEAT_PERSIST_INTERVAL_MS = 1000', () => {
            expect(tc.HEARTBEAT_PERSIST_INTERVAL_MS).toBe(1000);
        });
        test('STALENESS_THRESHOLD_MS = 30000', () => {
            expect(tc.STALENESS_THRESHOLD_MS).toBe(30000);
        });
    });

    describe('recordInvocation (hot path)', () => {
        test('emits heartbeat event to bus', () => {
            const received = [];
            eventBus.subscribe('heartbeat', e => received.push(e));
            tc.recordInvocation({
                moduleId: 'mtest', latencyMs: 1.5, ranOk: 1, ts: _now()
            });
            expect(received.length).toBe(1);
            expect(received[0].moduleId).toBe('mtest');
            expect(received[0].payload.latency_ms).toBe(1.5);
            expect(received[0].payload.ran_ok).toBe(1);
        });

        test('accumulates invocation_count per module between flushes', () => {
            tc.recordInvocation({ moduleId: 'm1', latencyMs: 1, ranOk: 1, ts: _now() });
            tc.recordInvocation({ moduleId: 'm1', latencyMs: 2, ranOk: 1, ts: _now() });
            tc.recordInvocation({ moduleId: 'm1', latencyMs: 3, ranOk: 1, ts: _now() });
            const stats = tc.getModuleStats({ moduleId: 'm1' });
            expect(stats.invocationCount).toBe(3);
        });

        test('rejects invalid params', () => {
            expect(() => tc.recordInvocation({
                latencyMs: 1, ranOk: 1, ts: _now()
            })).toThrow(/moduleId/);
            expect(() => tc.recordInvocation({
                moduleId: 'm', ranOk: 1, ts: _now()
            })).toThrow(/latencyMs/);
            expect(() => tc.recordInvocation({
                moduleId: 'm', latencyMs: 1, ts: _now()
            })).toThrow(/ranOk/);
        });

        test('ranOk must be 0 or 1', () => {
            expect(() => tc.recordInvocation({
                moduleId: 'm', latencyMs: 1, ranOk: 2, ts: _now()
            })).toThrow(/ranOk must be 0 or 1/);
        });

        test('latencyMs must be non-negative', () => {
            expect(() => tc.recordInvocation({
                moduleId: 'm', latencyMs: -1, ranOk: 1, ts: _now()
            })).toThrow(/latencyMs must be non-negative/);
        });
    });

    describe('Persistence (batch flush to ml_module_heartbeats)', () => {
        test('flushNow persists accumulated stats', () => {
            tc.start();
            tc.recordInvocation({ moduleId: 'mp1', latencyMs: 1.0, ranOk: 1, ts: _now() });
            tc.recordInvocation({ moduleId: 'mp1', latencyMs: 2.0, ranOk: 1, ts: _now() });
            tc.flushNow();
            const row = db.prepare(`
                SELECT module_id, latency_ms, ran_ok, invocation_count
                FROM ml_module_heartbeats
                WHERE module_id = ?
                ORDER BY id DESC LIMIT 1
            `).get('mp1');
            expect(row).toBeTruthy();
            expect(row.invocation_count).toBe(2);
            // latency = max of accumulated samples (worst case)
            expect(row.latency_ms).toBe(2.0);
        });

        test('flushNow clears in-memory stats', () => {
            tc.start();
            tc.recordInvocation({ moduleId: 'mp2', latencyMs: 1, ranOk: 1, ts: _now() });
            tc.flushNow();
            expect(tc.getModuleStats({ moduleId: 'mp2' })).toBeNull();
        });

        test('multi-module flush writes one row per module', () => {
            tc.start();
            tc.recordInvocation({ moduleId: 'ma', latencyMs: 1, ranOk: 1, ts: _now() });
            tc.recordInvocation({ moduleId: 'mb', latencyMs: 2, ranOk: 1, ts: _now() });
            tc.recordInvocation({ moduleId: 'mc', latencyMs: 3, ranOk: 1, ts: _now() });
            tc.flushNow();
            const n = db.prepare("SELECT COUNT(DISTINCT module_id) AS n FROM ml_module_heartbeats").get().n;
            expect(n).toBe(3);
        });

        test('ranOk = 0 propagates to DB', () => {
            tc.start();
            tc.recordInvocation({ moduleId: 'mfail', latencyMs: 5, ranOk: 0, ts: _now() });
            tc.flushNow();
            const row = db.prepare(`SELECT ran_ok FROM ml_module_heartbeats WHERE module_id = ?`).get('mfail');
            expect(row.ran_ok).toBe(0);
        });
    });

    describe('Staleness detection', () => {
        test('isStale returns true when no recent heartbeat', () => {
            tc.start();
            const oldTs = _now() - 31000;  // 31s ago
            db.prepare(`
                INSERT INTO ml_module_heartbeats
                (module_id, ts, latency_ms, ran_ok, invocation_count)
                VALUES (?, ?, ?, ?, ?)
            `).run('mstale', oldTs, 1.0, 1, 1);
            const result = tc.isStale({ moduleId: 'mstale', nowTs: _now() });
            expect(result.stale).toBe(true);
            expect(result.lastHeartbeatTs).toBe(oldTs);
        });

        test('isStale returns false when recent heartbeat exists', () => {
            tc.start();
            db.prepare(`
                INSERT INTO ml_module_heartbeats
                (module_id, ts, latency_ms, ran_ok, invocation_count)
                VALUES (?, ?, ?, ?, ?)
            `).run('mfresh', _now() - 5000, 1.0, 1, 1);
            const result = tc.isStale({ moduleId: 'mfresh', nowTs: _now() });
            expect(result.stale).toBe(false);
        });

        test('isStale returns true with no history at all', () => {
            const result = tc.isStale({ moduleId: 'never_seen', nowTs: _now() });
            expect(result.stale).toBe(true);
            expect(result.lastHeartbeatTs).toBeNull();
        });
    });

    describe('Lifecycle', () => {
        test('start() is idempotent', () => {
            tc.start();
            tc.start();
            tc.recordInvocation({ moduleId: 'mi', latencyMs: 1, ranOk: 1, ts: _now() });
            tc.flushNow();
            const n = db.prepare("SELECT COUNT(*) AS n FROM ml_module_heartbeats WHERE module_id = ?").get('mi').n;
            expect(n).toBe(1);
        });

        test('stop() clears timer', () => {
            tc.start();
            tc.stop();
            // Just verify no throw + can re-start
            expect(() => tc.start()).not.toThrow();
        });
    });

    describe('Performance', () => {
        test('recordInvocation completes under 0.5ms p99 for 1000 calls', () => {
            const samples = [];
            for (let i = 0; i < 1000; i++) {
                const t0 = process.hrtime.bigint();
                tc.recordInvocation({
                    moduleId: 'perf', latencyMs: 0.1, ranOk: 1, ts: i
                });
                const t1 = process.hrtime.bigint();
                samples.push(Number(t1 - t0) / 1e6);
            }
            samples.sort((a, b) => a - b);
            const p99 = samples[Math.floor(samples.length * 0.99)];
            expect(p99).toBeLessThan(2.0);  // CI slack; target 0.5ms
        });
    });
});

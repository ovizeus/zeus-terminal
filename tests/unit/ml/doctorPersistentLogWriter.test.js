'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-plw-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const eventBus = require('../../../server/services/ml/_doctor/eventBus');
const writer = require('../../../server/services/ml/_doctor/persistentLogWriter');

const _now = () => Date.now();

function clean() {
    db.prepare("DELETE FROM ml_diagnostic_events").run();
    eventBus.resetForTest();
    writer.resetForTest();
}

describe('D-2.3 persistentLogWriter', () => {
    beforeEach(clean);
    afterAll(() => { clean(); writer.stop(); });

    describe('Constants', () => {
        test('BATCH_SIZE = 50', () => {
            expect(writer.BATCH_SIZE).toBe(50);
        });
        test('FLUSH_INTERVAL_MS = 1000', () => {
            expect(writer.FLUSH_INTERVAL_MS).toBe(1000);
        });
    });

    describe('Event capture', () => {
        test('subscribes to alert events on start', () => {
            writer.start();
            const before = db.prepare("SELECT COUNT(*) AS n FROM ml_diagnostic_events").get().n;
            eventBus.emit({
                eventType: 'alert', moduleId: 'm', severity: 'P1',
                payload: { reason: 'test' }, ts: _now()
            });
            writer.flushNow();
            const after = db.prepare("SELECT COUNT(*) AS n FROM ml_diagnostic_events").get().n;
            expect(after - before).toBe(1);
        });

        test('subscribes to state_change events', () => {
            writer.start();
            eventBus.emit({
                eventType: 'state_change', moduleId: 'omega',
                severity: 'P0',
                payload: { from: 'HEALTHY', to: 'COMPROMISED' }, ts: _now()
            });
            writer.flushNow();
            const row = db.prepare("SELECT event_type FROM ml_diagnostic_events ORDER BY id DESC LIMIT 1").get();
            expect(row.event_type).toBe('state_change');
        });

        test('subscribes to quarantine events', () => {
            writer.start();
            eventBus.emit({
                eventType: 'quarantine', moduleId: 'm', severity: 'P2',
                payload: { action: 'clamp' }, ts: _now()
            });
            writer.flushNow();
            const n = db.prepare("SELECT COUNT(*) AS n FROM ml_diagnostic_events WHERE event_type = ?").get('quarantine').n;
            expect(n).toBe(1);
        });

        test('does NOT persist heartbeat events (volume too high)', () => {
            writer.start();
            for (let i = 0; i < 5; i++) {
                eventBus.emit({
                    eventType: 'heartbeat', moduleId: 'm',
                    payload: { latency_ms: 1, ran_ok: 1 }, ts: _now()
                });
            }
            writer.flushNow();
            const n = db.prepare("SELECT COUNT(*) AS n FROM ml_diagnostic_events").get().n;
            expect(n).toBe(0);
        });
    });

    describe('Batching', () => {
        test('events not persisted until flush', () => {
            writer.start();
            eventBus.emit({
                eventType: 'alert', moduleId: 'm', severity: 'P2',
                payload: {}, ts: _now()
            });
            // queueDepth > 0 but no DB write yet
            expect(writer.getQueueDepth()).toBe(1);
            const n1 = db.prepare("SELECT COUNT(*) AS n FROM ml_diagnostic_events").get().n;
            expect(n1).toBe(0);
            writer.flushNow();
            expect(writer.getQueueDepth()).toBe(0);
            const n2 = db.prepare("SELECT COUNT(*) AS n FROM ml_diagnostic_events").get().n;
            expect(n2).toBe(1);
        });

        test('batch persists up to BATCH_SIZE events in one transaction', () => {
            writer.start();
            for (let i = 0; i < 50; i++) {
                eventBus.emit({
                    eventType: 'alert', moduleId: 'm' + i, severity: 'P3',
                    payload: { idx: i }, ts: _now() + i
                });
            }
            writer.flushNow();
            const n = db.prepare("SELECT COUNT(*) AS n FROM ml_diagnostic_events").get().n;
            expect(n).toBe(50);
        });

        test('handles batch larger than BATCH_SIZE (multi-flush)', () => {
            writer.start();
            for (let i = 0; i < 125; i++) {
                eventBus.emit({
                    eventType: 'alert', moduleId: 'mx', severity: 'P3',
                    payload: { idx: i }, ts: _now() + i
                });
            }
            writer.flushNow();
            const n = db.prepare("SELECT COUNT(*) AS n FROM ml_diagnostic_events").get().n;
            expect(n).toBe(125);
        });
    });

    describe('event_id deduplication', () => {
        test('writer auto-generates event_id if not provided', () => {
            writer.start();
            eventBus.emit({
                eventType: 'alert', moduleId: 'auto', severity: 'P2',
                payload: {}, ts: _now()
            });
            writer.flushNow();
            const row = db.prepare("SELECT event_id FROM ml_diagnostic_events ORDER BY id DESC LIMIT 1").get();
            expect(row.event_id).toBeTruthy();
            expect(row.event_id.length).toBeGreaterThan(8);
        });

        test('writer uses provided event_id if given', () => {
            writer.start();
            eventBus.emit({
                eventType: 'alert', moduleId: 'm', severity: 'P1',
                payload: { event_id: 'custom-evt-001' }, ts: _now()
            });
            writer.flushNow();
            const row = db.prepare("SELECT event_id FROM ml_diagnostic_events WHERE event_id = ?").get('custom-evt-001');
            expect(row).toBeTruthy();
        });

        test('duplicate event_id silently dropped (idempotent)', () => {
            writer.start();
            eventBus.emit({
                eventType: 'alert', moduleId: 'm', severity: 'P1',
                payload: { event_id: 'dup-001' }, ts: _now()
            });
            writer.flushNow();
            eventBus.emit({
                eventType: 'alert', moduleId: 'm', severity: 'P1',
                payload: { event_id: 'dup-001' }, ts: _now()
            });
            writer.flushNow();
            const n = db.prepare("SELECT COUNT(*) AS n FROM ml_diagnostic_events WHERE event_id = ?").get('dup-001').n;
            expect(n).toBe(1);
        });
    });

    describe('Lifecycle', () => {
        test('stop() prevents further captures', () => {
            writer.start();
            writer.stop();
            eventBus.emit({
                eventType: 'alert', moduleId: 'after_stop', severity: 'P2',
                payload: {}, ts: _now()
            });
            writer.flushNow();
            const n = db.prepare("SELECT COUNT(*) AS n FROM ml_diagnostic_events WHERE module_id = ?").get('after_stop').n;
            expect(n).toBe(0);
        });

        test('start() is idempotent', () => {
            writer.start();
            writer.start();
            writer.start();
            // No throw — single subscription only
            eventBus.emit({
                eventType: 'alert', moduleId: 'idem', severity: 'P3',
                payload: {}, ts: _now()
            });
            writer.flushNow();
            const n = db.prepare("SELECT COUNT(*) AS n FROM ml_diagnostic_events WHERE module_id = ?").get('idem').n;
            expect(n).toBe(1);  // Not 3 — single subscription
        });
    });
});

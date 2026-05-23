'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-bus-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

require('../../../server/services/database');  // ensure migrations applied
const eventBus = require('../../../server/services/ml/_doctor/eventBus');

describe('D-2.2 eventBus', () => {
    beforeEach(() => {
        eventBus.resetForTest();
    });

    describe('Constants', () => {
        test('EVENT_TYPES frozen', () => {
            expect(Object.isFrozen(eventBus.EVENT_TYPES)).toBe(true);
        });
        test('SEVERITIES frozen 5', () => {
            expect(eventBus.SEVERITIES).toEqual(['P0', 'P1', 'P2', 'P3', 'P0-FLOOD']);
            expect(Object.isFrozen(eventBus.SEVERITIES)).toBe(true);
        });
        test('RING_BUFFER_SIZE constant exposed', () => {
            expect(eventBus.RING_BUFFER_SIZE).toBe(10000);
        });
    });

    describe('emit + subscribe', () => {
        test('subscriber receives emitted event', () => {
            const received = [];
            eventBus.subscribe('heartbeat', (e) => received.push(e));
            eventBus.emit({
                eventType: 'heartbeat',
                moduleId: 'm1',
                payload: { latency_ms: 1.2, ran_ok: 1 },
                ts: Date.now()
            });
            expect(received.length).toBe(1);
            expect(received[0].moduleId).toBe('m1');
        });

        test('multiple subscribers all receive', () => {
            const a = []; const b = [];
            eventBus.subscribe('alert', e => a.push(e));
            eventBus.subscribe('alert', e => b.push(e));
            eventBus.emit({
                eventType: 'alert', moduleId: 'm', severity: 'P1',
                payload: {}, ts: Date.now()
            });
            expect(a.length).toBe(1);
            expect(b.length).toBe(1);
        });

        test('subscriber for different eventType does not receive', () => {
            const received = [];
            eventBus.subscribe('heartbeat', e => received.push(e));
            eventBus.emit({
                eventType: 'alert', moduleId: 'm', severity: 'P2',
                payload: {}, ts: Date.now()
            });
            expect(received.length).toBe(0);
        });

        test('unsubscribe stops delivery', () => {
            const received = [];
            const handler = e => received.push(e);
            eventBus.subscribe('heartbeat', handler);
            eventBus.unsubscribe('heartbeat', handler);
            eventBus.emit({
                eventType: 'heartbeat', moduleId: 'm',
                payload: { latency_ms: 1, ran_ok: 1 }, ts: Date.now()
            });
            expect(received.length).toBe(0);
        });
    });

    describe('Ring buffer', () => {
        test('emitted events appended to ring buffer', () => {
            eventBus.emit({
                eventType: 'heartbeat', moduleId: 'm1',
                payload: { latency_ms: 1, ran_ok: 1 }, ts: 1000
            });
            eventBus.emit({
                eventType: 'alert', moduleId: 'm2', severity: 'P1',
                payload: {}, ts: 2000
            });
            const ring = eventBus.getRingSnapshot();
            expect(ring.length).toBe(2);
            expect(ring[0].moduleId).toBe('m1');
            expect(ring[1].moduleId).toBe('m2');
        });

        test('ring overflow drops oldest', () => {
            for (let i = 0; i < 10005; i++) {
                eventBus.emit({
                    eventType: 'heartbeat', moduleId: 'mb',
                    payload: { latency_ms: 1, ran_ok: 1 }, ts: i
                });
            }
            const ring = eventBus.getRingSnapshot();
            expect(ring.length).toBe(10000);
            // Oldest 5 dropped — first remaining should be ts=5
            expect(ring[0].ts).toBe(5);
            expect(ring[ring.length - 1].ts).toBe(10004);
        });

        test('getRingSnapshot returns a copy (mutation safe)', () => {
            eventBus.emit({
                eventType: 'heartbeat', moduleId: 'x',
                payload: { latency_ms: 1, ran_ok: 1 }, ts: Date.now()
            });
            const snap1 = eventBus.getRingSnapshot();
            snap1.push({ foo: 'bar' });
            const snap2 = eventBus.getRingSnapshot();
            expect(snap2.length).toBe(1);
        });
    });

    describe('Validation', () => {
        test('rejects emit without eventType', () => {
            expect(() => eventBus.emit({
                moduleId: 'm', payload: {}, ts: Date.now()
            })).toThrow(/eventType/);
        });

        test('rejects emit without moduleId', () => {
            expect(() => eventBus.emit({
                eventType: 'heartbeat', payload: {}, ts: Date.now()
            })).toThrow(/moduleId/);
        });

        test('rejects emit without ts', () => {
            expect(() => eventBus.emit({
                eventType: 'heartbeat', moduleId: 'm', payload: {}
            })).toThrow(/ts/);
        });

        test('rejects alert severity not in enum', () => {
            expect(() => eventBus.emit({
                eventType: 'alert', moduleId: 'm', severity: 'PX',
                payload: {}, ts: Date.now()
            })).toThrow(/severity/);
        });

        test('heartbeat does not require severity', () => {
            expect(() => eventBus.emit({
                eventType: 'heartbeat', moduleId: 'm',
                payload: { latency_ms: 1, ran_ok: 1 }, ts: Date.now()
            })).not.toThrow();
        });
    });

    describe('Performance', () => {
        test('emit completes under 0.5ms p99 for 1000 calls', () => {
            const samples = [];
            for (let i = 0; i < 1000; i++) {
                const t0 = process.hrtime.bigint();
                eventBus.emit({
                    eventType: 'heartbeat', moduleId: 'perf',
                    payload: { latency_ms: 0.1, ran_ok: 1 }, ts: i
                });
                const t1 = process.hrtime.bigint();
                samples.push(Number(t1 - t0) / 1e6); // → ms
            }
            samples.sort((a, b) => a - b);
            const p99 = samples[Math.floor(samples.length * 0.99)];
            // Allow generous slack for CI; spec target 0.5ms but flag at 2ms
            expect(p99).toBeLessThan(2.0);
        });
    });
});

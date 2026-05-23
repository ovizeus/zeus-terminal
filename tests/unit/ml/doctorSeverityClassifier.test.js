'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-sev-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const classifier = require('../../../server/services/ml/_doctor/severityClassifier');

const _now = () => Date.now();
const _hourAgo = (ts) => ts - 3600_000;
const _dayAgo = (ts) => ts - 86400_000;

function clean() {
    db.prepare("DELETE FROM ml_diagnostic_events").run();
    classifier.resetForTest();
}

describe('D-3.1 severityClassifier (quota + alert-storm coalesce)', () => {
    beforeEach(clean);

    describe('Constants per FAILURE_ONTOLOGY', () => {
        test('P0 quota = 3/day', () => {
            expect(classifier.QUOTA_P0_PER_DAY).toBe(3);
        });
        test('P1 quota = 10/hour', () => {
            expect(classifier.QUOTA_P1_PER_HOUR).toBe(10);
        });
        test('P2 quota = 100/hour', () => {
            expect(classifier.QUOTA_P2_PER_HOUR).toBe(100);
        });
        test('SEVERITIES match eventBus enum 5', () => {
            expect(classifier.SEVERITIES).toEqual(['P0', 'P1', 'P2', 'P3', 'P0-FLOOD']);
        });
    });

    describe('Under quota — pass through', () => {
        test('1st P0 of day → pass', () => {
            const r = classifier.classify({
                severity: 'P0', moduleId: 'm', ts: _now()
            });
            expect(r.severity).toBe('P0');
            expect(r.quotaExceeded).toBe(false);
        });

        test('3 P0 in same day → all pass', () => {
            const now = _now();
            for (let i = 0; i < 3; i++) {
                const r = classifier.classify({
                    severity: 'P0', moduleId: `m${i}`, ts: now + i
                });
                expect(r.severity).toBe('P0');
            }
        });

        test('10 P1 in same hour → all pass', () => {
            const now = _now();
            for (let i = 0; i < 10; i++) {
                const r = classifier.classify({
                    severity: 'P1', moduleId: `mp1_${i}`, ts: now + i
                });
                expect(r.severity).toBe('P1');
                expect(r.quotaExceeded).toBe(false);
            }
        });

        test('P3 always passes (unlimited)', () => {
            const now = _now();
            for (let i = 0; i < 500; i++) {
                const r = classifier.classify({
                    severity: 'P3', moduleId: 'mp3', ts: now + i
                });
                expect(r.severity).toBe('P3');
            }
        });
    });

    describe('Quota exceeded → P0-FLOOD promotion', () => {
        test('4th P0 in 24h promotes to P0-FLOOD', () => {
            const now = _now();
            // Insert 3 prior P0 events into log
            const ins = db.prepare(`
                INSERT INTO ml_diagnostic_events
                (event_id, severity, module_id, event_type, payload_json, ts)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            for (let i = 0; i < 3; i++) {
                ins.run(`prior_p0_${i}`, 'P0', 'm', 'alert', '{}', now - 1000 + i);
            }
            const r = classifier.classify({
                severity: 'P0', moduleId: 'm4', ts: now
            });
            expect(r.severity).toBe('P0-FLOOD');
            expect(r.quotaExceeded).toBe(true);
            expect(r.reason).toMatch(/quota/i);
        });

        test('11th P1 in 1h coalesces to alert_storm', () => {
            const now = _now();
            const ins = db.prepare(`
                INSERT INTO ml_diagnostic_events
                (event_id, severity, module_id, event_type, payload_json, ts)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            for (let i = 0; i < 10; i++) {
                ins.run(`prior_p1_${i}`, 'P1', 'm', 'alert', '{}', now - 1000 + i);
            }
            const r = classifier.classify({
                severity: 'P1', moduleId: 'm11', ts: now
            });
            expect(r.quotaExceeded).toBe(true);
            expect(r.coalesced).toBe(true);
            expect(r.alertStorm).toBe(true);
        });

        test('101st P2 in 1h coalesces', () => {
            const now = _now();
            const ins = db.prepare(`
                INSERT INTO ml_diagnostic_events
                (event_id, severity, module_id, event_type, payload_json, ts)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            for (let i = 0; i < 100; i++) {
                ins.run(`prior_p2_${i}`, 'P2', 'm', 'alert', '{}', now - 1000 + i);
            }
            const r = classifier.classify({
                severity: 'P2', moduleId: 'm101', ts: now
            });
            expect(r.coalesced).toBe(true);
        });
    });

    describe('Quota window — old events do not count', () => {
        test('P0 older than 24h does not count toward quota', () => {
            const now = _now();
            const ins = db.prepare(`
                INSERT INTO ml_diagnostic_events
                (event_id, severity, module_id, event_type, payload_json, ts)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            // 3 P0 events but all >24h old
            for (let i = 0; i < 3; i++) {
                ins.run(`old_p0_${i}`, 'P0', 'm', 'alert', '{}', _dayAgo(now) - 1000);
            }
            const r = classifier.classify({
                severity: 'P0', moduleId: 'm_now', ts: now
            });
            expect(r.severity).toBe('P0');
            expect(r.quotaExceeded).toBe(false);
        });

        test('P1 older than 1h does not count toward quota', () => {
            const now = _now();
            const ins = db.prepare(`
                INSERT INTO ml_diagnostic_events
                (event_id, severity, module_id, event_type, payload_json, ts)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            for (let i = 0; i < 10; i++) {
                ins.run(`old_p1_${i}`, 'P1', 'm', 'alert', '{}', _hourAgo(now) - 1000);
            }
            const r = classifier.classify({
                severity: 'P1', moduleId: 'm_now', ts: now
            });
            expect(r.quotaExceeded).toBe(false);
        });
    });

    describe('getQuotaStatus', () => {
        test('returns current rolling counts', () => {
            const now = _now();
            const ins = db.prepare(`
                INSERT INTO ml_diagnostic_events
                (event_id, severity, module_id, event_type, payload_json, ts)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            ins.run('qs1', 'P0', 'm', 'alert', '{}', now - 1000);
            ins.run('qs2', 'P1', 'm', 'alert', '{}', now - 1000);
            ins.run('qs3', 'P1', 'm', 'alert', '{}', now - 500);
            const status = classifier.getQuotaStatus({ nowTs: now });
            expect(status.p0_24h).toBe(1);
            expect(status.p1_1h).toBe(2);
            expect(status.p2_1h).toBe(0);
        });
    });

    describe('Validation', () => {
        test('rejects invalid severity', () => {
            expect(() => classifier.classify({
                severity: 'PX', moduleId: 'm', ts: _now()
            })).toThrow(/severity/);
        });

        test('rejects missing moduleId', () => {
            expect(() => classifier.classify({
                severity: 'P1', ts: _now()
            })).toThrow(/moduleId/);
        });

        test('rejects missing ts', () => {
            expect(() => classifier.classify({
                severity: 'P1', moduleId: 'm'
            })).toThrow(/ts/);
        });
    });
});

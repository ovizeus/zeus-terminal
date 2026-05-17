'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-fp-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const fpa = require('../../../server/services/ml/_doctor/falsePositiveAuditor');

const _now = () => Date.now();
const _dayAgo = (ts, d) => ts - d * 86400_000;

function clean() {
    db.prepare("DELETE FROM ml_diagnostic_events").run();
    fpa.resetForTest();
}

function seedEvent(eventId, severity, moduleId, verdict, ts) {
    db.prepare(`
        INSERT INTO ml_diagnostic_events
        (event_id, severity, module_id, event_type, payload_json, verdict, ts)
        VALUES (?, ?, ?, 'alert', '{}', ?, ?)
    `).run(eventId, severity, moduleId, verdict, ts);
}

describe('D-3.2 falsePositiveAuditor', () => {
    beforeEach(clean);

    describe('Constants', () => {
        test('FP_RATE_THRESHOLD = 0.30 per FAILURE_ONTOLOGY', () => {
            expect(fpa.FP_RATE_THRESHOLD).toBe(0.30);
        });
        test('WINDOW_DAYS = 30 per ontology', () => {
            expect(fpa.WINDOW_DAYS).toBe(30);
        });
        test('VERDICTS frozen 4', () => {
            expect(fpa.VERDICTS).toEqual([
                'real_incident', 'false_positive', 'inconclusive', 'partial'
            ]);
        });
    });

    describe('setVerdict', () => {
        test('updates verdict on event', () => {
            const now = _now();
            seedEvent('ev1', 'P1', 'modA', null, now);
            const r = fpa.setVerdict({ eventId: 'ev1', verdict: 'real_incident' });
            expect(r.updated).toBe(true);
            const row = db.prepare("SELECT verdict FROM ml_diagnostic_events WHERE event_id = ?").get('ev1');
            expect(row.verdict).toBe('real_incident');
        });

        test('rejects invalid verdict', () => {
            expect(() => fpa.setVerdict({
                eventId: 'ev_nope', verdict: 'maybe'
            })).toThrow(/invalid verdict/);
        });

        test('rejects unknown eventId', () => {
            expect(() => fpa.setVerdict({
                eventId: 'never_existed', verdict: 'real_incident'
            })).toThrow(/eventId not found/);
        });

        test('can overwrite verdict (operator correction)', () => {
            const now = _now();
            seedEvent('ev_over', 'P1', 'modA', 'inconclusive', now);
            fpa.setVerdict({ eventId: 'ev_over', verdict: 'false_positive' });
            const row = db.prepare("SELECT verdict FROM ml_diagnostic_events WHERE event_id = ?").get('ev_over');
            expect(row.verdict).toBe('false_positive');
        });
    });

    describe('computeFPRate per module', () => {
        test('0 verdicted events → null FP rate (insufficient data)', () => {
            const now = _now();
            seedEvent('e1', 'P1', 'modX', null, now);
            seedEvent('e2', 'P1', 'modX', null, now);
            const r = fpa.computeFPRate({ moduleId: 'modX', nowTs: now });
            expect(r.fpRate).toBeNull();
            expect(r.totalVerdicted).toBe(0);
            expect(r.totalEvents).toBe(2);
        });

        test('100% real_incident → FP rate 0', () => {
            const now = _now();
            seedEvent('a1', 'P1', 'modY', 'real_incident', now);
            seedEvent('a2', 'P1', 'modY', 'real_incident', now);
            seedEvent('a3', 'P1', 'modY', 'real_incident', now);
            const r = fpa.computeFPRate({ moduleId: 'modY', nowTs: now });
            expect(r.fpRate).toBe(0);
            expect(r.totalVerdicted).toBe(3);
        });

        test('50% false_positive → FP rate 0.5', () => {
            const now = _now();
            seedEvent('b1', 'P1', 'modZ', 'real_incident', now);
            seedEvent('b2', 'P1', 'modZ', 'false_positive', now);
            const r = fpa.computeFPRate({ moduleId: 'modZ', nowTs: now });
            expect(r.fpRate).toBe(0.5);
        });

        test('partial counts as 0.5 weight', () => {
            const now = _now();
            seedEvent('c1', 'P1', 'modP', 'real_incident', now);
            seedEvent('c2', 'P1', 'modP', 'partial', now);
            const r = fpa.computeFPRate({ moduleId: 'modP', nowTs: now });
            expect(r.fpRate).toBe(0.25);  // 0 + 0.5 / 2
        });

        test('inconclusive verdicts excluded from rate', () => {
            const now = _now();
            seedEvent('d1', 'P1', 'modI', 'real_incident', now);
            seedEvent('d2', 'P1', 'modI', 'inconclusive', now);
            seedEvent('d3', 'P1', 'modI', 'false_positive', now);
            const r = fpa.computeFPRate({ moduleId: 'modI', nowTs: now });
            // 1 real, 1 fp → 0.5 (inconclusive not counted)
            expect(r.fpRate).toBe(0.5);
            expect(r.totalVerdicted).toBe(2);  // inconclusive excluded
        });

        test('only events within 30d window count', () => {
            const now = _now();
            // 5 false_positive >30d ago
            for (let i = 0; i < 5; i++) {
                seedEvent(`old${i}`, 'P1', 'modOld', 'false_positive', _dayAgo(now, 31));
            }
            // 2 real_incident recent
            seedEvent('new1', 'P1', 'modOld', 'real_incident', now);
            seedEvent('new2', 'P1', 'modOld', 'real_incident', now);
            const r = fpa.computeFPRate({ moduleId: 'modOld', nowTs: now });
            expect(r.fpRate).toBe(0);  // Only recent counted
            expect(r.totalVerdicted).toBe(2);
        });
    });

    describe('isDownweighted', () => {
        test('FP rate >= 0.30 → downweighted', () => {
            const now = _now();
            seedEvent('dw1', 'P1', 'modBad', 'real_incident', now);
            seedEvent('dw2', 'P1', 'modBad', 'false_positive', now);
            seedEvent('dw3', 'P1', 'modBad', 'false_positive', now);
            // 1/3 real, 2/3 fp → fpRate = 0.666 → downweighted
            const r = fpa.isDownweighted({ moduleId: 'modBad', nowTs: now });
            expect(r.downweighted).toBe(true);
            expect(r.fpRate).toBeCloseTo(0.666, 2);
        });

        test('FP rate < 0.30 → not downweighted', () => {
            const now = _now();
            for (let i = 0; i < 9; i++) {
                seedEvent(`good${i}`, 'P1', 'modGood', 'real_incident', now);
            }
            seedEvent('one_fp', 'P1', 'modGood', 'false_positive', now);
            // 9/10 real → fpRate = 0.1 → not downweighted
            const r = fpa.isDownweighted({ moduleId: 'modGood', nowTs: now });
            expect(r.downweighted).toBe(false);
        });

        test('null FP rate (no verdicted events) → not downweighted', () => {
            const r = fpa.isDownweighted({ moduleId: 'modNew', nowTs: _now() });
            expect(r.downweighted).toBe(false);
        });
    });

    describe('listDownweightedModules', () => {
        test('returns modules exceeding threshold', () => {
            const now = _now();
            // Bad module
            seedEvent('b1', 'P1', 'badMod', 'false_positive', now);
            seedEvent('b2', 'P1', 'badMod', 'false_positive', now);
            seedEvent('b3', 'P1', 'badMod', 'false_positive', now);
            // Good module
            seedEvent('g1', 'P1', 'goodMod', 'real_incident', now);
            seedEvent('g2', 'P1', 'goodMod', 'real_incident', now);
            const list = fpa.listDownweightedModules({ nowTs: now });
            const ids = list.map(m => m.moduleId);
            expect(ids).toContain('badMod');
            expect(ids).not.toContain('goodMod');
        });
    });

    describe('Validation', () => {
        test('rejects missing eventId in setVerdict', () => {
            expect(() => fpa.setVerdict({ verdict: 'real_incident' })).toThrow(/eventId/);
        });
        test('rejects missing verdict in setVerdict', () => {
            expect(() => fpa.setVerdict({ eventId: 'ev1' })).toThrow(/verdict/);
        });
        test('rejects missing moduleId in computeFPRate', () => {
            expect(() => fpa.computeFPRate({ nowTs: _now() })).toThrow(/moduleId/);
        });
    });
});

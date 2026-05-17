'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r5-pool-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const be = require('../../../server/services/ml/_ring5/banditEvidence');
const pe = require('../../../server/services/ml/_ring5/pooledEvidence');

const _now = () => Date.now();

function clean() {
    db.prepare("DELETE FROM ml_bandit_evidence").run();
    db.prepare("DELETE FROM ml_pooled_evidence").run();
}

describe('pooledEvidence (Phase 3 — SPEC-7 lazy-with-TTL)', () => {
    beforeEach(clean);

    describe('constants', () => {
        test('TTL_MS = 30 min', () => { expect(pe.TTL_MS).toBe(30 * 60 * 1000); });
        test('OBS_THRESHOLD = 50', () => { expect(pe.OBS_THRESHOLD).toBe(50); });
        test('WINDOW_DAYS = 30', () => { expect(pe.WINDOW_DAYS).toBe(30); });
    });

    describe('refresh (triggered)', () => {
        test('first call creates pooled row from evidence', () => {
            const t = _now();
            be.recordEvidence({ cellKey: 'fresh', moduleId: 'm', contribution: 0.5, confidence: 0.7, outcomeClass: 'positive', ts: t });
            be.recordEvidence({ cellKey: 'fresh', moduleId: 'm', contribution: 0.3, confidence: 0.6, outcomeClass: 'positive', ts: t + 100 });
            const r = pe.refresh({ cellKey: 'fresh', nowTs: _now() });
            expect(r.refreshed).toBe(true);
            expect(r.pooledAlpha).toBe(3);
            expect(r.pooledBeta).toBe(1);
            expect(r.n).toBe(2);
        });
        test('persisted in ml_pooled_evidence', () => {
            be.recordEvidence({ cellKey: 'persist', moduleId: 'm', contribution: 0.1, confidence: 0.5, outcomeClass: 'positive', ts: _now() });
            pe.refresh({ cellKey: 'persist', nowTs: _now() });
            const row = db.prepare("SELECT * FROM ml_pooled_evidence WHERE cell_key = ?").get('persist');
            expect(row).toBeTruthy();
            expect(row.pooled_alpha).toBe(2);
            expect(row.staleness_observations_count).toBe(0);
        });
    });

    describe('get + lazy refresh trigger', () => {
        test('returns existing pooled row when fresh', () => {
            const now = _now();
            be.recordEvidence({ cellKey: 'g1', moduleId: 'm', contribution: 0.5, confidence: 0.5, outcomeClass: 'positive', ts: now });
            pe.refresh({ cellKey: 'g1', nowTs: now });
            const r = pe.get({ cellKey: 'g1', nowTs: now + 1000 });
            expect(r.pooledAlpha).toBe(2);
            expect(r.refreshTriggered).toBe(false);
        });
        test('TTL trigger: > 30min stale auto-refresh', () => {
            const t = _now() - 31 * 60 * 1000;
            be.recordEvidence({ cellKey: 'ttl', moduleId: 'm', contribution: 0.1, confidence: 0.5, outcomeClass: 'positive', ts: t });
            pe.refresh({ cellKey: 'ttl', nowTs: t });
            const newT = _now();
            be.recordEvidence({ cellKey: 'ttl', moduleId: 'm', contribution: 0.2, confidence: 0.5, outcomeClass: 'positive', ts: newT });
            const r = pe.get({ cellKey: 'ttl', nowTs: newT });
            expect(r.refreshTriggered).toBe(true);
            expect(r.pooledAlpha).toBe(3);
        });
        test('OBS threshold trigger: 50 new obs → auto-refresh', () => {
            const t = _now();
            be.recordEvidence({ cellKey: 'obs', moduleId: 'm', contribution: 0.1, confidence: 0.5, outcomeClass: 'positive', ts: t });
            pe.refresh({ cellKey: 'obs', nowTs: t });
            for (let i = 0; i < 50; i++) {
                be.recordEvidence({ cellKey: 'obs', moduleId: 'm', contribution: 0.05, confidence: 0.5, outcomeClass: 'positive', ts: t + 100 + i });
            }
            pe.incrementStaleness({ cellKey: 'obs', count: 50 });
            const r = pe.get({ cellKey: 'obs', nowTs: t + 500 });
            expect(r.refreshTriggered).toBe(true);
            expect(r.n).toBe(51);
        });
        test('never refreshed → triggers initial refresh on first get', () => {
            be.recordEvidence({ cellKey: 'new', moduleId: 'm', contribution: 0.1, confidence: 0.5, outcomeClass: 'positive', ts: _now() });
            const r = pe.get({ cellKey: 'new', nowTs: _now() });
            expect(r.refreshTriggered).toBe(true);
            expect(r.pooledAlpha).toBe(2);
        });
    });

    describe('incrementStaleness', () => {
        test('increments staleness counter without refresh', () => {
            be.recordEvidence({ cellKey: 'st', moduleId: 'm', contribution: 0.1, confidence: 0.5, outcomeClass: 'positive', ts: _now() });
            pe.refresh({ cellKey: 'st', nowTs: _now() });
            pe.incrementStaleness({ cellKey: 'st', count: 5 });
            const row = db.prepare("SELECT staleness_observations_count FROM ml_pooled_evidence WHERE cell_key = ?").get('st');
            expect(row.staleness_observations_count).toBe(5);
        });
    });
});

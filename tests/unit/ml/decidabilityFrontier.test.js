'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p191-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const M = require('../../../server/services/ml/_meta/decidabilityFrontier');

const UID = 9191, UID2 = 9291, ENV = 'DEMO';
const _now = () => Date.now();

const HIGH = {
    evidenceAvailable: 0.85, ontologyAvailable: 0.85,
    computeAvailable: 0.85, timeAvailable: 0.85, authorityAvailable: 0.85
};
const LOW = {
    evidenceAvailable: 0.15, ontologyAvailable: 0.10,
    computeAvailable: 0.15, timeAvailable: 0.15, authorityAvailable: 0.15
};

function cleanRows() {
    db.prepare(`DELETE FROM ml_decidability_assessments WHERE user_id IN (?, ?)`).run(UID, UID2);
}
beforeEach(() => cleanRows());
afterAll(() => cleanRows());

describe('OMEGA §191 DECIDABILITY FRONTIER', () => {
    test('migration 338 applied', () => {
        expect(db.prepare("SELECT name FROM _migrations WHERE name=?").get('338_ml_decidability_assessments')).toBeTruthy();
    });
    test('DECIDABILITY_CATEGORIES frozen 4', () => {
        expect(M.DECIDABILITY_CATEGORIES).toEqual([
            'decidable_now', 'decidable_with_more_sensing',
            'decidable_only_with_ontology_change',
            'not_responsibly_decidable_in_current_frame'
        ]);
    });
    test('ESCALATION_OPTIONS frozen 6', () => {
        expect(M.ESCALATION_OPTIONS).toEqual([
            'act', 'wait', 'reframe_question',
            'active_sensing', 'shadow_only', 'observer'
        ]);
    });
    test('DECIDABILITY_FACTORS frozen 5 (canonical)', () => {
        expect(M.DECIDABILITY_FACTORS).toEqual([
            'evidenceAvailable', 'ontologyAvailable',
            'computeAvailable', 'timeAvailable', 'authorityAvailable'
        ]);
    });
    test('computeDecidabilityScore: HIGH → high', () => {
        const r = M.computeDecidabilityScore({ factors: HIGH });
        expect(r.decidabilityScore).toBeCloseTo(0.85, 5);
    });
    test('computeDecidabilityScore: LOW → low', () => {
        const r = M.computeDecidabilityScore({ factors: LOW });
        expect(r.decidabilityScore).toBeLessThan(0.20);
    });
    test('classifyDecidability: HIGH → decidable_now', () => {
        expect(M.classifyDecidability({ decidabilityScore: 0.85, factors: HIGH }).category).toBe('decidable_now');
    });
    test('classifyDecidability: low ontology → ontology_change', () => {
        const r = M.classifyDecidability({
            decidabilityScore: 0.45,
            factors: { ...HIGH, ontologyAvailable: 0.10 }
        });
        expect(r.category).toBe('decidable_only_with_ontology_change');
    });
    test('classifyDecidability: LOW → not_responsibly_decidable', () => {
        expect(M.classifyDecidability({
            decidabilityScore: 0.10, factors: LOW
        }).category).toBe('not_responsibly_decidable_in_current_frame');
    });
    test('recommendEscalation per category', () => {
        expect(M.recommendEscalation({ category: 'decidable_now' }).escalation).toBe('act');
        expect(M.recommendEscalation({ category: 'not_responsibly_decidable_in_current_frame' }).escalation).toBe('observer');
    });
    test('detectCoercion: forced + low score → coercion', () => {
        const r = M.detectCoercion({ decidabilityScore: 0.15, forcedVerdict: true });
        expect(r.coercionDetected).toBe(1);
    });
    test('detectCoercion: not forced → no coercion', () => {
        const r = M.detectCoercion({ decidabilityScore: 0.15, forcedVerdict: false });
        expect(r.coercionDetected).toBe(0);
    });
    test('recordDecidabilityAssessment: HIGH', () => {
        const r = M.recordDecidabilityAssessment({
            userId: UID, resolvedEnv: ENV,
            assessmentId: 'rd_1', questionLabel: 'enter BTC long?',
            factors: HIGH, forcedVerdict: false, ts: _now()
        });
        expect(r.recorded).toBe(true);
        expect(r.decidabilityCategory).toBe('decidable_now');
        expect(r.recommendedEscalation).toBe('act');
        expect(r.coercionDetected).toBe(0);
    });
    test('recordDecidabilityAssessment: LOW + forced → coercion', () => {
        const r = M.recordDecidabilityAssessment({
            userId: UID, resolvedEnv: ENV,
            assessmentId: 'rd_coerce', questionLabel: 'should I act now?',
            factors: LOW, forcedVerdict: true, ts: _now()
        });
        expect(r.coercionDetected).toBe(1);
        expect(r.recommendedEscalation).toBe('observer');
    });
    test('duplicate throws', () => {
        M.recordDecidabilityAssessment({
            userId: UID, resolvedEnv: ENV, assessmentId: 'rd_dup',
            questionLabel: 'q', factors: HIGH, ts: _now()
        });
        expect(() => M.recordDecidabilityAssessment({
            userId: UID, resolvedEnv: ENV, assessmentId: 'rd_dup',
            questionLabel: 'q', factors: HIGH, ts: _now()
        })).toThrow(/duplicate/);
    });
    test('uid isolation', () => {
        M.recordDecidabilityAssessment({
            userId: UID, resolvedEnv: ENV, assessmentId: 'iso_a',
            questionLabel: 'q', factors: HIGH, ts: _now()
        });
        expect(M.getRecentAssessments({ userId: UID2, resolvedEnv: ENV })).toEqual([]);
    });
});

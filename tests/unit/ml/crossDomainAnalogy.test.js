'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p102-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const cda = require('../../../server/services/ml/R2_cognition/crossDomainAnalogy');

const TEST_USER = 9102;
const OTHER_USER = 9103;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_analogy_templates WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_analogy_matches WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§102 Migrations 193 + 194', () => {
    test('template_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_analogy_templates
             (user_id, resolved_env, template_id, source_domain,
              structural_pattern_json, market_application, status, ts)
             VALUES (?, ?, 'AT-UNIQ', 'physics', '{}', 'app', 'ACTIVE', ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_analogy_templates
             (user_id, resolved_env, template_id, source_domain,
              structural_pattern_json, market_application, status, ts)
             VALUES (?, ?, 'AT-UNIQ', 'ecology', '{}', 'app2', 'ACTIVE', ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK source_domain restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_analogy_templates
             (user_id, resolved_env, template_id, source_domain,
              structural_pattern_json, market_application, status, ts)
             VALUES (?, ?, 'AT-BAD', 'BOGUS', '{}', 'app', 'ACTIVE', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK structural_similarity in [0,1]', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_analogy_matches
             (user_id, resolved_env, match_id, template_id,
              market_situation_id, structural_similarity,
              predicted_outcome, actual_outcome, accuracy, ts)
             VALUES (?, ?, 'AM-BAD', 'T', 'S', 1.5, 'pred', NULL, NULL, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§102 Constants', () => {
    test('SOURCE_DOMAINS has 7 entries', () => {
        expect(cda.SOURCE_DOMAINS).toHaveLength(7);
    });

    test('HEALTH_STATUSES has 3 entries', () => {
        expect(cda.HEALTH_STATUSES).toEqual([
            'HEALTHY', 'UNDERPERFORMING', 'INSUFFICIENT'
        ]);
    });

    test('threshold in (0,1)', () => {
        expect(cda.HEALTHY_ACCURACY_THRESHOLD).toBeGreaterThan(0);
        expect(cda.HEALTHY_ACCURACY_THRESHOLD).toBeLessThan(1);
    });
});

describe('§102 computeStructuralSimilarity (pure cosine)', () => {
    test('identical features → similarity=1', () => {
        const r = cda.computeStructuralSimilarity({
            patternFeaturesA: { potential_energy: 0.8, density: 0.5, gradient: 0.3 },
            patternFeaturesB: { potential_energy: 0.8, density: 0.5, gradient: 0.3 }
        });
        expect(r.similarity).toBeCloseTo(1);
    });

    test('orthogonal features → similarity=0', () => {
        const r = cda.computeStructuralSimilarity({
            patternFeaturesA: { a: 1, b: 0 },
            patternFeaturesB: { a: 0, b: 1 }
        });
        expect(r.similarity).toBeCloseTo(0);
    });

    test('partial overlap → 0 < sim < 1', () => {
        const r = cda.computeStructuralSimilarity({
            patternFeaturesA: { x: 1, y: 1 },
            patternFeaturesB: { x: 1, y: 0 }
        });
        expect(r.similarity).toBeGreaterThan(0);
        expect(r.similarity).toBeLessThan(1);
    });

    test('empty features → similarity=0', () => {
        const r = cda.computeStructuralSimilarity({
            patternFeaturesA: {}, patternFeaturesB: {}
        });
        expect(r.similarity).toBe(0);
    });
});

describe('§102 registerAnalogyTemplate', () => {
    test('persists with valid domain', () => {
        const r = cda.registerAnalogyTemplate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            templateId: 'RT-1', sourceDomain: 'physics',
            structuralPattern: { potential_energy_buildup: true },
            marketApplication: 'liquidity squeeze precursor'
        });
        expect(r.registered).toBe(true);
    });

    test('duplicate throws', () => {
        cda.registerAnalogyTemplate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            templateId: 'RT-DUP', sourceDomain: 'ecology',
            structuralPattern: {}, marketApplication: 'app'
        });
        expect(() => cda.registerAnalogyTemplate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            templateId: 'RT-DUP', sourceDomain: 'biology',
            structuralPattern: {}, marketApplication: 'app2'
        })).toThrow();
    });

    test('invalid domain throws', () => {
        expect(() => cda.registerAnalogyTemplate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            templateId: 'RT-BAD', sourceDomain: 'BOGUS',
            structuralPattern: {}, marketApplication: 'app'
        })).toThrow();
    });
});

describe('§102 recordAnalogyMatch + recordAnalogyOutcome', () => {
    test('match persists then outcome updates', () => {
        cda.registerAnalogyTemplate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            templateId: 'AM-T', sourceDomain: 'epidemiology',
            structuralPattern: {}, marketApplication: 'cascade'
        });
        cda.recordAnalogyMatch({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            matchId: 'AM-M1', templateId: 'AM-T',
            marketSituationId: 'liq_crash_1',
            structuralSimilarity: 0.8,
            predictedOutcome: 'cascade'
        });
        const r = cda.recordAnalogyOutcome({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            matchId: 'AM-M1', actualOutcome: 'cascade', accuracy: 0.9
        });
        expect(r.updated).toBe(true);
    });

    test('match with unknown template throws', () => {
        expect(() => cda.recordAnalogyMatch({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            matchId: 'AM-BAD', templateId: 'NOEXIST',
            marketSituationId: 's', structuralSimilarity: 0.5,
            predictedOutcome: 'p'
        })).toThrow();
    });

    test('similarity out of range throws', () => {
        cda.registerAnalogyTemplate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            templateId: 'AM-RT', sourceDomain: 'physics',
            structuralPattern: {}, marketApplication: 'app'
        });
        expect(() => cda.recordAnalogyMatch({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            matchId: 'AM-RB', templateId: 'AM-RT',
            marketSituationId: 's', structuralSimilarity: 1.5,
            predictedOutcome: 'p'
        })).toThrow();
    });
});

describe('§102 evaluateAnalogyHealth', () => {
    function seedTemplateAndMatches(templateId, accuracies) {
        cda.registerAnalogyTemplate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            templateId, sourceDomain: 'physics',
            structuralPattern: {}, marketApplication: 'app'
        });
        accuracies.forEach((acc, i) => {
            cda.recordAnalogyMatch({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                matchId: `${templateId}-M-${i}`, templateId,
                marketSituationId: `s-${i}`,
                structuralSimilarity: 0.7,
                predictedOutcome: 'p'
            });
            cda.recordAnalogyOutcome({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                matchId: `${templateId}-M-${i}`,
                actualOutcome: 'p', accuracy: acc
            });
        });
    }

    test('INSUFFICIENT when few resolved matches', () => {
        seedTemplateAndMatches('EH-FEW', [0.9, 0.9]);
        const r = cda.evaluateAnalogyHealth({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            templateId: 'EH-FEW'
        });
        expect(r.status).toBe('INSUFFICIENT');
    });

    test('HEALTHY when avg accuracy >= 0.60', () => {
        seedTemplateAndMatches('EH-OK', [0.9, 0.8, 0.7, 0.85, 0.75]);
        const r = cda.evaluateAnalogyHealth({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            templateId: 'EH-OK'
        });
        expect(r.status).toBe('HEALTHY');
    });

    test('UNDERPERFORMING when avg accuracy < 0.60', () => {
        seedTemplateAndMatches('EH-BAD', [0.2, 0.3, 0.4, 0.3, 0.5]);
        const r = cda.evaluateAnalogyHealth({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            templateId: 'EH-BAD'
        });
        expect(r.status).toBe('UNDERPERFORMING');
    });
});

describe('§102 getActiveTemplates', () => {
    test('filters by source domain', () => {
        cda.registerAnalogyTemplate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            templateId: 'GA-PHYS', sourceDomain: 'physics',
            structuralPattern: {}, marketApplication: 'app'
        });
        cda.registerAnalogyTemplate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            templateId: 'GA-ECO', sourceDomain: 'ecology',
            structuralPattern: {}, marketApplication: 'app'
        });
        const r = cda.getActiveTemplates({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sourceDomain: 'physics'
        });
        expect(r).toHaveLength(1);
        expect(r[0].templateId).toBe('GA-PHYS');
    });
});

describe('§102 isolation', () => {
    test('per (user × env) isolation', () => {
        cda.registerAnalogyTemplate({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            templateId: 'ISO-1', sourceDomain: 'physics',
            structuralPattern: {}, marketApplication: 'app'
        });
        const a = cda.getActiveTemplates({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const b = cda.getActiveTemplates({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});

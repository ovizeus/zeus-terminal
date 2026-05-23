'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p110-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const arr = require('../../../server/services/ml/R2_cognition/adaptiveReasoningRouter');

const TEST_USER = 9110;
const OTHER_USER = 9111;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_module_priorities WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_reasoning_paths WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§110 Migrations 209 + 210', () => {
    test('priority_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_module_priorities
             (user_id, resolved_env, priority_id, module_id, kind,
              constant_priority, is_active, last_invoked, ts)
             VALUES (?, ?, 'MP-UNIQ', 'M1', 'safety', 100, 1, NULL, ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_module_priorities
             (user_id, resolved_env, priority_id, module_id, kind,
              constant_priority, is_active, last_invoked, ts)
             VALUES (?, ?, 'MP-UNIQ', 'M2', 'normal', 50, 1, NULL, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK kind restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_module_priorities
             (user_id, resolved_env, priority_id, module_id, kind,
              constant_priority, is_active, last_invoked, ts)
             VALUES (?, ?, 'MP-BAD', 'M', 'BOGUS', 50, 1, NULL, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK cognitive_budget_used >= 0', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_reasoning_paths
             (user_id, resolved_env, path_id, decision_context_json,
              modules_included_json, modules_skipped_json,
              cognitive_budget_used, justification, ts)
             VALUES (?, ?, 'RP-NEG', '{}', '[]', '[]', -0.5, 'j', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§110 Constants', () => {
    test('MODULE_KINDS has 3 entries', () => {
        expect(arr.MODULE_KINDS).toEqual(['safety', 'veto', 'normal']);
    });

    test('SAFETY_PRIORITY > VETO_PRIORITY > DEFAULT_NORMAL', () => {
        expect(arr.SAFETY_PRIORITY).toBeGreaterThan(arr.VETO_PRIORITY);
        expect(arr.VETO_PRIORITY).toBeGreaterThan(arr.DEFAULT_NORMAL_PRIORITY);
    });

    test('MIN_DEEP_DIVE_BUDGET positive', () => {
        expect(arr.MIN_DEEP_DIVE_BUDGET).toBeGreaterThan(0);
    });
});

describe('§110 selectReasoningPath (pure)', () => {
    test('always includes safety + veto modules', () => {
        const r = arr.selectReasoningPath({
            contextSignals: { macro: 0.1 },
            candidateModules: [
                { moduleId: 'safety-1', kind: 'safety', contextRelevance: 0 },
                { moduleId: 'veto-1', kind: 'veto', contextRelevance: 0 },
                { moduleId: 'normal-1', kind: 'normal', contextRelevance: 0.1 }
            ],
            cognitiveBudget: 0.01
        });
        const ids = r.modulesIncluded.map(m => m.moduleId);
        expect(ids).toContain('safety-1');
        expect(ids).toContain('veto-1');
    });

    test('skips low-relevance normal under tight budget', () => {
        const r = arr.selectReasoningPath({
            contextSignals: {},
            candidateModules: [
                { moduleId: 'safety-1', kind: 'safety', contextRelevance: 1, cost: 0.1 },
                { moduleId: 'low-rel', kind: 'normal', contextRelevance: 0.1, cost: 0.5 }
            ],
            cognitiveBudget: 0.2
        });
        const skipped = r.modulesSkipped.map(m => m.moduleId);
        expect(skipped).toContain('low-rel');
    });

    test('includes high-relevance normal when budget allows', () => {
        const r = arr.selectReasoningPath({
            contextSignals: {},
            candidateModules: [
                { moduleId: 'safety-1', kind: 'safety', contextRelevance: 1, cost: 0.05 },
                { moduleId: 'high-rel', kind: 'normal', contextRelevance: 0.9, cost: 0.2 }
            ],
            cognitiveBudget: 1.0
        });
        const ids = r.modulesIncluded.map(m => m.moduleId);
        expect(ids).toContain('high-rel');
    });

    test('returns justification + budget used', () => {
        const r = arr.selectReasoningPath({
            contextSignals: { test: 1 },
            candidateModules: [
                { moduleId: 'safety-1', kind: 'safety', contextRelevance: 1, cost: 0.1 }
            ],
            cognitiveBudget: 0.5
        });
        expect(r.justification).toBeTruthy();
        expect(r.cognitiveBudgetUsed).toBeGreaterThanOrEqual(0);
    });
});

describe('§110 enforceSafetyVeto (pure)', () => {
    test('throws if safety module in skipped', () => {
        expect(() => arr.enforceSafetyVeto({
            modulesIncluded: [{ moduleId: 'M1', kind: 'normal' }],
            modulesSkipped: [{ moduleId: 'safety-1', kind: 'safety' }],
            safetyModuleIds: ['safety-1'],
            vetoModuleIds: []
        })).toThrow();
    });

    test('throws if veto module in skipped', () => {
        expect(() => arr.enforceSafetyVeto({
            modulesIncluded: [],
            modulesSkipped: [{ moduleId: 'veto-1', kind: 'veto' }],
            safetyModuleIds: [],
            vetoModuleIds: ['veto-1']
        })).toThrow();
    });

    test('allows normal module in skipped', () => {
        const r = arr.enforceSafetyVeto({
            modulesIncluded: [{ moduleId: 'safety-1', kind: 'safety' }],
            modulesSkipped: [{ moduleId: 'normal-1', kind: 'normal' }],
            safetyModuleIds: ['safety-1'],
            vetoModuleIds: []
        });
        expect(r.valid).toBe(true);
    });
});

describe('§110 registerModulePriority', () => {
    test('persists', () => {
        const r = arr.registerModulePriority({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            priorityId: 'RP-1', moduleId: 'circuit-breaker',
            kind: 'safety'
        });
        expect(r.registered).toBe(true);
    });

    test('duplicate throws', () => {
        arr.registerModulePriority({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            priorityId: 'RP-DUP', moduleId: 'M', kind: 'normal'
        });
        expect(() => arr.registerModulePriority({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            priorityId: 'RP-DUP', moduleId: 'M2', kind: 'veto'
        })).toThrow();
    });

    test('invalid kind throws', () => {
        expect(() => arr.registerModulePriority({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            priorityId: 'RP-BAD', moduleId: 'M', kind: 'BOGUS'
        })).toThrow();
    });

    test('safety kind gets constant SAFETY_PRIORITY by default', () => {
        const r = arr.registerModulePriority({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            priorityId: 'RP-SAFE', moduleId: 'M', kind: 'safety'
        });
        expect(r.constantPriority).toBe(arr.SAFETY_PRIORITY);
    });
});

describe('§110 recordReasoningPath', () => {
    test('persists', () => {
        const r = arr.recordReasoningPath({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            pathId: 'PP-1',
            decisionContext: { regime: 'trend' },
            modulesIncluded: [{ moduleId: 'M1', kind: 'safety' }],
            modulesSkipped: [{ moduleId: 'M2', kind: 'normal' }],
            cognitiveBudgetUsed: 0.5,
            justification: 'macro_dominant_context'
        });
        expect(r.recorded).toBe(true);
    });

    test('negative budget throws', () => {
        expect(() => arr.recordReasoningPath({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            pathId: 'PP-NEG',
            decisionContext: {}, modulesIncluded: [], modulesSkipped: [],
            cognitiveBudgetUsed: -1, justification: 'j'
        })).toThrow();
    });
});

describe('§110 getActiveModulePriorities', () => {
    test('filter by kind', () => {
        arr.registerModulePriority({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            priorityId: 'GAP-S', moduleId: 'M1', kind: 'safety'
        });
        arr.registerModulePriority({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            priorityId: 'GAP-N', moduleId: 'M2', kind: 'normal'
        });
        const r = arr.getActiveModulePriorities({
            userId: TEST_USER, resolvedEnv: TEST_ENV, kind: 'safety'
        });
        expect(r).toHaveLength(1);
        expect(r[0].moduleId).toBe('M1');
    });
});

describe('§110 isolation', () => {
    test('per (user × env) isolation', () => {
        arr.registerModulePriority({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            priorityId: 'ISO-1', moduleId: 'M', kind: 'safety'
        });
        const a = arr.getActiveModulePriorities({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const b = arr.getActiveModulePriorities({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});

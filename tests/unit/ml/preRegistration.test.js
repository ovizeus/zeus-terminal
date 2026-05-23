/**
 * R5B Governance — preRegistration tests (§247* Claude-extras)
 *
 * §247* HYPOTHESIS PRE-REGISTRATION = anti-p-hacking discipline.
 * Source: project_ml_brain_pro_244.md "247* (R6 + R5) pre-registered analysis plan".
 * Claude-extras approved 2026-04-29, NOT in canonical PDF.
 *
 * Anti-tampering invariants:
 *   - REGISTERED snapshot is hashed (SHA-256); any field change → INVALID
 *   - evaluate() requires eval_window_to <= now (no early peek-cheat)
 *   - Only one REGISTERED per version_id at a time
 *   - Once PASS/FAIL/INVALID, state is terminal
 */

const { db } = require('../../../server/services/database')
const versionRegistry = require('../../../server/services/ml/R5B_governance/versionRegistry')
const {
    registerHypothesis,
    recordActuals,
    evaluate,
    getRegistration,
    getRegistrationsForVersion,
    SUCCESS_OPERATORS,
    REGISTRATION_STATES
} = require('../../../server/services/ml/R5B_governance/preRegistration')

describe('R5B — preRegistration (§247* Claude-extras)', () => {
    const TEST_PREFIX = `omega_w3_p247_${Date.now()}_`

    let testVersionId
    beforeAll(() => {
        const p = versionRegistry.proposeVersion({
            componentType: 'model',
            componentId: `${TEST_PREFIX}base`,
            version: 'v1',
            config: { w: 0.7 },
            motivation: 'test base for pre-registration',
            actor: 'test'
        })
        testVersionId = p.id
    })

    afterAll(() => {
        db.prepare(`DELETE FROM ml_hypothesis_pre_registrations WHERE actor LIKE 'omega_w3_p247%' OR actor = 'test'`).run()
        db.prepare(`DELETE FROM ml_governance_versions WHERE component_id LIKE ?`).run(`${TEST_PREFIX}%`)
    })

    // ── Migration 046 verification ─────────────────────────────────
    describe('Migration 046 — ml_hypothesis_pre_registrations', () => {
        test('table exists', () => {
            const row = db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='ml_hypothesis_pre_registrations'"
            ).get()
            expect(row).toBeDefined()
        })

        test('has expected columns', () => {
            const cols = db.prepare("PRAGMA table_info(ml_hypothesis_pre_registrations)").all()
            const names = cols.map(c => c.name)
            expect(names).toEqual(expect.arrayContaining([
                'id', 'version_id', 'hypothesis',
                'predicted_metrics_json', 'success_criteria_json',
                'eval_window_from', 'eval_window_to', 'registration_hash',
                'state', 'actual_metrics_json', 'pass_fail_details_json',
                'actor', 'registered_at', 'evaluated_at'
            ]))
        })

        test('state CHECK enforces 5 lifecycle states', () => {
            expect(() => db.prepare(`INSERT INTO ml_hypothesis_pre_registrations
                (version_id, hypothesis, predicted_metrics_json, success_criteria_json,
                 eval_window_from, eval_window_to, registration_hash, state, actor, registered_at)
                VALUES (1, 'h', '{}', '{}', 0, 0, 'h', 'BANANA', 'test', 0)
            `).run()).toThrow(/CHECK constraint/)
        })

        test('version_id+state index exists', () => {
            const idx = db.prepare("PRAGMA index_list(ml_hypothesis_pre_registrations)").all()
            const names = idx.map(i => i.name)
            expect(names).toEqual(expect.arrayContaining(['idx_mlhpr_version_state']))
        })
    })

    // ── Exported enums ─────────────────────────────────────────────
    describe('Exported enums', () => {
        test('SUCCESS_OPERATORS export', () => {
            expect(SUCCESS_OPERATORS).toEqual(['>=', '<=', '>', '<', '=='])
        })
        test('REGISTRATION_STATES export', () => {
            expect(REGISTRATION_STATES).toEqual(['REGISTERED', 'EVALUATING', 'PASS', 'FAIL', 'INVALID'])
        })
    })

    // ── registerHypothesis ─────────────────────────────────────────
    describe('registerHypothesis', () => {
        test('inserts REGISTERED row with computed hash', () => {
            const result = registerHypothesis({
                versionId: testVersionId,
                hypothesis: 'New version improves hit_rate by 3pp',
                predictedMetrics: { hit_rate: 0.55, brier_score: 0.18 },
                successCriteria: { hit_rate: '>= 0.50', brier_score: '<= 0.22' },
                evalWindow: { fromMs: Date.now(), toMs: Date.now() + 86400_000 },
                actor: 'omega_w3_p247_test'
            })
            expect(typeof result.id).toBe('number')
            expect(typeof result.registration_hash).toBe('string')
            expect(result.registration_hash.length).toBe(64)

            const row = getRegistration(result.id)
            expect(row.state).toBe('REGISTERED')
            expect(row.hypothesis).toBe('New version improves hit_rate by 3pp')
        })

        test('same input produces same hash (anti-tampering identity)', () => {
            const window = { fromMs: 1000, toMs: 2000 }
            const compIdA = `${TEST_PREFIX}h_a`
            const compIdB = `${TEST_PREFIX}h_b`
            const vA = versionRegistry.proposeVersion({
                componentType: 'model', componentId: compIdA, version: 'v1',
                config: {}, motivation: 't', actor: 't'
            })
            const vB = versionRegistry.proposeVersion({
                componentType: 'model', componentId: compIdB, version: 'v1',
                config: {}, motivation: 't', actor: 't'
            })
            const aArgs = {
                versionId: vA.id, hypothesis: 'h',
                predictedMetrics: { x: 1 }, successCriteria: { x: '>= 0' },
                evalWindow: window, actor: 'omega_w3_p247_test'
            }
            const bArgs = { ...aArgs, versionId: vB.id }
            const a = registerHypothesis(aArgs)
            const b = registerHypothesis(bArgs)
            // Different version_id changes hash — that's intentional. Test
            // that identical INPUT (same version) produces same hash by
            // computing twice with same params:
            const aArgs2 = { ...aArgs, versionId: vA.id }
            // Cleanup previous to allow duplicate (only one REGISTERED per version):
            db.prepare(`DELETE FROM ml_hypothesis_pre_registrations WHERE id = ?`).run(a.id)
            const a2 = registerHypothesis(aArgs2)
            expect(a2.registration_hash).toBe(a.registration_hash)
        })

        test('throws on duplicate REGISTERED for same version', () => {
            const v = versionRegistry.proposeVersion({
                componentType: 'detector',
                componentId: `${TEST_PREFIX}dup`,
                version: 'v1',
                config: {},
                motivation: 'dup test',
                actor: 'test'
            })
            registerHypothesis({
                versionId: v.id,
                hypothesis: 'first',
                predictedMetrics: { a: 1 },
                successCriteria: { a: '>= 0' },
                evalWindow: { fromMs: Date.now(), toMs: Date.now() + 1000 },
                actor: 'omega_w3_p247_test'
            })
            expect(() => registerHypothesis({
                versionId: v.id,
                hypothesis: 'second attempt',
                predictedMetrics: { a: 2 },
                successCriteria: { a: '>= 0' },
                evalWindow: { fromMs: Date.now(), toMs: Date.now() + 1000 },
                actor: 'omega_w3_p247_test'
            })).toThrow(/already.*registered|duplicate/i)
        })

        test('throws on invalid eval_window (to <= from)', () => {
            expect(() => registerHypothesis({
                versionId: testVersionId,
                hypothesis: 'bad window',
                predictedMetrics: { a: 1 },
                successCriteria: { a: '>= 0' },
                evalWindow: { fromMs: 2000, toMs: 1000 },
                actor: 'omega_w3_p247_test'
            })).toThrow(/eval_window|invalid/i)
        })

        test('throws on missing required fields', () => {
            expect(() => registerHypothesis({})).toThrow()
            expect(() => registerHypothesis({ versionId: 1 })).toThrow()
        })
    })

    // ── recordActuals ──────────────────────────────────────────────
    describe('recordActuals', () => {
        test('writes actual_metrics_json onto registration', () => {
            const v = versionRegistry.proposeVersion({
                componentType: 'detector',
                componentId: `${TEST_PREFIX}ra1`,
                version: 'v1',
                config: {},
                motivation: 't',
                actor: 't'
            })
            const reg = registerHypothesis({
                versionId: v.id,
                hypothesis: 'actuals test',
                predictedMetrics: { hit: 0.55 },
                successCriteria: { hit: '>= 0.5' },
                evalWindow: { fromMs: Date.now() - 1000, toMs: Date.now() + 1000 },
                actor: 'omega_w3_p247_test'
            })
            recordActuals({ id: reg.id, actualMetrics: { hit: 0.58 } })
            const row = getRegistration(reg.id)
            const parsed = JSON.parse(row.actual_metrics_json)
            expect(parsed.hit).toBe(0.58)
        })

        test('throws if registration in terminal state (PASS/FAIL/INVALID)', () => {
            const v = versionRegistry.proposeVersion({
                componentType: 'detector',
                componentId: `${TEST_PREFIX}ra2`,
                version: 'v1',
                config: {}, motivation: 't', actor: 't'
            })
            const reg = registerHypothesis({
                versionId: v.id,
                hypothesis: 'evaluate then attempt record',
                predictedMetrics: { hit: 0.55 },
                successCriteria: { hit: '>= 0.5' },
                evalWindow: { fromMs: Date.now() - 86400_000 - 1000, toMs: Date.now() - 1000 },
                actor: 'omega_w3_p247_test'
            })
            recordActuals({ id: reg.id, actualMetrics: { hit: 0.58 } })
            evaluate({ id: reg.id })
            // Now PASS; recordActuals should throw
            expect(() => recordActuals({ id: reg.id, actualMetrics: { hit: 0.9 } })).toThrow(/terminal|state/i)
        })
    })

    // ── evaluate ───────────────────────────────────────────────────
    describe('evaluate', () => {
        test('PASS when all criteria met', () => {
            const v = versionRegistry.proposeVersion({
                componentType: 'model',
                componentId: `${TEST_PREFIX}eval_pass`,
                version: 'v1',
                config: {}, motivation: 't', actor: 't'
            })
            const reg = registerHypothesis({
                versionId: v.id,
                hypothesis: 'should pass',
                predictedMetrics: { hit: 0.55, brier: 0.18 },
                successCriteria: { hit: '>= 0.5', brier: '<= 0.22' },
                evalWindow: { fromMs: Date.now() - 86400_000 - 1000, toMs: Date.now() - 1000 },
                actor: 'omega_w3_p247_test'
            })
            recordActuals({ id: reg.id, actualMetrics: { hit: 0.58, brier: 0.20 } })
            const result = evaluate({ id: reg.id })
            expect(result.state).toBe('PASS')
            const row = getRegistration(reg.id)
            expect(row.state).toBe('PASS')
        })

        test('FAIL when any criterion misses', () => {
            const v = versionRegistry.proposeVersion({
                componentType: 'model',
                componentId: `${TEST_PREFIX}eval_fail`,
                version: 'v1',
                config: {}, motivation: 't', actor: 't'
            })
            const reg = registerHypothesis({
                versionId: v.id,
                hypothesis: 'should fail brier',
                predictedMetrics: { hit: 0.55, brier: 0.18 },
                successCriteria: { hit: '>= 0.5', brier: '<= 0.22' },
                evalWindow: { fromMs: Date.now() - 86400_000 - 1000, toMs: Date.now() - 1000 },
                actor: 'omega_w3_p247_test'
            })
            recordActuals({ id: reg.id, actualMetrics: { hit: 0.58, brier: 0.30 } })
            const result = evaluate({ id: reg.id })
            expect(result.state).toBe('FAIL')
        })

        test('throws if eval_window_to not yet reached (no early peek)', () => {
            const v = versionRegistry.proposeVersion({
                componentType: 'model',
                componentId: `${TEST_PREFIX}eval_early`,
                version: 'v1',
                config: {}, motivation: 't', actor: 't'
            })
            const futureMs = Date.now() + 86400_000
            const reg = registerHypothesis({
                versionId: v.id,
                hypothesis: 'too early to evaluate',
                predictedMetrics: { hit: 0.55 },
                successCriteria: { hit: '>= 0.5' },
                evalWindow: { fromMs: Date.now() - 1000, toMs: futureMs },
                actor: 'omega_w3_p247_test'
            })
            recordActuals({ id: reg.id, actualMetrics: { hit: 0.58 } })
            expect(() => evaluate({ id: reg.id })).toThrow(/window|early|not.*reached/i)
        })

        test('throws if no actual_metrics recorded', () => {
            const v = versionRegistry.proposeVersion({
                componentType: 'model',
                componentId: `${TEST_PREFIX}eval_no_actuals`,
                version: 'v1',
                config: {}, motivation: 't', actor: 't'
            })
            const reg = registerHypothesis({
                versionId: v.id,
                hypothesis: 'no actuals',
                predictedMetrics: { hit: 0.55 },
                successCriteria: { hit: '>= 0.5' },
                evalWindow: { fromMs: Date.now() - 86400_000 - 1000, toMs: Date.now() - 1000 },
                actor: 'omega_w3_p247_test'
            })
            expect(() => evaluate({ id: reg.id })).toThrow(/actual|metric/i)
        })

        test('INVALID when criterion uses unsupported operator', () => {
            const v = versionRegistry.proposeVersion({
                componentType: 'model',
                componentId: `${TEST_PREFIX}eval_invalid`,
                version: 'v1',
                config: {}, motivation: 't', actor: 't'
            })
            const reg = registerHypothesis({
                versionId: v.id,
                hypothesis: 'bad criterion op',
                predictedMetrics: { hit: 0.55 },
                successCriteria: { hit: '??? 0.5' },  // unsupported operator
                evalWindow: { fromMs: Date.now() - 86400_000 - 1000, toMs: Date.now() - 1000 },
                actor: 'omega_w3_p247_test'
            })
            recordActuals({ id: reg.id, actualMetrics: { hit: 0.58 } })
            const result = evaluate({ id: reg.id })
            expect(result.state).toBe('INVALID')
        })
    })

    // ── getRegistrationsForVersion ─────────────────────────────────
    describe('getRegistrationsForVersion', () => {
        test('returns array of registrations for given version', () => {
            const v = versionRegistry.proposeVersion({
                componentType: 'model',
                componentId: `${TEST_PREFIX}list1`,
                version: 'v1',
                config: {}, motivation: 't', actor: 't'
            })
            registerHypothesis({
                versionId: v.id,
                hypothesis: 'list test',
                predictedMetrics: { a: 1 },
                successCriteria: { a: '>= 0' },
                evalWindow: { fromMs: Date.now(), toMs: Date.now() + 1000 },
                actor: 'omega_w3_p247_test'
            })
            const rows = getRegistrationsForVersion(v.id)
            expect(Array.isArray(rows)).toBe(true)
            expect(rows.length).toBe(1)
        })

        test('returns empty array if no registrations', () => {
            const v = versionRegistry.proposeVersion({
                componentType: 'model',
                componentId: `${TEST_PREFIX}list_empty`,
                version: 'v1',
                config: {}, motivation: 't', actor: 't'
            })
            expect(getRegistrationsForVersion(v.id)).toEqual([])
        })
    })
})

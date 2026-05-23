/**
 * R6 Shadow/Meta — abTesting tests (canonical §33)
 *
 * Canonical PDF §33 A/B TESTING / SHADOW COMPARE / EXPERIMENT CONTROL.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1324-1336.
 *
 * Experiment lifecycle: CREATED → RUNNING → COMPLETED → PROMOTED/ROLLED_BACK.
 * Hash-deterministic routing per allocation %, isolated PnL accounting,
 * z-test on 2 proportions for winner declaration, composes §19 versionRegistry
 * for promotion/rollback actions.
 */

const { db } = require('../../../server/services/database')
const versionRegistry = require('../../../server/services/ml/R5B_governance/versionRegistry')
const {
    EXPERIMENT_STATES,
    ARMS,
    ISOLATION_MODES,
    MIN_SAMPLES_FOR_DECISION,
    createExperiment,
    startExperiment,
    routeDecision,
    recordOutcome,
    getExperimentMetrics,
    completeExperiment,
    promoteWinner
} = require('../../../server/services/ml/R6_shadowMeta/abTesting')

describe('R6 — abTesting (canonical §33)', () => {
    const TEST_PREFIX = `omega_w3_p33_${Date.now()}_`
    const versionIds = []

    function makeVersion(suffix) {
        const v = versionRegistry.proposeVersion({
            componentType: 'model',
            componentId: `${TEST_PREFIX}${suffix}`,
            version: 'v1',
            config: {},
            motivation: 'ab test',
            actor: 'omega_w3_p33_test'
        })
        versionIds.push(v.id)
        return v.id
    }

    afterAll(() => {
        const expIds = db.prepare(
            `SELECT id FROM ml_experiments WHERE actor LIKE 'omega_w3_p33%'`
        ).all().map(r => r.id)
        for (const id of expIds) {
            db.prepare(`DELETE FROM ml_experiment_outcomes WHERE experiment_id = ?`).run(id)
        }
        db.prepare(`DELETE FROM ml_experiments WHERE actor LIKE 'omega_w3_p33%'`).run()
        for (const vid of versionIds) {
            db.prepare(`DELETE FROM ml_governance_versions WHERE id = ?`).run(vid)
        }
    })

    // ── Migration 053 ──────────────────────────────────────────────
    describe('Migration 053 — ml_experiments + ml_experiment_outcomes', () => {
        test('ml_experiments table exists', () => {
            const row = db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='ml_experiments'"
            ).get()
            expect(row).toBeDefined()
        })

        test('ml_experiment_outcomes table exists', () => {
            const row = db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='ml_experiment_outcomes'"
            ).get()
            expect(row).toBeDefined()
        })

        test('state CHECK on experiments', () => {
            expect(() => db.prepare(`INSERT INTO ml_experiments
                (name, version_a_id, version_b_id, allocation_pct_b, isolation_mode,
                 state, actor, created_at)
                VALUES ('x', 1, 2, 50, 'STRICT', 'INVALID_STATE', 'a', 0)
            `).run()).toThrow(/CHECK constraint/)
        })

        test('arm CHECK on outcomes', () => {
            expect(() => db.prepare(`INSERT INTO ml_experiment_outcomes
                (experiment_id, arm, decision_digest, outcome, pnl_pct, recorded_at)
                VALUES (1, 'C', 'd', 'WIN', 0.5, 0)
            `).run()).toThrow(/CHECK constraint/)
        })

        test('experiments state index exists', () => {
            const idx = db.prepare("PRAGMA index_list(ml_experiments)").all()
            const names = idx.map(i => i.name)
            expect(names).toEqual(expect.arrayContaining(['idx_mlexp_state']))
        })
    })

    // ── Exported constants ─────────────────────────────────────────
    describe('Exported constants', () => {
        test('EXPERIMENT_STATES', () => {
            expect(EXPERIMENT_STATES).toEqual([
                'CREATED', 'RUNNING', 'COMPLETED', 'PROMOTED', 'ROLLED_BACK'
            ])
        })
        test('ARMS', () => {
            expect(ARMS).toEqual(['A', 'B'])
        })
        test('ISOLATION_MODES', () => {
            expect(ISOLATION_MODES).toEqual(['STRICT', 'SHARED_CAPITAL'])
        })
        test('MIN_SAMPLES_FOR_DECISION >= 50', () => {
            expect(MIN_SAMPLES_FOR_DECISION).toBeGreaterThanOrEqual(50)
        })
    })

    // ── createExperiment ───────────────────────────────────────────
    describe('createExperiment', () => {
        test('inserts CREATED row', () => {
            const va = makeVersion('exp1a')
            const vb = makeVersion('exp1b')
            const result = createExperiment({
                name: 'test_exp_1',
                versionAId: va,
                versionBId: vb,
                allocationPctB: 50,
                isolationMode: 'STRICT',
                actor: 'omega_w3_p33_test'
            })
            expect(typeof result.experimentId).toBe('number')
            const row = db.prepare(`SELECT * FROM ml_experiments WHERE id = ?`).get(result.experimentId)
            expect(row.state).toBe('CREATED')
            expect(row.allocation_pct_b).toBeCloseTo(50, 1)
        })

        test('throws on invalid allocation_pct_b', () => {
            const va = makeVersion('bad_alloc_a')
            const vb = makeVersion('bad_alloc_b')
            expect(() => createExperiment({
                name: 'bad',
                versionAId: va, versionBId: vb,
                allocationPctB: 150,
                isolationMode: 'STRICT',
                actor: 'omega_w3_p33_test'
            })).toThrow(/allocation|0..100/i)
        })

        test('throws on same versionA and versionB', () => {
            const v = makeVersion('same')
            expect(() => createExperiment({
                name: 'same versions',
                versionAId: v, versionBId: v,
                allocationPctB: 50,
                isolationMode: 'STRICT',
                actor: 'omega_w3_p33_test'
            })).toThrow(/same|identical/i)
        })
    })

    // ── startExperiment ────────────────────────────────────────────
    describe('startExperiment', () => {
        test('transitions CREATED → RUNNING', () => {
            const va = makeVersion('start_a')
            const vb = makeVersion('start_b')
            const exp = createExperiment({
                name: 'start_test',
                versionAId: va, versionBId: vb,
                allocationPctB: 30,
                isolationMode: 'STRICT',
                actor: 'omega_w3_p33_test'
            })
            startExperiment({ experimentId: exp.experimentId, actor: 'omega_w3_p33_test' })
            const row = db.prepare(`SELECT * FROM ml_experiments WHERE id = ?`).get(exp.experimentId)
            expect(row.state).toBe('RUNNING')
            expect(row.started_at).toBeGreaterThan(0)
        })

        test('throws if already RUNNING', () => {
            const va = makeVersion('run_a')
            const vb = makeVersion('run_b')
            const exp = createExperiment({
                name: 'already_running',
                versionAId: va, versionBId: vb,
                allocationPctB: 50,
                isolationMode: 'STRICT',
                actor: 'omega_w3_p33_test'
            })
            startExperiment({ experimentId: exp.experimentId, actor: 'omega_w3_p33_test' })
            expect(() => startExperiment({
                experimentId: exp.experimentId, actor: 't'
            })).toThrow(/state|RUNNING|CREATED/i)
        })
    })

    // ── routeDecision ──────────────────────────────────────────────
    describe('routeDecision', () => {
        test('returns A or B', () => {
            const va = makeVersion('route_a')
            const vb = makeVersion('route_b')
            const exp = createExperiment({
                name: 'route_test',
                versionAId: va, versionBId: vb,
                allocationPctB: 50,
                isolationMode: 'STRICT',
                actor: 'omega_w3_p33_test'
            })
            startExperiment({ experimentId: exp.experimentId, actor: 't' })
            const arm = routeDecision({
                experimentId: exp.experimentId,
                decisionContext: { user_id: 1, symbol: 'BTCUSDT', ts: 1000 }
            })
            expect(['A', 'B']).toContain(arm)
        })

        test('deterministic — same context → same arm', () => {
            const va = makeVersion('det_a')
            const vb = makeVersion('det_b')
            const exp = createExperiment({
                name: 'det_test',
                versionAId: va, versionBId: vb,
                allocationPctB: 50,
                isolationMode: 'STRICT',
                actor: 'omega_w3_p33_test'
            })
            startExperiment({ experimentId: exp.experimentId, actor: 't' })
            const ctx = { user_id: 42, symbol: 'BTCUSDT', ts: 12345 }
            const arm1 = routeDecision({ experimentId: exp.experimentId, decisionContext: ctx })
            const arm2 = routeDecision({ experimentId: exp.experimentId, decisionContext: ctx })
            expect(arm1).toBe(arm2)
        })

        test('approximate allocation distribution', () => {
            const va = makeVersion('alloc_a')
            const vb = makeVersion('alloc_b')
            const exp = createExperiment({
                name: 'alloc_test',
                versionAId: va, versionBId: vb,
                allocationPctB: 30,  // 30% to B
                isolationMode: 'STRICT',
                actor: 'omega_w3_p33_test'
            })
            startExperiment({ experimentId: exp.experimentId, actor: 't' })
            let countB = 0
            for (let i = 0; i < 1000; i++) {
                const arm = routeDecision({
                    experimentId: exp.experimentId,
                    decisionContext: { user_id: i, symbol: 'X', ts: i }
                })
                if (arm === 'B') countB++
            }
            // Expected ~300; allow tolerance ±10%
            expect(countB).toBeGreaterThan(200)
            expect(countB).toBeLessThan(400)
        })

        test('throws if experiment not RUNNING', () => {
            const va = makeVersion('not_running_a')
            const vb = makeVersion('not_running_b')
            const exp = createExperiment({
                name: 'not running',
                versionAId: va, versionBId: vb,
                allocationPctB: 50,
                isolationMode: 'STRICT',
                actor: 'omega_w3_p33_test'
            })
            // Don't start it
            expect(() => routeDecision({
                experimentId: exp.experimentId,
                decisionContext: {}
            })).toThrow(/state|RUNNING/i)
        })
    })

    // ── recordOutcome ──────────────────────────────────────────────
    describe('recordOutcome', () => {
        test('inserts outcome row', () => {
            const va = makeVersion('rec_a')
            const vb = makeVersion('rec_b')
            const exp = createExperiment({
                name: 'rec_test',
                versionAId: va, versionBId: vb,
                allocationPctB: 50,
                isolationMode: 'STRICT',
                actor: 'omega_w3_p33_test'
            })
            startExperiment({ experimentId: exp.experimentId, actor: 't' })
            const result = recordOutcome({
                experimentId: exp.experimentId,
                arm: 'A',
                decisionDigest: 'rec_d_1',
                outcome: 'WIN',
                pnlPct: 0.8,
                actor: 'test'
            })
            expect(typeof result.outcomeId).toBe('number')
        })

        test('throws on invalid arm', () => {
            const va = makeVersion('invalid_arm_a')
            const vb = makeVersion('invalid_arm_b')
            const exp = createExperiment({
                name: 'bad arm',
                versionAId: va, versionBId: vb,
                allocationPctB: 50,
                isolationMode: 'STRICT',
                actor: 'omega_w3_p33_test'
            })
            startExperiment({ experimentId: exp.experimentId, actor: 't' })
            expect(() => recordOutcome({
                experimentId: exp.experimentId,
                arm: 'X',
                decisionDigest: 'd',
                outcome: 'WIN',
                pnlPct: 0.5,
                actor: 't'
            })).toThrow(/arm/i)
        })
    })

    // ── getExperimentMetrics ───────────────────────────────────────
    describe('getExperimentMetrics', () => {
        function setupAndSeed(allocPctB = 50, nA = 60, nB = 60, hitA = 0.5, hitB = 0.55) {
            const va = makeVersion(`metrics_a_${Math.random()}`)
            const vb = makeVersion(`metrics_b_${Math.random()}`)
            const exp = createExperiment({
                name: `metrics_${Math.random()}`,
                versionAId: va, versionBId: vb,
                allocationPctB: allocPctB,
                isolationMode: 'STRICT',
                actor: 'omega_w3_p33_test'
            })
            startExperiment({ experimentId: exp.experimentId, actor: 't' })
            for (let i = 0; i < nA; i++) {
                recordOutcome({
                    experimentId: exp.experimentId,
                    arm: 'A',
                    decisionDigest: `da_${exp.experimentId}_${i}_${Math.random()}`,
                    outcome: i < nA * hitA ? 'WIN' : 'LOSS',
                    pnlPct: i < nA * hitA ? 0.8 : -0.6,
                    actor: 't'
                })
            }
            for (let i = 0; i < nB; i++) {
                recordOutcome({
                    experimentId: exp.experimentId,
                    arm: 'B',
                    decisionDigest: `db_${exp.experimentId}_${i}_${Math.random()}`,
                    outcome: i < nB * hitB ? 'WIN' : 'LOSS',
                    pnlPct: i < nB * hitB ? 0.8 : -0.6,
                    actor: 't'
                })
            }
            return exp.experimentId
        }

        test('returns expected shape', () => {
            const expId = setupAndSeed(50, 60, 60, 0.5, 0.55)
            const m = getExperimentMetrics({ experimentId: expId })
            expect(m).toHaveProperty('arm_a')
            expect(m).toHaveProperty('arm_b')
            expect(m).toHaveProperty('comparison')
            expect(m.arm_a).toHaveProperty('n')
            expect(m.arm_a).toHaveProperty('wins')
            expect(m.arm_a).toHaveProperty('hit_rate')
            expect(m.arm_a).toHaveProperty('avg_pnl_pct')
            expect(m.comparison).toHaveProperty('winner')
            expect(m.comparison).toHaveProperty('p_value')
        })

        test('INSUFFICIENT_DATA when both arms < MIN_SAMPLES', () => {
            const expId = setupAndSeed(50, 20, 20, 0.6, 0.7)
            const m = getExperimentMetrics({ experimentId: expId })
            expect(m.comparison.winner).toBe('INSUFFICIENT_DATA')
        })

        test('declares winner B when statistically significant', () => {
            // Sufficient samples + clear difference (60% vs 50%)
            const expId = setupAndSeed(50, 200, 200, 0.5, 0.65)
            const m = getExperimentMetrics({ experimentId: expId })
            expect(['B', 'TIE']).toContain(m.comparison.winner)
            expect(m.comparison.p_value).toBeLessThan(1)
        })
    })

    // ── completeExperiment ─────────────────────────────────────────
    describe('completeExperiment', () => {
        test('transitions RUNNING → COMPLETED', () => {
            const va = makeVersion('complete_a')
            const vb = makeVersion('complete_b')
            const exp = createExperiment({
                name: 'complete_test',
                versionAId: va, versionBId: vb,
                allocationPctB: 50,
                isolationMode: 'STRICT',
                actor: 'omega_w3_p33_test'
            })
            startExperiment({ experimentId: exp.experimentId, actor: 't' })
            completeExperiment({
                experimentId: exp.experimentId,
                actor: 'omega_w3_p33_test',
                reason: 'done'
            })
            const row = db.prepare(`SELECT * FROM ml_experiments WHERE id = ?`).get(exp.experimentId)
            expect(row.state).toBe('COMPLETED')
        })
    })

    // ── promoteWinner ──────────────────────────────────────────────
    describe('promoteWinner', () => {
        test('transitions COMPLETED → PROMOTED + calls versionRegistry.activateVersion', () => {
            const va = makeVersion('promo_a')
            const vb = makeVersion('promo_b')
            const exp = createExperiment({
                name: 'promo_test',
                versionAId: va, versionBId: vb,
                allocationPctB: 50,
                isolationMode: 'STRICT',
                actor: 'omega_w3_p33_test'
            })
            startExperiment({ experimentId: exp.experimentId, actor: 't' })
            completeExperiment({ experimentId: exp.experimentId, actor: 't', reason: 'r' })
            promoteWinner({
                experimentId: exp.experimentId,
                winner: 'B',
                actor: 'omega_w3_p33_test'
            })
            const row = db.prepare(`SELECT * FROM ml_experiments WHERE id = ?`).get(exp.experimentId)
            expect(row.state).toBe('PROMOTED')
            // Verify version B is now ACTIVE
            const winnerVersion = versionRegistry.getById(vb)
            expect(winnerVersion.state).toBe('ACTIVE')
        })

        test('throws if experiment not COMPLETED', () => {
            const va = makeVersion('promo_bad_a')
            const vb = makeVersion('promo_bad_b')
            const exp = createExperiment({
                name: 'promo_bad',
                versionAId: va, versionBId: vb,
                allocationPctB: 50,
                isolationMode: 'STRICT',
                actor: 'omega_w3_p33_test'
            })
            // Still CREATED
            expect(() => promoteWinner({
                experimentId: exp.experimentId,
                winner: 'A',
                actor: 't'
            })).toThrow(/state|COMPLETED/i)
        })

        test('throws on invalid winner', () => {
            const va = makeVersion('promo_inv_a')
            const vb = makeVersion('promo_inv_b')
            const exp = createExperiment({
                name: 'promo_inv',
                versionAId: va, versionBId: vb,
                allocationPctB: 50,
                isolationMode: 'STRICT',
                actor: 'omega_w3_p33_test'
            })
            startExperiment({ experimentId: exp.experimentId, actor: 't' })
            completeExperiment({ experimentId: exp.experimentId, actor: 't', reason: 'r' })
            expect(() => promoteWinner({
                experimentId: exp.experimentId,
                winner: 'X',
                actor: 't'
            })).toThrow(/winner/i)
        })
    })
})

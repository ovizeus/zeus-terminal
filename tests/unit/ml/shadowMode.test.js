/**
 * R5B Governance — shadowMode tests (canonical §18)
 *
 * Canonical PDF §18 SHADOW MODE SI LANSARE CONTROLATA. Source:
 * /root/_review/ml_brain/ml_brain_canonic.txt lines 990-1015.
 *
 * 6-stage deployment ladder: offline_backtest → walk_forward → paper
 * → shadow_live → limited_probation → normal_live.
 *
 * Performance degradation triggers: auto-degrade (1 stage down), pause,
 * rollback (via §19 versionRegistry).
 *
 * Minimum 4-week soak per shadow_live + limited_probation stages.
 */

const { db } = require('../../../server/services/database')
const versionRegistry = require('../../../server/services/ml/R5B_governance/versionRegistry')
const {
    STAGES,
    TRANSITION_TYPES,
    DEFAULT_DEGRADE_THRESHOLDS,
    MIN_DURATION_DAYS_PER_STAGE,
    enterStage,
    exitStage,
    advanceStage,
    degrade,
    pauseDeployment,
    evaluatePerformance,
    getCurrentStage,
    getStageHistory,
    hasMinDuration
} = require('../../../server/services/ml/R5B_governance/shadowMode')

describe('R5B — shadowMode (canonical §18)', () => {
    const TEST_PREFIX = `omega_w3_p18_${Date.now()}_`
    const fakeVersionIds = []

    // Helper: create a version via versionRegistry to attach stages
    function makeVersion(suffix) {
        const result = versionRegistry.proposeVersion({
            componentType: 'model',
            componentId: `${TEST_PREFIX}${suffix}`,
            version: 'v1',
            config: {},
            motivation: 'shadowMode test',
            actor: 'omega_w3_p18_test'
        })
        fakeVersionIds.push(result.id)
        return result.id
    }

    afterAll(() => {
        db.prepare(`DELETE FROM ml_shadow_stage_log WHERE actor LIKE 'omega_w3_p18%'`).run()
        for (const id of fakeVersionIds) {
            db.prepare(`DELETE FROM ml_governance_versions WHERE id = ?`).run(id)
        }
    })

    // ── Migration 052 ──────────────────────────────────────────────
    describe('Migration 052 — ml_shadow_stage_log', () => {
        test('table exists', () => {
            const row = db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='ml_shadow_stage_log'"
            ).get()
            expect(row).toBeDefined()
        })

        test('has expected columns', () => {
            const cols = db.prepare("PRAGMA table_info(ml_shadow_stage_log)").all()
            const names = cols.map(c => c.name)
            expect(names).toEqual(expect.arrayContaining([
                'id', 'version_id', 'stage', 'transition_type',
                'metrics_json', 'threshold_breach_json',
                'reason', 'actor', 'started_at', 'ended_at'
            ]))
        })

        test('stage CHECK constraint', () => {
            expect(() => db.prepare(`INSERT INTO ml_shadow_stage_log
                (version_id, stage, transition_type, reason, actor, started_at)
                VALUES (1, 'invalid_stage', 'ENTER', 'r', 'a', 0)
            `).run()).toThrow(/CHECK constraint/)
        })

        test('transition_type CHECK constraint', () => {
            expect(() => db.prepare(`INSERT INTO ml_shadow_stage_log
                (version_id, stage, transition_type, reason, actor, started_at)
                VALUES (1, 'paper', 'JUMP', 'r', 'a', 0)
            `).run()).toThrow(/CHECK constraint/)
        })

        test('version_id+started_at index exists', () => {
            const idx = db.prepare("PRAGMA index_list(ml_shadow_stage_log)").all()
            const names = idx.map(i => i.name)
            expect(names).toEqual(expect.arrayContaining(['idx_mlssl_version_ts']))
        })
    })

    // ── Exported constants ─────────────────────────────────────────
    describe('Exported constants', () => {
        test('STAGES = 6 spec stages in order', () => {
            expect(STAGES).toEqual([
                'offline_backtest', 'walk_forward', 'paper',
                'shadow_live', 'limited_probation', 'normal_live'
            ])
        })

        test('TRANSITION_TYPES = 5 types', () => {
            expect(TRANSITION_TYPES).toEqual([
                'ENTER', 'EXIT', 'DEGRADE', 'PAUSE', 'ROLLBACK'
            ])
        })

        test('DEFAULT_DEGRADE_THRESHOLDS shape', () => {
            expect(DEFAULT_DEGRADE_THRESHOLDS).toHaveProperty('hit_rate_min')
            expect(DEFAULT_DEGRADE_THRESHOLDS).toHaveProperty('calibration_quality_min')
            expect(DEFAULT_DEGRADE_THRESHOLDS).toHaveProperty('drift_max')
        })

        test('MIN_DURATION_DAYS_PER_STAGE has 4-week minimums for shadow_live + limited_probation', () => {
            expect(MIN_DURATION_DAYS_PER_STAGE.shadow_live).toBeGreaterThanOrEqual(28)
            expect(MIN_DURATION_DAYS_PER_STAGE.limited_probation).toBeGreaterThanOrEqual(28)
        })
    })

    // ── enterStage ─────────────────────────────────────────────────
    describe('enterStage', () => {
        test('inserts ENTER row with stage + timestamps', () => {
            const versionId = makeVersion('enter1')
            const result = enterStage({
                versionId,
                stage: 'paper',
                actor: 'omega_w3_p18_test',
                reason: 'paper trading start'
            })
            expect(typeof result.logId).toBe('number')
            const row = db.prepare(`SELECT * FROM ml_shadow_stage_log WHERE id = ?`).get(result.logId)
            expect(row.stage).toBe('paper')
            expect(row.transition_type).toBe('ENTER')
            expect(row.ended_at).toBeNull()
        })

        test('throws on invalid stage', () => {
            const versionId = makeVersion('enter_bad')
            expect(() => enterStage({
                versionId, stage: 'INVALID_STAGE', actor: 't', reason: 'r'
            })).toThrow(/stage|invalid/i)
        })

        test('throws if already in this stage (no duplicate ENTER without EXIT)', () => {
            const versionId = makeVersion('enter_dup')
            enterStage({ versionId, stage: 'paper', actor: 't', reason: 'first' })
            expect(() => enterStage({
                versionId, stage: 'paper', actor: 't', reason: 'duplicate'
            })).toThrow(/already|active/i)
        })
    })

    // ── exitStage ──────────────────────────────────────────────────
    describe('exitStage', () => {
        test('sets ended_at on the most recent ENTER row for this stage', () => {
            const versionId = makeVersion('exit1')
            enterStage({ versionId, stage: 'paper', actor: 't', reason: 'enter' })
            exitStage({ versionId, stage: 'paper', actor: 't', reason: 'done' })
            const row = db.prepare(
                `SELECT * FROM ml_shadow_stage_log WHERE version_id = ? AND stage = 'paper' ORDER BY id DESC LIMIT 1`
            ).get(versionId)
            // exit inserts a new EXIT row; the ENTER row should now have ended_at set
            const enter = db.prepare(
                `SELECT * FROM ml_shadow_stage_log WHERE version_id = ? AND stage = 'paper' AND transition_type = 'ENTER'`
            ).get(versionId)
            expect(enter.ended_at).toBeGreaterThan(0)
        })

        test('throws if no active stage to exit', () => {
            const versionId = makeVersion('exit_none')
            expect(() => exitStage({
                versionId, stage: 'paper', actor: 't', reason: 'r'
            })).toThrow(/no active|not entered/i)
        })
    })

    // ── advanceStage ───────────────────────────────────────────────
    describe('advanceStage', () => {
        test('moves to next stage in STAGES order (no min duration on paper)', () => {
            const versionId = makeVersion('adv1')
            enterStage({ versionId, stage: 'paper', actor: 't', reason: 'r' })
            const result = advanceStage({ versionId, actor: 't', reason: 'advance' })
            expect(result.promoted).toBe(true)
            expect(result.new_stage).toBe('shadow_live')
        })

        test('blocks advance when min soak duration not met on shadow_live', () => {
            const versionId = makeVersion('adv_min_block')
            enterStage({ versionId, stage: 'shadow_live', actor: 't', reason: 'r' })
            const result = advanceStage({ versionId, actor: 't', reason: 'try advance' })
            expect(result.promoted).toBe(false)
            expect(result.blocked_by).toBe('min_duration')
            expect(result.current_stage).toBe('shadow_live')
            expect(result.target_stage).toBe('limited_probation')
        })

        test('allows advance when min soak duration met on shadow_live', () => {
            const versionId = makeVersion('adv_min_pass')
            enterStage({ versionId, stage: 'shadow_live', actor: 't', reason: 'r' })
            const entryRow = db.prepare(
                `SELECT id FROM ml_shadow_stage_log WHERE version_id = ? AND stage = 'shadow_live' AND transition_type = 'ENTER' ORDER BY id DESC LIMIT 1`
            ).get(versionId)
            db.prepare(`UPDATE ml_shadow_stage_log SET started_at = ? WHERE id = ?`)
                .run(Date.now() - 29 * 86400 * 1000, entryRow.id)
            const result = advanceStage({ versionId, actor: 't', reason: 'soak complete' })
            expect(result.promoted).toBe(true)
            expect(result.new_stage).toBe('limited_probation')
        })

        test('throws if at last stage (normal_live)', () => {
            const versionId = makeVersion('adv_last')
            enterStage({ versionId, stage: 'normal_live', actor: 't', reason: 'r' })
            expect(() => advanceStage({
                versionId, actor: 't', reason: 'cant advance'
            })).toThrow(/last stage|max/i)
        })

        test('throws if no current stage', () => {
            const versionId = makeVersion('adv_no_stage')
            expect(() => advanceStage({
                versionId, actor: 't', reason: 'r'
            })).toThrow(/no current/i)
        })
    })

    // ── degrade ────────────────────────────────────────────────────
    describe('degrade', () => {
        test('moves down 1 stage + logs DEGRADE transition', () => {
            const versionId = makeVersion('degrade1')
            enterStage({ versionId, stage: 'shadow_live', actor: 't', reason: 'r' })
            const result = degrade({
                versionId,
                reason: 'hit_rate dropped below threshold',
                actor: 'auto_evaluator',
                metrics: { hit_rate: 0.4 }
            })
            expect(result.new_stage).toBe('paper')
            const row = db.prepare(
                `SELECT * FROM ml_shadow_stage_log WHERE id = ?`
            ).get(result.logId)
            expect(row.transition_type).toBe('DEGRADE')
        })

        test('throws if already at first stage', () => {
            const versionId = makeVersion('degrade_floor')
            enterStage({ versionId, stage: 'offline_backtest', actor: 't', reason: 'r' })
            expect(() => degrade({
                versionId, reason: 'r', actor: 't', metrics: {}
            })).toThrow(/first stage|cannot|floor/i)
        })
    })

    // ── pauseDeployment ────────────────────────────────────────────
    describe('pauseDeployment', () => {
        test('inserts PAUSE row + exits current stage', () => {
            const versionId = makeVersion('pause1')
            enterStage({ versionId, stage: 'shadow_live', actor: 't', reason: 'r' })
            pauseDeployment({
                versionId, reason: 'manual pause for investigation', actor: 'operator'
            })
            const pauseRow = db.prepare(
                `SELECT * FROM ml_shadow_stage_log WHERE version_id = ? AND transition_type = 'PAUSE'`
            ).get(versionId)
            expect(pauseRow).toBeDefined()
        })

        test('throws if no active stage', () => {
            const versionId = makeVersion('pause_none')
            expect(() => pauseDeployment({
                versionId, reason: 'r', actor: 't'
            })).toThrow(/no active/i)
        })
    })

    // ── evaluatePerformance ────────────────────────────────────────
    describe('evaluatePerformance', () => {
        test('returns passing=true when all metrics within thresholds', () => {
            const versionId = makeVersion('eval_pass')
            const result = evaluatePerformance({
                versionId,
                metrics: { hit_rate: 0.55, calibration_quality: 0.7, drift_score: 0.15 }
            })
            expect(result.passing).toBe(true)
            expect(result.breaches).toEqual([])
        })

        test('returns passing=false with breaches when degraded', () => {
            const versionId = makeVersion('eval_fail')
            const result = evaluatePerformance({
                versionId,
                metrics: { hit_rate: 0.3, calibration_quality: 0.4, drift_score: 0.4 }
            })
            expect(result.passing).toBe(false)
            expect(result.breaches.length).toBeGreaterThan(0)
        })

        test('respects custom thresholds', () => {
            const versionId = makeVersion('eval_custom')
            const result = evaluatePerformance({
                versionId,
                metrics: { hit_rate: 0.55, calibration_quality: 0.7, drift_score: 0.15 },
                thresholds: { hit_rate_min: 0.6 }  // strict
            })
            expect(result.passing).toBe(false)
            expect(result.breaches).toEqual(expect.arrayContaining([
                expect.objectContaining({ metric: 'hit_rate' })
            ]))
        })
    })

    // ── getCurrentStage ────────────────────────────────────────────
    describe('getCurrentStage', () => {
        test('returns current active stage row', () => {
            const versionId = makeVersion('current1')
            enterStage({ versionId, stage: 'paper', actor: 't', reason: 'r' })
            const current = getCurrentStage({ versionId })
            expect(current).not.toBeNull()
            expect(current.stage).toBe('paper')
        })

        test('returns null when no stages entered yet', () => {
            const versionId = makeVersion('current_none')
            expect(getCurrentStage({ versionId })).toBeNull()
        })
    })

    // ── getStageHistory ────────────────────────────────────────────
    describe('getStageHistory', () => {
        test('returns chronological list', () => {
            const versionId = makeVersion('hist1')
            enterStage({ versionId, stage: 'paper', actor: 't', reason: 'r1' })
            exitStage({ versionId, stage: 'paper', actor: 't', reason: 'r2' })
            enterStage({ versionId, stage: 'shadow_live', actor: 't', reason: 'r3' })
            const history = getStageHistory({ versionId })
            expect(history.length).toBeGreaterThanOrEqual(3)
        })
    })

    // ── hasMinDuration ─────────────────────────────────────────────
    describe('hasMinDuration', () => {
        test('returns false when stage not yet 4 weeks old', () => {
            const versionId = makeVersion('mindur_short')
            enterStage({ versionId, stage: 'shadow_live', actor: 't', reason: 'r' })
            expect(hasMinDuration({ versionId, stage: 'shadow_live' })).toBe(false)
        })

        test('returns true when stage 28+ days old', () => {
            const versionId = makeVersion('mindur_long')
            const result = enterStage({ versionId, stage: 'shadow_live', actor: 't', reason: 'r' })
            // Backdate 30 days
            db.prepare(`UPDATE ml_shadow_stage_log SET started_at = ? WHERE id = ?`)
                .run(Date.now() - 30 * 86400 * 1000, result.logId)
            expect(hasMinDuration({ versionId, stage: 'shadow_live' })).toBe(true)
        })

        test('returns true for stages without min duration requirement', () => {
            const versionId = makeVersion('mindur_none')
            enterStage({ versionId, stage: 'paper', actor: 't', reason: 'r' })
            expect(hasMinDuration({ versionId, stage: 'paper' })).toBe(true)
        })
    })
})

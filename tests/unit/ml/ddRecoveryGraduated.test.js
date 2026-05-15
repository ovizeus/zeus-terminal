/**
 * R3A Safety — ddRecoveryGraduated tests (§246* Claude-extras)
 *
 * §246* GRADUATED DD RECOVERY — partial size on partial recovery.
 * Source: project_ml_brain_pro_244.md "246* GRADUATED DD RECOVERY".
 * Claude-extras approved 2026-04-29, NOT in canonical PDF.
 *
 * 4-stage ladder post-§255* auto-resume:
 *   Stage 1 (0-24h):     25% target size, no min wins
 *   Stage 2 (24-72h):    50% size, requires 2 wins at stage 1
 *   Stage 3 (72-168h):   75% size, requires 3 wins at stage 2
 *   Stage 4 (168h+):     100% size, requires 5 wins at stage 3
 *
 * Step-DOWN on DD spike → retrograde to stage 1.
 */

const { db } = require('../../../server/services/database')
const autoResumeDD = require('../../../server/services/ml/R5B_governance/autoResumeDD')
const {
    RECOVERY_LADDER,
    startRecovery,
    getRecoveryStage,
    getRecoverySize,
    recordPostResumeOutcome,
    maybeAdvanceStage,
    stepDownOnDD,
    isInRecovery
} = require('../../../server/services/ml/R3A_safety/ddRecoveryGraduated')

describe('R3A — ddRecoveryGraduated (§246* Claude-extras)', () => {
    const TEST_USER_ID_BASE = 99700

    afterAll(() => {
        db.prepare(`DELETE FROM ml_dd_pauses WHERE user_id BETWEEN ? AND ?`)
            .run(TEST_USER_ID_BASE, TEST_USER_ID_BASE + 100)
    })

    // ── Migration 049 ──────────────────────────────────────────────
    describe('Migration 049 — ml_dd_pauses ADD COLUMNs', () => {
        test('recovery_stage column exists', () => {
            const cols = db.prepare("PRAGMA table_info(ml_dd_pauses)").all()
            expect(cols.find(c => c.name === 'recovery_stage')).toBeDefined()
        })
        test('recovery_wins_at_stage column exists', () => {
            const cols = db.prepare("PRAGMA table_info(ml_dd_pauses)").all()
            expect(cols.find(c => c.name === 'recovery_wins_at_stage')).toBeDefined()
        })
        test('recovery_started_at column exists', () => {
            const cols = db.prepare("PRAGMA table_info(ml_dd_pauses)").all()
            expect(cols.find(c => c.name === 'recovery_started_at')).toBeDefined()
        })
    })

    // ── Exported RECOVERY_LADDER ───────────────────────────────────
    describe('RECOVERY_LADDER', () => {
        test('has 4 stages with expected size percentages', () => {
            expect(RECOVERY_LADDER.length).toBe(4)
            expect(RECOVERY_LADDER[0].size_pct).toBe(25)
            expect(RECOVERY_LADDER[1].size_pct).toBe(50)
            expect(RECOVERY_LADDER[2].size_pct).toBe(75)
            expect(RECOVERY_LADDER[3].size_pct).toBe(100)
        })

        test('each stage has required fields', () => {
            for (const s of RECOVERY_LADDER) {
                expect(s).toHaveProperty('stage')
                expect(s).toHaveProperty('max_hours')
                expect(s).toHaveProperty('size_pct')
                expect(s).toHaveProperty('min_wins_at_stage')
            }
        })
    })

    // Helper to create + resume a pause (sets state=RESUMED, ready for recovery)
    function setupResumedPause(uid, ddPct = 12) {
        db.prepare(`DELETE FROM ml_dd_pauses WHERE user_id = ?`).run(uid)
        const p = autoResumeDD.pauseFromDD({
            userId: uid,
            resolvedEnv: 'DEMO',
            ddPct,
            reason: 'p246 test',
            actor: 'test'
        })
        autoResumeDD.resumeFromPause({
            pauseId: p.pauseId,
            mode: 'AUTO',
            actor: 'test',
            reason: 'test resume'
        })
        return p.pauseId
    }

    // ── startRecovery ──────────────────────────────────────────────
    describe('startRecovery', () => {
        test('sets recovery_stage=1, recovery_started_at=now', () => {
            const uid = TEST_USER_ID_BASE + 1
            const pauseId = setupResumedPause(uid)
            const beforeMs = Date.now()
            startRecovery({ pauseId, actor: 'test' })
            const row = db.prepare(`SELECT * FROM ml_dd_pauses WHERE id = ?`).get(pauseId)
            expect(row.recovery_stage).toBe(1)
            expect(row.recovery_wins_at_stage).toBe(0)
            expect(row.recovery_started_at).toBeGreaterThanOrEqual(beforeMs)
        })

        test('throws if pause not in RESUMED state', () => {
            const uid = TEST_USER_ID_BASE + 2
            db.prepare(`DELETE FROM ml_dd_pauses WHERE user_id = ?`).run(uid)
            const p = autoResumeDD.pauseFromDD({
                userId: uid, resolvedEnv: 'DEMO', ddPct: 11, reason: 't', actor: 't'
            })
            // Still ACTIVE, not RESUMED
            expect(() => startRecovery({ pauseId: p.pauseId, actor: 'test' }))
                .toThrow(/state|RESUMED/i)
        })

        test('throws if recovery already started', () => {
            const uid = TEST_USER_ID_BASE + 3
            const pauseId = setupResumedPause(uid)
            startRecovery({ pauseId, actor: 'test' })
            expect(() => startRecovery({ pauseId, actor: 'test' }))
                .toThrow(/already|started/i)
        })
    })

    // ── getRecoveryStage ───────────────────────────────────────────
    describe('getRecoveryStage', () => {
        test('returns stage 1 info immediately after startRecovery', () => {
            const uid = TEST_USER_ID_BASE + 4
            const pauseId = setupResumedPause(uid)
            startRecovery({ pauseId, actor: 'test' })
            const info = getRecoveryStage({ pauseId })
            expect(info.stage).toBe(1)
            expect(info.size_pct).toBe(25)
            expect(info.wins_at_stage).toBe(0)
            expect(typeof info.hours_in_stage).toBe('number')
            expect(typeof info.ready_to_advance).toBe('boolean')
        })

        test('returns stage=0 if recovery not started', () => {
            const uid = TEST_USER_ID_BASE + 5
            const pauseId = setupResumedPause(uid)
            const info = getRecoveryStage({ pauseId })
            expect(info.stage).toBe(0)
            expect(info.size_pct).toBe(100)  // No recovery active → full size
        })
    })

    // ── getRecoverySize ────────────────────────────────────────────
    describe('getRecoverySize', () => {
        test('returns 25% of target at stage 1', () => {
            const uid = TEST_USER_ID_BASE + 6
            const pauseId = setupResumedPause(uid)
            startRecovery({ pauseId, actor: 'test' })
            const adjusted = getRecoverySize({ pauseId, targetSize: 100 })
            expect(adjusted).toBe(25)
        })

        test('returns full target when no recovery', () => {
            const uid = TEST_USER_ID_BASE + 7
            const pauseId = setupResumedPause(uid)
            const adjusted = getRecoverySize({ pauseId, targetSize: 100 })
            expect(adjusted).toBe(100)
        })
    })

    // ── recordPostResumeOutcome ────────────────────────────────────
    describe('recordPostResumeOutcome', () => {
        test('increments wins_at_stage on won=true', () => {
            const uid = TEST_USER_ID_BASE + 8
            const pauseId = setupResumedPause(uid)
            startRecovery({ pauseId, actor: 'test' })
            recordPostResumeOutcome({ pauseId, won: true })
            recordPostResumeOutcome({ pauseId, won: true })
            const info = getRecoveryStage({ pauseId })
            expect(info.wins_at_stage).toBe(2)
        })

        test('does not increment on won=false', () => {
            const uid = TEST_USER_ID_BASE + 9
            const pauseId = setupResumedPause(uid)
            startRecovery({ pauseId, actor: 'test' })
            recordPostResumeOutcome({ pauseId, won: false })
            const info = getRecoveryStage({ pauseId })
            expect(info.wins_at_stage).toBe(0)
        })

        test('throws if recovery not active', () => {
            const uid = TEST_USER_ID_BASE + 10
            const pauseId = setupResumedPause(uid)
            expect(() => recordPostResumeOutcome({ pauseId, won: true }))
                .toThrow(/recovery|not.*active/i)
        })
    })

    // ── maybeAdvanceStage ──────────────────────────────────────────
    describe('maybeAdvanceStage', () => {
        test('advances stage when hours + wins criteria met', () => {
            const uid = TEST_USER_ID_BASE + 11
            const pauseId = setupResumedPause(uid)
            startRecovery({ pauseId, actor: 'test' })
            // Force-set hours_in_stage by backdating recovery_started_at
            db.prepare(`UPDATE ml_dd_pauses SET recovery_started_at = ?, recovery_wins_at_stage = ? WHERE id = ?`)
                .run(Date.now() - 25 * 3600 * 1000, 2, pauseId)  // 25h ago + 2 wins
            const result = maybeAdvanceStage({ pauseId })
            expect(result.advanced).toBe(true)
            expect(result.new_stage).toBe(2)
            const info = getRecoveryStage({ pauseId })
            expect(info.stage).toBe(2)
            expect(info.wins_at_stage).toBe(0)  // reset on advance
        })

        test('does NOT advance when wins insufficient', () => {
            const uid = TEST_USER_ID_BASE + 12
            const pauseId = setupResumedPause(uid)
            startRecovery({ pauseId, actor: 'test' })
            db.prepare(`UPDATE ml_dd_pauses SET recovery_started_at = ?, recovery_wins_at_stage = ? WHERE id = ?`)
                .run(Date.now() - 30 * 3600 * 1000, 0, pauseId)  // 30h ago, 0 wins
            const result = maybeAdvanceStage({ pauseId })
            expect(result.advanced).toBe(false)
            expect(result.reason).toMatch(/wins/i)
        })

        test('does NOT advance when hours insufficient', () => {
            const uid = TEST_USER_ID_BASE + 13
            const pauseId = setupResumedPause(uid)
            startRecovery({ pauseId, actor: 'test' })
            db.prepare(`UPDATE ml_dd_pauses SET recovery_wins_at_stage = ? WHERE id = ?`)
                .run(10, pauseId)  // 10 wins but only 0h elapsed
            const result = maybeAdvanceStage({ pauseId })
            expect(result.advanced).toBe(false)
            expect(result.reason).toMatch(/hours/i)
        })

        test('caps at stage 4 (cannot advance beyond)', () => {
            const uid = TEST_USER_ID_BASE + 14
            const pauseId = setupResumedPause(uid)
            startRecovery({ pauseId, actor: 'test' })
            db.prepare(`UPDATE ml_dd_pauses SET recovery_stage = 4 WHERE id = ?`).run(pauseId)
            const result = maybeAdvanceStage({ pauseId })
            expect(result.advanced).toBe(false)
            expect(result.reason).toMatch(/max|already.*4/i)
        })
    })

    // ── stepDownOnDD ───────────────────────────────────────────────
    describe('stepDownOnDD', () => {
        test('retrogrades to stage 1 when DD spike exceeds threshold', () => {
            const uid = TEST_USER_ID_BASE + 15
            const pauseId = setupResumedPause(uid)
            startRecovery({ pauseId, actor: 'test' })
            db.prepare(`UPDATE ml_dd_pauses SET recovery_stage = 3 WHERE id = ?`).run(pauseId)
            const result = stepDownOnDD({ pauseId, currentDdPct: 10 })  // spike
            expect(result.stepped_down).toBe(true)
            expect(result.new_stage).toBe(1)
            const info = getRecoveryStage({ pauseId })
            expect(info.stage).toBe(1)
        })

        test('does NOT step down when DD within threshold', () => {
            const uid = TEST_USER_ID_BASE + 16
            const pauseId = setupResumedPause(uid)
            startRecovery({ pauseId, actor: 'test' })
            db.prepare(`UPDATE ml_dd_pauses SET recovery_stage = 3 WHERE id = ?`).run(pauseId)
            const result = stepDownOnDD({ pauseId, currentDdPct: 2 })
            expect(result.stepped_down).toBe(false)
        })

        test('resets wins_at_stage on step down', () => {
            const uid = TEST_USER_ID_BASE + 17
            const pauseId = setupResumedPause(uid)
            startRecovery({ pauseId, actor: 'test' })
            db.prepare(`UPDATE ml_dd_pauses SET recovery_stage = 3, recovery_wins_at_stage = 7 WHERE id = ?`).run(pauseId)
            stepDownOnDD({ pauseId, currentDdPct: 8 })
            const info = getRecoveryStage({ pauseId })
            expect(info.wins_at_stage).toBe(0)
        })
    })

    // ── isInRecovery ───────────────────────────────────────────────
    describe('isInRecovery', () => {
        test('returns true when stage > 0', () => {
            const uid = TEST_USER_ID_BASE + 18
            const pauseId = setupResumedPause(uid)
            startRecovery({ pauseId, actor: 'test' })
            expect(isInRecovery({ pauseId })).toBe(true)
        })

        test('returns false when stage = 0 (not started)', () => {
            const uid = TEST_USER_ID_BASE + 19
            const pauseId = setupResumedPause(uid)
            expect(isInRecovery({ pauseId })).toBe(false)
        })

        test('returns false when stage = 4 (recovery complete)', () => {
            const uid = TEST_USER_ID_BASE + 20
            const pauseId = setupResumedPause(uid)
            startRecovery({ pauseId, actor: 'test' })
            db.prepare(`UPDATE ml_dd_pauses SET recovery_stage = 4 WHERE id = ?`).run(pauseId)
            expect(isInRecovery({ pauseId })).toBe(false)  // stage 4 = full size, recovery complete
        })
    })
})

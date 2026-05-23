/**
 * R5B Governance — autoResumeDD tests (§255* Claude-extras)
 *
 * §255* AUTO-RESUME FROM MEDIUM DD = closes R5B auto-actions quartet.
 * Source: project_ml_brain_pro_244.md "255* (R3A + R5) — auto-resume
 * 10-15% DD pauses după 24h cooldown + 3 shadow wins + DD<8% +
 * regime stable. DD≥15% rămâne manual."
 *
 * Claude-extras approved 2026-04-29, NOT in canonical PDF.
 *
 * 4 cumulative conditions for auto-resume (ALL must hold):
 *   1. ≥24h elapsed since pause (resume_eligible_after <= now)
 *   2. ≥3 shadow wins recorded
 *   3. current_dd_pct < 8%
 *   4. regime drift level = STABLE
 *
 * Hard invariant: pause with dd_at_pause >= 15% → manual-only; cannot
 * auto-resume regardless of conditions.
 */

const { db } = require('../../../server/services/database')
const {
    THRESHOLDS,
    PAUSE_STATES,
    RESUME_MODES,
    pauseFromDD,
    recordShadowWin,
    evaluateResumeEligibility,
    resumeFromPause,
    scanAllPauses,
    getActivePause
} = require('../../../server/services/ml/R5B_governance/autoResumeDD')

describe('R5B — autoResumeDD (§255* Claude-extras)', () => {
    const TEST_USER_ID = 99760
    const TEST_PREFIX = `omega_w3_p255_${Date.now()}_`

    afterAll(() => {
        db.prepare(`DELETE FROM ml_dd_pauses WHERE user_id = ?`).run(TEST_USER_ID)
    })

    // ── Migration 047 ──────────────────────────────────────────────
    describe('Migration 047 — ml_dd_pauses', () => {
        test('table exists', () => {
            const row = db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='ml_dd_pauses'"
            ).get()
            expect(row).toBeDefined()
        })

        test('has expected columns', () => {
            const cols = db.prepare("PRAGMA table_info(ml_dd_pauses)").all()
            const names = cols.map(c => c.name)
            expect(names).toEqual(expect.arrayContaining([
                'id', 'user_id', 'resolved_env',
                'pause_reason', 'dd_at_pause', 'state',
                'resume_eligible_after', 'shadow_wins_count', 'auto_resumed',
                'paused_at', 'resumed_at', 'resumed_by', 'resume_reason'
            ]))
        })

        test('state CHECK enforces lifecycle enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_dd_pauses
                (user_id, resolved_env, pause_reason, dd_at_pause, state,
                 resume_eligible_after, paused_at, paused_by)
                VALUES (1, 'DEMO', 'test', 12, 'BANANA', 0, 0, 'test')
            `).run()).toThrow(/CHECK constraint/)
        })

        test('user+env+state index exists', () => {
            const idx = db.prepare("PRAGMA index_list(ml_dd_pauses)").all()
            const names = idx.map(i => i.name)
            expect(names).toEqual(expect.arrayContaining(['idx_mldp_user_env_state']))
        })
    })

    // ── Exported constants ─────────────────────────────────────────
    describe('Exported constants', () => {
        test('THRESHOLDS values match spec', () => {
            expect(THRESHOLDS.medium_dd_min).toBe(10)
            expect(THRESHOLDS.medium_dd_max).toBe(15)
            expect(THRESHOLDS.cooldown_hours).toBe(24)
            expect(THRESHOLDS.min_shadow_wins).toBe(3)
            expect(THRESHOLDS.max_current_dd).toBe(8)
        })

        test('PAUSE_STATES export', () => {
            expect(PAUSE_STATES).toEqual(['ACTIVE', 'RESUMED', 'EXPIRED'])
        })

        test('RESUME_MODES export', () => {
            expect(RESUME_MODES).toEqual(['AUTO', 'MANUAL'])
        })
    })

    // ── pauseFromDD ────────────────────────────────────────────────
    describe('pauseFromDD', () => {
        test('inserts ACTIVE pause with eligibleAfter = pause_time + 24h', () => {
            const beforeMs = Date.now()
            const result = pauseFromDD({
                userId: TEST_USER_ID,
                resolvedEnv: 'DEMO',
                ddPct: 12,
                reason: 'medium DD test',
                actor: 'test'
            })
            expect(typeof result.pauseId).toBe('number')
            expect(result.eligibleAfter).toBeGreaterThan(beforeMs + 23 * 3600 * 1000)
            expect(result.eligibleAfter).toBeLessThan(beforeMs + 25 * 3600 * 1000)
            const row = db.prepare(`SELECT * FROM ml_dd_pauses WHERE id = ?`).get(result.pauseId)
            expect(row.state).toBe('ACTIVE')
            expect(row.dd_at_pause).toBeCloseTo(12, 1)
        })

        test('throws if existing ACTIVE pause for user/env', () => {
            pauseFromDD({
                userId: TEST_USER_ID,
                resolvedEnv: 'TESTNET',
                ddPct: 11,
                reason: 'first',
                actor: 'test'
            })
            expect(() => pauseFromDD({
                userId: TEST_USER_ID,
                resolvedEnv: 'TESTNET',
                ddPct: 14,
                reason: 'second',
                actor: 'test'
            })).toThrow(/already.*active|existing/i)
        })

        test('throws on invalid env', () => {
            expect(() => pauseFromDD({
                userId: TEST_USER_ID,
                resolvedEnv: 'INVALID',
                ddPct: 12,
                reason: 'bad env',
                actor: 'test'
            })).toThrow()
        })
    })

    // ── recordShadowWin ────────────────────────────────────────────
    describe('recordShadowWin', () => {
        test('increments shadow_wins_count', () => {
            // Use unique user for isolation (other tests use TEST_USER_ID for DEMO)
            const freshUid = TEST_USER_ID + 100
            db.prepare(`DELETE FROM ml_dd_pauses WHERE user_id = ?`).run(freshUid)
            const p = pauseFromDD({
                userId: freshUid,
                resolvedEnv: 'DEMO',
                ddPct: 11,
                reason: 'shadow-win test',
                actor: 'test'
            })
            recordShadowWin({ pauseId: p.pauseId })
            recordShadowWin({ pauseId: p.pauseId })
            const row = db.prepare(`SELECT shadow_wins_count FROM ml_dd_pauses WHERE id = ?`).get(p.pauseId)
            expect(row.shadow_wins_count).toBe(2)
            db.prepare(`DELETE FROM ml_dd_pauses WHERE user_id = ?`).run(freshUid)
        })

        test('throws if pause not ACTIVE', () => {
            const p = pauseFromDD({
                userId: TEST_USER_ID,
                resolvedEnv: 'REAL',
                ddPct: 11,
                reason: 'expired test',
                actor: 'test'
            })
            db.prepare(`UPDATE ml_dd_pauses SET state = 'EXPIRED' WHERE id = ?`).run(p.pauseId)
            expect(() => recordShadowWin({ pauseId: p.pauseId })).toThrow(/state|ACTIVE/i)
        })
    })

    // ── evaluateResumeEligibility ──────────────────────────────────
    describe('evaluateResumeEligibility', () => {
        test('returns conditions shape', () => {
            // Need fresh user for isolation
            const freshUid = TEST_USER_ID + 1
            db.prepare(`DELETE FROM ml_dd_pauses WHERE user_id = ?`).run(freshUid)
            const p = pauseFromDD({
                userId: freshUid,
                resolvedEnv: 'DEMO',
                ddPct: 12,
                reason: 'eval test',
                actor: 'test'
            })
            const result = evaluateResumeEligibility({
                pauseId: p.pauseId,
                currentDdPct: 7,
                regimeDriftLevel: 'STABLE'
            })
            expect(result).toHaveProperty('eligible')
            expect(result).toHaveProperty('conditions')
            expect(result.conditions).toHaveProperty('cooldown_elapsed')
            expect(result.conditions).toHaveProperty('sufficient_wins')
            expect(result.conditions).toHaveProperty('dd_recovered')
            expect(result.conditions).toHaveProperty('regime_stable')
            expect(result).toHaveProperty('reason')
            db.prepare(`DELETE FROM ml_dd_pauses WHERE id = ?`).run(p.pauseId)
        })

        test('cooldown_elapsed=false when <24h passed', () => {
            const freshUid = TEST_USER_ID + 2
            db.prepare(`DELETE FROM ml_dd_pauses WHERE user_id = ?`).run(freshUid)
            const p = pauseFromDD({
                userId: freshUid,
                resolvedEnv: 'DEMO',
                ddPct: 12,
                reason: 't',
                actor: 't'
            })
            const result = evaluateResumeEligibility({
                pauseId: p.pauseId,
                currentDdPct: 5,
                regimeDriftLevel: 'STABLE'
            })
            // resume_eligible_after = now + 24h, so cooldown not elapsed
            expect(result.conditions.cooldown_elapsed).toBe(false)
            expect(result.eligible).toBe(false)
            db.prepare(`DELETE FROM ml_dd_pauses WHERE id = ?`).run(p.pauseId)
        })

        test('eligible=true when ALL 4 conditions met', () => {
            const freshUid = TEST_USER_ID + 3
            db.prepare(`DELETE FROM ml_dd_pauses WHERE user_id = ?`).run(freshUid)
            const p = pauseFromDD({
                userId: freshUid,
                resolvedEnv: 'DEMO',
                ddPct: 12,
                reason: 'all conditions',
                actor: 't'
            })
            // Force-update: cooldown elapsed + 3 wins
            db.prepare(`UPDATE ml_dd_pauses SET resume_eligible_after = ?, shadow_wins_count = ? WHERE id = ?`)
                .run(Date.now() - 1000, 3, p.pauseId)
            const result = evaluateResumeEligibility({
                pauseId: p.pauseId,
                currentDdPct: 5,
                regimeDriftLevel: 'STABLE'
            })
            expect(result.eligible).toBe(true)
            expect(result.conditions.cooldown_elapsed).toBe(true)
            expect(result.conditions.sufficient_wins).toBe(true)
            expect(result.conditions.dd_recovered).toBe(true)
            expect(result.conditions.regime_stable).toBe(true)
            db.prepare(`DELETE FROM ml_dd_pauses WHERE id = ?`).run(p.pauseId)
        })

        test('NEVER eligible if dd_at_pause >= 15% (manual-only invariant)', () => {
            const freshUid = TEST_USER_ID + 4
            db.prepare(`DELETE FROM ml_dd_pauses WHERE user_id = ?`).run(freshUid)
            const p = pauseFromDD({
                userId: freshUid,
                resolvedEnv: 'DEMO',
                ddPct: 18,  // >= 15
                reason: 'severe DD',
                actor: 't'
            })
            db.prepare(`UPDATE ml_dd_pauses SET resume_eligible_after = ?, shadow_wins_count = ? WHERE id = ?`)
                .run(Date.now() - 1000, 10, p.pauseId)
            const result = evaluateResumeEligibility({
                pauseId: p.pauseId,
                currentDdPct: 3,
                regimeDriftLevel: 'STABLE'
            })
            expect(result.eligible).toBe(false)
            expect(result.reason).toMatch(/manual|severe|15/i)
            db.prepare(`DELETE FROM ml_dd_pauses WHERE id = ?`).run(p.pauseId)
        })

        test('regime_stable=false when drift is UNSTABLE', () => {
            const freshUid = TEST_USER_ID + 5
            db.prepare(`DELETE FROM ml_dd_pauses WHERE user_id = ?`).run(freshUid)
            const p = pauseFromDD({
                userId: freshUid,
                resolvedEnv: 'DEMO',
                ddPct: 12,
                reason: 't',
                actor: 't'
            })
            db.prepare(`UPDATE ml_dd_pauses SET resume_eligible_after = ?, shadow_wins_count = ? WHERE id = ?`)
                .run(Date.now() - 1000, 3, p.pauseId)
            const result = evaluateResumeEligibility({
                pauseId: p.pauseId,
                currentDdPct: 5,
                regimeDriftLevel: 'UNSTABLE'
            })
            expect(result.conditions.regime_stable).toBe(false)
            expect(result.eligible).toBe(false)
            db.prepare(`DELETE FROM ml_dd_pauses WHERE id = ?`).run(p.pauseId)
        })
    })

    // ── resumeFromPause ────────────────────────────────────────────
    describe('resumeFromPause', () => {
        test('transitions ACTIVE → RESUMED with mode metadata', () => {
            const freshUid = TEST_USER_ID + 6
            db.prepare(`DELETE FROM ml_dd_pauses WHERE user_id = ?`).run(freshUid)
            const p = pauseFromDD({
                userId: freshUid,
                resolvedEnv: 'DEMO',
                ddPct: 11,
                reason: 'resume test',
                actor: 't'
            })
            resumeFromPause({
                pauseId: p.pauseId,
                mode: 'MANUAL',
                actor: 'operator',
                reason: 'op decision'
            })
            const row = db.prepare(`SELECT * FROM ml_dd_pauses WHERE id = ?`).get(p.pauseId)
            expect(row.state).toBe('RESUMED')
            expect(row.auto_resumed).toBe(0)
            expect(row.resumed_by).toBe('operator')
            db.prepare(`DELETE FROM ml_dd_pauses WHERE id = ?`).run(p.pauseId)
        })

        test('AUTO mode sets auto_resumed=1', () => {
            const freshUid = TEST_USER_ID + 7
            db.prepare(`DELETE FROM ml_dd_pauses WHERE user_id = ?`).run(freshUid)
            const p = pauseFromDD({
                userId: freshUid,
                resolvedEnv: 'DEMO',
                ddPct: 11,
                reason: 'auto resume',
                actor: 't'
            })
            resumeFromPause({
                pauseId: p.pauseId,
                mode: 'AUTO',
                actor: '§255*_auto',
                reason: 'all conditions met'
            })
            const row = db.prepare(`SELECT * FROM ml_dd_pauses WHERE id = ?`).get(p.pauseId)
            expect(row.auto_resumed).toBe(1)
            db.prepare(`DELETE FROM ml_dd_pauses WHERE id = ?`).run(p.pauseId)
        })

        test('throws on invalid mode', () => {
            const freshUid = TEST_USER_ID + 8
            db.prepare(`DELETE FROM ml_dd_pauses WHERE user_id = ?`).run(freshUid)
            const p = pauseFromDD({
                userId: freshUid, resolvedEnv: 'DEMO', ddPct: 11, reason: 't', actor: 't'
            })
            expect(() => resumeFromPause({
                pauseId: p.pauseId,
                mode: 'TURBO',
                actor: 'op',
                reason: 'r'
            })).toThrow(/mode/i)
            db.prepare(`DELETE FROM ml_dd_pauses WHERE id = ?`).run(p.pauseId)
        })
    })

    // ── getActivePause ─────────────────────────────────────────────
    describe('getActivePause', () => {
        test('returns ACTIVE pause for user/env', () => {
            const freshUid = TEST_USER_ID + 9
            db.prepare(`DELETE FROM ml_dd_pauses WHERE user_id = ?`).run(freshUid)
            pauseFromDD({
                userId: freshUid, resolvedEnv: 'DEMO', ddPct: 12, reason: 'gap test', actor: 't'
            })
            const active = getActivePause({ userId: freshUid, resolvedEnv: 'DEMO' })
            expect(active).not.toBeNull()
            expect(active.state).toBe('ACTIVE')
            db.prepare(`DELETE FROM ml_dd_pauses WHERE user_id = ?`).run(freshUid)
        })

        test('returns null if no active pause', () => {
            const active = getActivePause({ userId: 999999970, resolvedEnv: 'DEMO' })
            expect(active).toBeNull()
        })
    })

    // ── scanAllPauses ──────────────────────────────────────────────
    describe('scanAllPauses', () => {
        test('returns {evaluated, auto_resumed, skipped, errors}', () => {
            const result = scanAllPauses({
                userId: TEST_USER_ID + 10,
                resolvedEnv: 'DEMO',
                getCurrentDdFn: () => 5,
                getDriftLevelFn: () => 'STABLE'
            })
            expect(result).toHaveProperty('evaluated')
            expect(result).toHaveProperty('auto_resumed')
            expect(result).toHaveProperty('skipped')
            expect(result).toHaveProperty('errors')
        })
    })
})

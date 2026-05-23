/**
 * R5B Governance — tieredPromotion tests (§252* Claude-extras)
 *
 * §252* = Claude-extras approved 2026-04-29 (NOT in canonical PDF).
 * Source: project_ml_architecture_frozen.md + project_ml_brain_pro_244.md.
 *
 * 3-tier promotion mechanism for governance proposals:
 *   - MINOR  → auto-apply when flag on, never on REAL
 *   - MAJOR  → operator approval queue
 *   - CRITICAL → operator approval + 24h cooldown
 *
 * Composes existing modules: versionRegistry (§19) + approvalQueue (Wave 1D).
 * No new migration.
 */

const { db } = require('../../../server/services/database')
const versionRegistry = require('../../../server/services/ml/R5B_governance/versionRegistry')
const approvalQueue = require('../../../server/services/ml/_operator/approvalQueue')
const {
    TIERS,
    classifyChange,
    weightDelta,
    proposeWithTier,
    applyApproved,
    processMinor
} = require('../../../server/services/ml/R5B_governance/tieredPromotion')

describe('R5B — tieredPromotion (§252* Claude-extras)', () => {
    const TEST_PREFIX = `omega_w3_p252_${Date.now()}_`
    const TEST_USER_ID = 99850

    // Save original flag state
    let originalFlag
    beforeAll(() => {
        const MF = require('../../../server/migrationFlags')
        originalFlag = MF.ML_BANDIT_AUTO_APPLY_MINOR
    })
    afterAll(() => {
        // Clean up test rows
        db.prepare(`DELETE FROM ml_governance_versions WHERE component_id LIKE ?`)
            .run(`${TEST_PREFIX}%`)
        db.prepare(`DELETE FROM ml_operator_approval WHERE user_id = ?`).run(TEST_USER_ID)
    })

    // ── Exported enums ─────────────────────────────────────────────
    describe('TIERS export', () => {
        test('matches approvalQueue.TIERS for consistency', () => {
            expect(TIERS).toEqual(['MINOR', 'MAJOR', 'CRITICAL'])
            expect(TIERS).toEqual(approvalQueue.TIERS)
        })
    })

    // ── weightDelta helper ─────────────────────────────────────────
    describe('weightDelta(oldConfig, newConfig)', () => {
        test('returns 0 for identical configs', () => {
            expect(weightDelta({ a: 0.5, b: 0.7 }, { a: 0.5, b: 0.7 })).toBe(0)
        })

        test('returns max absolute diff across keys', () => {
            expect(weightDelta({ a: 0.5, b: 0.7 }, { a: 0.52, b: 0.65 })).toBeCloseTo(0.05, 4)
        })

        test('handles missing keys gracefully', () => {
            expect(weightDelta({ a: 0.5 }, { a: 0.5, b: 0.3 })).toBeCloseTo(0.3, 4)
        })

        test('returns 0 on empty configs', () => {
            expect(weightDelta({}, {})).toBe(0)
        })

        test('ignores non-numeric values', () => {
            expect(weightDelta({ a: 0.5, name: 'old' }, { a: 0.6, name: 'new' })).toBeCloseTo(0.1, 4)
        })
    })

    // ── classifyChange ─────────────────────────────────────────────
    describe('classifyChange', () => {
        test('MINOR when weight delta < 0.05 and non-charter and USER_CELL', () => {
            const tier = classifyChange({
                componentType: 'detector',
                oldConfig: { w: 0.7 },
                newConfig: { w: 0.72 },
                scope: 'USER_CELL'
            })
            expect(tier).toBe('MINOR')
        })

        test('MAJOR when weight delta in [0.05, 0.20)', () => {
            const tier = classifyChange({
                componentType: 'detector',
                oldConfig: { w: 0.7 },
                newConfig: { w: 0.82 },
                scope: 'USER_CELL'
            })
            expect(tier).toBe('MAJOR')
        })

        test('CRITICAL when weight delta >= 0.20', () => {
            const tier = classifyChange({
                componentType: 'detector',
                oldConfig: { w: 0.5 },
                newConfig: { w: 0.75 },
                scope: 'USER_CELL'
            })
            expect(tier).toBe('CRITICAL')
        })

        test('CRITICAL for risk_config regardless of delta', () => {
            const tier = classifyChange({
                componentType: 'risk_config',
                oldConfig: { max_drawdown: 5.0 },
                newConfig: { max_drawdown: 5.01 },
                scope: 'USER_CELL'
            })
            expect(tier).toBe('CRITICAL')
        })

        test('CRITICAL when isCharter=true regardless of delta', () => {
            const tier = classifyChange({
                componentType: 'model',
                oldConfig: { x: 0.5 },
                newConfig: { x: 0.51 },
                scope: 'USER_CELL',
                isCharter: true
            })
            expect(tier).toBe('CRITICAL')
        })

        test('CRITICAL for feature_schema breaking changes (key removed)', () => {
            const tier = classifyChange({
                componentType: 'feature_schema',
                oldConfig: { fields: ['a', 'b', 'c'] },
                newConfig: { fields: ['a', 'b'] }  // 'c' removed = breaking
            })
            expect(tier).toBe('CRITICAL')
        })

        test('MAJOR for scope expansion (USER_CELL → SYMBOL)', () => {
            const tier = classifyChange({
                componentType: 'detector',
                oldConfig: { w: 0.7 },
                newConfig: { w: 0.71 },  // would be MINOR by delta
                scope: 'SYMBOL'           // but scope expanded
            })
            expect(tier).toBe('MAJOR')
        })

        test('throws on missing componentType', () => {
            expect(() => classifyChange({
                oldConfig: {}, newConfig: {}, scope: 'USER_CELL'
            })).toThrow()
        })
    })

    // ── proposeWithTier MINOR path ─────────────────────────────────
    describe('proposeWithTier — MINOR auto-apply', () => {
        test('auto-applies MINOR when flag ON and non-REAL', () => {
            const MF = require('../../../server/migrationFlags')
            MF.set('ML_BANDIT_AUTO_APPLY_MINOR', true)
            try {
                const result = proposeWithTier({
                    componentType: 'detector',
                    componentId: `${TEST_PREFIX}minor1`,
                    version: 'v1',
                    config: { w: 0.7 },
                    oldConfig: { w: 0.7 },  // identical → MINOR
                    motivation: 'minor tweak',
                    actor: 'bandit',
                    scope: 'USER_CELL',
                    env: 'DEMO',
                    userId: TEST_USER_ID
                })
                expect(result.tier).toBe('MINOR')
                expect(result.autoApplied).toBe(true)
                expect(result.state).toBe('APPLIED')
                const row = versionRegistry.getById(result.versionId)
                expect(row.state).toBe('ACTIVE')
            } finally {
                MF.set('ML_BANDIT_AUTO_APPLY_MINOR', originalFlag)
            }
        })

        test('queues MINOR when flag OFF', () => {
            const MF = require('../../../server/migrationFlags')
            MF.set('ML_BANDIT_AUTO_APPLY_MINOR', false)
            const result = proposeWithTier({
                componentType: 'detector',
                componentId: `${TEST_PREFIX}minor2`,
                version: 'v1',
                config: { w: 0.7 },
                oldConfig: { w: 0.7 },
                motivation: 'minor when flag off',
                actor: 'bandit',
                scope: 'USER_CELL',
                env: 'DEMO',
                userId: TEST_USER_ID
            })
            expect(result.tier).toBe('MINOR')
            expect(result.autoApplied).toBe(false)
            expect(result.state).toBe('PENDING_APPROVAL')
            expect(typeof result.approvalId).toBe('number')
        })

        test('NEVER auto-applies on REAL even when flag ON', () => {
            const MF = require('../../../server/migrationFlags')
            MF.set('ML_BANDIT_AUTO_APPLY_MINOR', true)
            try {
                const result = proposeWithTier({
                    componentType: 'detector',
                    componentId: `${TEST_PREFIX}minor_real`,
                    version: 'v1',
                    config: { w: 0.7 },
                    oldConfig: { w: 0.7 },
                    motivation: 'minor on REAL',
                    actor: 'bandit',
                    scope: 'USER_CELL',
                    env: 'REAL',
                    userId: TEST_USER_ID
                })
                expect(result.tier).toBe('MINOR')
                expect(result.autoApplied).toBe(false)
                expect(result.state).toBe('BLOCKED_REAL')
            } finally {
                MF.set('ML_BANDIT_AUTO_APPLY_MINOR', originalFlag)
            }
        })
    })

    // ── proposeWithTier MAJOR path ─────────────────────────────────
    describe('proposeWithTier — MAJOR queued', () => {
        test('queues MAJOR change for operator approval', () => {
            const result = proposeWithTier({
                componentType: 'detector',
                componentId: `${TEST_PREFIX}major1`,
                version: 'v2',
                config: { w: 0.85 },
                oldConfig: { w: 0.7 },  // delta 0.15 → MAJOR
                motivation: 'major bump',
                actor: 'bandit',
                scope: 'USER_CELL',
                env: 'DEMO',
                userId: TEST_USER_ID
            })
            expect(result.tier).toBe('MAJOR')
            expect(result.autoApplied).toBe(false)
            expect(result.state).toBe('PENDING_APPROVAL')
            expect(typeof result.approvalId).toBe('number')

            const approval = approvalQueue.getById(result.approvalId)
            expect(approval.tier).toBe('MAJOR')
            expect(approval.queue_state).toBe('PENDING')
            expect(approval.cooldown_until).toBeNull()  // MAJOR no cooldown
        })
    })

    // ── proposeWithTier CRITICAL path ──────────────────────────────
    describe('proposeWithTier — CRITICAL queued + 24h cooldown', () => {
        test('queues CRITICAL with 24h cooldown', () => {
            const beforeMs = Date.now()
            const result = proposeWithTier({
                componentType: 'risk_config',
                componentId: `${TEST_PREFIX}crit1`,
                version: 'v2',
                config: { max_drawdown: 3.5 },
                oldConfig: { max_drawdown: 5.0 },
                motivation: 'tighten DD limit',
                actor: 'operator',
                scope: 'USER_CELL',
                env: 'DEMO',
                userId: TEST_USER_ID
            })
            expect(result.tier).toBe('CRITICAL')
            expect(result.state).toBe('PENDING_APPROVAL')

            const approval = approvalQueue.getById(result.approvalId)
            expect(approval.tier).toBe('CRITICAL')
            expect(approval.cooldown_until).toBeGreaterThan(beforeMs + 23 * 3600 * 1000)
            expect(approval.cooldown_until).toBeLessThan(beforeMs + 25 * 3600 * 1000)
        })
    })

    // ── applyApproved ──────────────────────────────────────────────
    describe('applyApproved', () => {
        test('activates version when approval is APPROVED and cooldown elapsed', () => {
            const prop = proposeWithTier({
                componentType: 'detector',
                componentId: `${TEST_PREFIX}apply1`,
                version: 'v2',
                config: { w: 0.85 },
                oldConfig: { w: 0.7 },
                motivation: 'apply test',
                actor: 'test',
                scope: 'USER_CELL',
                env: 'DEMO',
                userId: TEST_USER_ID
            })
            // Approve via approvalQueue
            approvalQueue.decide({
                id: prop.approvalId,
                decision: 'APPROVED',
                decidedBy: 'operator',
                signature: 'sig_test'
            })
            const result = applyApproved({
                approvalId: prop.approvalId,
                actor: 'operator'
            })
            expect(typeof result.versionId).toBe('number')
            expect(typeof result.activated_at).toBe('number')
            const row = versionRegistry.getById(result.versionId)
            expect(row.state).toBe('ACTIVE')
        })

        test('CRITICAL cooldown enforcement — throws if cooldown_until > now', () => {
            const prop = proposeWithTier({
                componentType: 'risk_config',
                componentId: `${TEST_PREFIX}crit_cd`,
                version: 'v2',
                config: { max_drawdown: 3.0 },
                oldConfig: { max_drawdown: 5.0 },
                motivation: 'critical with cooldown',
                actor: 'test',
                scope: 'USER_CELL',
                env: 'DEMO',
                userId: TEST_USER_ID
            })
            approvalQueue.decide({
                id: prop.approvalId,
                decision: 'APPROVED',
                decidedBy: 'operator',
                signature: 'sig'
            })
            // Cooldown still active (24h ahead)
            expect(() => applyApproved({
                approvalId: prop.approvalId,
                actor: 'operator'
            })).toThrow(/cooldown/i)
        })

        test('throws if approval not APPROVED state', () => {
            const prop = proposeWithTier({
                componentType: 'detector',
                componentId: `${TEST_PREFIX}apply_pending`,
                version: 'v2',
                config: { w: 0.85 },
                oldConfig: { w: 0.7 },
                motivation: 'pending approval',
                actor: 'test',
                scope: 'USER_CELL',
                env: 'DEMO',
                userId: TEST_USER_ID
            })
            // Still PENDING
            expect(() => applyApproved({
                approvalId: prop.approvalId,
                actor: 'operator'
            })).toThrow(/APPROVED|state/i)
        })
    })

    // ── processMinor ───────────────────────────────────────────────
    describe('processMinor — batch auto-apply', () => {
        test('returns {applied_count, skipped_count, errors[]}', () => {
            const result = processMinor()
            expect(result).toHaveProperty('applied_count')
            expect(result).toHaveProperty('skipped_count')
            expect(result).toHaveProperty('errors')
            expect(Array.isArray(result.errors)).toBe(true)
        })

        test('respects ML_BANDIT_AUTO_APPLY_MINOR flag (returns skipped when off)', () => {
            const MF = require('../../../server/migrationFlags')
            MF.set('ML_BANDIT_AUTO_APPLY_MINOR', false)
            const result = processMinor()
            // When flag off, all are skipped (or applied=0 at minimum)
            expect(result.applied_count).toBe(0)
        })
    })
})

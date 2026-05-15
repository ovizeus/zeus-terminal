/**
 * Operator Interaction — operatorUnavailability tests (§253* Claude-extras)
 *
 * §253* OPERATOR UNAVAILABILITY LADDER (R1 + R0) — escalation ladder 24h
 * WARN / 72h HANDOVER / 7d FALLBACK. Anti-paralysis, multi-operator
 * handover, fallback SAFE = status quo. NEVER auto-approve during silence.
 *
 * Claude-extras approved 2026-04-29, NOT in canonical PDF.
 * Source: project_ml_brain_pro_244.md "253*".
 */

const { db } = require('../../../server/services/database')
const approvalQueue = require('../../../server/services/ml/_operator/approvalQueue')
const {
    THRESHOLDS,
    ESCALATION_LEVELS,
    evaluateApproval,
    recordEscalation,
    processEscalations,
    getEscalationHistory
} = require('../../../server/services/ml/_operator/operatorUnavailability')

describe('Operator — operatorUnavailability (§253* Claude-extras)', () => {
    const TEST_USER_ID = 99720

    afterAll(() => {
        const ids = db.prepare(`SELECT id FROM ml_operator_approval WHERE user_id = ?`).all(TEST_USER_ID).map(r => r.id)
        for (const id of ids) {
            db.prepare(`DELETE FROM ml_operator_escalations WHERE approval_id = ?`).run(id)
        }
        db.prepare(`DELETE FROM ml_operator_approval WHERE user_id = ?`).run(TEST_USER_ID)
    })

    // ── Migration 048 ──────────────────────────────────────────────
    describe('Migration 048 — ml_operator_escalations', () => {
        test('table exists', () => {
            const row = db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='ml_operator_escalations'"
            ).get()
            expect(row).toBeDefined()
        })

        test('has expected columns', () => {
            const cols = db.prepare("PRAGMA table_info(ml_operator_escalations)").all()
            const names = cols.map(c => c.name)
            expect(names).toEqual(expect.arrayContaining([
                'id', 'approval_id', 'level', 'hours_since_request',
                'action_taken', 'actor', 'notified_operators_json', 'created_at'
            ]))
        })

        test('level CHECK enforces enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_operator_escalations
                (approval_id, level, hours_since_request, action_taken, actor, created_at)
                VALUES (1, 'BANANA', 10, 'test', 'sys', 0)
            `).run()).toThrow(/CHECK constraint/)
        })

        test('approval_id index exists', () => {
            const idx = db.prepare("PRAGMA index_list(ml_operator_escalations)").all()
            const names = idx.map(i => i.name)
            expect(names).toEqual(expect.arrayContaining(['idx_mloe_approval_ts']))
        })
    })

    // ── Exported constants ─────────────────────────────────────────
    describe('Exported constants', () => {
        test('THRESHOLDS', () => {
            expect(THRESHOLDS.warn_hours).toBe(24)
            expect(THRESHOLDS.handover_hours).toBe(72)
            expect(THRESHOLDS.fallback_hours).toBe(168)  // 7 days
        })
        test('ESCALATION_LEVELS', () => {
            expect(ESCALATION_LEVELS).toEqual(['NONE', 'WARN', 'HANDOVER', 'FALLBACK'])
        })
    })

    // ── evaluateApproval ───────────────────────────────────────────
    describe('evaluateApproval', () => {
        function seedApproval({ requestedAt, state = 'PENDING' }) {
            const result = approvalQueue.enqueue({
                userId: TEST_USER_ID,
                requestType: 'PROMOTION',
                payload: { versionId: 1 },
                tier: 'MAJOR'
            })
            // Override requested_at + state for time-travel tests
            db.prepare(`UPDATE ml_operator_approval SET requested_at = ?, queue_state = ? WHERE id = ?`)
                .run(requestedAt, state, result.id)
            return result.id
        }

        test('level=NONE when <24h since request', () => {
            const id = seedApproval({ requestedAt: Date.now() - 5 * 3600 * 1000 })  // 5h ago
            const result = evaluateApproval({ approvalId: id })
            expect(result.level).toBe('NONE')
            expect(result.hours_since_request).toBeCloseTo(5, 0)
        })

        test('level=WARN when 24h <= silence < 72h', () => {
            const id = seedApproval({ requestedAt: Date.now() - 30 * 3600 * 1000 })  // 30h ago
            const result = evaluateApproval({ approvalId: id })
            expect(result.level).toBe('WARN')
        })

        test('level=HANDOVER when 72h <= silence < 168h', () => {
            const id = seedApproval({ requestedAt: Date.now() - 80 * 3600 * 1000 })  // 80h ago
            const result = evaluateApproval({ approvalId: id })
            expect(result.level).toBe('HANDOVER')
        })

        test('level=FALLBACK when silence >= 168h (7d)', () => {
            const id = seedApproval({ requestedAt: Date.now() - 200 * 3600 * 1000 })  // 200h ago
            const result = evaluateApproval({ approvalId: id })
            expect(result.level).toBe('FALLBACK')
        })

        test('returns NONE for non-PENDING approvals (no escalation needed)', () => {
            const id = seedApproval({ requestedAt: Date.now() - 200 * 3600 * 1000, state: 'APPROVED' })
            const result = evaluateApproval({ approvalId: id })
            expect(result.level).toBe('NONE')
            expect(result.reason).toMatch(/state|not pending/i)
        })

        test('result shape includes hours, next_escalation, recommended_action', () => {
            const id = seedApproval({ requestedAt: Date.now() - 30 * 3600 * 1000 })
            const result = evaluateApproval({ approvalId: id })
            expect(result).toHaveProperty('hours_since_request')
            expect(result).toHaveProperty('next_escalation_in_hours')
            expect(result).toHaveProperty('recommended_action')
        })

        test('throws on missing approval', () => {
            expect(() => evaluateApproval({ approvalId: 999999999 })).toThrow(/not found/i)
        })
    })

    // ── recordEscalation ───────────────────────────────────────────
    describe('recordEscalation', () => {
        test('inserts escalation log entry', () => {
            const id = approvalQueue.enqueue({
                userId: TEST_USER_ID,
                requestType: 'PROMOTION',
                payload: {},
                tier: 'MAJOR'
            }).id
            db.prepare(`UPDATE ml_operator_approval SET requested_at = ? WHERE id = ?`)
                .run(Date.now() - 30 * 3600 * 1000, id)

            const result = recordEscalation({
                approvalId: id,
                level: 'WARN',
                action: 'reminder sent',
                actor: 'auto_escalator'
            })
            expect(typeof result.escalation_id).toBe('number')
            const row = db.prepare(`SELECT * FROM ml_operator_escalations WHERE id = ?`).get(result.escalation_id)
            expect(row.level).toBe('WARN')
            expect(row.action_taken).toBe('reminder sent')
        })

        test('FALLBACK level sets approval state to EXPIRED (status quo)', () => {
            const id = approvalQueue.enqueue({
                userId: TEST_USER_ID,
                requestType: 'PROMOTION',
                payload: {},
                tier: 'MAJOR'
            }).id
            db.prepare(`UPDATE ml_operator_approval SET requested_at = ? WHERE id = ?`)
                .run(Date.now() - 200 * 3600 * 1000, id)
            recordEscalation({
                approvalId: id,
                level: 'FALLBACK',
                action: '7d silence, expired (status quo preserved)',
                actor: 'auto_escalator'
            })
            const approval = approvalQueue.getById(id)
            expect(approval.queue_state).toBe('EXPIRED')
        })

        test('rejects duplicate same-level escalations for same approval', () => {
            const id = approvalQueue.enqueue({
                userId: TEST_USER_ID,
                requestType: 'PROMOTION',
                payload: {},
                tier: 'MAJOR'
            }).id
            db.prepare(`UPDATE ml_operator_approval SET requested_at = ? WHERE id = ?`)
                .run(Date.now() - 30 * 3600 * 1000, id)
            recordEscalation({
                approvalId: id, level: 'WARN', action: 'first', actor: 'sys'
            })
            expect(() => recordEscalation({
                approvalId: id, level: 'WARN', action: 'second', actor: 'sys'
            })).toThrow(/duplicate|already.*WARN/i)
        })

        test('stores notified_operators_json when provided (HANDOVER level)', () => {
            const id = approvalQueue.enqueue({
                userId: TEST_USER_ID,
                requestType: 'PROMOTION',
                payload: {},
                tier: 'MAJOR'
            }).id
            const result = recordEscalation({
                approvalId: id, level: 'HANDOVER',
                action: 'paged backup operators',
                actor: 'sys',
                notifiedOperators: ['op_backup_1', 'op_backup_2']
            })
            const row = db.prepare(`SELECT notified_operators_json FROM ml_operator_escalations WHERE id = ?`)
                .get(result.escalation_id)
            const parsed = JSON.parse(row.notified_operators_json)
            expect(parsed).toEqual(['op_backup_1', 'op_backup_2'])
        })

        test('throws on invalid level', () => {
            expect(() => recordEscalation({
                approvalId: 1, level: 'EXTREME', action: 'x', actor: 'y'
            })).toThrow(/level/i)
        })
    })

    // ── getEscalationHistory ───────────────────────────────────────
    describe('getEscalationHistory', () => {
        test('returns chronological list for approval', () => {
            const id = approvalQueue.enqueue({
                userId: TEST_USER_ID,
                requestType: 'PROMOTION',
                payload: {},
                tier: 'MAJOR'
            }).id
            db.prepare(`UPDATE ml_operator_approval SET requested_at = ? WHERE id = ?`)
                .run(Date.now() - 80 * 3600 * 1000, id)
            recordEscalation({ approvalId: id, level: 'WARN', action: 'first', actor: 'sys' })
            recordEscalation({ approvalId: id, level: 'HANDOVER', action: 'second', actor: 'sys', notifiedOperators: ['op2'] })
            const history = getEscalationHistory({ approvalId: id })
            expect(history.length).toBe(2)
            expect(history[0].level).toBe('WARN')
            expect(history[1].level).toBe('HANDOVER')
        })

        test('returns empty array when no escalations', () => {
            const id = approvalQueue.enqueue({
                userId: TEST_USER_ID,
                requestType: 'PROMOTION',
                payload: {},
                tier: 'MAJOR'
            }).id
            expect(getEscalationHistory({ approvalId: id })).toEqual([])
        })
    })

    // ── processEscalations ─────────────────────────────────────────
    describe('processEscalations', () => {
        test('returns {evaluated, warned, handed_over, expired, errors}', () => {
            const result = processEscalations({ sinceMs: 0 })
            expect(result).toHaveProperty('evaluated')
            expect(result).toHaveProperty('warned')
            expect(result).toHaveProperty('handed_over')
            expect(result).toHaveProperty('expired')
            expect(result).toHaveProperty('errors')
            expect(Array.isArray(result.errors)).toBe(true)
        })

        test('auto-escalates approvals past thresholds', () => {
            // Seed 3 approvals at different ages
            const warnId = approvalQueue.enqueue({
                userId: TEST_USER_ID, requestType: 'PROMOTION', payload: {}, tier: 'MAJOR'
            }).id
            db.prepare(`UPDATE ml_operator_approval SET requested_at = ? WHERE id = ?`)
                .run(Date.now() - 30 * 3600 * 1000, warnId)

            const handoverId = approvalQueue.enqueue({
                userId: TEST_USER_ID, requestType: 'PROMOTION', payload: {}, tier: 'MAJOR'
            }).id
            db.prepare(`UPDATE ml_operator_approval SET requested_at = ? WHERE id = ?`)
                .run(Date.now() - 80 * 3600 * 1000, handoverId)

            const fallbackId = approvalQueue.enqueue({
                userId: TEST_USER_ID, requestType: 'PROMOTION', payload: {}, tier: 'MAJOR'
            }).id
            db.prepare(`UPDATE ml_operator_approval SET requested_at = ? WHERE id = ?`)
                .run(Date.now() - 200 * 3600 * 1000, fallbackId)

            const result = processEscalations({ sinceMs: 0 })
            expect(result.warned).toBeGreaterThanOrEqual(1)
            expect(result.handed_over).toBeGreaterThanOrEqual(1)
            expect(result.expired).toBeGreaterThanOrEqual(1)
        })

        test('NEVER auto-approves silenced approvals (status quo invariant)', () => {
            const fallbackId = approvalQueue.enqueue({
                userId: TEST_USER_ID, requestType: 'PROMOTION', payload: {}, tier: 'MAJOR'
            }).id
            db.prepare(`UPDATE ml_operator_approval SET requested_at = ? WHERE id = ?`)
                .run(Date.now() - 200 * 3600 * 1000, fallbackId)

            processEscalations({ sinceMs: 0 })

            const approval = approvalQueue.getById(fallbackId)
            // FALLBACK = EXPIRED, NEVER APPROVED
            expect(approval.queue_state).toBe('EXPIRED')
            expect(approval.queue_state).not.toBe('APPROVED')
        })
    })
})

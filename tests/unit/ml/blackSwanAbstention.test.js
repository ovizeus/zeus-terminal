/**
 * R3A Safety — blackSwanAbstention tests (§248* Claude-extras)
 *
 * §248* BLACK SWAN ABSTENTION (R3A + R3B) = regime-level OOD detection
 * (flash crash, structural break) → abstain from trading.
 * Source: project_ml_brain_pro_244.md "248*".
 * Claude-extras approved 2026-04-29, NOT in canonical PDF.
 *
 * 5 detection signals (any threshold breach counts as triggered condition):
 *   1. Volatility spike ratio (current ATR / baseline > 5x)
 *   2. Liquidity drop (orderbook depth drop > 80%)
 *   3. Price gap (single-bar move > 5%)
 *   4. Cross-asset correlation breakdown (delta from historical > 0.5)
 *   5. Funding extreme deviation (>10% absolute)
 *
 * Severity by count of triggered conditions:
 *   MINOR (1):    1h cooldown, auto-clear on cooldown expire
 *   MAJOR (2):    24h cooldown, auto-clear on cooldown expire
 *   CRITICAL (3+): 7d (168h) cooldown, MUST be manually cleared by operator
 */

const { db } = require('../../../server/services/database')
const {
    THRESHOLDS,
    SEVERITY_LEVELS,
    COOLDOWN_HOURS,
    ABSTENTION_STATES,
    evaluateBlackSwan,
    recordEvent,
    isAbstaining,
    getActiveEvent,
    clearAbstention
} = require('../../../server/services/ml/R3A_safety/blackSwanAbstention')

describe('R3A — blackSwanAbstention (§248* Claude-extras)', () => {
    const TEST_USER_BASE = 99650

    afterAll(() => {
        db.prepare(`DELETE FROM ml_black_swan_events WHERE user_id BETWEEN ? AND ?`)
            .run(TEST_USER_BASE, TEST_USER_BASE + 100)
    })

    // ── Migration 050 ──────────────────────────────────────────────
    describe('Migration 050 — ml_black_swan_events', () => {
        test('table exists', () => {
            const row = db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='ml_black_swan_events'"
            ).get()
            expect(row).toBeDefined()
        })

        test('has expected columns', () => {
            const cols = db.prepare("PRAGMA table_info(ml_black_swan_events)").all()
            const names = cols.map(c => c.name)
            expect(names).toEqual(expect.arrayContaining([
                'id', 'user_id', 'resolved_env', 'symbol',
                'severity', 'signals_json', 'triggers_json',
                'abstention_state', 'cooldown_until',
                'actor', 'detected_at', 'cleared_at',
                'cleared_by', 'clear_reason'
            ]))
        })

        test('severity CHECK constraint', () => {
            expect(() => db.prepare(`INSERT INTO ml_black_swan_events
                (user_id, resolved_env, symbol, severity, signals_json, triggers_json,
                 abstention_state, cooldown_until, actor, detected_at)
                VALUES (1, 'DEMO', 'BTC', 'EXTREME', '{}', '[]', 'ACTIVE', 0, 'sys', 0)
            `).run()).toThrow(/CHECK constraint/)
        })

        test('abstention_state CHECK constraint', () => {
            expect(() => db.prepare(`INSERT INTO ml_black_swan_events
                (user_id, resolved_env, symbol, severity, signals_json, triggers_json,
                 abstention_state, cooldown_until, actor, detected_at)
                VALUES (1, 'DEMO', 'BTC', 'MINOR', '{}', '[]', 'BANANA', 0, 'sys', 0)
            `).run()).toThrow(/CHECK constraint/)
        })

        test('user+env+state index exists', () => {
            const idx = db.prepare("PRAGMA index_list(ml_black_swan_events)").all()
            const names = idx.map(i => i.name)
            expect(names).toEqual(expect.arrayContaining(['idx_mlbs_user_env_state']))
        })
    })

    // ── Exported constants ─────────────────────────────────────────
    describe('Exported constants', () => {
        test('THRESHOLDS', () => {
            expect(THRESHOLDS.volatility_spike_ratio).toBe(5.0)
            expect(THRESHOLDS.liquidity_drop_pct).toBe(0.80)
            expect(THRESHOLDS.price_gap_pct).toBe(5.0)
            expect(THRESHOLDS.correlation_breakdown).toBeCloseTo(0.5, 2)
            expect(THRESHOLDS.funding_extreme).toBeCloseTo(0.10, 2)
        })
        test('SEVERITY_LEVELS', () => {
            expect(SEVERITY_LEVELS).toEqual(['NONE', 'MINOR', 'MAJOR', 'CRITICAL'])
        })
        test('COOLDOWN_HOURS by severity', () => {
            expect(COOLDOWN_HOURS.MINOR).toBe(1)
            expect(COOLDOWN_HOURS.MAJOR).toBe(24)
            expect(COOLDOWN_HOURS.CRITICAL).toBe(168)
        })
        test('ABSTENTION_STATES', () => {
            expect(ABSTENTION_STATES).toEqual(['ACTIVE', 'CLEARED', 'EXPIRED'])
        })
    })

    // ── evaluateBlackSwan ──────────────────────────────────────────
    describe('evaluateBlackSwan', () => {
        test('severity=NONE when no conditions triggered', () => {
            const result = evaluateBlackSwan({
                signals: {
                    volatility_ratio: 1.5,
                    liquidity_drop: 0.1,
                    price_gap_pct: 0.5,
                    correlation_delta: 0.1,
                    funding_rate: 0.005
                }
            })
            expect(result.severity).toBe('NONE')
            expect(result.triggered_conditions).toEqual([])
            expect(result.recommended_action).toMatch(/none|no action/i)
        })

        test('severity=MINOR when 1 condition triggered', () => {
            const result = evaluateBlackSwan({
                signals: {
                    volatility_ratio: 7.0,   // > 5 trigger
                    liquidity_drop: 0.1,
                    price_gap_pct: 0.5,
                    correlation_delta: 0.1,
                    funding_rate: 0.005
                }
            })
            expect(result.severity).toBe('MINOR')
            expect(result.triggered_conditions).toContain('volatility_spike')
            expect(result.triggered_conditions.length).toBe(1)
        })

        test('severity=MAJOR when 2 conditions triggered', () => {
            const result = evaluateBlackSwan({
                signals: {
                    volatility_ratio: 7.0,
                    liquidity_drop: 0.85,  // > 0.80 trigger
                    price_gap_pct: 0.5,
                    correlation_delta: 0.1,
                    funding_rate: 0.005
                }
            })
            expect(result.severity).toBe('MAJOR')
            expect(result.triggered_conditions.length).toBe(2)
        })

        test('severity=CRITICAL when 3+ conditions triggered', () => {
            const result = evaluateBlackSwan({
                signals: {
                    volatility_ratio: 7.0,
                    liquidity_drop: 0.85,
                    price_gap_pct: 8.0,  // > 5 trigger
                    correlation_delta: 0.6,  // > 0.5 trigger
                    funding_rate: 0.005
                }
            })
            expect(result.severity).toBe('CRITICAL')
            expect(result.triggered_conditions.length).toBeGreaterThanOrEqual(3)
        })

        test('detects funding extreme (negative)', () => {
            const result = evaluateBlackSwan({
                signals: {
                    volatility_ratio: 1.5,
                    liquidity_drop: 0.1,
                    price_gap_pct: 0.5,
                    correlation_delta: 0.1,
                    funding_rate: -0.15  // abs > 0.10 trigger
                }
            })
            expect(result.triggered_conditions).toContain('funding_extreme')
        })

        test('returns result shape', () => {
            const result = evaluateBlackSwan({
                signals: { volatility_ratio: 7 }
            })
            expect(result).toHaveProperty('severity')
            expect(result).toHaveProperty('triggered_conditions')
            expect(result).toHaveProperty('recommended_action')
        })

        test('throws on missing signals', () => {
            expect(() => evaluateBlackSwan({})).toThrow()
        })
    })

    // ── recordEvent ────────────────────────────────────────────────
    describe('recordEvent', () => {
        test('inserts ACTIVE event with cooldown by severity', () => {
            const uid = TEST_USER_BASE + 1
            const beforeMs = Date.now()
            const result = recordEvent({
                userId: uid,
                resolvedEnv: 'DEMO',
                symbol: 'BTCUSDT',
                signals: { volatility_ratio: 8 },
                severity: 'MAJOR',
                triggers: ['volatility_spike', 'price_gap'],
                actor: 'test'
            })
            expect(typeof result.eventId).toBe('number')
            expect(result.cooldownUntil).toBeGreaterThan(beforeMs + 23 * 3600 * 1000)
            const row = db.prepare(`SELECT * FROM ml_black_swan_events WHERE id = ?`).get(result.eventId)
            expect(row.abstention_state).toBe('ACTIVE')
            expect(row.severity).toBe('MAJOR')
        })

        test('MINOR cooldown is 1h', () => {
            const uid = TEST_USER_BASE + 2
            const beforeMs = Date.now()
            const result = recordEvent({
                userId: uid, resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
                signals: { volatility_ratio: 7 },
                severity: 'MINOR',
                triggers: ['volatility_spike'],
                actor: 'test'
            })
            expect(result.cooldownUntil).toBeLessThan(beforeMs + 2 * 3600 * 1000)
            expect(result.cooldownUntil).toBeGreaterThan(beforeMs + 0.5 * 3600 * 1000)
        })

        test('CRITICAL cooldown is 168h (7d)', () => {
            const uid = TEST_USER_BASE + 3
            const beforeMs = Date.now()
            const result = recordEvent({
                userId: uid, resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
                signals: { volatility_ratio: 12 },
                severity: 'CRITICAL',
                triggers: ['volatility_spike', 'price_gap', 'liquidity_drop'],
                actor: 'test'
            })
            expect(result.cooldownUntil).toBeGreaterThan(beforeMs + 167 * 3600 * 1000)
            expect(result.cooldownUntil).toBeLessThan(beforeMs + 169 * 3600 * 1000)
        })

        test('throws on invalid severity', () => {
            expect(() => recordEvent({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTC',
                signals: {}, severity: 'BANANA', triggers: [], actor: 't'
            })).toThrow(/severity/i)
        })
    })

    // ── isAbstaining ───────────────────────────────────────────────
    describe('isAbstaining', () => {
        test('returns true when ACTIVE event exists and cooldown not expired', () => {
            const uid = TEST_USER_BASE + 4
            recordEvent({
                userId: uid, resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
                signals: { volatility_ratio: 7 }, severity: 'MAJOR',
                triggers: ['volatility_spike', 'price_gap'], actor: 'test'
            })
            expect(isAbstaining({ userId: uid, resolvedEnv: 'DEMO' })).toBe(true)
        })

        test('returns false when no active event', () => {
            expect(isAbstaining({ userId: 999999650, resolvedEnv: 'DEMO' })).toBe(false)
        })

        test('returns false when active event but cooldown expired', () => {
            const uid = TEST_USER_BASE + 5
            const result = recordEvent({
                userId: uid, resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
                signals: {}, severity: 'MINOR',
                triggers: ['volatility_spike'], actor: 'test'
            })
            // Force cooldown into the past
            db.prepare(`UPDATE ml_black_swan_events SET cooldown_until = ? WHERE id = ?`)
                .run(Date.now() - 1000, result.eventId)
            expect(isAbstaining({ userId: uid, resolvedEnv: 'DEMO' })).toBe(false)
        })
    })

    // ── getActiveEvent ─────────────────────────────────────────────
    describe('getActiveEvent', () => {
        test('returns the ACTIVE event row', () => {
            const uid = TEST_USER_BASE + 6
            const result = recordEvent({
                userId: uid, resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
                signals: {}, severity: 'MAJOR',
                triggers: ['volatility_spike', 'price_gap'], actor: 'test'
            })
            const event = getActiveEvent({ userId: uid, resolvedEnv: 'DEMO' })
            expect(event).not.toBeNull()
            expect(event.id).toBe(result.eventId)
        })

        test('returns null when no active event', () => {
            expect(getActiveEvent({ userId: 999999651, resolvedEnv: 'DEMO' })).toBeNull()
        })
    })

    // ── clearAbstention ────────────────────────────────────────────
    describe('clearAbstention', () => {
        test('MINOR/MAJOR can be cleared by anyone', () => {
            const uid = TEST_USER_BASE + 7
            const result = recordEvent({
                userId: uid, resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
                signals: {}, severity: 'MAJOR',
                triggers: ['volatility_spike', 'price_gap'], actor: 'test'
            })
            clearAbstention({
                eventId: result.eventId,
                actor: 'auto_cooldown_clear',
                reason: 'cooldown expired'
            })
            const row = db.prepare(`SELECT * FROM ml_black_swan_events WHERE id = ?`).get(result.eventId)
            expect(row.abstention_state).toBe('CLEARED')
            expect(row.cleared_by).toBe('auto_cooldown_clear')
        })

        test('CRITICAL requires operator actor (not auto)', () => {
            const uid = TEST_USER_BASE + 8
            const result = recordEvent({
                userId: uid, resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
                signals: {}, severity: 'CRITICAL',
                triggers: ['volatility_spike', 'price_gap', 'liquidity_drop'], actor: 'test'
            })
            expect(() => clearAbstention({
                eventId: result.eventId,
                actor: 'auto_cooldown_clear',
                reason: 'try auto'
            })).toThrow(/operator|manual|CRITICAL/i)
        })

        test('CRITICAL clears when actor starts with operator', () => {
            const uid = TEST_USER_BASE + 9
            const result = recordEvent({
                userId: uid, resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
                signals: {}, severity: 'CRITICAL',
                triggers: ['volatility_spike', 'price_gap', 'liquidity_drop'], actor: 'test'
            })
            clearAbstention({
                eventId: result.eventId,
                actor: 'operator_manual',
                reason: 'operator clearance'
            })
            const row = db.prepare(`SELECT * FROM ml_black_swan_events WHERE id = ?`).get(result.eventId)
            expect(row.abstention_state).toBe('CLEARED')
        })

        test('throws if event not found', () => {
            expect(() => clearAbstention({
                eventId: 999999652, actor: 'op', reason: 'r'
            })).toThrow(/not found/i)
        })

        test('throws if already cleared', () => {
            const uid = TEST_USER_BASE + 10
            const result = recordEvent({
                userId: uid, resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
                signals: {}, severity: 'MAJOR',
                triggers: ['volatility_spike', 'price_gap'], actor: 'test'
            })
            clearAbstention({
                eventId: result.eventId, actor: 'op1', reason: 'first'
            })
            expect(() => clearAbstention({
                eventId: result.eventId, actor: 'op2', reason: 'second'
            })).toThrow(/already|state/i)
        })
    })
})

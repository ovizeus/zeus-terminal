'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p29-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const cb = require('../../../server/services/ml/R3A_safety/circuitBreaker');

const TEST_USER = 9929;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_circuit_state WHERE user_id = ?').run(TEST_USER);
    db.prepare('DELETE FROM ml_circuit_history WHERE user_id = ?').run(TEST_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§29 Migration 058_ml_circuit_state', () => {
    test('table ml_circuit_state exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_circuit_state'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('table ml_circuit_history exists', () => {
        const row = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='ml_circuit_history'`
        ).get();
        expect(row).toBeTruthy();
    });

    test('ml_circuit_state has expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_circuit_state)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'id', 'user_id', 'resolved_env', 'level', 'reason', 'actor',
            'probation_active', 'probation_trades_remaining',
            'manual_required', 'since', 'updated_at'
        ]));
    });

    test('ml_circuit_state CHECK level restricts to L0-L5', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_circuit_state
             (user_id, resolved_env, level, reason, actor, since, updated_at)
             VALUES (?, ?, 'L9', 'test', 'test', ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now())).toThrow();
    });

    test('ml_circuit_state UNIQUE per (user_id, resolved_env)', () => {
        db.prepare(
            `INSERT INTO ml_circuit_state
             (user_id, resolved_env, level, reason, actor, since, updated_at)
             VALUES (?, ?, 'L0', 'normal', 'system', ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now());
        expect(() => db.prepare(
            `INSERT INTO ml_circuit_state
             (user_id, resolved_env, level, reason, actor, since, updated_at)
             VALUES (?, ?, 'L1', 'dup', 'system', ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now())).toThrow();
        db.prepare(`DELETE FROM ml_circuit_state WHERE user_id = ?`).run(TEST_USER);
    });
});

describe('§29 Exported constants', () => {
    test('BREAKER_LEVELS has 6 entries (L0 normal + 5 escalation)', () => {
        expect(cb.BREAKER_LEVELS).toEqual([
            'L0',  // normal
            'L1',  // reduce size
            'L2',  // stop new entries
            'L3',  // management/exits only
            'L4',  // full stop
            'L5'   // flatten
        ]);
    });

    test('BREAKER_LEVEL_LABELS describes each level', () => {
        expect(cb.BREAKER_LEVEL_LABELS.L1).toMatch(/reduce/i);
        expect(cb.BREAKER_LEVEL_LABELS.L2).toMatch(/no new entries|stop new/i);
        expect(cb.BREAKER_LEVEL_LABELS.L3).toMatch(/management|exits/i);
        expect(cb.BREAKER_LEVEL_LABELS.L4).toMatch(/full stop|stop/i);
        expect(cb.BREAKER_LEVEL_LABELS.L5).toMatch(/flatten/i);
    });

    test('DEGRADATION_FEEDS has 5 entries', () => {
        expect(cb.DEGRADATION_FEEDS).toEqual(expect.arrayContaining([
            'order_book', 'open_interest', 'venue_comparison',
            'options_context', 'sentiment_feed'
        ]));
        expect(cb.DEGRADATION_FEEDS).toHaveLength(5);
    });

    test('CAPABILITY_KEYS lists all capabilities that can be disabled', () => {
        expect(cb.CAPABILITY_KEYS).toEqual(expect.arrayContaining([
            'derivatives_weighting', 'cross_venue_compare',
            'options_setup', 'sentiment_filter', 'orderbook_microstructure'
        ]));
    });
});

describe('§29 getBreakerState — default state', () => {
    test('returns L0 + no probation when no state exists', () => {
        const r = cb.getBreakerState({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        expect(r.level).toBe('L0');
        expect(r.probationActive).toBe(false);
    });
});

describe('§29 setBreakerLevel — escalation', () => {
    test('setBreakerLevel L1 → state stored', () => {
        cb.setBreakerLevel({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            level: 'L1', reason: 'dd_warning', actor: 'system'
        });
        const r = cb.getBreakerState({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        expect(r.level).toBe('L1');
        expect(r.reason).toBe('dd_warning');
    });

    test('setBreakerLevel L4 → state escalated', () => {
        cb.setBreakerLevel({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            level: 'L1', reason: 'init', actor: 'system'
        });
        cb.setBreakerLevel({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            level: 'L4', reason: 'incident', actor: 'system'
        });
        const r = cb.getBreakerState({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        expect(r.level).toBe('L4');
    });

    test('setBreakerLevel records history row', () => {
        cb.setBreakerLevel({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            level: 'L2', reason: 'feed_stale', actor: 'system'
        });
        const history = db.prepare(
            `SELECT * FROM ml_circuit_history WHERE user_id = ?`
        ).all(TEST_USER);
        expect(history).toHaveLength(1);
        expect(history[0].new_level).toBe('L2');
    });

    test('rejects invalid level', () => {
        expect(() => cb.setBreakerLevel({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            level: 'L9', reason: 'test', actor: 'test'
        })).toThrow(/level/);
    });

    test('throws on missing reason', () => {
        expect(() => cb.setBreakerLevel({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            level: 'L1', actor: 'system'
        })).toThrow(/reason/);
    });
});

describe('§29 evaluateGracefulDegradation', () => {
    test('no missing feeds → no disabled capabilities', () => {
        const r = cb.evaluateGracefulDegradation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            missingFeeds: []
        });
        expect(r.disabledCapabilities).toEqual([]);
    });

    test('missing OI → derivatives_weighting disabled', () => {
        const r = cb.evaluateGracefulDegradation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            missingFeeds: ['open_interest']
        });
        expect(r.disabledCapabilities).toContain('derivatives_weighting');
    });

    test('missing venue_comparison → reduce confidence flag', () => {
        const r = cb.evaluateGracefulDegradation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            missingFeeds: ['venue_comparison']
        });
        expect(r.disabledCapabilities).toContain('cross_venue_compare');
        expect(r.confidenceReduction).toBeGreaterThan(0);
    });

    test('missing order_book → orderbook_microstructure disabled', () => {
        const r = cb.evaluateGracefulDegradation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            missingFeeds: ['order_book']
        });
        expect(r.disabledCapabilities).toContain('orderbook_microstructure');
    });

    test('missing options → options_setup disabled', () => {
        const r = cb.evaluateGracefulDegradation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            missingFeeds: ['options_context']
        });
        expect(r.disabledCapabilities).toContain('options_setup');
    });

    test('multiple missing feeds compound disabled set', () => {
        const r = cb.evaluateGracefulDegradation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            missingFeeds: ['order_book', 'open_interest']
        });
        expect(r.disabledCapabilities.length).toBeGreaterThan(1);
    });

    test('unknown feed key ignored (forward-compat)', () => {
        const r = cb.evaluateGracefulDegradation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            missingFeeds: ['bogus_feed']
        });
        expect(r.disabledCapabilities).toEqual([]);
    });
});

describe('§29 enterProbation', () => {
    test('records probation state', () => {
        cb.setBreakerLevel({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            level: 'L0', reason: 'reset', actor: 'system'
        });
        cb.enterProbation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            probationTrades: 5, manualRequired: false, reason: 'post_dd_recovery'
        });
        const s = cb.getBreakerState({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        expect(s.probationActive).toBe(true);
        expect(s.probationTradesRemaining).toBe(5);
        expect(s.manualRequired).toBe(false);
    });

    test('severe incident sets manual_required=true', () => {
        cb.setBreakerLevel({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            level: 'L0', reason: 'reset', actor: 'system'
        });
        cb.enterProbation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            probationTrades: 10, manualRequired: true, reason: 'severe_incident'
        });
        const s = cb.getBreakerState({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        expect(s.manualRequired).toBe(true);
    });
});

describe('§29 attemptAutoResume', () => {
    test('refuses when manual_required=true', () => {
        cb.setBreakerLevel({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            level: 'L4', reason: 'test', actor: 'system'
        });
        cb.enterProbation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            probationTrades: 5, manualRequired: true, reason: 'severe'
        });
        const r = cb.attemptAutoResume({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            healthChecks: { all_pass: true }
        });
        expect(r.resumed).toBe(false);
        expect(r.blockers).toContain('manual_required');
    });

    test('refuses when health checks fail', () => {
        cb.setBreakerLevel({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            level: 'L4', reason: 'test', actor: 'system'
        });
        cb.enterProbation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            probationTrades: 5, manualRequired: false, reason: 'auto_check'
        });
        const r = cb.attemptAutoResume({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            healthChecks: { feed_healthy: false, recon_clean: true }
        });
        expect(r.resumed).toBe(false);
        expect(r.blockers).toContain('feed_healthy');
    });

    test('refuses while probation_trades_remaining > 0', () => {
        cb.setBreakerLevel({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            level: 'L1', reason: 'test', actor: 'system'
        });
        cb.enterProbation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            probationTrades: 3, manualRequired: false, reason: 'probation'
        });
        const r = cb.attemptAutoResume({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            healthChecks: { all_pass: true }
        });
        expect(r.resumed).toBe(false);
        expect(r.blockers).toContain('probation_trades');
    });

    test('resumes when all conditions met', () => {
        cb.setBreakerLevel({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            level: 'L1', reason: 'test', actor: 'system'
        });
        cb.enterProbation({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            probationTrades: 0, manualRequired: false, reason: 'done'
        });
        const r = cb.attemptAutoResume({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            healthChecks: { feed_healthy: true, recon_clean: true }
        });
        expect(r.resumed).toBe(true);
        const s = cb.getBreakerState({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        expect(s.level).toBe('L0');
        expect(s.probationActive).toBe(false);
    });
});

describe('§29 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9930;
        cb.setBreakerLevel({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            level: 'L4', reason: 'incident', actor: 'system'
        });
        const r1 = cb.getBreakerState({ userId: TEST_USER, resolvedEnv: TEST_ENV });
        const r2 = cb.getBreakerState({ userId: OTHER_USER, resolvedEnv: TEST_ENV });
        expect(r1.level).toBe('L4');
        expect(r2.level).toBe('L0');
    });
});

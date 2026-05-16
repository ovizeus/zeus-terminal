'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p79-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const os_ = require('../../../server/services/ml/R3A_safety/opportunityScheduler');

const TEST_USER = 9079;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_opportunity_candidates WHERE user_id IN (?, ?)').run(TEST_USER, 9080);
    db.prepare('DELETE FROM ml_capital_auction_decisions WHERE user_id IN (?, ?)').run(TEST_USER, 9080);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§79 Migrations 148 + 149', () => {
    test('UNIQUE opportunity_id', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_opportunity_candidates
             (user_id, resolved_env, opportunity_id, symbol,
              opportunity_score, capital_required, margin_required,
              classification, status, submitted_at)
             VALUES (?, ?, 'O-UNIQ', 'BTC', 0.5, 100, 10, 'best_trade_available', 'PENDING', ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_opportunity_candidates
             (user_id, resolved_env, opportunity_id, symbol,
              opportunity_score, capital_required, margin_required,
              classification, status, submitted_at)
             VALUES (?, ?, 'O-UNIQ', 'BTC', 0.6, 100, 10, 'best_trade_available', 'PENDING', ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK classification restricts', () => {
        const ts = Date.now();
        expect(() => db.prepare(
            `INSERT INTO ml_opportunity_candidates
             (user_id, resolved_env, opportunity_id, symbol,
              opportunity_score, capital_required, margin_required,
              classification, status, submitted_at)
             VALUES (?, ?, 'O-BAD', 'BTC', 0.5, 100, 10, 'BOGUS', 'PENDING', ?)`
        ).run(TEST_USER, TEST_ENV, ts)).toThrow();
    });

    test('CHECK status restricts', () => {
        const ts = Date.now();
        expect(() => db.prepare(
            `INSERT INTO ml_opportunity_candidates
             (user_id, resolved_env, opportunity_id, symbol,
              opportunity_score, capital_required, margin_required,
              classification, status, submitted_at)
             VALUES (?, ?, 'O-BAD2', 'BTC', 0.5, 100, 10, 'best_trade_available', 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, ts)).toThrow();
    });
});

describe('§79 Constants', () => {
    test('OPPORTUNITY_CLASSIFICATIONS has 4 entries', () => {
        expect(os_.OPPORTUNITY_CLASSIFICATIONS).toEqual([
            'best_trade_available', 'good_but_inferior',
            'valid_but_crowded', 'valid_but_execution_poor'
        ]);
    });

    test('OPPORTUNITY_STATUSES has 5 entries', () => {
        expect(os_.OPPORTUNITY_STATUSES).toEqual([
            'PENDING', 'ACCEPTED', 'DEFERRED', 'REPLACED', 'REJECTED'
        ]);
    });

    test('REPLACEMENT_RATIO > 1', () => {
        expect(os_.REPLACEMENT_RATIO).toBeGreaterThan(1);
    });
});

describe('§79 evaluateOpportunityScore (pure)', () => {
    test('costs reduce net score', () => {
        const r = os_.evaluateOpportunityScore({
            rawScore: 0.8, costsBps: 1000  // 10%
        });
        expect(r.netScore).toBeCloseTo(0.7);
    });

    test('correlation penalty reduces', () => {
        const r = os_.evaluateOpportunityScore({
            rawScore: 0.8, correlationPenalty: 0.2
        });
        expect(r.netScore).toBeCloseTo(0.6);
    });

    test('clamps to 0', () => {
        const r = os_.evaluateOpportunityScore({
            rawScore: 0.1, costsBps: 5000  // 50%
        });
        expect(r.netScore).toBe(0);
    });
});

describe('§79 classifyOpportunity (pure)', () => {
    test('high exec + low crowding + no superior → best_trade_available', () => {
        const r = os_.classifyOpportunity({
            score: 0.7, executionQuality: 0.9, crowdingScore: 0.1,
            hasSuperiorAlternative: false
        });
        expect(r).toBe('best_trade_available');
    });

    test('high crowding → valid_but_crowded', () => {
        const r = os_.classifyOpportunity({
            score: 0.7, executionQuality: 0.9, crowdingScore: 0.7,
            hasSuperiorAlternative: false
        });
        expect(r).toBe('valid_but_crowded');
    });

    test('low execution → valid_but_execution_poor', () => {
        const r = os_.classifyOpportunity({
            score: 0.7, executionQuality: 0.4
        });
        expect(r).toBe('valid_but_execution_poor');
    });

    test('superior alternative → good_but_inferior', () => {
        const r = os_.classifyOpportunity({
            score: 0.7, executionQuality: 0.9, crowdingScore: 0.1,
            hasSuperiorAlternative: true
        });
        expect(r).toBe('good_but_inferior');
    });
});

describe('§79 submitOpportunity', () => {
    test('persists', () => {
        const r = os_.submitOpportunity({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            opportunityId: 'O-001', symbol: 'BTC',
            opportunityScore: 0.75,
            capitalRequired: 1000, marginRequired: 100,
            classification: 'best_trade_available'
        });
        expect(r.submitted).toBe(true);
    });

    test('duplicate id throws', () => {
        os_.submitOpportunity({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            opportunityId: 'O-DUP', symbol: 'BTC',
            opportunityScore: 0.5,
            capitalRequired: 100, marginRequired: 10,
            classification: 'best_trade_available'
        });
        expect(() => os_.submitOpportunity({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            opportunityId: 'O-DUP', symbol: 'BTC',
            opportunityScore: 0.5,
            capitalRequired: 100, marginRequired: 10,
            classification: 'best_trade_available'
        })).toThrow();
    });

    test('invalid classification throws', () => {
        expect(() => os_.submitOpportunity({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            opportunityId: 'O-BAD', symbol: 'BTC',
            opportunityScore: 0.5,
            capitalRequired: 100, marginRequired: 10,
            classification: 'BOGUS'
        })).toThrow();
    });
});

describe('§79 runCapitalAuction', () => {
    test('greedy ordering by score DESC', () => {
        os_.submitOpportunity({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            opportunityId: 'A-LOW', symbol: 'BTC',
            opportunityScore: 0.4,
            capitalRequired: 500, marginRequired: 50,
            classification: 'good_but_inferior'
        });
        os_.submitOpportunity({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            opportunityId: 'A-HIGH', symbol: 'ETH',
            opportunityScore: 0.9,
            capitalRequired: 500, marginRequired: 50,
            classification: 'best_trade_available'
        });
        const r = os_.runCapitalAuction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            opportunityIds: ['A-LOW', 'A-HIGH'],
            availableCapital: 600, availableMargin: 100
        });
        // High-score gets first pick, low gets deferred (not enough capital left)
        expect(r.accepted).toContain('A-HIGH');
        expect(r.deferred).toContain('A-LOW');
    });

    test('respects capital cap', () => {
        os_.submitOpportunity({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            opportunityId: 'B-1', symbol: 'BTC',
            opportunityScore: 0.7,
            capitalRequired: 5000, marginRequired: 100,
            classification: 'best_trade_available'
        });
        const r = os_.runCapitalAuction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            opportunityIds: ['B-1'],
            availableCapital: 1000, availableMargin: 1000
        });
        expect(r.deferred).toContain('B-1');
        expect(r.capitalUsed).toBe(0);
    });

    test('rejects below MIN_ACCEPTANCE_SCORE', () => {
        os_.submitOpportunity({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            opportunityId: 'C-WEAK', symbol: 'BTC',
            opportunityScore: 0.1,  // below 0.30 threshold
            capitalRequired: 100, marginRequired: 10,
            classification: 'good_but_inferior'
        });
        const r = os_.runCapitalAuction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            opportunityIds: ['C-WEAK'],
            availableCapital: 10000, availableMargin: 1000
        });
        expect(r.rejected).toContain('C-WEAK');
    });

    test('updates statuses persistently', () => {
        os_.submitOpportunity({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            opportunityId: 'D-1', symbol: 'BTC',
            opportunityScore: 0.7,
            capitalRequired: 100, marginRequired: 10,
            classification: 'best_trade_available'
        });
        os_.runCapitalAuction({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            opportunityIds: ['D-1'],
            availableCapital: 1000, availableMargin: 100
        });
        const status = os_.getOpportunityStatus({ opportunityId: 'D-1' });
        expect(status.status).toBe('ACCEPTED');
    });
});

describe('§79 recordAuctionDecision', () => {
    test('persists', () => {
        os_.recordAuctionDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auctionId: 'AU-001',
            candidates: ['A', 'B'],
            accepted: ['A'], deferred: ['B'], rejected: [],
            totalCapitalAvailable: 1000, totalCapitalUsed: 500,
            reasoning: 'high score wins'
        });
        const h = os_.getAuctionHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(h).toHaveLength(1);
    });

    test('UNIQUE auction_id throws', () => {
        os_.recordAuctionDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auctionId: 'AU-DUP', candidates: [],
            accepted: [], deferred: [], rejected: [],
            totalCapitalAvailable: 0, totalCapitalUsed: 0
        });
        expect(() => os_.recordAuctionDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auctionId: 'AU-DUP', candidates: [],
            accepted: [], deferred: [], rejected: [],
            totalCapitalAvailable: 0, totalCapitalUsed: 0
        })).toThrow();
    });
});

describe('§79 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9080;
        os_.submitOpportunity({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            opportunityId: 'O-ISO', symbol: 'BTC',
            opportunityScore: 0.5,
            capitalRequired: 100, marginRequired: 10,
            classification: 'best_trade_available'
        });
        os_.recordAuctionDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            auctionId: 'AU-ISO', candidates: ['O-ISO'],
            accepted: ['O-ISO'], deferred: [], rejected: [],
            totalCapitalAvailable: 1000, totalCapitalUsed: 100
        });
        const h1 = os_.getAuctionHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const h2 = os_.getAuctionHistory({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(h1.length).toBe(1);
        expect(h2.length).toBe(0);
    });
});

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p108-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const pc = require('../../../server/services/ml/R4_execution/progressiveCommitment');

const TEST_USER = 9108;
const OTHER_USER = 9109;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_commitment_setups WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_commitment_tranches WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§108 Migrations 205 + 206', () => {
    test('setup_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_commitment_setups
             (user_id, resolved_env, setup_id, target_total_size,
              current_filled_size, status, thesis_id,
              ts_created, ts_last_updated)
             VALUES (?, ?, 'PC-UNIQ', 100, 0, 'probing', NULL, ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_commitment_setups
             (user_id, resolved_env, setup_id, target_total_size,
              current_filled_size, status, thesis_id,
              ts_created, ts_last_updated)
             VALUES (?, ?, 'PC-UNIQ', 50, 0, 'probing', NULL, ?, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1, ts + 1)).toThrow();
    });

    test('CHECK status restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_commitment_setups
             (user_id, resolved_env, setup_id, target_total_size,
              current_filled_size, status, thesis_id,
              ts_created, ts_last_updated)
             VALUES (?, ?, 'PC-BAD', 100, 0, 'BOGUS', NULL, ?, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now(), Date.now())).toThrow();
    });

    test('CHECK tranche kind restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_commitment_tranches
             (user_id, resolved_env, tranche_id, setup_id, kind,
              size, market_response_score, decision_after, ts)
             VALUES (?, ?, 'CT-BAD', 'S', 'BOGUS', 10, NULL, NULL, ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK decision_after nullable+restricted', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_commitment_tranches
             (user_id, resolved_env, tranche_id, setup_id, kind,
              size, market_response_score, decision_after, ts)
             VALUES (?, ?, 'CT-DBAD', 'S', 'exploratory', 10, 0.5, 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§108 Constants', () => {
    test('SETUP_STATUSES has 5 entries', () => {
        expect(pc.SETUP_STATUSES).toEqual([
            'probing', 'confirming', 'full', 'aborted', 'completed'
        ]);
    });

    test('TRANCHE_KINDS has 4 entries', () => {
        expect(pc.TRANCHE_KINDS).toEqual([
            'exploratory', 'conviction', 'confirmation_add', 'defensive_reduce'
        ]);
    });

    test('expansion > abort thresholds', () => {
        expect(pc.DEFAULT_EXPANSION_THRESHOLD)
            .toBeGreaterThan(pc.DEFAULT_ABORT_THRESHOLD);
    });
});

describe('§108 evaluateExpansionDecision (pure)', () => {
    test('high response → expand', () => {
        const r = pc.evaluateExpansionDecision({
            marketResponseScore: 0.80, currentFilledRatio: 0.20
        });
        expect(r.decision).toBe('expand');
    });

    test('low response → abort', () => {
        const r = pc.evaluateExpansionDecision({
            marketResponseScore: 0.15, currentFilledRatio: 0.30
        });
        expect(r.decision).toBe('abort');
    });

    test('mid response → hold', () => {
        const r = pc.evaluateExpansionDecision({
            marketResponseScore: 0.45, currentFilledRatio: 0.30
        });
        expect(r.decision).toBe('hold');
    });

    test('full fill ratio → hold even if high response', () => {
        const r = pc.evaluateExpansionDecision({
            marketResponseScore: 0.90, currentFilledRatio: 1.0
        });
        expect(r.decision).toBe('hold');
    });
});

describe('§108 registerCommitmentSetup', () => {
    test('persists with probing status', () => {
        const r = pc.registerCommitmentSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'RC-1', targetTotalSize: 100, thesisId: 'thesis-X'
        });
        expect(r.registered).toBe(true);
        expect(r.status).toBe('probing');
    });

    test('duplicate throws', () => {
        pc.registerCommitmentSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'RC-DUP', targetTotalSize: 50
        });
        expect(() => pc.registerCommitmentSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'RC-DUP', targetTotalSize: 100
        })).toThrow();
    });

    test('invalid initialStatus throws', () => {
        expect(() => pc.registerCommitmentSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'RC-BAD', targetTotalSize: 50,
            initialStatus: 'BOGUS'
        })).toThrow();
    });
});

describe('§108 addTranche', () => {
    test('probing → confirming after exploratory tranche', () => {
        pc.registerCommitmentSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'AT-1', targetTotalSize: 100
        });
        const r = pc.addTranche({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            trancheId: 'AT-T1', setupId: 'AT-1',
            kind: 'exploratory', size: 40,
            marketResponseScore: 0.7
        });
        expect(r.newFilledSize).toBe(40);
        expect(r.newStatus).toBe('confirming');
    });

    test('full status when filled >= target', () => {
        pc.registerCommitmentSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'AT-F', targetTotalSize: 100
        });
        pc.addTranche({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            trancheId: 'AT-FT1', setupId: 'AT-F',
            kind: 'conviction', size: 100
        });
        const setup = pc.getActiveCommitments({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        }).find(s => s.setupId === 'AT-F');
        expect(setup.status).toBe('full');
    });

    test('defensive_reduce decreases filled size', () => {
        pc.registerCommitmentSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'AT-DR', targetTotalSize: 100
        });
        pc.addTranche({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            trancheId: 'AT-DR-1', setupId: 'AT-DR',
            kind: 'conviction', size: 60
        });
        const r = pc.addTranche({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            trancheId: 'AT-DR-2', setupId: 'AT-DR',
            kind: 'defensive_reduce', size: 30
        });
        expect(r.newFilledSize).toBe(30);
    });

    test('rejects tranche on aborted setup', () => {
        pc.registerCommitmentSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'AT-AB', targetTotalSize: 100
        });
        pc.abortSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'AT-AB'
        });
        expect(() => pc.addTranche({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            trancheId: 'AT-AB-T', setupId: 'AT-AB',
            kind: 'exploratory', size: 10
        })).toThrow();
    });
});

describe('§108 recordTrancheDecision', () => {
    test('logs decision_after', () => {
        pc.registerCommitmentSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'RD-1', targetTotalSize: 100
        });
        pc.addTranche({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            trancheId: 'RD-T1', setupId: 'RD-1',
            kind: 'exploratory', size: 20
        });
        const r = pc.recordTrancheDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            trancheId: 'RD-T1', decision: 'expand'
        });
        expect(r.recorded).toBe(true);
    });

    test('invalid decision throws', () => {
        expect(() => pc.recordTrancheDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            trancheId: 'NOEXIST', decision: 'BOGUS'
        })).toThrow();
    });
});

describe('§108 abortSetup', () => {
    test('marks aborted', () => {
        pc.registerCommitmentSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'AB-1', targetTotalSize: 100
        });
        const r = pc.abortSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'AB-1', reason: 'thesis_invalidated'
        });
        expect(r.aborted).toBe(true);
        expect(r.previousStatus).toBe('probing');
    });
});

describe('§108 getActiveCommitments', () => {
    test('filter by status', () => {
        pc.registerCommitmentSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'GA-P1', targetTotalSize: 100
        });
        pc.registerCommitmentSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'GA-P2', targetTotalSize: 100
        });
        pc.abortSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV, setupId: 'GA-P2'
        });
        const r = pc.getActiveCommitments({
            userId: TEST_USER, resolvedEnv: TEST_ENV, status: 'probing'
        });
        expect(r).toHaveLength(1);
        expect(r[0].setupId).toBe('GA-P1');
    });
});

describe('§108 isolation', () => {
    test('per (user × env) isolation', () => {
        pc.registerCommitmentSetup({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            setupId: 'ISO-1', targetTotalSize: 100
        });
        const a = pc.getActiveCommitments({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const b = pc.getActiveCommitments({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});

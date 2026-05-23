'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r5-ia-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const ia = require('../../../server/services/ml/_ring5/influenceAudit');

const _phase2 = (over = {}) => ({ dir: 'LONG', confidence: 70, score: 5, reasons: ['t1'], ts: 100, ...over });
const _proposed = (over = {}) => ({ dir: 'LONG', confidence: 82, score: 5, reasons: ['t1', 'ring5_boost'], ts: 100, ...over });

function clean() { db.prepare("DELETE FROM ml_influence_audit").run(); }

describe('influenceAudit.record', () => {
    beforeEach(clean);

    test('accepted attempt persists row with status=accepted', () => {
        const r = ia.record({
            userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending',
            phase2Decision: _phase2(), proposedDecision: _proposed(),
            gateStatus: 'accepted', gateReason: 'reflection_passed',
            rationale: 'positive_boost: bandit=0.85 sumC=0.20',
            ts: Date.now()
        });
        expect(r.recorded).toBe(true);
        expect(r.id).toBeGreaterThan(0);

        const row = db.prepare("SELECT * FROM ml_influence_audit WHERE id=?").get(r.id);
        expect(row.user_id).toBe(1);
        expect(row.env).toBe('DEMO');
        expect(row.gate_status).toBe('accepted');
        expect(row.phase2_confidence).toBe(70);
        expect(row.proposed_confidence).toBe(82);
    });

    test('rejected attempt records concerns in rationale_json', () => {
        const r = ia.record({
            userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'ranging',
            phase2Decision: _phase2(), proposedDecision: _proposed(),
            gateStatus: 'rejected', gateReason: 'reflection_blocked',
            rationale: { proposal: 'boost', concerns: [{ type: 'learned_rule' }] },
            ts: Date.now()
        });
        const row = db.prepare("SELECT * FROM ml_influence_audit WHERE id=?").get(r.id);
        expect(row.gate_status).toBe('rejected');
        const parsed = JSON.parse(row.rationale_json);
        expect(parsed.concerns[0].type).toBe('learned_rule');
    });

    test('skipped attempt (no proposal) persists with status=skipped', () => {
        const r = ia.record({
            userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending',
            phase2Decision: _phase2(),
            proposedDecision: _phase2(),
            gateStatus: 'skipped', gateReason: 'neutral_signal',
            rationale: 'no_proposal: bandit=0.50 sumC=0.0',
            ts: Date.now()
        });
        const row = db.prepare("SELECT * FROM ml_influence_audit WHERE id=?").get(r.id);
        expect(row.gate_status).toBe('skipped');
    });

    test('serializes object rationale as JSON', () => {
        const obj = { foo: 'bar', nested: { x: 1 } };
        const r = ia.record({
            userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending',
            phase2Decision: _phase2(), proposedDecision: _proposed(),
            gateStatus: 'accepted', gateReason: 'ok', rationale: obj, ts: Date.now()
        });
        const row = db.prepare("SELECT rationale_json FROM ml_influence_audit WHERE id=?").get(r.id);
        expect(JSON.parse(row.rationale_json)).toEqual(obj);
    });

    test('preserves string rationale as-is (wrapped in JSON object)', () => {
        const r = ia.record({
            userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending',
            phase2Decision: _phase2(), proposedDecision: _proposed(),
            gateStatus: 'accepted', gateReason: 'ok', rationale: 'plain text', ts: Date.now()
        });
        const row = db.prepare("SELECT rationale_json FROM ml_influence_audit WHERE id=?").get(r.id);
        expect(JSON.parse(row.rationale_json)).toEqual({ text: 'plain text' });
    });
});

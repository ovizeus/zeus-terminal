'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r5-ip-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

require('../../../server/services/database');
const ip = require('../../../server/services/ml/_ring5/influenceProposer');

const _phase2 = (over = {}) => ({
    dir: 'LONG', confidence: 70, score: 5, reasons: ['t1'], ts: Date.now(), ...over
});
const _mlInputs = (sum = 0.15, n = 3) => ({
    contributions: Array.from({ length: n }, (_, i) => ({ moduleId: `m${i}`, contribution: sum / n }))
});

describe('influenceProposer.propose', () => {
    test('no proposal when banditSample neutral and ML neutral', () => {
        const r = ip.propose({
            phase2Decision: _phase2(), banditSample: 0.50, mlBrainProInputs: _mlInputs(0, 1)
        });
        expect(r.hasProposal).toBe(false);
        expect(r.rationale).toMatch(/neutral|insufficient/i);
    });

    test('proposes confidence boost when bandit and ML both strongly positive same dir', () => {
        const r = ip.propose({
            phase2Decision: _phase2({ confidence: 70, dir: 'LONG' }),
            banditSample: 0.80, mlBrainProInputs: _mlInputs(0.20, 4)
        });
        expect(r.hasProposal).toBe(true);
        expect(r.proposedDecision.dir).toBe('LONG');
        expect(r.proposedDecision.confidence).toBeGreaterThan(70);
        expect(r.proposedDecision.confidence).toBeLessThanOrEqual(100);
        expect(r.rationale).toMatch(/boost|positive/i);
    });

    test('proposes confidence cut when bandit and ML both negative same dir', () => {
        const r = ip.propose({
            phase2Decision: _phase2({ confidence: 70, dir: 'LONG' }),
            banditSample: 0.20, mlBrainProInputs: _mlInputs(-0.20, 4)
        });
        expect(r.hasProposal).toBe(true);
        expect(r.proposedDecision.dir).toBe('LONG');
        expect(r.proposedDecision.confidence).toBeLessThan(70);
        expect(r.proposedDecision.confidence).toBeGreaterThanOrEqual(0);
        expect(r.rationale).toMatch(/cut|negative/i);
    });

    test('NEVER flips dir in Phase 4', () => {
        const r = ip.propose({
            phase2Decision: _phase2({ dir: 'LONG' }),
            banditSample: 0.10, mlBrainProInputs: _mlInputs(-0.40, 4)
        });
        if (r.hasProposal) expect(r.proposedDecision.dir).toBe('LONG');
    });

    test('clamps confidence to [0, 100]', () => {
        const r1 = ip.propose({
            phase2Decision: _phase2({ confidence: 95 }),
            banditSample: 0.99, mlBrainProInputs: _mlInputs(0.50, 4)
        });
        if (r1.hasProposal) expect(r1.proposedDecision.confidence).toBeLessThanOrEqual(100);

        const r2 = ip.propose({
            phase2Decision: _phase2({ confidence: 5 }),
            banditSample: 0.01, mlBrainProInputs: _mlInputs(-0.50, 4)
        });
        if (r2.hasProposal) expect(r2.proposedDecision.confidence).toBeGreaterThanOrEqual(0);
    });

    test('score field preserved (not modified by Phase 4 proposer)', () => {
        const r = ip.propose({
            phase2Decision: _phase2({ score: 7.3 }),
            banditSample: 0.85, mlBrainProInputs: _mlInputs(0.30, 4)
        });
        if (r.hasProposal) expect(r.proposedDecision.score).toBe(7.3);
    });
});

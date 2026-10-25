'use strict';
// tests/unit/pending-blocked-is-recorded.test.js
//
// [G-8 2026-10-25] On the pending path, a refusal by the guard was recorded
// nowhere.
//
//     const entry = serverAT.processBrainDecision(...);
//     if (entry) {
//         ...
//         brainLogger.updateAction(_pendSnapId, 'pending_fill' | 'pending_momentum');
//     }
//     // there was no else
//
// processBrainDecision returns null on every refusal path. So when a pending
// triggered and autotrade said no, the decision row stayed 'pending_created'
// for ever. The direct path writes 'entry_blocked' for exactly that refusal
// (serverBrain.js:1655); the pending path wrote nothing at all.
//
// 33,677 rows were stuck that way — 43% of every pending ever created. What
// made it worth fixing is not the row count, it is that the pending funnel
// could not be computed at all: 451 fills against an unknown denominator.
//
// This is logging only. The decision, the sizing and the execution are
// untouched; the guard is still asked the same question and its answer is
// still obeyed. The only new thing is that the answer gets written down.

const fs = require('fs');
const path = require('path');

const SB_SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'server', 'services', 'serverBrain.js'), 'utf8');
const A = require('../../server/services/brainActions');

// The pending FILL/MOMENTUM block, cut from its own `if` to the end of the
// branch that follows it — not a character window, so the assertions cannot
// pass on a neighbouring block (the lesson from G-5).
function pendingBlock() {
    const start = SB_SRC.indexOf("if (pendingResult.action === 'FILL' || pendingResult.action === 'MOMENTUM')");
    expect(start).toBeGreaterThan(-1);
    const end = SB_SRC.indexOf("// [ML] Handle EXPIRE", start);
    expect(end).toBeGreaterThan(start);
    return SB_SRC.slice(start, end);
}

describe('G-8 — a refused pending entry is written down', () => {

    test('the block was found and still contains the fill path (non-vacuity)', () => {
        const b = pendingBlock();
        expect(b).toMatch(/processBrainDecision/);
        expect(b).toMatch(/pending_fill/);
        expect(b).toMatch(/pending_momentum/);
    });

    test('there is now an else — the refusal has a branch at all', () => {
        expect(pendingBlock()).toMatch(/\}\s*else\b/);
    });

    test('the refusal writes pending_blocked', () => {
        expect(pendingBlock()).toMatch(/updateAction\([^)]*'pending_blocked'\)/);
    });

    test('pending_blocked is classified as a block, so retention and the ML label follow', () => {
        // Nothing extra to wire: G-5 gives it the 90-day window and G-6 gives
        // it ABSTAIN_CRITIC, both from this one list.
        expect(A.BLOCKED_ACTIONS).toContain('pending_blocked');
        expect(A.isBlocked('pending_blocked')).toBe(true);
        expect(A.isHistory('pending_blocked')).toBe(false);
        expect(A.classify('pending_blocked')).toBe('blocked');
    });

    test('it is NOT in history — a refused entry never became a position (R-C-21)', () => {
        expect(A.HISTORY_ACTIONS).not.toContain('pending_blocked');
        expect(A.PENDING_TERMINAL_ACTIONS).not.toContain('pending_blocked');
    });

    test('the money path is untouched: the guard is still called once, and obeyed', () => {
        const b = pendingBlock();
        // exactly one call to the guard, and the branch still keys off its result
        expect(b.match(/serverAT\.processBrainDecision/g)).toHaveLength(1);
        expect(b).toMatch(/const entry = serverAT\.processBrainDecision/);
        expect(b).toMatch(/if \(entry\)/);
    });

    test('the new branch cannot throw into the AT cycle', () => {
        const b = pendingBlock();
        const i = b.indexOf("'pending_blocked'");
        expect(i).toBeGreaterThan(-1);
        // the write sits inside a try, like every other logging call here
        expect(b.slice(Math.max(0, i - 200), i)).toMatch(/try\s*\{/);
    });

    test('nothing is written when there is no snapshot to update', () => {
        const b = pendingBlock();
        const i = b.indexOf("'pending_blocked'");
        expect(b.slice(Math.max(0, i - 300), i)).toMatch(/_pendSnapId/);
    });

    test('the file was really read (guard against a vacuous pass)', () => {
        expect(SB_SRC.length).toBeGreaterThan(50000);
    });
});

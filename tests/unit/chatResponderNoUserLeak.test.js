'use strict';

/**
 * [2026-11-08] `const uid = userId || 1;`
 *
 * Found while auditing for hardcoded user-1 assumptions, after a day whose
 * central bug was a hand-written `userIds.add(1)`.
 *
 * This line sits in front of a query over `brain_decisions WHERE user_id = ?`,
 * whose result becomes OMEGA's description of how trading is going. Called
 * without a userId it does not decline — it reads USER 1's trading and reports
 * it as the asker's own. One account's results, narrated to another.
 *
 * The codebase already learned this lesson elsewhere, in serverAT:
 *   "[C5] Reject positions without userId — do NOT default to user 1
 *    (prevents cross-user leak)"
 *
 * A missing user id is not user 1. It is a missing user id.
 */
const path = require('path');
const fs = require('fs');

const SRC = path.join(__dirname, '../../server/services/ml/_voice/chatResponder.js');
const src = fs.readFileSync(SRC, 'utf8');

describe('OMEGA never narrates one account to another', () => {
    it('does not fall back to user 1 when the caller gave no user', () => {
        expect(src).not.toMatch(/const uid = userId \|\| 1/);
        expect(src).not.toMatch(/userId \|\| 1\b/);
    });

    it('the decisions query is still scoped to a user', () => {
        // the guard must not have been "fixed" by dropping the scoping
        expect(src).toMatch(/FROM brain_decisions[\s\S]{0,80}WHERE user_id = \?/);
    });

    it('declines rather than guesses when there is no user', () => {
        // whatever shape the fix takes, an absent id must short-circuit
        expect(src).toMatch(/if \(!userId\)|userId == null|!Number\.isFinite\(userId\)/);
    });
});

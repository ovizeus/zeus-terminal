'use strict';
// tests/unit/pending-lifecycle-retention.test.js
//
// [G-7 2026-10-25] The pending lifecycle had no retention rule at all, and
// measuring it changed what the right rule is.
//
// 77,692 rows were outside every tier: pending_expire 44,015 and
// pending_created 33,677, both with zero linked_seq. The obvious move was to
// put them with the blocked tier at 90 days. Two measurements say otherwise.
//
// (1) THE FUNNEL WOULD GO BIASED, NOT JUST SHORT. pending_fill and
//     pending_momentum are LINKED, so R-C-21 keeps them forever. Pruning the
//     denominator while keeping the numerator means anyone computing a
//     fill-rate over an old window sees only fills — 100%, confidently wrong.
//     A short window loses information; this would manufacture it. So the
//     terminal pending states get 365 days, the same tier as an unlinked
//     `entry`, which is also the better analogy: a pending that expired did
//     queue an attempt, unlike a decision blocked before it tried.
//
// (2) pending_created IS NOT TELEMETRY WITH AN UNKNOWN ENDING. Its ending is
//     known and simply never written down. On the pending path,
//     serverBrain.js:~1045 calls linkSeq + updateAction only INSIDE
//     `if (entry)`, so when autotrade refuses the triggered fill the row stays
//     'pending_created' for ever. The direct path writes 'entry_blocked' for
//     exactly that refusal; the pending path writes nothing.
//     Corroboration, not proof: acceptance is 1.0% on the direct path
//     (1,325 entry vs 128,744 entry_blocked) and 1.3% on the pending path
//     (451 fill vs 33,677 orphans), and the orphan share is a flat 33–52%
//     every month for six months — a per-decision cause, not restarts, which
//     would cluster (and are audited separately: only 136 rows).
//     So these rows are the ONLY trace of decisions nothing else recorded.
//     Deleting them on a timer would destroy evidence of a logging gap. They
//     stay unpruned until that gap is closed — that is G-8, and the operator's
//     call, because it touches serverBrain's inner loop.
//
// This file pins both halves, including the deliberate absence of a rule.

const fs = require('fs');
const os = require('os');
const path = require('path');

const DB_SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'server', 'services', 'database.js'), 'utf8');
const A = require('../../server/services/brainActions');

describe('G-7 — the terminal pending states are a named class', () => {

    test('the class exists and holds exactly the terminal non-trade states', () => {
        expect([...A.PENDING_TERMINAL_ACTIONS].sort()).toEqual(['pending_cancel', 'pending_expire']);
    });

    test('it is frozen, like the other classes', () => {
        // Object.isFrozen(undefined) is true, so this passed before the list
        // existed. Assert the shape first, then the freeze.
        expect(Array.isArray(A.PENDING_TERMINAL_ACTIONS)).toBe(true);
        expect(A.PENDING_TERMINAL_ACTIONS.length).toBeGreaterThan(0);
        expect(Object.isFrozen(A.PENDING_TERMINAL_ACTIONS)).toBe(true);
    });

    test('it is a SUBSET of telemetry — it refines a class, it does not add one', () => {
        for (const a of A.PENDING_TERMINAL_ACTIONS) {
            expect(A.TELEMETRY_ACTIONS).toContain(a);
            expect(A.classify(a)).toBe('telemetry');
        }
    });

    test('pending_created is NOT in it — its ending is unrecorded, not terminal', () => {
        expect(A.PENDING_TERMINAL_ACTIONS).not.toContain('pending_created');
    });

    test('nothing that can be linked is in it (R-C-21)', () => {
        for (const a of A.HISTORY_ACTIONS) {
            expect(A.PENDING_TERMINAL_ACTIONS).not.toContain(a);
        }
    });
});

describe('G-7 — the retention statement', () => {

    function stmtText(name) {
        const i = DB_SRC.indexOf(name + ':');
        expect(i).toBeGreaterThan(-1);
        const end = DB_SRC.indexOf('`),', i);
        expect(end).toBeGreaterThan(i);
        const text = DB_SRC.slice(i, end);
        expect(text).not.toMatch(/bdPruneTrade|bdPruneNoTrade|bdPruneBlocked/); // clean cut
        return text;
    }

    test('it reads the shared list, not a literal pair of names', () => {
        expect(stmtText('bdPrunePendingTerminal')).toMatch(/_BRAIN_ACTIONS\.PENDING_TERMINAL_ACTIONS/);
    });

    test('it keeps the linked_seq guard with the index hint (G-5)', () => {
        expect(stmtText('bdPrunePendingTerminal')).toMatch(/\+linked_seq IS NULL/);
    });

    test('it is batched, like every other tier', () => {
        expect(stmtText('bdPrunePendingTerminal')).toMatch(/LIMIT \?/);
    });
});

describe('G-7 — the log mentions the new tier', () => {
    const BL_SRC = fs.readFileSync(
        path.join(__dirname, '..', '..', 'server', 'services', 'brainLogger.js'), 'utf8');

    test('the prune log line reports pending_terminal too', () => {
        const i = BL_SRC.indexOf('brain_decisions prune');
        expect(i).toBeGreaterThan(-1);
        expect(BL_SRC.slice(i, i + 300)).toMatch(/pending_terminal=/);
    });

    test('a run that ONLY removed pending rows still logs', () => {
        // The guard was `if (r.no_trade || r.blocked || r.trade)`. Once the
        // older tiers are at steady state, a run that only touches the new
        // tier would have removed rows in silence.
        const i = BL_SRC.indexOf('db.bdPrune()');
        expect(i).toBeGreaterThan(-1);
        const block = BL_SRC.slice(i, i + 500);
        expect(block).toMatch(/r\.pending_terminal/);
    });
});

describe('G-7 — the rule behaves, on a real database', () => {
    const DAY = 86400000;
    let db, api;

    beforeAll(() => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-g7-'));
        process.env.ZEUS_DB_PATH = path.join(tmp, 'test.db');
        api = require('../../server/services/database');
        db = api.db;
    });

    afterEach(() => { db.exec('DELETE FROM brain_decisions;'); });

    function row(action, ageDays, linked = null, tier = 'SMALL') {
        api.bdInsert(`s_${action}_${ageDays}_${linked}_${Math.random()}`, 1, 'BTCUSDT',
            Date.now() - ageDays * DAY, 1, 'direct', tier, 60, 'long', action, linked, {}, 'DEMO');
    }
    const left = () => db.prepare('SELECT final_action a FROM brain_decisions').all().map(r => r.a).sort();

    test('a pending_expire past 365 days goes', async () => {
        row('pending_expire', 400);
        await api.bdPrune();
        expect(left()).toEqual([]);
    });

    test('a pending_expire inside 365 days stays — nothing is deleted today', async () => {
        // The oldest real row is 2026-05-13, 165 days. This rule is a BOUND for
        // the future, not a cleanup: its first run removes zero rows, by design.
        row('pending_expire', 165);
        row('pending_expire', 364);
        await api.bdPrune();
        expect(left()).toEqual(['pending_expire', 'pending_expire']);
    });

    test('pending_cancel follows the same window', async () => {
        row('pending_cancel', 400);
        row('pending_cancel', 100);
        await api.bdPrune();
        expect(left()).toEqual(['pending_cancel']);
    });

    test('a LINKED terminal row is never deleted, however old (R-C-21)', async () => {
        row('pending_expire', 900, 4242);
        await api.bdPrune();
        expect(left()).toEqual(['pending_expire']);
    });

    test('pending_created is NOT pruned, at any age — the gap is G-8', async () => {
        row('pending_created', 900);
        row('pending_created', 2000);
        await api.bdPrune();
        expect(left()).toEqual(['pending_created', 'pending_created']);
    });

    test('pending_fill and pending_momentum are untouchable — they are history', async () => {
        row('pending_fill', 900, 1);
        row('pending_momentum', 900, 2);
        await api.bdPrune();
        expect(left()).toEqual(['pending_fill', 'pending_momentum']);
    });

    test('the tiers from G-5 still work — nothing was displaced', async () => {
        row('entry_blocked', 120);          // blocked, 90d  → goes
        row('no_trade', 40, null, 'NO_TRADE'); // 30d        → goes
        row('entry', 400);                  // unlinked, 365d → goes
        row('entry_blocked', 30);           // inside 90d    → stays
        await api.bdPrune();
        expect(left()).toEqual(['entry_blocked']);
    });

    test('the prune reports the new tier, so the log says what happened', async () => {
        row('pending_expire', 400);
        const r = await api.bdPrune();
        expect(r.pending_terminal).toBe(1);
        expect(r).toHaveProperty('no_trade');
        expect(r).toHaveProperty('blocked');
        expect(r).toHaveProperty('trade');
    });

    test('a backlog larger than one batch still drains', async () => {
        for (let i = 0; i < 12; i++) row('pending_expire', 400);
        await api.bdPrune(Date.now(), 5);
        expect(left()).toEqual([]);
    });
});

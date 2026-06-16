# ML Plan v3 — Phase B Day 3 (Phase 4 Reflection-Aware Influence Gate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add INFLUENCE MODE to Ring5LearningService.wrap() — when Ring5 proposes to modify the phase2 fusion decision (vs current Day 1+2 read-only shadow mode), the proposed modification must pass a reflection re-check via `serverReflection.questionEntry()` before being applied; all attempts (accepted or rejected) recorded in a new audit table.

**Architecture:** Three layered components on top of Day 2 Thompson Sampling bandit. (1) **InfluenceProposer** computes whether Ring5 wants to modify the phase2 decision based on `thompsonSampler.drawSample()` + ML-Brain-Pro contribution signals (e.g., bandit posterior strongly favors a dir flip OR a confidence boost); returns `{hasProposal, proposedDecision, rationale}`. (2) **ReflectionGate** takes the proposed decision + market context, adapts it to the `serverReflection.questionEntry()` signature, and returns `{accepted, concerns, finalDecision}` — if rejected, the gate falls back to the unchanged phase2 decision. (3) **Audit trail** writes every influence attempt (accepted or rejected) to a new `ml_influence_audit` table (migration 373) with full rationale + reflection concerns. Ring5LearningService.wrap() gains a `mode: 'shadow' | 'influence'` parameter (default `shadow` for backward compat); only when `mode='influence'` does the new pipeline activate. Phase 2 fusion math UNTOUCHED.

**Tech Stack:** Node.js + better-sqlite3 + Jest (TDD). All new modules in `server/services/ml/_ring5/` namespace. Wires existing `serverReflection.js` module (no changes to it).

**Branch:** `omega/wave-1-foundation` (continuation).

**Gate:** Phase B Day 2 SHIPPED 2026-05-17 (tag `ml-plan-v3-phase-b-day2-phase3-COMPLETE-20260517-205606`). thompsonSampler + banditPosteriors + banditEvidence + pooledEvidence + effectiveStatus live.

**Reference specs:**
- `_review/audit/PLAN_V3_GAP_CLOSURE_SCAFFOLDING.md` PVR-5 (two-table strategy POST-gate / PRE-gate audit)
- §247* preRegistration (DEFERRED to Day 4 — not enforced in Phase 4)
- `[[project_ml_v3_active_resumed]]` ARCH-4 constraint #4 WRAP NOT REWRITE

---

## File Structure

- **Modify:** `server/services/database.js` — prepend migration `373_ml_influence_audit` before existing Phase B Day 2 anchor (migration 372)
- **Create:** `server/services/ml/_ring5/influenceProposer.js` — proposes modification when bandit posterior + ML signals justify
- **Create:** `server/services/ml/_ring5/reflectionGate.js` — adapter that calls `serverReflection.questionEntry()` with proposed decision and returns gate result
- **Create:** `server/services/ml/_ring5/influenceAudit.js` — atomic writer for `ml_influence_audit` table
- **Modify:** `server/services/ml/ring5LearningService.js` — extend `wrap()` to support `mode='influence'`
- **Create:** `tests/unit/ml/influenceProposer.test.js`
- **Create:** `tests/unit/ml/reflectionGate.test.js`
- **Create:** `tests/unit/ml/influenceAudit.test.js`
- **Modify:** `tests/unit/ml/ring5LearningService.test.js` — add influence-mode tests

---

## Task 4.1: Migration 373 — ml_influence_audit table

**Files:**
- Modify: `server/services/database.js` (prepend new migrate call before migration 372 block)
- Test: `tests/unit/ml/ring5LearningService.test.js` (extend with migration check)

- [ ] **Step 1: Write the failing test (append to existing ring5LearningService.test.js OR create new migration test)**

Add to `tests/unit/ml/ring5LearningService.test.js` describe block:

```javascript
describe('migration 373_ml_influence_audit', () => {
    test('table exists with required columns', () => {
        const cols = db.prepare("PRAGMA table_info(ml_influence_audit)").all();
        const names = cols.map(c => c.name);
        expect(names).toEqual(expect.arrayContaining([
            'id', 'user_id', 'env', 'symbol', 'regime',
            'phase2_dir', 'phase2_confidence', 'phase2_score',
            'proposed_dir', 'proposed_confidence', 'proposed_score',
            'gate_status', 'gate_reason', 'rationale_json',
            'created_at'
        ]));
    });
    test('gate_status CHECK constraint accepts only valid values', () => {
        const stmt = db.prepare(`INSERT INTO ml_influence_audit
            (user_id, env, symbol, regime, phase2_dir, phase2_confidence, phase2_score,
             proposed_dir, proposed_confidence, proposed_score, gate_status, gate_reason, rationale_json, created_at)
            VALUES (1, 'DEMO', 'BTCUSDT', 'trending', 'LONG', 70, 5, 'LONG', 80, 5.5, ?, 'ok', '{}', ?)`);
        expect(() => stmt.run('accepted', Date.now())).not.toThrow();
        expect(() => stmt.run('rejected', Date.now())).not.toThrow();
        expect(() => stmt.run('skipped', Date.now())).not.toThrow();
        expect(() => stmt.run('INVALID', Date.now())).toThrow();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/ring5LearningService.test.js --runInBand 2>&1 | tail -15`
Expected: FAIL — `no such table: ml_influence_audit`

- [ ] **Step 3: Add migration to `server/services/database.js`**

Find the existing anchor comment immediately before migration `372_ml_bandit_evidence` and prepend a new `migrate()` block:

```javascript
// [ML Phase B Day 3 — Phase 4] Audit trail for Ring5 influence-mode decisions.
// Every attempt (accepted/rejected/skipped) is recorded with full rationale +
// reflection concerns. Two-table strategy per Phase A PVR-5 — this is the PRE-gate
// trail; brain_decisions remains the POST-gate canonical trail.
migrate('373_ml_influence_audit', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_influence_audit (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            env                 TEXT NOT NULL CHECK(env IN ('DEMO','TESTNET','REAL')),
            symbol              TEXT NOT NULL,
            regime              TEXT NOT NULL,
            phase2_dir          TEXT NOT NULL,
            phase2_confidence   REAL NOT NULL,
            phase2_score        REAL NOT NULL,
            proposed_dir        TEXT NOT NULL,
            proposed_confidence REAL NOT NULL,
            proposed_score      REAL NOT NULL,
            gate_status         TEXT NOT NULL CHECK(gate_status IN ('accepted','rejected','skipped')),
            gate_reason         TEXT NOT NULL,
            rationale_json      TEXT NOT NULL,
            created_at          INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ml_inf_audit_user_env_ts
            ON ml_influence_audit(user_id, env, created_at);
        CREATE INDEX IF NOT EXISTS idx_ml_inf_audit_status_ts
            ON ml_influence_audit(gate_status, created_at);
    `);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/ring5LearningService.test.js --runInBand 2>&1 | tail -10`
Expected: PASS — all migration assertions green.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add server/services/database.js tests/unit/ml/ring5LearningService.test.js && git commit -m "feat(ml-phase-b-day3): migration 373 ml_influence_audit

PRE-gate audit trail for Ring5 influence-mode decisions (PVR-5 two-table
strategy). Records every attempt with phase2 vs proposed deltas, gate
status (accepted/rejected/skipped), and full rationale JSON.

Indices for per-user time-series queries and per-status filtering.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4.2: influenceProposer module

**Files:**
- Create: `server/services/ml/_ring5/influenceProposer.js`
- Test: `tests/unit/ml/influenceProposer.test.js`

**Contract:**
- `propose({phase2Decision, banditSample, mlBrainProInputs, thresholds?}) → {hasProposal, proposedDecision?, rationale}`
- Rules (conservative MVP):
  - If `banditSample >= 0.70` AND `mlBrainProInputs.sumContribution >= 0.10` AND phase2.dir matches → propose confidence boost +min(15, banditSample×20)
  - If `banditSample <= 0.30` AND `mlBrainProInputs.sumContribution <= -0.10` AND phase2.dir matches → propose confidence cut −min(15, (1-banditSample)×20)
  - Otherwise → `hasProposal: false` (no modification, stays shadow-only)
- NEVER flips `dir` in Phase 4 (dir-flip is Phase 5+ work; too risky without preReg gate)
- Resulting `proposedDecision.confidence` clamped to [0, 100]
- Resulting `proposedDecision.score` not touched (Phase 4 confidence-only)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ml/influenceProposer.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/influenceProposer.test.js --runInBand 2>&1 | tail -15`
Expected: FAIL — `Cannot find module '../../../server/services/ml/_ring5/influenceProposer'`

- [ ] **Step 3: Implement minimal code**

Create `server/services/ml/_ring5/influenceProposer.js`:

```javascript
'use strict';

/**
 * ML Plan v3 Phase 4 — Influence Proposer.
 *
 * Decides whether Ring5 wants to modify the phase2 fusion decision.
 * Conservative Phase 4 rules: confidence boost or cut ONLY (no dir flip).
 * Output feeds into reflectionGate which may accept or reject.
 */

const POS_BANDIT = 0.70;
const NEG_BANDIT = 0.30;
const POS_ML = 0.10;
const NEG_ML = -0.10;
const MAX_DELTA = 15;

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`influenceProposer: missing ${k}`);
    return p[k];
}

function _sumContribution(mlInputs) {
    if (!mlInputs || !mlInputs.contributions) return 0;
    return mlInputs.contributions.reduce((s, c) => s + (c.contribution || 0), 0);
}

function _clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
}

function propose(params) {
    const phase2 = _required(params, 'phase2Decision');
    const banditSample = _required(params, 'banditSample');
    const mlInputs = params.mlBrainProInputs || null;
    const sumC = _sumContribution(mlInputs);

    if (banditSample >= POS_BANDIT && sumC >= POS_ML) {
        const delta = Math.min(MAX_DELTA, banditSample * 20);
        return {
            hasProposal: true,
            proposedDecision: {
                dir: phase2.dir,
                confidence: _clamp(phase2.confidence + delta, 0, 100),
                score: phase2.score,
                reasons: [...(phase2.reasons || []), 'ring5_boost'],
                ts: phase2.ts
            },
            rationale: `positive_boost: bandit=${banditSample.toFixed(3)} sumC=${sumC.toFixed(3)} delta=+${delta.toFixed(2)}`
        };
    }

    if (banditSample <= NEG_BANDIT && sumC <= NEG_ML) {
        const delta = Math.min(MAX_DELTA, (1 - banditSample) * 20);
        return {
            hasProposal: true,
            proposedDecision: {
                dir: phase2.dir,
                confidence: _clamp(phase2.confidence - delta, 0, 100),
                score: phase2.score,
                reasons: [...(phase2.reasons || []), 'ring5_cut'],
                ts: phase2.ts
            },
            rationale: `negative_cut: bandit=${banditSample.toFixed(3)} sumC=${sumC.toFixed(3)} delta=-${delta.toFixed(2)}`
        };
    }

    return {
        hasProposal: false,
        rationale: `neutral_or_insufficient: bandit=${banditSample.toFixed(3)} sumC=${sumC.toFixed(3)}`
    };
}

module.exports = { propose, _constants: { POS_BANDIT, NEG_BANDIT, POS_ML, NEG_ML, MAX_DELTA } };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/influenceProposer.test.js --runInBand 2>&1 | tail -10`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add server/services/ml/_ring5/influenceProposer.js tests/unit/ml/influenceProposer.test.js && git commit -m "feat(ml-phase-b-day3): influenceProposer — conservative confidence delta proposals

Phase 4 rules:
  - banditSample >= 0.70 AND sumContribution >= 0.10 -> propose boost +min(15, bandit*20)
  - banditSample <= 0.30 AND sumContribution <= -0.10 -> propose cut -min(15, (1-bandit)*20)
  - otherwise -> no proposal (stays shadow-only)

NEVER flips dir in Phase 4 (dir-flip requires preReg gate, Phase 5+ work).
Score field preserved. Confidence clamped to [0, 100].

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4.3: reflectionGate module

**Files:**
- Create: `server/services/ml/_ring5/reflectionGate.js`
- Test: `tests/unit/ml/reflectionGate.test.js`

**Contract:**
- `evaluate({userId, symbol, regime, marketContext, phase2Decision, proposedDecision}) → {accepted, concerns, finalDecision, reflectionResult}`
- Calls `serverReflection.questionEntry(symbol, dir, confidence, regime, marketContext, userId)` with the PROPOSED decision's dir + confidence
- If `reflectionResult.proceed === false` → `accepted: false`, `finalDecision: phase2Decision`, concerns surfaced
- If `reflectionResult.proceed === true` → `accepted: true`, `finalDecision: proposedDecision` (may include reflection penalty applied per existing reflection contract — penalty subtracts from confidence)
- Apply `reflectionResult.totalPenalty` to proposedDecision.confidence before returning when accepted

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ml/reflectionGate.test.js`:

```javascript
'use strict';

jest.mock('../../../server/services/serverReflection', () => ({
    questionEntry: jest.fn()
}));

const reflection = require('../../../server/services/serverReflection');
const rg = require('../../../server/services/ml/_ring5/reflectionGate');

const _phase2 = (over = {}) => ({ dir: 'LONG', confidence: 70, score: 5, reasons: ['t1'], ts: 100, ...over });
const _proposed = (over = {}) => ({ dir: 'LONG', confidence: 80, score: 5, reasons: ['t1', 'ring5_boost'], ts: 100, ...over });

describe('reflectionGate.evaluate', () => {
    beforeEach(() => reflection.questionEntry.mockReset());

    test('accepts when reflection proceeds with zero penalty', () => {
        reflection.questionEntry.mockReturnValue({ proceed: true, concerns: [], adjustments: {}, totalPenalty: 0 });
        const r = rg.evaluate({
            userId: 1, symbol: 'BTCUSDT', regime: 'trending', marketContext: {},
            phase2Decision: _phase2(), proposedDecision: _proposed()
        });
        expect(r.accepted).toBe(true);
        expect(r.finalDecision.confidence).toBe(80);
        expect(r.concerns).toEqual([]);
    });

    test('rejects when reflection blocks (proceed=false)', () => {
        reflection.questionEntry.mockReturnValue({
            proceed: false,
            concerns: [{ type: 'learned_rule', rule: 'no-counter-trend', severity: 'high' }],
            adjustments: {}, totalPenalty: 0
        });
        const r = rg.evaluate({
            userId: 1, symbol: 'BTCUSDT', regime: 'ranging', marketContext: {},
            phase2Decision: _phase2(), proposedDecision: _proposed()
        });
        expect(r.accepted).toBe(false);
        expect(r.finalDecision).toEqual(_phase2());
        expect(r.concerns.length).toBeGreaterThan(0);
        expect(r.concerns[0].type).toBe('learned_rule');
    });

    test('applies reflection penalty to proposed confidence when accepted', () => {
        reflection.questionEntry.mockReturnValue({ proceed: true, concerns: [], adjustments: {}, totalPenalty: -8 });
        const r = rg.evaluate({
            userId: 1, symbol: 'BTCUSDT', regime: 'trending', marketContext: {},
            phase2Decision: _phase2({ confidence: 70 }), proposedDecision: _proposed({ confidence: 85 })
        });
        expect(r.accepted).toBe(true);
        expect(r.finalDecision.confidence).toBe(77);
    });

    test('clamps confidence after penalty to [0, 100]', () => {
        reflection.questionEntry.mockReturnValue({ proceed: true, concerns: [], adjustments: {}, totalPenalty: -120 });
        const r = rg.evaluate({
            userId: 1, symbol: 'BTCUSDT', regime: 'trending', marketContext: {},
            phase2Decision: _phase2(), proposedDecision: _proposed({ confidence: 50 })
        });
        expect(r.accepted).toBe(true);
        expect(r.finalDecision.confidence).toBe(0);
    });

    test('passes correct args to reflection.questionEntry', () => {
        reflection.questionEntry.mockReturnValue({ proceed: true, concerns: [], adjustments: {}, totalPenalty: 0 });
        rg.evaluate({
            userId: 42, symbol: 'ETHUSDT', regime: 'choppy', marketContext: { foo: 'bar' },
            phase2Decision: _phase2(), proposedDecision: _proposed({ dir: 'LONG', confidence: 85 })
        });
        expect(reflection.questionEntry).toHaveBeenCalledWith(
            'ETHUSDT', 'LONG', 85, 'choppy', { foo: 'bar' }, 42
        );
    });

    test('returns reflectionResult for upstream audit logging', () => {
        const mock = { proceed: true, concerns: [], adjustments: {}, totalPenalty: -3 };
        reflection.questionEntry.mockReturnValue(mock);
        const r = rg.evaluate({
            userId: 1, symbol: 'BTCUSDT', regime: 'trending', marketContext: {},
            phase2Decision: _phase2(), proposedDecision: _proposed()
        });
        expect(r.reflectionResult).toEqual(mock);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/reflectionGate.test.js --runInBand 2>&1 | tail -15`
Expected: FAIL — `Cannot find module '../../../server/services/ml/_ring5/reflectionGate'`

- [ ] **Step 3: Implement minimal code**

Create `server/services/ml/_ring5/reflectionGate.js`:

```javascript
'use strict';

/**
 * ML Plan v3 Phase 4 — Reflection Gate.
 *
 * Adapter that runs an already-proposed Ring5 modification through the
 * existing serverReflection.questionEntry() pipeline. If reflection blocks,
 * Ring5 falls back to the unchanged phase2 decision. If reflection allows
 * with a confidence penalty, the penalty is applied to the proposed
 * decision's confidence (clamped to [0, 100]) before acceptance.
 */

const serverReflection = require('../../serverReflection');

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`reflectionGate: missing ${k}`);
    return p[k];
}

function _clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
}

function evaluate(params) {
    const userId = _required(params, 'userId');
    const symbol = _required(params, 'symbol');
    const regime = _required(params, 'regime');
    const marketContext = _required(params, 'marketContext');
    const phase2Decision = _required(params, 'phase2Decision');
    const proposedDecision = _required(params, 'proposedDecision');

    const reflectionResult = serverReflection.questionEntry(
        symbol, proposedDecision.dir, proposedDecision.confidence, regime, marketContext, userId
    );

    if (!reflectionResult.proceed) {
        return {
            accepted: false,
            concerns: reflectionResult.concerns || [],
            finalDecision: phase2Decision,
            reflectionResult
        };
    }

    const penalty = reflectionResult.totalPenalty || 0;
    const adjustedConfidence = _clamp(proposedDecision.confidence + penalty, 0, 100);

    return {
        accepted: true,
        concerns: reflectionResult.concerns || [],
        finalDecision: {
            ...proposedDecision,
            confidence: adjustedConfidence
        },
        reflectionResult
    };
}

module.exports = { evaluate };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/reflectionGate.test.js --runInBand 2>&1 | tail -10`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add server/services/ml/_ring5/reflectionGate.js tests/unit/ml/reflectionGate.test.js && git commit -m "feat(ml-phase-b-day3): reflectionGate — runs Ring5 proposal through serverReflection.questionEntry

Adapter that takes a Phase 4 influence proposal + market context and runs
it through the existing reflection pipeline:
  - proceed=false -> reject, fallback to phase2Decision
  - proceed=true with penalty -> apply penalty to confidence, accept

Confidence clamped to [0, 100] post-penalty. Returns full reflectionResult
for upstream audit logging.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4.4: influenceAudit writer

**Files:**
- Create: `server/services/ml/_ring5/influenceAudit.js`
- Test: `tests/unit/ml/influenceAudit.test.js`

**Contract:**
- `record({userId, env, symbol, regime, phase2Decision, proposedDecision, gateStatus, gateReason, rationale, ts}) → {recorded: true, id}`
- Atomic insert into `ml_influence_audit` table
- `rationale` may be string or object (serialize to JSON)
- `phase2Decision` and `proposedDecision` extract `{dir, confidence, score}` to dedicated columns

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ml/influenceAudit.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/influenceAudit.test.js --runInBand 2>&1 | tail -15`
Expected: FAIL — `Cannot find module '../../../server/services/ml/_ring5/influenceAudit'`

- [ ] **Step 3: Implement minimal code**

Create `server/services/ml/_ring5/influenceAudit.js`:

```javascript
'use strict';

/**
 * ML Plan v3 Phase 4 — Influence Audit writer.
 *
 * Persists every Ring5 influence-mode attempt (accepted/rejected/skipped)
 * to ml_influence_audit. PRE-gate trail per PVR-5 two-table strategy.
 */

const { db } = require('../../database');

const _STMT = db.prepare(`
    INSERT INTO ml_influence_audit
    (user_id, env, symbol, regime,
     phase2_dir, phase2_confidence, phase2_score,
     proposed_dir, proposed_confidence, proposed_score,
     gate_status, gate_reason, rationale_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`influenceAudit: missing ${k}`);
    return p[k];
}

function _serializeRationale(r) {
    if (typeof r === 'string') return JSON.stringify({ text: r });
    return JSON.stringify(r);
}

function record(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'env');
    const symbol = _required(params, 'symbol');
    const regime = _required(params, 'regime');
    const phase2 = _required(params, 'phase2Decision');
    const proposed = _required(params, 'proposedDecision');
    const gateStatus = _required(params, 'gateStatus');
    const gateReason = _required(params, 'gateReason');
    const rationale = _required(params, 'rationale');
    const ts = _required(params, 'ts');

    const info = _STMT.run(
        userId, env, symbol, regime,
        phase2.dir, phase2.confidence, phase2.score,
        proposed.dir, proposed.confidence, proposed.score,
        gateStatus, gateReason, _serializeRationale(rationale), ts
    );

    return { recorded: true, id: info.lastInsertRowid };
}

module.exports = { record };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/influenceAudit.test.js --runInBand 2>&1 | tail -10`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add server/services/ml/_ring5/influenceAudit.js tests/unit/ml/influenceAudit.test.js && git commit -m "feat(ml-phase-b-day3): influenceAudit — atomic writer for ml_influence_audit table

Records every Ring5 influence-mode attempt with phase2 vs proposed deltas,
gate status, reason, and rationale (string-wrapped or object-serialized to
JSON). PRE-gate trail per PVR-5 two-table strategy.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4.5: Wire ring5LearningService.wrap() to influence mode

**Files:**
- Modify: `server/services/ml/ring5LearningService.js` (extend `wrap` function)
- Modify: `tests/unit/ml/ring5LearningService.test.js` (add influence-mode tests)

**Contract changes:**
- `wrap()` accepts new optional params:
  - `mode: 'shadow' | 'influence'` (default `'shadow'` — Day 1 behavior)
  - `userId`, `env`, `symbol`, `regime`, `marketContext`, `nowTs` (required when `mode='influence'`)
- When `mode='influence'`:
  1. Draw bandit sample via `thompsonSampler.drawSample()`
  2. Run `influenceProposer.propose()` with phase2Decision + banditSample + mlBrainProInputs
  3. If `!hasProposal` → record audit `gateStatus='skipped'`, return phase2 unchanged (with `layeredBy: 'ring5-influence-skipped'`)
  4. If `hasProposal` → run `reflectionGate.evaluate()`
     - If accepted → record audit `gateStatus='accepted'`, return finalDecision (with `layeredBy: 'ring5-influence-applied'`)
     - If rejected → record audit `gateStatus='rejected'`, return phase2 unchanged (with `layeredBy: 'ring5-influence-blocked'`)

- [ ] **Step 1: Write the failing tests (add to ring5LearningService.test.js)**

Append to `tests/unit/ml/ring5LearningService.test.js` describe block:

```javascript
describe('wrap influence mode (Phase 4)', () => {
    // We'll use the real modules — Phase 4 integration test
    const _phase2 = (over = {}) => ({ dir: 'LONG', confidence: 70, score: 5, reasons: ['t1'], ts: Date.now(), ...over });
    const _ctx = () => ({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', marketContext: {}, nowTs: Date.now() });

    beforeEach(() => {
        if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ml_influence_audit'").get()) {
            db.prepare("DELETE FROM ml_influence_audit").run();
        }
    });

    test('mode=shadow (default) preserves Day 1 behavior — no audit row', () => {
        const r = ring5.wrap({
            userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
            phase2Decision: _phase2(), mlBrainProInputs: null
        });
        expect(r.layeredBy).toBe('phase2-only');
        const audit = db.prepare("SELECT COUNT(*) c FROM ml_influence_audit").get();
        expect(audit.c).toBe(0);
    });

    test('mode=influence with no mlBrainProInputs -> skipped audit row', () => {
        const r = ring5.wrap({
            ..._ctx(), resolvedEnv: 'DEMO', mode: 'influence',
            phase2Decision: _phase2(), mlBrainProInputs: null
        });
        expect(r.layeredBy).toBe('ring5-influence-skipped');
        const audit = db.prepare("SELECT gate_status FROM ml_influence_audit").get();
        expect(audit.gate_status).toBe('skipped');
    });

    test('mode=influence with neutral signals -> skipped (no proposal)', () => {
        const r = ring5.wrap({
            ..._ctx(), resolvedEnv: 'DEMO', mode: 'influence',
            phase2Decision: _phase2(),
            mlBrainProInputs: { contributions: [{ moduleId: 'm', contribution: 0.0 }] }
        });
        expect(r.layeredBy).toBe('ring5-influence-skipped');
        expect(r.confidence).toBe(70);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/ring5LearningService.test.js --runInBand 2>&1 | tail -15`
Expected: FAIL — `wrap` doesn't accept `mode` param yet; layeredBy is `'phase2-only'` or `'ring5-shadow'`.

- [ ] **Step 3: Extend ring5LearningService.wrap()**

Open `server/services/ml/ring5LearningService.js` and add new imports near top:

```javascript
const thompsonSampler = require('./_ring5/thompsonSampler');
const influenceProposer = require('./_ring5/influenceProposer');
const reflectionGate = require('./_ring5/reflectionGate');
const influenceAudit = require('./_ring5/influenceAudit');
```

(Note: `thompsonSampler` is already imported on line 29 — do not duplicate.)

Then modify the `wrap` function signature and body. Replace the entire `function wrap(params) { ... }` block with:

```javascript
function wrap(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _validateEnv(_required(params, 'resolvedEnv'));
    const symbol = _required(params, 'symbol');
    const phase2Decision = _required(params, 'phase2Decision');
    const mlBrainProInputs = params.mlBrainProInputs ?? null;
    const mode = params.mode || 'shadow';

    if (mode === 'influence') {
        return _wrapInfluence({
            userId, resolvedEnv, symbol, phase2Decision, mlBrainProInputs,
            regime: params.regime || 'unknown',
            marketContext: params.marketContext || {},
            nowTs: params.nowTs || Date.now()
        });
    }

    // mode === 'shadow' (Day 1 behavior, unchanged)
    const wrapped = {
        dir: phase2Decision.dir,
        confidence: phase2Decision.confidence,
        score: phase2Decision.score,
        reasons: phase2Decision.reasons,
        ts: phase2Decision.ts,
        layeredBy: mlBrainProInputs ? 'ring5-shadow' : 'phase2-only'
    };
    if (mlBrainProInputs) {
        wrapped.ring5Shadow = {
            contributionsCount: (mlBrainProInputs.contributions || []).length,
            sumContribution: (mlBrainProInputs.contributions || [])
                .reduce((s, c) => s + (c.contribution || 0), 0),
        };
    }
    return wrapped;
}

function _wrapInfluence(ctx) {
    const { userId, resolvedEnv, symbol, phase2Decision, mlBrainProInputs, regime, marketContext, nowTs } = ctx;

    const draw = thompsonSampler.drawSample({ userId, env: resolvedEnv, symbol, regime, nowTs });
    const proposal = influenceProposer.propose({
        phase2Decision, banditSample: draw.sample, mlBrainProInputs
    });

    if (!proposal.hasProposal) {
        influenceAudit.record({
            userId, env: resolvedEnv, symbol, regime,
            phase2Decision, proposedDecision: phase2Decision,
            gateStatus: 'skipped', gateReason: 'no_proposal',
            rationale: proposal.rationale, ts: nowTs
        });
        return { ...phase2Decision, layeredBy: 'ring5-influence-skipped' };
    }

    const gate = reflectionGate.evaluate({
        userId, symbol, regime, marketContext,
        phase2Decision, proposedDecision: proposal.proposedDecision
    });

    if (!gate.accepted) {
        influenceAudit.record({
            userId, env: resolvedEnv, symbol, regime,
            phase2Decision, proposedDecision: proposal.proposedDecision,
            gateStatus: 'rejected', gateReason: 'reflection_blocked',
            rationale: { proposal: proposal.rationale, concerns: gate.concerns },
            ts: nowTs
        });
        return { ...phase2Decision, layeredBy: 'ring5-influence-blocked' };
    }

    influenceAudit.record({
        userId, env: resolvedEnv, symbol, regime,
        phase2Decision, proposedDecision: gate.finalDecision,
        gateStatus: 'accepted', gateReason: 'reflection_passed',
        rationale: {
            proposal: proposal.rationale,
            penalty: gate.reflectionResult.totalPenalty || 0
        },
        ts: nowTs
    });
    return { ...gate.finalDecision, layeredBy: 'ring5-influence-applied' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/ring5LearningService.test.js --runInBand 2>&1 | tail -10`
Expected: PASS — all original Day 1 tests + new Phase 4 tests green.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add server/services/ml/ring5LearningService.js tests/unit/ml/ring5LearningService.test.js && git commit -m "feat(ml-phase-b-day3): wire ring5LearningService.wrap() to influence mode

wrap() now accepts mode='shadow' (default, Day 1 behavior unchanged) or
mode='influence' (Phase 4 pipeline):
  1. thompsonSampler.drawSample() -> banditSample
  2. influenceProposer.propose() -> hasProposal + proposedDecision
  3. skip if no proposal (audit row gate_status='skipped')
  4. reflectionGate.evaluate() -> accepted or rejected
  5. accepted -> apply finalDecision, audit accepted
  6. rejected -> fallback to phase2Decision, audit rejected

layeredBy markers: ring5-influence-{skipped,blocked,applied}.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4.6: Day 3 closeout

- [ ] **Step 1: Full regression**

Run: `cd /root/zeus-terminal && npx jest --maxWorkers=2 2>&1 | tail -8`
Expected: total tests increase by ~25-30 vs Day 2 baseline (6700). Zero new failures attributable to Phase 4 — confidenceDecay parallel race expected, isolated PASS per Day 2 pattern.

- [ ] **Step 2: Tag**

```bash
cd /root/zeus-terminal && TAG="ml-plan-v3-phase-b-day3-phase4-COMPLETE-$(date -u +%Y%m%d-%H%M%S)" && git tag -a "$TAG" -m "ML Plan v3 Phase B Day 3 — Phase 4 Reflection-Aware Influence Gate COMPLETE

Day 3 deliverables:
- migration 373 ml_influence_audit (PRE-gate audit trail)
- influenceProposer.js (confidence-only proposals, no dir flip)
- reflectionGate.js (adapter to serverReflection.questionEntry)
- influenceAudit.js (atomic writer)
- ring5LearningService.wrap() extended with mode='shadow'|'influence'

Phase 2 fusion math UNTOUCHED. Backward compatible (shadow mode default).
Phase 5 (preReg) / Phase 6 (tieredPromotion) / Phase 7 (deploy+obs) deferred to Day 4-5." && echo "TAG=\$TAG"
```

- [ ] **Step 3: Push**

```bash
cd /root/zeus-terminal && git push origin HEAD --tags
```

- [ ] **Step 4: Memory update**

Edit `/root/.claude/projects/-root/memory/MEMORY.md` line 23 — append after the Day 2 SHIPPED block: `**PHASE B Day 3 ✅ SHIPPED YYYY-MM-DD HH:MM UTC** (tag `ml-plan-v3-phase-b-day3-phase4-COMPLETE-...`): Phase 4 reflection-aware influence gate complete — migration 373 ml_influence_audit + 3 new modules (influenceProposer + reflectionGate + influenceAudit) + ring5LearningService.wrap() mode='influence' pipeline. Phase 2 fusion UNTOUCHED. Backward compatible default shadow mode. ~25-30 new tests. **Day 4 NEXT** = Phase 5 (preRegistration wiring) + Phase 6 (tieredPromotion wiring).`

---

## Self-Review

**1. Spec coverage:**
- Phase 4 = reflection-aware gate ✅ (Task 4.5 wires reflectionGate into wrap)
- PVR-5 PRE-gate audit trail ✅ (Task 4.1 + 4.4)
- WRAP NOT REWRITE ✅ (Phase 2 fusion untouched, only new modules + wrap extension)
- Backward compat ✅ (mode defaults to 'shadow', Day 1 tests unchanged)
- Phase 5/6/7 explicitly deferred to Day 4-5 — no scope creep

**2. Placeholder scan:** None. All code complete, all commands explicit.

**3. Type consistency:**
- `proposedDecision` shape `{dir, confidence, score, reasons, ts}` consistent across proposer / gate / audit / wrap
- `gateStatus` enum `'accepted'|'rejected'|'skipped'` enforced at DB CHECK + used consistently
- `layeredBy` marker strings consistent: `'phase2-only'` / `'ring5-shadow'` / `'ring5-influence-{skipped,blocked,applied}'`

---

## Execution Handoff

Plan saved. Two execution options:

1. **Inline Execution (recommended for this scope)** — same session, fewer tasks (6), executing-plans skill
2. **Subagent-Driven** — fresh subagent per task with two-stage review

Recommendation: **Inline** — Phase 4 is small enough (6 tasks) and tightly coupled (wrap() integration depends on all three modules being in place), subagent overhead not worth it.

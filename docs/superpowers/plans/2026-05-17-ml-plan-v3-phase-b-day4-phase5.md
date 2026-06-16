# ML Plan v3 — Phase B Day 4 (Phase 5 Pre-Registration Eligibility Gate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ELIGIBILITY GATE in front of the Day 3 influence pipeline — when caller asks for `mode='influence'`, Ring5 first verifies the (user, env, symbol, regime) cell qualifies based on (1) sufficient bandit observations, (2) active versionRegistry entry for the Ring5 bandit component, (3) non-terminal preRegistration covering that version, (4) eval-window still open. If any check fails → fall back to shadow mode + audit row `gate_status='skipped'` with specific `gate_reason`. Existing `preRegistration.js` and `versionRegistry.js` Wave 3 modules wired (NOT modified).

**Architecture:** New module `_ring5/influenceEligibility.js` exposes `checkEligibility({userId, env, symbol, regime, nowTs}) → {eligible, reason, observationCount, preRegStatus, versionId}`. Internally walks: (a) `banditPosteriors.getPosterior(L4)` for observationCount vs `MIN_OBSERVATIONS=30` threshold (matches SPEC-8 promotion gate); (b) `versionRegistry.getActive('ring5-bandit-influence', 'phase4')` for active version row; (c) `preRegistration.getRegistrationsForVersion(versionId)` filtered to non-terminal states `REGISTERED|EVALUATING`; (d) `eval_window_to_ms` comparison vs nowTs. `ring5LearningService.wrap()` calls eligibility FIRST in the influence branch; on `eligible=false`, writes audit row with `gate_status='skipped'` + `gate_reason='not_eligible_{reason}'` and returns `layeredBy: 'ring5-influence-not-eligible'`. Versioning component label stays static `'ring5-bandit-influence' / 'phase4'` for Phase 4 scope — Phase 6 deployment work will add per-cell versioning.

**Tech Stack:** Node.js + better-sqlite3 + Jest (TDD). New module in `server/services/ml/_ring5/`. Wires existing `R5B_governance/preRegistration.js` + `R5B_governance/versionRegistry.js` (no changes). No new migrations — uses existing tables `ml_governance_versions` (045) + `ml_hypothesis_pre_registrations` (046).

**Branch:** `omega/wave-1-foundation` (continuation).

**Gate:** Phase B Day 3 SHIPPED 2026-05-17 (tag `ml-plan-v3-phase-b-day3-phase4-COMPLETE-20260517-213234`). Day 3 influence pipeline (proposer + reflectionGate + audit) live.

**Reference specs:**
- `_review/audit/PLAN_V3_GAP_CLOSURE_SCAFFOLDING.md` FEAT-247* preRegistration (RESOLVED via Wave 3 shipment)
- `[[project_ml_v3_active_resumed]]` ARCH-4 constraint #4 WRAP NOT REWRITE
- `[[project_ml_brain_pro_244]]` §247* hash-locked anti-p-hacking

---

## File Structure

- **Create:** `server/services/ml/_ring5/influenceEligibility.js` — eligibility resolver
- **Create:** `tests/unit/ml/influenceEligibility.test.js`
- **Modify:** `server/services/ml/ring5LearningService.js` — extend `_wrapInfluence` to gate on eligibility
- **Modify:** `tests/unit/ml/ring5LearningService.test.js` — add eligibility-gate tests

---

## Task 5.1: influenceEligibility module

**Files:**
- Create: `server/services/ml/_ring5/influenceEligibility.js`
- Test: `tests/unit/ml/influenceEligibility.test.js`

**Contract:**
- Constants: `MIN_OBSERVATIONS = 30`, `INFLUENCE_COMPONENT_TYPE = 'ring5-bandit-influence'`, `INFLUENCE_COMPONENT_ID = 'phase4'`
- `checkEligibility({userId, env, symbol, regime, nowTs}) → {eligible: boolean, reason: string, observationCount: number, preRegStatus: string|null, versionId: number|null}`
- Reasons (enum):
  - `'all_checks_passed'`
  - `'insufficient_observations'`
  - `'no_active_version'`
  - `'no_active_pre_registration'`
  - `'pre_registration_terminal'`
  - `'eval_window_expired'`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ml/influenceEligibility.test.js`:

```javascript
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r5-elig-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const bp = require('../../../server/services/ml/_ring5/banditPosteriors');
const versionRegistry = require('../../../server/services/ml/R5B_governance/versionRegistry');
const preRegistration = require('../../../server/services/ml/R5B_governance/preRegistration');
const elig = require('../../../server/services/ml/_ring5/influenceEligibility');

const _now = () => Date.now();
const _cellKey = (uid, env, symbol, regime) => `${uid}:${env}:${symbol}:${regime}`;

function _seedObservations(cellKey, count) {
    for (let i = 0; i < count; i++) {
        bp.updatePosterior({ level: 4, cellKey, outcomeClass: 'positive', ts: _now() });
    }
}

function _seedActiveVersion() {
    const proposed = versionRegistry.proposeVersion({
        componentType: 'ring5-bandit-influence',
        componentId: 'phase4',
        version: 'v1.0.0',
        config: { thresholds: { POS_BANDIT: 0.70 } },
        motivation: 'test',
        actor: 'test'
    });
    versionRegistry.activateVersion({ id: proposed.id });
    return proposed.id;
}

function _seedActivePreReg(versionId, evalToMs) {
    return preRegistration.registerHypothesis({
        versionId,
        hypothesis: 'Ring5 confidence delta improves win rate by 3%',
        predictedMetrics: { winRateDelta: 0.03 },
        successCriteria: [{ metric: 'winRateDelta', op: '>=', value: 0.02 }],
        evalWindow: { fromMs: _now() - 86400000, toMs: evalToMs },
        actor: 'test'
    });
}

function clean() {
    db.prepare("DELETE FROM ml_bandit_posteriors").run();
    db.prepare("DELETE FROM ml_hypothesis_pre_registrations").run();
    db.prepare("DELETE FROM ml_governance_versions").run();
}

describe('influenceEligibility.checkEligibility', () => {
    beforeEach(clean);

    test('exposes MIN_OBSERVATIONS = 30 constant', () => {
        expect(elig.MIN_OBSERVATIONS).toBe(30);
    });

    test('returns eligible=false reason=insufficient_observations when bandit untrained', () => {
        const r = elig.checkEligibility({
            userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: _now()
        });
        expect(r.eligible).toBe(false);
        expect(r.reason).toBe('insufficient_observations');
        expect(r.observationCount).toBe(0);
    });

    test('returns eligible=false reason=no_active_version when bandit trained but no version', () => {
        _seedObservations(_cellKey(1, 'DEMO', 'BTCUSDT', 'trending'), 30);
        const r = elig.checkEligibility({
            userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: _now()
        });
        expect(r.eligible).toBe(false);
        expect(r.reason).toBe('no_active_version');
        expect(r.observationCount).toBe(30);
        expect(r.versionId).toBeNull();
    });

    test('returns eligible=false reason=no_active_pre_registration when version exists but no preReg', () => {
        _seedObservations(_cellKey(1, 'DEMO', 'BTCUSDT', 'trending'), 30);
        const versionId = _seedActiveVersion();
        const r = elig.checkEligibility({
            userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: _now()
        });
        expect(r.eligible).toBe(false);
        expect(r.reason).toBe('no_active_pre_registration');
        expect(r.versionId).toBe(versionId);
        expect(r.preRegStatus).toBeNull();
    });

    test('returns eligible=true when all gates pass', () => {
        _seedObservations(_cellKey(1, 'DEMO', 'BTCUSDT', 'trending'), 30);
        const versionId = _seedActiveVersion();
        _seedActivePreReg(versionId, _now() + 86400000);
        const r = elig.checkEligibility({
            userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: _now()
        });
        expect(r.eligible).toBe(true);
        expect(r.reason).toBe('all_checks_passed');
        expect(r.observationCount).toBe(30);
        expect(r.versionId).toBe(versionId);
        expect(r.preRegStatus).toBe('REGISTERED');
    });

    test('returns eligible=false reason=eval_window_expired when nowTs > eval_window_to_ms', () => {
        _seedObservations(_cellKey(1, 'DEMO', 'BTCUSDT', 'trending'), 30);
        const versionId = _seedActiveVersion();
        _seedActivePreReg(versionId, _now() - 1000);  // already expired
        const r = elig.checkEligibility({
            userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: _now()
        });
        expect(r.eligible).toBe(false);
        expect(r.reason).toBe('eval_window_expired');
    });

    test('per-cell isolation: user 1 trained, user 2 not -> only user 1 eligible', () => {
        _seedObservations(_cellKey(1, 'DEMO', 'BTCUSDT', 'trending'), 30);
        const versionId = _seedActiveVersion();
        _seedActivePreReg(versionId, _now() + 86400000);

        const r1 = elig.checkEligibility({ userId: 1, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: _now() });
        const r2 = elig.checkEligibility({ userId: 2, env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending', nowTs: _now() });

        expect(r1.eligible).toBe(true);
        expect(r2.eligible).toBe(false);
        expect(r2.reason).toBe('insufficient_observations');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/influenceEligibility.test.js --runInBand 2>&1 | tail -15`
Expected: FAIL — `Cannot find module '../../../server/services/ml/_ring5/influenceEligibility'`

- [ ] **Step 3: Implement minimal code**

Create `server/services/ml/_ring5/influenceEligibility.js`:

```javascript
'use strict';

/**
 * ML Plan v3 Phase 5 — Influence Eligibility Gate.
 *
 * Decides whether a (userId, env, symbol, regime) cell may enter the Day 3
 * influence pipeline. Composes:
 *   1. banditPosteriors L4 observationCount >= MIN_OBSERVATIONS
 *   2. versionRegistry has active version for ('ring5-bandit-influence', 'phase4')
 *   3. preRegistration has non-terminal entry for that version
 *   4. preReg eval window not expired
 *
 * On any failure, returns eligible=false with specific reason — caller (wrap)
 * falls back to shadow mode with audit row gate_status='skipped'.
 */

const bp = require('./banditPosteriors');
const versionRegistry = require('../R5B_governance/versionRegistry');
const preRegistration = require('../R5B_governance/preRegistration');

const MIN_OBSERVATIONS = 30;
const INFLUENCE_COMPONENT_TYPE = 'ring5-bandit-influence';
const INFLUENCE_COMPONENT_ID = 'phase4';
const TERMINAL_PREREG_STATES = new Set(['PASS', 'FAIL', 'INVALID']);

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`influenceEligibility: missing ${k}`);
    return p[k];
}

function checkEligibility(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'env');
    const symbol = _required(params, 'symbol');
    const regime = _required(params, 'regime');
    const nowTs = _required(params, 'nowTs');

    const cellKey = `${userId}:${env}:${symbol}:${regime}`;
    const l4 = bp.getPosterior({ level: 4, cellKey });
    const observationCount = l4 ? l4.observationCount : 0;

    if (observationCount < MIN_OBSERVATIONS) {
        return {
            eligible: false,
            reason: 'insufficient_observations',
            observationCount,
            preRegStatus: null,
            versionId: null
        };
    }

    const activeVersion = versionRegistry.getActive(INFLUENCE_COMPONENT_TYPE, INFLUENCE_COMPONENT_ID);
    if (!activeVersion) {
        return {
            eligible: false,
            reason: 'no_active_version',
            observationCount,
            preRegStatus: null,
            versionId: null
        };
    }

    const regs = preRegistration.getRegistrationsForVersion(activeVersion.id);
    const activeReg = regs.find(r => !TERMINAL_PREREG_STATES.has(r.state));
    if (!activeReg) {
        return {
            eligible: false,
            reason: 'no_active_pre_registration',
            observationCount,
            preRegStatus: null,
            versionId: activeVersion.id
        };
    }

    if (nowTs > activeReg.eval_window_to_ms) {
        return {
            eligible: false,
            reason: 'eval_window_expired',
            observationCount,
            preRegStatus: activeReg.state,
            versionId: activeVersion.id
        };
    }

    return {
        eligible: true,
        reason: 'all_checks_passed',
        observationCount,
        preRegStatus: activeReg.state,
        versionId: activeVersion.id
    };
}

module.exports = {
    MIN_OBSERVATIONS,
    INFLUENCE_COMPONENT_TYPE,
    INFLUENCE_COMPONENT_ID,
    checkEligibility
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/influenceEligibility.test.js --runInBand 2>&1 | tail -10`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add server/services/ml/_ring5/influenceEligibility.js tests/unit/ml/influenceEligibility.test.js && git commit -m "feat(ml-phase-b-day4): influenceEligibility — preReg+version eligibility gate

Composes 4 checks before Ring5 may enter influence pipeline:
  1. banditPosteriors L4 observationCount >= 30 (matches SPEC-8 promotion)
  2. versionRegistry active for ('ring5-bandit-influence', 'phase4')
  3. preRegistration non-terminal entry exists for that version
  4. eval window not expired

Returns specific reason on failure for audit logging. Wires existing
preRegistration.js + versionRegistry.js Wave 3 modules unchanged.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5.2: Wire wrap() to gate on eligibility

**Files:**
- Modify: `server/services/ml/ring5LearningService.js` (extend `_wrapInfluence` head)
- Modify: `tests/unit/ml/ring5LearningService.test.js` (add eligibility-gate tests)

**Contract change:**
- `_wrapInfluence` calls `influenceEligibility.checkEligibility()` BEFORE drawing bandit sample
- If `!eligible` → record audit row `gate_status='skipped'`, `gate_reason='not_eligible_${reason}'`, rationale `{eligibility: {reason, observationCount, preRegStatus, versionId}}`, return `{...phase2, layeredBy: 'ring5-influence-not-eligible'}`
- If `eligible` → proceed with Day 3 pipeline unchanged

- [ ] **Step 1: Write the failing tests (append to existing `wrap influence mode` describe block in ring5LearningService.test.js)**

```javascript
test('mode=influence not eligible (no observations) -> skipped + layeredBy=not-eligible', () => {
    const r = ring5.wrap({
        userId: 99, resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
        regime: 'trending', marketContext: {}, nowTs: Date.now(),
        mode: 'influence',
        phase2Decision: _phase2(),
        mlBrainProInputs: { contributions: [{ moduleId: 'm', contribution: 0.30 }] }
    });
    expect(r.layeredBy).toBe('ring5-influence-not-eligible');
    expect(r.confidence).toBe(70);
    const audit = db.prepare("SELECT gate_status, gate_reason FROM ml_influence_audit WHERE user_id=99 ORDER BY id DESC LIMIT 1").get();
    expect(audit.gate_status).toBe('skipped');
    expect(audit.gate_reason).toMatch(/not_eligible/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/zeus-terminal && npx jest tests/unit/ml/ring5LearningService.test.js --runInBand 2>&1 | tail -15`
Expected: FAIL — layeredBy is `'ring5-influence-skipped'` (Day 3 behavior with strong signal proceeds to pipeline; not blocked by eligibility yet).

- [ ] **Step 3: Wire eligibility check into `_wrapInfluence`**

Open `server/services/ml/ring5LearningService.js`. Add import:

```javascript
const influenceEligibility = require('./_ring5/influenceEligibility');
```

Modify `_wrapInfluence` — insert eligibility check at the top:

```javascript
function _wrapInfluence(ctx) {
    const { userId, resolvedEnv, symbol, phase2Decision, mlBrainProInputs, regime, marketContext, nowTs } = ctx;

    const eligibility = influenceEligibility.checkEligibility({
        userId, env: resolvedEnv, symbol, regime, nowTs
    });
    if (!eligibility.eligible) {
        influenceAudit.record({
            userId, env: resolvedEnv, symbol, regime,
            phase2Decision, proposedDecision: phase2Decision,
            gateStatus: 'skipped',
            gateReason: `not_eligible_${eligibility.reason}`,
            rationale: { eligibility },
            ts: nowTs
        });
        return { ...phase2Decision, layeredBy: 'ring5-influence-not-eligible' };
    }

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
Expected: PASS — all original Day 1+3 tests still green + new Phase 5 eligibility test green. NOTE: the Day 3 tests `mode=influence with no mlBrainProInputs -> skipped audit row` and `mode=influence with neutral signals -> skipped (no proposal)` will now fail with `ring5-influence-not-eligible` instead of `ring5-influence-skipped` because the test users don't have observations or active versions. **Update those Day 3 tests** to either (a) expect the new `not-eligible` outcome OR (b) seed bandit+version+preReg before the wrap call.

Choose (a) — simpler. Update the two Day 3 tests in `ring5LearningService.test.js`:

```javascript
test('mode=influence with no mlBrainProInputs -> not-eligible (no seeded version)', () => {
    const r = ring5.wrap({
        userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
        regime: 'trending', marketContext: {}, nowTs: Date.now(),
        mode: 'influence',
        phase2Decision: _phase2(), mlBrainProInputs: null
    });
    expect(r.layeredBy).toBe('ring5-influence-not-eligible');
    const audit = db.prepare("SELECT gate_status, gate_reason FROM ml_influence_audit").get();
    expect(audit.gate_status).toBe('skipped');
});

test('mode=influence with neutral signals -> not-eligible (no seeded version)', () => {
    const r = ring5.wrap({
        userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT',
        regime: 'trending', marketContext: {}, nowTs: Date.now(),
        mode: 'influence',
        phase2Decision: _phase2(),
        mlBrainProInputs: { contributions: [{ moduleId: 'm', contribution: 0.0 }] }
    });
    expect(r.layeredBy).toBe('ring5-influence-not-eligible');
    expect(r.confidence).toBe(70);
});
```

Re-run: PASS — all 16+ tests green.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add server/services/ml/ring5LearningService.js tests/unit/ml/ring5LearningService.test.js && git commit -m "feat(ml-phase-b-day4): wire wrap() to influenceEligibility gate

_wrapInfluence now checks eligibility BEFORE drawing bandit sample. On
failure: audit row gate_status='skipped' + gate_reason='not_eligible_<reason>',
returns {...phase2, layeredBy: 'ring5-influence-not-eligible'}.

Day 3 tests updated to reflect that influence-mode is no-op until operator
seeds versionRegistry + preRegistration + bandit observations.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5.3: Day 4 closeout

- [ ] **Step 1: Full regression**

Run: `cd /root/zeus-terminal && npx jest --maxWorkers=2 2>&1 | tail -8`
Expected: total tests increase by ~7 vs Day 3 baseline (6748). Zero new failures attributable to Phase 5.

- [ ] **Step 2: Tag**

```bash
cd /root/zeus-terminal && TAG="ml-plan-v3-phase-b-day4-phase5-COMPLETE-$(date -u +%Y%m%d-%H%M%S)" && git tag -a "$TAG" -m "ML Plan v3 Phase B Day 4 — Phase 5 Pre-Registration Eligibility Gate COMPLETE

Day 4 deliverables:
- influenceEligibility.js (4-check composite: observations + version + preReg + eval window)
- _wrapInfluence extended with eligibility gate at head
- Day 3 baseline tests updated to reflect new gate

Wires existing Wave 3 preRegistration.js + versionRegistry.js without changes.

Phase 2 fusion math UNTOUCHED. mode='shadow' default still backward compatible.
Phase 6 (tieredPromotion background job) / Phase 7 (deploy+obs) deferred to Day 5+."
```

- [ ] **Step 3: Push**

```bash
cd /root/zeus-terminal && git push origin HEAD --tags
```

- [ ] **Step 4: Memory update**

Append Day 4 SHIPPED note to the ML Plan v3 ACTIVE RESUMED memory entry (line 23 in MEMORY.md, after Day 3 SHIPPED block).

---

## Self-Review

**1. Spec coverage:**
- Phase 5 = preRegistration wiring ✅ (Task 5.1 + 5.2)
- §247* hash-locked anti-p-hacking ✅ (uses existing preRegistration.js Wave 3 shipment unchanged)
- WRAP NOT REWRITE ✅ (Phase 2 fusion untouched, preRegistration/versionRegistry unchanged)
- Per-cell isolation ✅ (Test "user 1 trained vs user 2 not")
- Phase 6/7 explicitly deferred to Day 5+ — no scope creep

**2. Placeholder scan:** None. All code complete, commands explicit.

**3. Type consistency:**
- `eligibility` shape `{eligible, reason, observationCount, preRegStatus, versionId}` consistent across module + wrap consumer
- `reason` enum values consistent with module-level definitions
- `layeredBy` new marker `'ring5-influence-not-eligible'` follows Day 3 prefix pattern `ring5-influence-*`

---

## Execution Handoff

Plan saved. Inline executing-plans recommended for this scope (3 tasks, tightly coupled).

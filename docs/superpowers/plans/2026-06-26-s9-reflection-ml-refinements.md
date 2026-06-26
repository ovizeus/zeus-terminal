# S9 Reflection Enforcement (finish) + ML Refinements (fill gaps) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans + test-driven-development. Steps use `- [ ]`.

**Goal:** Finish the small remaining bits of S9 (reflection-blocking is ALREADY implemented — add the missing audit event + Telegram alert, then measure the block rate over a soak), then fill the GENUINE gaps in the ML pre-REAL refinements (most are already built — the confirmed missing piece is the `/api/ml/stage-promote` sign-off endpoint; the rest need a status-verify first).

**Architecture:** Reflection already runs in `serverBrain.js` (`serverReflection.questionEntry` → `proceed:false` blocks the entry at ~line 1269, plus a confidence-penalty path at ~1298). We only ADD an explicit audit record + a throttled operator Telegram alert on block, and a measurement script for the block rate. ML refinements: verify each of the 6 (S9 turned out mostly-done — expect the same), build only the genuinely-missing endpoint, fill any real gaps the verify pass finds.

**Tech Stack:** Node CommonJS, Express, better-sqlite3, Jest. `telegram.sendToUser`, lazy `require('./audit').record`, `serverReflection.js`.

**Reality check (verified 2026-06-26):** S9.1 blocking = DONE. ML #6 drawdown auto-halt = DONE (`_r7AssessDD`/`ddAssess.locked`). ML #1 attribution tests = partial (`exit-fill-attribution.test.js`). ML #5 stage-promote endpoint = MISSING. ML #2/#3/#4 = verify.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `server/services/serverReflection.js` | MODIFY | export pure `buildReflectionAlert(symbol, dir, concerns)` (alert text) + `shouldAlert(key, now)` (throttle) |
| `server/services/serverBrain.js` | MODIFY | on reflection block (~1284 + ~1306): `audit.record('REFLECTION_BLOCKED')` + throttled `telegram.sendToUser` |
| `scripts/reflection-rate.js` | CREATE | measurement: block-rate from the brain decision log (for the soak/tuning) |
| `server/routes/admin.js` | MODIFY | `POST /api/admin/ml/stage-promote` (sign-off + audit) — the confirmed-missing ML #5 |
| `tests/unit/reflection-alert.test.js` | CREATE | TDD the pure alert builder + throttle |

---

## PHASE 1 — S9: finish reflection enforcement

### Task 1: Audit event + throttled Telegram alert on reflection block

**Files:** Modify `server/services/serverReflection.js`, `server/services/serverBrain.js`; Test `tests/unit/reflection-alert.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/reflection-alert.test.js
const { buildReflectionAlert, shouldAlert, _resetAlertThrottle } = require('../../server/services/serverReflection');

describe('reflection alert (pure)', () => {
  beforeEach(() => _resetAlertThrottle());
  test('buildReflectionAlert summarizes the block', () => {
    const msg = buildReflectionAlert('BTCUSDT', 'LONG', [{ type: 'losing_streak' }, { type: 'dangerous_regime' }]);
    expect(msg).toContain('BTCUSDT');
    expect(msg).toContain('LONG');
    expect(msg).toContain('losing_streak');
    expect(msg).toContain('dangerous_regime');
  });
  test('shouldAlert throttles repeat keys within the window', () => {
    expect(shouldAlert('1:BTCUSDT:LONG', 1000)).toBe(true);     // first → alert
    expect(shouldAlert('1:BTCUSDT:LONG', 1000 + 60000)).toBe(false); // 1min later → throttled
    expect(shouldAlert('1:BTCUSDT:LONG', 1000 + 11 * 60000)).toBe(true); // >10min → alert again
    expect(shouldAlert('1:ETHUSDT:SHORT', 1000)).toBe(true);    // different key → alert
  });
});
```

- [ ] **Step 2: Run → fail** — `sudo -u zeus npx jest tests/unit/reflection-alert.test.js --forceExit --runInBand` → `buildReflectionAlert is not a function`

- [ ] **Step 3: Implement in `server/services/serverReflection.js`** (add near the exports)

```javascript
const _alertThrottle = new Map(); // key → last alert ts
const ALERT_WINDOW_MS = 10 * 60 * 1000;
function shouldAlert(key, now) {
    const last = _alertThrottle.get(key) || 0;
    if (now - last < ALERT_WINDOW_MS) return false;
    _alertThrottle.set(key, now);
    return true;
}
function _resetAlertThrottle() { _alertThrottle.clear(); }
function buildReflectionAlert(symbol, dir, concerns) {
    const types = (concerns || []).map((c) => c.type).join(', ') || 'reflection';
    return `🧠 Brain blocked ${dir} ${symbol} — second-guessed: ${types}`;
}
```
Add to `module.exports`: `buildReflectionAlert, shouldAlert, _resetAlertThrottle`.

- [ ] **Step 4: Run → pass** (2 tests)

- [ ] **Step 5: Wire into `serverBrain.js`** — in the reflection-block path (after the `serverReflection.trackSkippedTrade(...)` call inside `if (!questioning.proceed)`, ~line 1283) add:

```javascript
                        try { require('./audit').record('REFLECTION_BLOCKED', { userId, symbol: snap.symbol, dir: fusion.dir, confidence: fusion.confidence, concerns: questioning.concerns.map(c => c.type) }, 'SERVER_BRAIN'); } catch (_) { /* */ }
                        try {
                            if (serverReflection.shouldAlert(`${userId}:${snap.symbol}:${fusion.dir}`, Date.now())) {
                                telegram.sendToUser(userId, serverReflection.buildReflectionAlert(snap.symbol, fusion.dir, questioning.concerns));
                            }
                        } catch (_) { /* */ }
```

- [ ] **Step 6: Validate + no-regression** — `node --check server/services/serverBrain.js`; `sudo -u zeus npx jest tests/unit/reflection-alert.test.js --forceExit --runInBand` (2 pass).

- [ ] **Step 7: Commit**

```bash
git add server/services/serverReflection.js server/services/serverBrain.js tests/unit/reflection-alert.test.js
git commit -m "feat(S9): audit event + throttled Telegram alert on reflection block (TDD)"
```

### Task 2: Reflection block-rate measurement (the soak/tune)

**Files:** Create `scripts/reflection-rate.js`

- [ ] **Step 1: Implement the measurement script** — reads the brain decision log and reports the reflection block rate (the S9.2 soak metric: target 10-20%).

```javascript
#!/usr/bin/env node
'use strict';
// Reflection block-rate over the brain decision log. finalAction=blocked_reflection
// (+ blocked_reflection_penalty) vs all entry-eligible decisions. Target 10-20%.
const db = require('../server/services/database');
const since = Date.now() - (parseInt(process.argv[2], 10) || 7) * 86400000; // default 7d
const rows = db.db.prepare("SELECT final_action FROM brain_decision_log WHERE ts >= ?").all(since);
let total = 0, blocked = 0;
for (const r of rows) {
    const a = r.final_action || '';
    if (a === 'no_trade' || a.startsWith('blocked') || a === 'entry' || a === 'committed') total++;
    if (a === 'blocked_reflection' || a === 'blocked_reflection_penalty') blocked++;
}
const pct = total ? (blocked / total * 100) : 0;
console.log(`reflection block rate: ${blocked}/${total} = ${pct.toFixed(1)}%  (target 10-20%)`);
process.exit(0);
```
*Note:* if the brain decision log table/columns differ, adapt the query — first run `sqlite3 data/zeus.db ".schema brain_decision_log"` to confirm the column names (`final_action`, `ts`).

- [ ] **Step 2: Run it** — `sudo -u zeus node scripts/reflection-rate.js 7` → prints the rate.
- [ ] **Step 3: Interpret + tune ONLY if needed** — if rate is 10-20%: done, no change. If >30% (too aggressive): in `serverReflection.questionEntry`, soften which concerns set `proceed=false` (e.g. require 2+ high-severity concerns, or downgrade some to penalty-only). If <5% over a representative period with real concerning trades: investigate why (likely just low volume — note it, do NOT force blocks).
- [ ] **Step 4: Commit the script** — `git add scripts/reflection-rate.js && git commit -m "feat(S9): reflection block-rate measurement script (soak metric)"`

**S9 GATE:** alert+audit shipped; block-rate measured. If the rate needs tuning, that is one more small commit. Then S9 is done.

---

## PHASE 2 — ML refinements (verify-first, fill genuine gaps)

### Task 3: Status-verify the 6 ML refinements (concrete checks)

- [ ] Run each check and record DONE / PARTIAL / MISSING:

```bash
cd /opt/zeus-terminal
# #1 DD2 attribution tests
ls tests/unit/*attribution* tests/unit/*dd2* 2>/dev/null
# #2 digest-lookup refinement (ORDER BY DESC LIMIT 1 approximation)
grep -rn "decision.*digest\|digest.*lookup\|ORDER BY.*DESC LIMIT 1" server/services/*.js | grep -i digest
# #3 evaluatePerformance cron wiring
grep -rn "evaluatePerformance" server/services/*.js server.js
# #4 automated soak-validation script
ls scripts/*soak*sanity* scripts/s7-sanity* 2>/dev/null
# #5 stage-promote endpoint (CONFIRMED missing)
grep -rn "stage-promote\|stagePromote" server/routes/*.js
# #6 drawdown auto-halt (CONFIRMED done: _r7AssessDD / ddAssess.locked) — verify it gates entries
grep -n "ddAssess.locked\|_r7AssessDD" server/services/serverBrain.js
```
- [ ] Output: the genuine gap list. (Expectation from prior verification: #6 done, #1 partial, #5 missing; #2/#3/#4 to confirm.)

### Task 4: `/api/admin/ml/stage-promote` sign-off endpoint (the confirmed-missing #5)

**Files:** Modify `server/routes/admin.js` (mirror the `/halt` admin endpoint pattern: `_requireAuth, _requireAdmin`)

- [ ] **Step 1: Add the endpoint** (before `module.exports = router;`)

```javascript
// POST /api/admin/ml/stage-promote — operator signs off advancing the ML soak stage.
// Body: { stage: number, note?: string }. Records an auditable promotion event.
router.post('/ml/stage-promote', _requireAuth, _requireAdmin, express.json(), (req, res) => {
    const stage = parseInt(req.body && req.body.stage, 10);
    if (!Number.isFinite(stage) || stage < 1 || stage > 12) return res.status(400).json({ ok: false, error: 'stage 1-12 required' });
    const note = String((req.body && req.body.note) || '').slice(0, 500);
    try {
        require('../services/audit').record('ML_STAGE_PROMOTE', { stage, note, by: req.user.id, ts: Date.now() }, 'ADMIN');
        return res.json({ ok: true, stage, note });
    } catch (e) { return res.status(500).json({ ok: false, error: 'promote failed' }); }
});
```

- [ ] **Step 2: Validate** — `node --check server/routes/admin.js`.
- [ ] **Step 3: Live smoke (after deploy)** — `curl -X POST /api/admin/ml/stage-promote` with admin cookie + `{stage:8,note:"test"}` → `{ok:true}`; confirm the `ML_STAGE_PROMOTE` audit row exists.
- [ ] **Step 4: Commit** — `git add server/routes/admin.js && git commit -m "feat(ML): /api/admin/ml/stage-promote sign-off endpoint with audit (#5)"`

### Task 5: Fill the remaining real gaps found in Task 3

- [ ] For each item Task 3 marked PARTIAL/MISSING (likely #2 digest refinement, #3 cron wiring, #4 soak-validation script, #1 DD2 test gaps), write a concrete TDD sub-task here AFTER Task 3 reveals the exact current code. Do NOT pre-write code for unverified internals — Task 3 is the gate. (#6 drawdown is already done — only add a regression test asserting `ddAssess.locked` blocks an entry, if one does not already exist.)

---

## Deploy + verify (after each phase)
- [ ] Targeted jest green (reflection-alert + any new). NOT the full suite on the live VPS.
- [ ] `node -e "require('./server/version.js')"` after any version bump; `pm2 reload zeus --update-env`; health check; **close any Playwright + kill chrome if used (the CPU-starvation lesson).**
- [ ] Update `docs/BOOK_OF_ALL.md` (mark S9 done once the rate is acceptable; update #13 as ML gaps close) + memory.

## Self-Review
**Spec coverage:** S9.1 blocking (already done — verified). S9 audit+Telegram → Task 1. S9.2 soak/tune → Task 2. ML #5 endpoint → Task 4. ML #1-#4,#6 → Task 3 verify + Task 5 fill. All covered.
**Placeholder scan:** Task 5 intentionally defers concrete code to AFTER Task 3's verification (the honest dependency — prior verification proved these items are more-built than the old plan claims; writing code for unverified internals would be the real error). Tasks 1, 2, 4 are fully concrete.
**Type consistency:** `buildReflectionAlert(symbol,dir,concerns)` / `shouldAlert(key,now)` / `_resetAlertThrottle()` used identically in test + impl + serverBrain wiring. `audit.record(action, payload, source)` matches the serverAres usage pattern.

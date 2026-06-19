# Mega-Audit Fix Campaign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, with a STOP+report checkpoint before/after every fix). Steps use `- [ ]` checkboxes.

**Goal:** Fix every bug found in `/root/_review/audit/MEGA_AUDIT_20260619.md` (5×P1, ~11×P2, ~13×P3 + canonical still-open), in risk-ordered phases, money-path-safe, no bug skipped.

**Architecture:** Each fix is self-contained: backup → failing test (TDD for business logic) → minimal fix → targeted green → report. Server fixes back up to `<file>.bak.pre-<slug>-20260619` first. Client fixes build + chown. Deploy (pm2 reload / build) ONLY on verified-green, and STOP for operator GO before any change that alters live DSL/SL behaviour during the soak.

**Tech Stack:** Node CommonJS (server/), TS+Vite (client/src/), jest (ts-jest), better-sqlite3, pm2 process `zeus`.

---

## STANDING DISCIPLINE — applies to EVERY task (do not forget)

1. **3× verify**: read the exact current lines before editing (Edit needs exact match); re-read after; run the test.
2. **Backup before any server edit**: `cp server/.../X.js server/.../X.js.bak.pre-<slug>-20260619`.
3. **TDD for business logic** (math, decisions, money-path): write the failing test FIRST, see it fail, then fix, see it pass. Pure display/i18n fixes get a lighter assertion or a visual note.
4. **NEVER full jest on the live VPS** (starves brain → GLOBAL_HALT). Only targeted:
   `npx jest tests/unit/<file>.test.js --forceExit --runInBand > /tmp/jest-<slug>.log 2>&1` then read the log. Never `tail -f`, never the whole suite.
5. **Client build**: `npm run build` then `chown -R zeus:zeus /opt/zeus-terminal/public/app`.
6. **Deploy**: server verified-green → `pm2 reload zeus` is pre-authorised (operator confirmed) EXCEPT for live-DSL/SL behaviour changes → STOP + report + GO first. Client green build auto-deploy is allowed.
7. **CSRF**: any test hitting POST/PUT/DELETE must set header `X-Zeus-Request: 1`.
8. **Report before AND after each fix** (operator directive). If anything looks off → STOP and report, don't push through. If a NEW bug appears on the way → fix it + report before and after.
9. **Do NOT heavy-query/JOIN live zeus.db**; read-only single SELECT on a /tmp copy only if needed.
10. **Crash-safety**: commit after each green fix (checkpoint) — disk persists on VPS.

---

## PHASE 1 — P1 money-path / safety (highest priority)

### Task 1: ARES auto-entries bypass server double-execution 409 (P1-2) — client, lowest-risk
**Files:** Modify `client/src/trading/liveApi.ts:486-494` (`aresPlaceOrder` body). Test: `tests/unit/ares-source-tag.test.ts` (new) OR extend `tests/unit/ares-rules.test.js`.

Root cause: `aresPlaceOrder` POST body omits `source`; server `ownership.js:55 shouldRejectClientAutoOrder` only rejects `source==='auto'`. AT sends `source:'auto'` and is caught; ARES slips the 409 backstop.

- [ ] **Step 1 — backup + failing test.** Add a unit test asserting `shouldRejectClientAutoOrder` would reject an ARES-shaped order once tagged. Pure-server assertion (the real gap is the missing tag):
```js
// tests/unit/ares-source-tag.test.js
const { shouldRejectClientAutoOrder } = require('../../server/services/ownership');
test('ARES auto order tagged source:auto IS rejected when server owns entries', () => {
  expect(shouldRejectClientAutoOrder({ serverOwnsEntries: true, source: 'auto', reduceOnly: false })).toBe(true);
});
test('untagged ARES order (current bug) is NOT rejected — regression guard', () => {
  expect(shouldRejectClientAutoOrder({ serverOwnsEntries: true, source: undefined, reduceOnly: false })).toBe(false);
});
```
- [ ] **Step 2 — run it:** `npx jest tests/unit/ares-source-tag.test.js --forceExit --runInBand > /tmp/jest-ares.log 2>&1` — both pass (documents current behaviour: untagged slips through).
- [ ] **Step 3 — fix:** add `source: 'auto',` to the `aresPlaceOrder` JSON body (after `referencePrice`). One line.
- [ ] **Step 4 — verify server still accepts the field** (no server change needed; trading.js already reads `req.body.source`). Confirm by reading `server/routes/trading.js` order/place handler that `source` flows into `shouldRejectClientAutoOrder` ctx.
- [ ] **Step 5 — build + chown + report.** `npm run build` green, chown. This is client-only + restores a *second* safety layer (the client `serverOwnsAT()` gate still primary) → low risk, but **money-path: report before/after**. Auto-deploy allowed on green.

### Task 2: Protected REAL flags bypassable via `/api/migration/flags` (P1-1) — server
**Files:** Modify `server/migrationFlags.js` (add `PROTECTED_FLAGS` export + guard in `set()`); Modify `server.js:341-360` (route-level 403 + audit, referencing `MF.PROTECTED_FLAGS`); optionally refactor `server/routes/auth.js:1023` to use the shared set. Test: extend `tests/unit/admin-flags-protected.test.js` + new `tests/unit/migrationFlags-protected-set.test.js`.

Root cause: `set()` enforces only the mutex, not the protected blocklist. `/auth/admin/flags` guards; `/api/migration/flags` (server.js:349) does not. The formal flip procedure edits `data/migration_flags.json` + restart (bypasses `set()`), so guarding `set()` against `true` is safe and DRY.

- [ ] **Step 1 — backup:** `cp server/migrationFlags.js server/migrationFlags.js.bak.pre-protflag-20260619`.
- [ ] **Step 2 — failing test:**
```js
// tests/unit/migrationFlags-protected-set.test.js
const MF = require('../../server/migrationFlags');
test('set(_SRV_POS_REAL_ENABLED, true) is REFUSED (protected, fail-closed)', () => {
  expect(() => MF.set('_SRV_POS_REAL_ENABLED', true)).toThrow(/protected/i);
  expect(MF.getAll()._SRV_POS_REAL_ENABLED).toBe(false);
});
test('set(_SRV_POS_REAL_ENABLED, false) is ALLOWED (emergency-off, fail-safe)', () => {
  expect(() => MF.set('_SRV_POS_REAL_ENABLED', false)).not.toThrow();
});
test('non-protected flag still settable', () => {
  expect(() => MF.set('ALT_WS_FEEDS', false)).not.toThrow();
});
```
- [ ] **Step 3 — run:** `npx jest tests/unit/migrationFlags-protected-set.test.js --forceExit --runInBand > /tmp/jest-protflag.log 2>&1` — first test FAILS (no guard yet).
- [ ] **Step 4 — fix in `migrationFlags.js`:** add near top `const PROTECTED_FLAGS = new Set(['_SRV_POS_REAL_ENABLED', '_USERDATA_STREAM_REAL_ENABLED']);` and in `set()` after the boolean check:
```js
if (PROTECTED_FLAGS.has(key) && value === true) {
  const err = new Error(`Flag ${key} is protected — REAL execution flips only via the formal operator procedure (edit data/migration_flags.json + restart), never an admin route.`);
  err.code = 'MF_PROTECTED_FLAG';
  throw err;
}
```
Export `PROTECTED_FLAGS` in `module.exports`.
- [ ] **Step 5 — route layer (server.js:349):** before `MF.set(...)`, add:
```js
const MF2 = require('./server/migrationFlags');
if (MF2.PROTECTED_FLAGS && MF2.PROTECTED_FLAGS.has(key) && value === true) {
  try { db.auditLog(_req.user.id||null, 'ADMIN_FLAG_TOGGLE_BLOCKED', { key, requested: value, route: '/api/migration/flags' }, _req.ip); } catch (_) {}
  return res.status(403).json({ error: 'Flag protected — operator procedure only' });
}
```
(Confirm exact `MF` require alias already in server.js; reuse it instead of MF2 if present.)
- [ ] **Step 6 — run** the protected-set test + existing `admin-flags-protected.test.js` + `migrationFlags-defaults.test.js` + `migrationFlags-coherence-wiring.test.js` (regression). All green.
- [ ] **Step 7 — report + reload.** Server safety fix, verified green → `pm2 reload zeus` (pre-authorised; not a DSL/SL behaviour change). Report before/after.

### Task 3: `_updateLiveSL` defensive monotonic floor (P2-floor) — backstops P1-3 & P1-4
**Files:** Modify `server/services/serverAT.js:2860` (`_updateLiveSL`). Test: new `tests/unit/updateLiveSL-monotonic.test.js` (extract pure helper).

This is the single exchange-write choke point. A "stop never moves against the trader" floor here catches DSL activation (P1-3), client manual edit (P1-4) and restart re-tighten (P3). **SOAK-SENSITIVE — STOP for GO before reload.**

- [ ] **Step 1 — backup:** `cp server/services/serverAT.js server/services/serverAT.js.bak.pre-slfloor-20260619`.
- [ ] **Step 2 — failing test** on a pure helper `_isSLImprovement(side, oldSL, newSL)`:
```js
// LONG: SL may only move UP (≥ old). SHORT: only DOWN (≤ old).
const { _slGuardHooks } = require('../../server/services/serverAT');
const ok = _slGuardHooks.isSLImprovement;
test('LONG rejects looser (lower) SL', () => { expect(ok('LONG', 100, 99)).toBe(false); });
test('LONG accepts tighter (higher) SL', () => { expect(ok('LONG', 100, 101)).toBe(true); });
test('SHORT rejects looser (higher) SL', () => { expect(ok('SHORT', 100, 101)).toBe(false); });
test('SHORT accepts tighter (lower) SL', () => { expect(ok('SHORT', 100, 99)).toBe(true); });
```
- [ ] **Step 3 — fix:** add helper + apply at top of `_updateLiveSL` (after the live-status guard): compute current resting SL (`pos.live.slPrice` or `pos.dsl.currentSL` prior value) and, if `newSL` is NOT an improvement vs it, log `AT_LIVE` warn `[seq] SL-floor rejected non-improving DSL SL` and `return` WITHOUT placing. Keep a one-line audit. Export `_slGuardHooks = Object.freeze({ isSLImprovement })`.
  - **Note:** must read the exact field holding the current SL price at execution (likely `pos.live.slPrice`/`pos.dsl.currentSL`) and guard against `null` (first placement always allowed).
- [ ] **Step 4 — run:** `npx jest tests/unit/updateLiveSL-monotonic.test.js dslfix-sl-breach-guard.test.js dslfix-user-control.test.js serverDSL-exchange.test.js --forceExit --runInBand > /tmp/jest-slfloor.log 2>&1` — all green, no regression.
- [ ] **Step 5 — STOP + report.** This changes live SL placement behaviour during the soak. Report the floor + green tests; **await operator GO** before `pm2 reload zeus`.

### Task 4: DSL activation can loosen SL below originalSL (P1-3) — server, SOAK-SENSITIVE
**Files:** Modify `server/services/serverDSL.js:198-203` (activation). Test: extend `tests/unit/serverDSL-exchange.test.js` or new `tests/unit/serverDSL-activation-floor.test.js`.

- [ ] **Step 1 — backup:** `cp server/services/serverDSL.js server/services/serverDSL.js.bak.pre-actfloor-20260619`.
- [ ] **Step 2 — failing test:** activate with a swing preset (`pivotLeftPct 1.30`) + a tighter `originalSL` (0.3%) for a LONG → assert `currentSL >= originalSL`; SHORT mirror → `currentSL <= originalSL`.
- [ ] **Step 3 — fix:** after `s.pivotLeft = _safePrice(s.pivotLeft, s.originalSL)`, clamp toward-trader:
```js
// [AUDIT-20260619 P1-3] activation must never loosen below the user's original SL
if (s.originalSL != null && Number.isFinite(s.originalSL)) {
  s.pivotLeft = isLong ? Math.max(s.pivotLeft, s.originalSL) : Math.min(s.pivotLeft, s.originalSL);
}
s.currentSL = s.pivotLeft;
```
- [ ] **Step 4 — run** the DSL suite (Task 3 command set) green.
- [ ] **Step 5 — STOP + report**, GO before reload (bundle reload with Task 3 + Task 5 since all are serverDSL/serverAT + soak).

### Task 5: Client DSL manual param edit moves SL against trader (P1-4) — client
**Files:** Modify `client/src/trading/dsl.ts:929-936` (`dslManualParam` LIVE RECALC). Test: extend `tests/unit/` TS dsl test if one exists, else add `tests/unit/dsl-manual-monotonic.test.ts`.

- [ ] **Step 1 — failing test:** simulate `dslManualParam` widening `pivotLeftPct` mid-trade on a LONG → assert resulting `currentSL` not below previous `pivotLeft`.
- [ ] **Step 2 — fix:** clamp the recomputed `pivotLeft` toward-trader against the existing `_dsl.pivotLeft` before assigning `currentSL`/`_syncLiveSL` (mirror engine impulse clamp at dsl.ts:707-711):
```js
const _pl = isLong ? cur * (1 - _san.pivotLeftPct/100) : cur * (1 + _san.pivotLeftPct/100)
_dsl.pivotLeft = (_dsl.pivotLeft!=null) ? (isLong ? Math.max(_dsl.pivotLeft, _pl) : Math.min(_dsl.pivotLeft, _pl)) : _pl
_dsl.currentSL = _dsl.pivotLeft
```
- [ ] **Step 3 — run** test green; `npm run build` + chown.
- [ ] **Step 4 — report** before/after. (Client; but money-path SL → bundle with operator GO alongside Tasks 3-4.)

### Task 6: userDataStream side-flip corrupts tracked position (P1-5) — server
**Files:** Modify `server/services/serverAT.js:6182-6189` (lookup) + `:6345-6356` (MODIFIED branch). Test: extend `tests/e2e/recon-external-sync.test.js` pattern or new unit on the side-detection helper.

- [ ] **Step 1 — backup** (same serverAT backup from Task 3 covers it; take a fresh `.bak.pre-sideflip-20260619` if Task 3 already committed).
- [ ] **Step 2 — failing test:** feed a userDataStream MODIFIED event whose `positionAmt` sign is OPPOSITE the tracked `existing.side` → assert the handler does NOT silently keep the stale side (it should detect the flip and either re-derive side + re-evaluate protection, or defer to recon — fail-safe).
- [ ] **Step 3 — fix:** in the MODIFIED branch, compute `flipSide = p.positionAmt>0?'LONG':'SHORT'`; if `flipSide !== existing.side`, log a WARN + treat as a close-of-old/open-of-new (or defer adoption to recon via the same path as the phantom-short guard) rather than blindly updating qty on a wrong-sided row. Must NOT invert PnL/SL. Conservative: detach DSL, mark for recon re-evaluation.
- [ ] **Step 4 — run** `serverAT`/recon tests green.
- [ ] **Step 5 — STOP + report**, GO before reload (serverAT money-path).

---

## PHASE 2 — P2 wrong-decision / sizing / data-integrity

### Task 7: KNN "neutral" prediction must be a no-op, not a penalty (P2) — server, money-path
**Files:** Modify `server/services/serverKNN.js:200-212` (`getKNNModifier`). Test: extend `tests/unit/knn.test.js`.
- [ ] Failing test: `getKNNModifier('LONG', {dir:'neutral', confidence:0})` should be `1.0` (currently 0.92).
- [ ] Fix: first line of body after `if(!prediction)`: `if (prediction.dir !== 'LONG' && prediction.dir !== 'SHORT') return 1.0;`
- [ ] Run `knn.test.js` + `brainV3.test.js` green. Server reload pre-authorised (decision-input, not SL) → but report; it changes live entry confidence, so STOP+GO (money-path decision change).

### Task 8: Brain re-tier-after-penalty over-sizing (P2) — server, money-path
**Files:** Modify `server/services/serverBrain.js` re-tier blocks (~`1223-1290`, `1335-1348`). Test: extend `tests/unit/brainV3.test.js` / `below-small-bar.test.js`.
- [ ] Failing test: a LARGE decision penalised to conf 75 must re-tier to MEDIUM (not stay LARGE).
- [ ] Fix: replace the partial re-tier shortcuts with a single call to the full tier classifier (`_classifyTier`) after every confidence mutation, so 72–81 → MEDIUM, 62–71 → SMALL, etc.
- [ ] Run brain suite green. STOP+GO before reload (changes live sizing).

### Task 9: `r_multiple` Infinity into ML attribution (P2) — server, data integrity
**Files:** Modify `server/services/serverAT.js:2560`. Test: new `tests/unit/r-multiple-precedence.test.js` on an extracted helper or assert via attribution path.
- [ ] Failing test: win + `slPct=0` currently yields `Infinity`; expect finite (fallback 1).
- [ ] Fix: `r_multiple: pos.rr && pnl !== 0 ? (pnl > 0 ? Math.abs(pnlPct / (pos.slPct || 1)) : -1) : null,`
- [ ] Run green. Reload pre-authorised (telemetry, not execution) — report.

### Task 10: `mscan` live confidence modifier coupled to shadow state (P2) — server
**Files:** `server/services/serverBrain.js:2317` + `_updateServerSigDir` at `:1669`. Test: extend brain test.
- [ ] Failing test: with `PARITY_SHADOW_ENABLED=false` and brain live, `_serverSigDirState` must still be fed (or `mscan` must degrade explicitly, not silently freeze).
- [ ] Fix: move `_updateServerSigDir` out of the shadow-only path so the live path updates it directly (or gate `mscan` on freshness with an explicit log when stale). STOP+GO before reload (decision input).

### Task 11: ML-DSL `simulate()` ≠ real `tick()` biases learner reward (P2) — server, learning
**Files:** `server/services/serverDSL.js:393-414` (`simulate`). Test: extend `tests/unit/serverDslSimulate.test.js`.
- [ ] Failing test: a scenario where `simulate` floors at originalSL + trails continuously but `tick` does neither → assert baseline matches the (now floor-fixed, Task 4) engine semantics.
- [ ] Fix: align `simulate` to the post-Task-4 engine (floor at originalSL is now TRUE in both; remove the continuous-trail divergence OR document it as intentional and adjust reward). Re-run `mlDslLearner`/`mlDslBandit`/`serverDslSimulate` tests green. Learning-only → reload pre-authorised, report. **Note:** depends on Task 4 landing first.

### Task 12: Exchange switch → zero active exchange / LIVE LOCKED (P2) — server, money-path
**Files:** `server/routes/exchange.js:413-468`. Test: extend `tests/unit/exchangeSwitchHelpers.test.js`.
- [ ] Failing test: target exchange has only an UNVERIFIED row → switch must NOT deactivate-all-then-activate-none; either reject up front or roll back.
- [ ] Fix: make Step 3.5 pre-flight require `status='verified'` (align with Step 7), OR wrap the transaction to throw/rollback when `_targetRow` is null. Return an explicit error, not `ok:true`.
- [ ] Run exchange suite green. Reload pre-authorised (no live SL change) — report.

### Task 13: Per-indicator PnL analytics permanently $0 (P2) — client, display
**Files:** `client/src/engine/perfStore.ts:44` (`recordIndicatorPnl` never called); wire it at the AT close path (`client/src/trading/autotrade.ts:~1696` `recordAllIndicators`). Test: TS unit if present.
- [ ] Failing test/assertion: after a close, `recordIndicatorPnl` populates `pnlSum/winPnl/lossPnl`.
- [ ] Fix: call `recordIndicatorPnl(id, pnl, fees)` alongside `recordIndicatorPerformance` for each active indicator on close. Build + chown. Client display → auto-deploy on green, report.

### Task 14: PnL Lab / DAILY_STATS + server stats blend demo+live+testnet/real (P2) — client+server
**Files:** `client/src/engine/dailyPnl.ts:31-49`, `client/src/services/storage.ts:33`; `server.js:855,898` stats routes. Test: extend stats tests.
- [ ] Failing test: a demo close + a live close in the same day must not co-mingle in the live equity/drawdown; `/api/performance?mode=live&env=testnet` must exclude real.
- [ ] Fix: thread `mode` (+ `env`) filter into `recordDailyClose`/`_addTradeToDailyStats` and the two server routes. Verify `at_closed` carries `env` (runtime-verify). Build + chown + reload. Report.

### Task 15: Radar wsproxy watchlist/quant pollers misclassified P5 (P2) — server
**Files:** `server/services/binanceScheduler.js:16-55` (LANE_RULES). Test: extend `tests/unit/binanceScheduler.test.js`.
- [ ] Failing test: `laneForSrc('wsproxy-watchlist')` should be P3/P4 (price-freshness), not P5.
- [ ] Fix: add a LANE_RULES entry mapping `wsproxy-*` (and `sentiment` per judgement) to a non-shed lane. Run scheduler tests green. Reload pre-authorised, report.

### Task 16: Client `addLiq` NaN poisons liquidation totals (P2) — client
**Files:** `client/src/quantmonitor/state.ts:47-53`. Test: TS unit.
- [ ] Failing test: an event without `vol` must not turn `totalBtc` into NaN.
- [ ] Fix: `ex.totalBtc += Number(liq.vol) || 0` (+ guard the other accumulators). Build + chown. Report.

---

## PHASE 3 — P3 cosmetic / latent (batch; lighter verification)

### Task 17: Brain `fusion.dir === 'bull'` dead compare → R1/charter/TheVoice see every LONG as SHORT (P3)
`server/services/serverBrain.js:1394,1419,1449,1074,1254`. Fix: compare against `'LONG'` (the real enum). Add a brain-test assertion that a LONG decision logs side LONG. STOP+GO before reload only if it changes advisory→blocking behaviour (it shouldn't; advisory). Report.

### Task 18: `w._fakeout.invalid` unguarded in 5 client brain sites (P3)
`client/src/engine/brain.ts:1289,1774,1811,1852,1937,1970`. Fix: guard with `w._fakeout &&` (or a single safe accessor) for consistency. Build + chown.

### Task 19: `effectiveStatus.invalidate` substring over-eviction (P3)
`server/services/ml/_ring5/effectiveStatus.js:61-67`. Fix: drop the `k.includes(cellKey)` branch (keep `k === cellKey`). Test in ml suite. Reload pre-authorised.

### Task 20: Cell-key `:`-join unescaped latent collision (P3)
`banditPosteriors.js:34-42` + mirrors. Fix: assert/encode `regime` has no `:` (or use a safe separator). Add a guard test. Low-risk.

### Task 21: `bootJitter` ReferenceError in ALT price poller (P3)
`server/services/marketFeed.js:524`. Fix: add module-scope `const { bootJitter } = require('../utils/bootJitter')` or qualify the call. Test `bootJitter.test.js` + altPricePoller. Reload pre-authorised.

### Task 22: Bybit data under `binance:` cache keys during ban (P3)
`server/services/marketRadar.js:322-327,489-496,537`. Fix: key by actual `_source` (`${_source}:${symbol}`) or carry a source tag on the cache proxy endpoints. Report.

### Task 23: Backtest table always "0W/0L" (P3)
`client/src/ui/panels.ts:541` + push at `:512`. Fix: carry `wins:r.wins, losses:r.losses` into the row and read `row.wins/row.losses`. Build + chown.

### Task 24: Zero-PnL win-rate mismatch client vs server (P3)
client `manualStats.ts:30`, `dailyPnl.ts:36`, `autotrade.ts` vs server `server.js:832,929,940`. Fix: pick ONE convention (recommend `> 0` = win, `< 0` = loss, `== 0` = neither) and apply both sides. Tests both. Build + reload.

### Task 25: localStorage journal persists 50/200 (P3)
`client/src/services/storage.ts:30-32`. Fix: persist the same cap held in memory (or raise to 200). Build + chown.

### Task 26: `impulseTriggered` not persisted → phase mislabel + restart re-tighten (P3)
`server/services/serverDSL.js:120-132` restore + `serverAT.js:457-468` persist. Fix: include `impulseTriggered` in the snapshot + restore. DSL → bundle with operator GO. Test serverDSL suite.

### Task 27: `serverActive` only refreshed on full-state payloads (P3, informational)
`client/src/core/state.ts:1170-1180`. Fix (optional/defensive): when an AT-state payload omits `serverActive`, leave the locked-safe default; document. Low priority, fail-safe already. Report decision.

### Task 28: Client watchlist `NaN%` / radar hydrate source label (P3)
`WatchlistBar.tsx:74,118` + `marketStore.ts:121`; `marketRadarStore.ts:86-98`. Fix: finite-guard the 24h change render; carry `source` on snapshot hydrate. Build + chown.

---

## PHASE 4 — canonical still-open money-path (larger / some operator-gated)

> These pre-date this audit and several are bigger than a one-task fix. Sequence last; STOP + report scope before each. Do NOT silently skip.

### Task 29: FA-P1-1 Bybit fee rate wrong → kill-switch fires late (HIGH) — server, money-path
`server/services/serverAT.js:343`. Fix: per-exchange fee rate (Bybit ≠ Binance 0.0008 RT) feeding PnL + kill-switch daily tracker. TDD on the fee calc. STOP+GO before reload.

### Task 30: B2 non-Binance price fallback into serverAT SL/TP path (HIGH, flip-blocker) — server
Server SL/TP + DSL trail freeze if `@bookTicker` stalls; exit-side stale-price guard missing. Larger design. STOP + report scope + GO; likely its own session.

### Task 31: BUG B — SL-required guard treats TESTNET as LIVE → closes rejected 400 — server
`trading.js:284-285` `_isTestnet` resolves false. Fix + test. STOP+GO.

### Task 32: BUG C — phantom LIVE testnet positions vs 0 on exchange (orphan family) — server
Recon/driftChecker not cleaning phantom tracking. Larger; overlaps the silent-archive theme. STOP + report scope + GO.

### Task 33: S8-P1-4 `lossStreak`/`dailyTrades` client-tracked → zeroed at S8 → brain gates wrong — server
Move the streak/daily counters server-side (or feed from server state). TDD. STOP+GO.

---

## Self-Review (against the audit spec)
- **Coverage:** every audit finding maps to a task — P1 (Tasks 1,2,4,5,6 + floor 3), P2 (7–16), P3 (17–28), canonical still-open (29–33). No finding dropped.
- **Ordering:** lowest-risk-highest-value first (ARES one-liner, flag guard), then the SL-floor backstop, then the behaviour-changing DSL fixes (gated on GO), then decision/data P2, then cosmetic P3, then the big canonical items.
- **Soak-sensitivity flagged:** Tasks 3,4,5,6,7,8,10,26 + Phase 4 change live decision/SL behaviour → STOP for GO before reload.
- **Type consistency:** helper names (`isSLImprovement`, `_slGuardHooks`, `PROTECTED_FLAGS`) are referenced consistently across tasks.
- **No placeholders:** code shown for each fix; sites where the exact field must be re-confirmed at execution are marked "read exact line at execution".

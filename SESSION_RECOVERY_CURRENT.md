# SESSION RECOVERY — CURRENT (Zeus Terminal)

**Last updated UTC:** 2026-04-25 14:37 (during T+24h S3.1 wait window)
**Status of this file:** non-runtime recovery note. Safe to read. Do NOT use it as source of truth — always re-verify against repo + DB.

---

## 0. WHAT THIS FILE IS

A static handover note. If a Claude session crashes mid-work, the next session
can read this file as a starting point and re-verify everything before acting.
This file does NOT replace the auto-memory in `~/.claude/projects/-root/memory/`
nor the canonical docs in `/root/_review/audit/`.

If you are a Claude instance reading this after a crash:

1. Read this file end-to-end before any action.
2. Re-verify every claim below by reading the actual file/DB/runtime.
3. NEVER treat this file as live state — it freezes at the timestamp above.

---

## 1. REPO + RUNTIME

- Repo: `/root/zeus-terminal`
- Branch: `post-v2/real-finish`
- Version on disk: `server/version.js` = `v1.7.66 b92` (no version bump for S3.1 batch yet)
- pm2 process: `zeus` (cluster, 1 instance, online); restarts ~134, current uptime ~14h
- Live S3.1 code on runtime: YES (because last pm2 restart read S3.1a/b/c/d files from disk)
- Migration flags on disk (`data/migration_flags.json`):
  - `SERVER_MARKET_DATA=true`
  - `SERVER_BRAIN=false`
  - `SERVER_AT=false`
  - `CLIENT_BRAIN=true`
  - `CLIENT_AT=true`
  - `POSITIONS_WS=true`
  - `PARITY_SHADOW_ENABLED=true`
  - `ALT_WS_FEEDS=true`

## 2. UNCOMMITTED FILES (DO NOT TOUCH WITHOUT EXPLICIT GO)

Two files modified but never committed; runtime already reads them from disk
(pm2 restart picked them up). Both should eventually become a commit + version
bump, but ONLY when the operator approves it explicitly:

- `client/src/trading/autotrade.ts` — moves parity POST before multi-sym
  early-return; removes `localStorage.zeus_parity_shadow` gate so client always
  emits parity rows when server flag is on.
- `server/services/binanceSigner.js` — IP-level circuit breaker for 418/429
  bans. Parses "banned until <ts>" and blocks `sendSignedRequest` globally
  until the deadline.

Backups:
- `client/src/trading/autotrade.ts.bak.s3-multisym`
- `server/services/binanceSigner.js.bak.ip-cb`

## 3. CANONICAL S-ROADMAP (NO REORDER, NO SKIP)

Sequence is fixed by the 2026-04-21 Phase 2 Master Audit:

| S | Definition | Status |
|---|---|---|
| S1 | warm-start `at_update` + `/api/at/resume` + mutex fail | SHIPPED b86 v1.7.60 |
| S2 | idempotency end-to-end + `POST /api/panic` global halt | SHIPPED b87 v1.7.61 |
| S2.C | panic gate on all manual + server live-exposure paths | SHIPPED b88 v1.7.62 |
| S3 | parity harness (shadow-only) + `brain_parity_log` table | SHIPPED b92 v1.7.66 |
| S3.1 | per-symbol POST + tier mapping + `_calcConfluenceParity` + `ALT_WS_FEEDS` + primary/coverage split | SHIPPED (uncommitted version bump); commits 860f2aa, c348c2f, 0d82fa2, 6cf6186, a1116a9, 048a3c1 |
| S3 re-soak | T0 = 2026-04-24 14:48 UTC; T+24h = 2026-04-25 14:48 UTC | IN PROGRESS |
| S4 | Bybit live-entry parity (port `binanceSigner.sendSignedRequest` → `bybitSigner.order()` × 6 call sites) | BLOCKED until S3 GREEN |
| S5 | Cooldown + regime persistence fix | BLOCKED |
| S6 | `positions.changed` WS + DEMO server-authoritative flip | BLOCKED |
| S7 | server DSL integration | BLOCKED |
| S8 | TESTNET flip | BLOCKED |
| S9 | reflection enforcement (advisory → binding) | BLOCKED |
| S10 | LIVE opt-in flip | BLOCKED |
| S11 | LIVE global flip | BLOCKED |
| S12 | cleanup — delete client decision path | BLOCKED |

S3 GREEN gate (from `S_ROADMAP.md` and `database.js::queryParityReport`):
- `primaryAgreementPct` ≥ 95% (PRIMARY ADJUSTED, not RAW)
- `primaryPairs` ≥ 500
- `primaryMismatched` real (after NO_TRADE/NO_TRADE adjustment) close to 0 with explained pattern

## 4. S3.1 RE-SOAK CURRENT NUMBERS (snapshot 14:25 UTC, T+23h37m)

| Metric | PRIMARY | COVERAGE |
|---|---|---|
| paired | 365 | 7,119 |
| RAW agreement | 27.12% | 19.43% |
| ADJ agreement | **92.60%** | 98.02% |
| real mismatches | **27** | 141 |

**Verdict at 14:25 UTC:** S3 RED / needs investigation. Below 95% AND below 500
paired AND 27 real mismatches all on BTCUSDT. The official T+24h report runs
at 14:48 UTC. See section 6 for the diagnostic root-cause plan.

## 5. A1–B7 PRE-CODE DOCS

All present in `/root/_review/audit/`. Audit folder is canonical for ML/Brain
build planning. Do NOT begin ML coding. Do NOT modify these docs without
explicit operator GO.

| ID | File | Last edited |
|---|---|---|
| A1 | `FULL_POINTS_RING_MAP_FINAL.md` | 04-25 00:13 — total 244 confirmed |
| A2 | `ML_PHASE2_INTEGRATION_PLAN.md` | 04-25 00:29 — wrap don't replace; Ring5LearningService facade |
| A3 | `COMMENTARY_MODEL_SPEC.md` | 04-25 00:32 — evidence-backed templates, NO raw chain-of-thought |
| B1 | `FILE_BY_FILE_RING_CLASSIFICATION_FINAL.md` | 04-25 00:35 |
| B2 | `BRAIN_BUILD_PLAN_FINAL.md` | 04-25 00:38 |
| B3 | `RISKS_AND_NO_TOUCH_ZONES.md` | 04-25 01:16 |
| B4 | `MACHINE_LEARNING_PAGE_SPEC_FINAL.md` | 04-25 01:19 — top-level route, NOT nested |
| B5 | `CODE_PREP_CHECKLIST.md` | 04-25 01:21 |
| B6 | `ML_LEARNING_ALGORITHM_SPEC.md` | 04-25 08:36 — PRE-CODE, no impl, contextual bandit + Thompson Sampling (Beta-Bernoulli) |
| B7 | `ML_FEATURE_CATALOG.md` | 04-25 08:39 — feature catalog with Drift Baseline / Tolerance / Used By |

B6/B7 are supplementary pre-code deliverables. They do NOT change the canonical
total of 244 (no 248 unless explicitly approved).

B7 hardening still pending: leakage class / training-serving parity / missing
data policy not isolated as explicit sections. Mark NEEDS_VERIFICATION on
line refs. Do NOT implement now.

## 6. S3 DIAGNOSTIC — ROOT CAUSE PLAN (READ-ONLY, NO PATCH)

Pattern of 27 PRIMARY real mismatches: all BTCUSDT, all `client=NO_TRADE` vs
`server=SMALL/MEDIUM`. Server is more aggressive than client.

Source-of-truth comparison done in this session (read-only):

- Client `computeFusionDecision` is at `client/src/trading/autotrade.ts:455-549`.
- Server fusion is in `server/services/serverBrain.js`:
  - `_runShadowCycle` line 690
  - `_calcConfluenceParity` line 758 (mirrors client confluence formula partially)
  - `_checkGates` line 873 (9 gates)
  - `_computeFusion` line 969 (LIVE fusion path — NOT a parity mirror)

Root-cause candidates (P1 = highest probability):

**P1 — Direction logic divergent.** Client direction = `dirScore > 0.15`/`< -0.15`
test where `dirScore = ofi*0.55 + (conf-50)/50*0.30 + sigDir*0.25`. Server
direction = `bullDirs > bearDirs ? LONG : SHORT`. They are NOT measuring the
same thing. With weak OFI but RSI+ST+FR aligned bull, client says
`neutral`/`NO_TRADE`, server says `LONG`/`SMALL` or `LONG`/`MEDIUM`. Most
of the 27 mismatches fit this pattern.

**P2 — Confidence formula divergent.** Client confidence = `confN*0.35 +
probN*0.25 + regimeN*0.20 + alignN*0.20` then `*(1 - liqDangerN*0.55)`.
Server confidence = 8-factor weighted sum + 7 multiplicative modifiers
(structure, liq, journal, knn, session, volatility, tilt). Different shape
entirely.

**P3 — Server applies live modifiers to shadow rows.** `_runShadowCycle`
calls live `_computeFusion`, which always multiplies by structure, liquidity,
journal, knn, session, volatility, tilt, trapRisk, regimeDanger modifiers.
Client's `computeFusionDecision` applies NONE of these. Even if everything
else matched, those modifiers can shift confidence by ±15% and tip into
SMALL/MEDIUM.

**P4 — LongShort ratio missing on server.** `_calcConfluenceParity` line 770
hardcodes `lsDir = 'neut'`. Client uses real LS feed. Comment explicitly
flags this gap: "follow-up batch should add `/futures/data/topLongShortPositionRatio`
polling to serverState."

**P5 — Pairing window ±15s is wide.** Could induce false mismatch if state
moves between client tick and server tick. But mismatches are systematic
(all BTC, all server-aggressive), not random — so pairing is not the primary
cause.

### S3.1e PROPOSED FIX (PLAN ONLY — DO NOT IMPLEMENT WITHOUT OPERATOR GO)

Mirror the full client `computeFusionDecision` flow on server with a parity-only
fusion path:

1. **Add `_calcDirScoreParity(snap, confluence)`** — server-side replica of
   client `dirScore` formula. Use `serverOrderflow.getFlow(snap.symbol).ofi`.
   For `sigDir` proxy, set 0 if no scan-direction signal exists on server.

2. **Add `_computeFusionParity(snap, confluence, regime, probN, liqDangerN)`** —
   replicates client confidence formula exactly. NO server-side modifiers
   (structure, liq, journal, knn, session, volatility, tilt). Same tier
   thresholds as client lines 532-540.

3. **Wire `_runShadowCycle` to call `_computeFusionParity`** instead of live
   `_computeFusion`. This isolates parity rows from server's live-fusion
   modifier stack.

4. **Server `probN` (Scenario)** — server has no `computeProbScore` equivalent
   currently. Default 0.5 (matches client default when scenario is null).

5. **Server `liqDangerN`** — `serverLiquidity.getLiquidity()` has a `nearPct`
   field; map to `liqDangerN = clamp01(nearPct/100)`. Default 0.2 if absent
   (matches client default).

6. **LongShort ratio** — separate sub-batch (S3.1f). Requires new feed:
   `/futures/data/topLongShortPositionRatio` polling in `serverState.js`.
   Don't bundle with S3.1e.

Risk: zero on live decisions (shadow path only). All work is in `serverBrain.js`
in functions only called when `PARITY_SHADOW_ENABLED && !SERVER_BRAIN`.

## 7. ML TIMING RULES

These are HARD rules, not suggestions:

- ML coding does NOT begin until S3 GREEN (≥95% PRIMARY ADJ, ≥500 PRIMARY paired,
  real mismatches close to 0 with explained pattern) AND explicit operator GO.
- After S3 GREEN: B6/B7 hardening + pre-code freeze.
- First ML coding is server-side, shadow/read-only, through `Ring5LearningService` facade.
- ML influence on DEMO decisions only after S6 GREEN.
- ML influence on TESTNET decisions only after S8 GREEN.
- ML influence on LIVE decisions only after S10/S11 + explicit per-user opt-in.

NEVER ship a half-trained bandit into LIVE. B6 cold-start rule: each arm needs
≥30 observations per regime before counting toward decisions.

## 8. PENDING BUGS / POST-S3 PRIORITY (DO NOT FIX DURING RE-SOAK)

From `~/.claude/projects/-root/memory/project_known_bugs.md`:

| Bug | Category | Source | Fix when |
|---|---|---|---|
| Auto-logout sessions concurente | operational blocker | reported 2026-04-25 | post-S3 verdict |
| Email verification — too many sends + on logout | post-S3 bug | reported 2026-04-25 | post-S3 verdict |
| PATCH warnings (`wrap.setSymbol`, `hook.tick.runQuantDetectors`) | UI polish | known-bugs 2026-04-09 | post-S3 |
| SVG `<path>` malformed errors | UI polish | known-bugs | post-S3 |
| User-context spam (`_usScheduleSave` rebound loop) | operational blocker | known-bugs | post-S3 |
| 403 balance/positions | by-design (no API keys) | known-bugs | not a bug |
| Phase 5 transient UI duplicates | CLOSED 2026-04-17 (Phase 5.1) | known-bugs | done |

## 9. HARD RULES — DO NOT VIOLATE

- Server is source of truth. React is read-model only.
- No localStorage as final truth.
- No second ML system. One Ring 5 facade only.
- No monolith. No moving final logic into client.
- No coding on the canonical 244 until pre-code/freeze package is done AND explicit operator GO.
- No flag flip without its gate batch (S6 needs S3 GREEN, S8 needs S3 GREEN, etc.).
- S4 stays BLOCKED until S3 closes GREEN. No exception.
- No new S-batch numbers without explicit approval.
- Backup files (`.bak.<tag>`) before any patch. Each batch is revertible in <5 min.

## 10. EMERGENCY RECOVERY COMMANDS (READ-ONLY)

If you are a new Claude session and need to reproduce my state:

```bash
# Repo + flags
cd /root/zeus-terminal
git status --short
git log --oneline -10
cat data/migration_flags.json
cat server/version.js | head -5

# pm2
pm2 list
pm2 logs zeus --lines 50 --nostream

# S3 parity (CURRENT snapshot, NOT formal report)
sqlite3 data/zeus.db "
SELECT source, COUNT(*) AS rows,
  datetime(MIN(created_at)/1000,'unixepoch') AS first,
  datetime(MAX(created_at)/1000,'unixepoch') AS last
FROM brain_parity_log GROUP BY source;
SELECT '---last hour by symbol---';
SELECT source, symbol, COUNT(*) AS n
FROM brain_parity_log
WHERE created_at >= (strftime('%s','now')-3600)*1000
GROUP BY source, symbol ORDER BY source, n DESC;"

# Audit docs
ls -la /root/_review/audit/
```

For the formal T+24h or rolling parity report, regenerate from
`server/services/database.js::queryParityReport(opts)` via the admin endpoint
`GET /api/brain/parity/report` (admin-only auth).

## 11. CONTACT POINTS

- Auto-memory: `~/.claude/projects/-root/memory/`
  - `MEMORY.md` index
  - `project_phase2_server_migration.md` — full S1..S12 spec
  - `project_s3_parity_collection.md` — soak history
  - `project_known_bugs.md` — open bug register
  - `project_v2_baseline_audit.md` — v2.0.0 baseline
  - `feedback_*.md` — operator preferences

- Canonical docs: `/root/_review/audit/` (A1..B7 + S_ROADMAP + audits)

- Phase 2 Master Audit transcript: session
  `200929f4-5767-46f3-877b-292853428c2d` (2026-04-21)

---

**End of recovery note.**

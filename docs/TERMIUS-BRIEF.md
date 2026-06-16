# Termius Brief — Zeus Terminal Production Repair

> **Purpose:** Surgical handoff for the Claude agent that runs in Termius (the SSH client) on top of the production VPS. Read this end-to-end before touching anything. It is self-contained: you do **not** have the prior conversation context.
>
> **Date written:** 2026-05-30 17:10 EEST
> **Author:** Audit Claude (local repo, read-only audit on VPS)
> **Audience:** Termius Claude (operator-on-VPS agent)
> **Mode:** Repair work. Code changes allowed under the rules below. ALWAYS stop and discuss with operator before touching code.

---

## 0. Identity & mission

You are a Senior Software Engineer and Security Auditor. You operate inside an SSH session into the production VPS that runs Zeus Terminal — a real-money-capable algorithmic trading platform connected to Binance Futures (currently using testnet credentials) and Bybit (active exchange, testnet credentials).

Your mission is to walk through the open items in `docs/BUG-BOOK.md` in the **order specified in this brief**, fix them one at a time, and report results in the format below. You do not invent priorities. You do not skip the verification protocol. You stop and ask when in doubt.

---

## 1. Standing protocol — MANDATORY before any code change

Operator's hard rule: **3× Pre-Code Verification** before writing or modifying any line of code. No exceptions.

Generate explicit answers to ALL FIVE steps below, in the chat, BEFORE writing the first line of code. If any step uncovers an ambiguity → stop, ask the operator, do not guess.

### 1.1 — VALIDARE CERINȚE (Stop & Think)
- Is the requirement complete?
- Are there ambiguities in the business logic?
- → If critical detail is missing, STOP and ask. Do not guess intent.

### 1.2 — CHECKLIST SECURITATE (Security First)
- What data flows into this function/module and how must it be sanitized?
- Are there security risks (SQL injection, XSS, CSRF, token / password exposure)?
- How is authorization / authentication handled for this code path?
- → State explicitly how you will secure the code before you write it.

### 1.3 — ANALIZA DE IMPACT ȘI DEPENDINȚE
- How will this change affect the existing architecture?
- Which libraries or frameworks are required? Are there lighter alternatives?
- → Ensure the proposed solution does NOT introduce breaking changes.

### 1.4 — TRATAREA ERORILOR (Edge Cases)
- What happens if input is null, empty, or the wrong type?
- What happens if the network or DB fails mid-execution?
- → Enumerate 2-3 possible error scenarios and how you'll handle them.

### 1.5 — PLANUL DE IMPLEMENTARE (Pseudocode)
- → Write a logical plan, step by step (or short pseudocode), explaining how you'll solve the problem.

**FINAL RULE:** Only after steps 1.1–1.5 are answered and the path is clearly safe may you start writing actual code.

### 1.6 — Surgical patch protocol (per-fix workflow)

Every fix follows this exact sequence:

1. **Backup first.** Always:
   ```bash
   cp <file> <file>.bak.pre-<task>-20260530
   ```
2. **Plan scurt.** State what you change, in which files, and what you do NOT touch.
3. **TDD RED → GREEN.**
   - Write the failing test first.
   - Run `npx jest <test-file> --forceExit` → FAIL with the expected message.
   - Apply the smallest possible code change to make it GREEN.
4. **Show diff.** Display the full diff for operator review.
5. **Await explicit "commit" or "go".** Never deploy without it.
6. **Deploy:**
   - Server-only change → `pm2 reload zeus` on the VPS.
   - Otherwise → operator runs `deploy.ps1` from local with tests 275/275 gate.
7. **Verify on VPS within 5 min after deploy.** Show evidence (log lines, DB rows, curl results).

### 1.7 — Report format (mandatory per fix)

After every fix you produce a numbered report:

1. **Ce am găsit** — exact problem, root cause.
2. **Plan scurt** — what you change, in which files, what you do NOT touch.
3. **Backup** — confirmation before edit.
4. **Implementare** — what changed concretely.
5. **Teste** — which tests, which flow verified, build OK?
6. **Rezultat** — what was repaired, what remains, next step.

### 1.8 — Rules of engagement

- Surgical patch only — change ONLY what is necessary.
- Do NOT refactor, do NOT add features, do NOT make cosmetic changes.
- Do NOT change architecture without explicit operator request.
- Do NOT deploy without operator confirmation.
- ONE bug at a time, never ten.
- If in doubt → STOP and ask.

### 1.9 — Tests gate

All three suites must pass before any deploy:
- `tests/test-ares-offline.js` (148 cases)
- `tests/test-preflight.js` (72 cases)
- `tests/test-p6-live.js` (55 cases)

Total: **275/275 must be green**. No partial deploys.

---

## 2. Production state snapshot (verified 2026-05-30 17:05 EEST)

You do NOT need to re-audit any of this. It was verified live during the audit. Re-verify only if you suspect drift (e.g., a teammate deployed since).

| Item | Value |
|------|-------|
| VPS | `root@178.104.64.124` |
| Path | `/root/zeus-terminal/` |
| PM2 process | `zeus` id=2, fork mode, max RAM 512 MB, autorestart |
| Current git HEAD | `7708cd8 fix(close): row-independent reduce-only fallback when at_positions row archived (P2 close-desync)` |
| Branch | `main` |
| Working tree | Practically clean (untracked plan-md files + DB backups only) |
| Node version | v20.20.2 |
| DB | SQLite WAL, `/root/zeus-terminal/data/zeus.db`, ~788 MB |
| Active exchange for `uid=1` | **Bybit testnet** (`exchange_accounts.is_active=1`) |
| Binance testnet creds for `uid=1` | Still verified, `is_active=0` |
| `engineMode` for `uid=1` | `'live'` |
| `engineMode` for `uid=2` | `'demo'` (heavily active — 84K brain decisions / 24h) |
| Migration flags (key) | `SERVER_AT=false`, `SERVER_AT_TESTNET=true`, `SERVER_AT_DEMO=true`, `SERVER_BRAIN=false`, `SERVER_BRAIN_DEMO=true`, `CLIENT_BRAIN=true`, `CLIENT_AT=true`, `_SRV_POS_TESTNET_ENABLED=true`, `_SRV_POS_REAL_ENABLED=false`, `USERDATA_STREAM_ENABLED=true`, `_USERDATA_STREAM_TESTNET_ENABLED=true`, `_USERDATA_STREAM_REAL_ENABLED=false` |
| Uptime current process | ~3 h (last restart ~13:55) |
| PM2 cumulative restarts | 219 (no unstable restarts) |
| Live RAM | ~280 MB |
| Disk | 67% used (96/150 GB), 12 GB in `/data/` (DB + backups) |

**Recent commits already on prod (last 24h, oldest → newest):**
```
f3c9b93  fix(trading): /order/place routes through exchangeOps (Phase M Task 5)
0364cf2  fix(trading+serverAT): manual endpoints via exchangeOps (Phase M Tasks 6-7)
f7f5b71  fix(bybitOps): tolerate retCode 10032 on leverage/margin mgmt
94732ba  fix(telegram): escapeMarkdown helper + restart-anomaly alert (closes OPS-4)
38842b0  fix(bybitOps): getPositions must send settleCoin (closes most of SYNC root)
ca8aca9  P-A Task 1: _adoptExternalPosition          ← later REVERTED
41717e5  P-A Task 2: _adoptWithProtection           ← removed by revert
e36e395  P-A Task 3: _reconcileAndAdopt 8 layers    ← removed by revert
d96c199  P-A Task 4 prep                            ← removed by revert
0b676ab  P-A Task 4b recoveryBoot adopt             ← removed by revert
ff4c442  P-A Task 4c engine noAutoSL                ← removed by revert
b630017  P-A Task 4c wiring                         ← removed by revert
6e5e00a  REVERT P-A Task 1 (clean, 354 LOC removed)
8b4321e  test(repro): P2 manual Bybit close-desync
7708cd8  fix(close): row-independent reduce-only fallback (closes P2 close-desync)
```

**Bug book master:** `docs/BUG-BOOK.md` contains the full 23-bug inventory plus the new findings. **Always read this first.** Update its Status field whenever a bug transitions (`open → discussed → in-progress → merged → verified-prod`).

---

## 3. Bugs already FIXED (do not touch — verify only)

These are closed. Confirm only.

### 3.1 OPS-4 — Telegram parse error
- **Status:** ✅ merged via `94732ba`.
- **Verify:** Trigger a restart-anomaly alert → confirm Telegram delivers without `Bad Request: can't parse entities`.
- **No further work.**

### 3.2 NEW-0 — Bybit `getPositions` missing `settleCoin`
- **Status:** ✅ merged via `38842b0`.
- **Verify:** `bybitOps.getPositions(uid, {})` now defaults `settleCoin:'USDT'` (file `server/services/bybitOps.js` around lines 456-470). Test live: open BTCUSDT short on Bybit demo, call recon manually or wait 60s → position must show up in `at_positions` once SYNC-1 + adoption are landed.
- **Do NOT re-add a symbol guard that would re-trigger the empty-list bug.**

### 3.3 ENG-2 — Bybit manual trading parity
- **Status:** 🟢 near-complete. Phase M Tasks 5-7 merged (`f3c9b93`, `0364cf2`, `f7f5b71`).
- **Verify:**
  - Manual BUY/SELL on Bybit succeeds and lands in `at_positions` (caveat: see ENG-3 — exchange may still be labeled `'binance'` due to schema default).
  - Manual cancel, modify, openOrders return Bybit data.
  - Leverage / margin endpoints tolerate Bybit `retCode 10032` ("Demo Trading not supported") without erroring out.
- **Remaining work (optional):** confirm the `2026-05-30-bybit-manual-trading.md` plan checklist is fully ticked, otherwise close out the remaining tasks.

---

## 4. Repair queue — priority order, surgical detail

For each item below, follow `1.1–1.7` of the standing protocol before code. Stop and discuss before patching.

The list below is intentionally ordered to minimize regression risk: stop the silent loss first, then unblock architecture, then perf, then hygiene. Do not reorder without operator approval.

---

### 4.1 — Phase 0 — Operator-gate questions

Before touching ANY code, get these four answers from the operator. They drive multiple downstream patches.

**Q1.** Is real-money Binance/Bybit trading the target, or is testnet the durable target?
→ This decides whether `_SRV_POS_REAL_ENABLED` ever flips true. Drives SEC-2 documentation and ENG-1 fix scope.

**Q2.** Should the `SERVER_AT_REQUIRED_FOR_LIVE` gate at `server/services/serverAT.js:942-944` pass when `SERVER_AT_TESTNET=true` AND creds.mode=`'testnet'`?
→ This drives ENG-1 wording.

**Q3.** Brain feed source for a Bybit user: keep Binance market data (current), or align with active exchange (Bybit market data)?
→ This drives PERF-5 scope.

**Q4.** Position adoption (SYNC-4): re-implement (after the recent revert), pursue a simpler design, or live with `settleCoin`-only mitigation?
→ This drives the entire Phase 1 below.

Once Q1–Q4 are answered, proceed to Phase 1.

---

### 4.2 — Phase 1 — Position correctness on Bybit (stop the silent loss)

**Goal:** A position opened on Bybit (via Zeus UI **or** via Bybit web UI) must land in `at_positions OPEN` with the correct `exchange` label, and stay visible until it actually closes on the exchange. No phantom close at PnL=$0.

#### 4.2.1 SYNC-2 — `registerManualPosition` records wrong exchange (P0)

**File:** `server/services/serverAT.js` — the `registerManualPosition` function (used by `POST /api/order/place` and `POST /api/manual/protection`).
**Schema cross-reference:** `at_positions.exchange TEXT NOT NULL DEFAULT 'binance'`.

**Evidence:**
- Manual BUY at 13:28:51 today (`seq=1776859653088`) opened on Bybit → row saved with `exchange='binance'`.
- Same for `seq=1776859653089` at 14:42:21.
- Active credentials at the moment of registration: `bybit`.

**Pre-code verification (you must produce these answers in chat):**

- (1.1) Requirement: the saved row's `exchange` must equal the active exchange at the time of registration, retrieved via `credentialStore.getExchangeCreds(uid).exchange`. Ambiguity: should `params.exchangeOverride` win over the active creds when present? — yes, mirror `exchangeOps._resolveOpsFor`.
- (1.2) Security: input `params.exchange` (if any) is a small enum; constrain to `{'binance','bybit'}`. No SQL building from it (use parametrized inserts). No auth change.
- (1.3) Impact: any caller of `registerManualPosition` that today relied on the implicit `'binance'` default now produces a row with the actual active exchange. Confirm no test fixtures rely on the implicit default. Grep `registerManualPosition\(` site-wide.
- (1.4) Edge cases: <br>(a) `credentialStore.getExchangeCreds(uid)` returns null → fall back to `params.exchange` if given, else fail-loud with a logged warning rather than silently saving the wrong row. <br>(b) The user just switched exchange between order placement and registration callback — register against `params.exchangeAtPlacement` if the call site provides one.
- (1.5) Pseudocode:
  ```
  function registerManualPosition(uid, params) {
      const activeCreds = credentialStore.getExchangeCreds(uid);
      const resolvedExchange =
          params.exchangeOverride
          || (activeCreds && activeCreds.exchange)
          || params.exchange  // legacy callers
          || (logger.warn('SAT', 'registerManualPosition: no exchange resolvable, fail-loud'), null);
      if (!resolvedExchange) throw new Error('registerManualPosition: cannot resolve exchange');
      const posObj = { /* …existing fields… */, exchange: resolvedExchange };
      db.atSavePosition(posObj); // existing helper threads `exchange` into the row
  }
  ```

**TDD plan:**
1. RED test in `tests/unit/at-register-manual.test.js` (new file): mock `credentialStore.getExchangeCreds` to return `{exchange:'bybit', mode:'testnet'}`; assert the inserted row has `exchange='bybit'`.
2. RED test for the override path: `params.exchangeOverride='binance'` → row has `exchange='binance'`.
3. RED test for fail-loud: mock returns null, no override → throws.
4. Make GREEN with the minimal change above.

**Verification on VPS after deploy:**
- Open a manual position on Bybit via Zeus UI.
- `sqlite3 data/zeus.db "SELECT seq, exchange FROM at_positions WHERE seq=<seq>"` → must show `bybit`.

**Discussion gate:** confirm with operator whether old `'binance'`-defaulted rows (the existing 22 CLOSED + 3 OPEN demo rows) need a one-time migration script or can be left as-is.

---

#### 4.2.2 SYNC-1 — RECON skips polling when memory is empty (P0)

**File:** `server/services/serverAT.js:4596 (`_runReconciliation`)` — specifically the early return at `:4608-4609`:
```javascript
const livePositions = _positions.filter(p => p.mode === 'live' && p.live && (p.live.status === 'LIVE' || p.live.status === 'LIVE_NO_SL'));
if (livePositions.length === 0) return; // [B6] finally will reset _reconRunning
```

**Symptom:** When Zeus has zero live positions in memory, recon does not poll any exchange. External positions on Bybit remain invisible forever.

**Pre-code verification:**

- (1.1) Requirement: recon must poll the active exchange for every active user **even when** the Zeus-side `_positions` array has no live entries for that user, so externally opened positions can be discovered. Ambiguity: how many users to poll per cycle? — only active users (logged-in in the last N minutes, or with `atActive=true` in `at_state`).
- (1.2) Security: no new attack surface. Rate-limit calls per user to avoid Binance/Bybit IP bans (OPS-1 lesson).
- (1.3) Impact: more REST calls per cycle. With 5-10 active users and a 60s interval this is well within Binance + Bybit rate limits. Coordinate with `binanceRateGate` / `bybit_rate_state` to confirm budget.
- (1.4) Edge cases: <br>(a) Many active users → batch by exchange so a single `getPositions` per (exchange, settleCoin) covers everyone if creds are shared per-user; otherwise spread calls across the cycle. <br>(b) Active exchange resolves to one whose creds are missing → skip with a single WARN. <br>(c) `getPositions` throws (rate-limit or net) → swallow, continue next user.
- (1.5) Pseudocode:
  ```
  const activeUsers = _getActiveUsersForRecon(); // from at_state where atActive=true OR last_seen<5min
  for (const uid of activeUsers) {
      const exchange = credentialStore.getExchangeCreds(uid)?.exchange;
      if (!exchange) continue;
      const held = await exchangeOps.getPositions(uid, { exchangeOverride: exchange });
      const tracked = _positions.filter(p => p.userId===uid && p.exchange===exchange && p.mode==='live');
      for (const exchPos of held) {
          const matched = tracked.find(t => t.symbol===exchPos.symbol && t.side===exchPos.side);
          if (!matched) {
              // external position — see SYNC-4 for adoption decision
              _logExternalDiscovered(uid, exchange, exchPos);
          }
      }
  }
  ```

**Dependency:** This change discovers external positions but does NOT adopt them — adoption depends on Q4. Until Q4 is answered, the body inside `if (!matched)` should at minimum: log `[RECON_DISCOVERY] external position uid=X exchange=Y symbol=Z side=W qty=Q` to make the gap visible.

**TDD plan:**
1. RED: `tests/unit/recon-empty-memory.test.js` — mock `_positions=[]`, mock `credentialStore.getExchangeCreds` to return Bybit creds for uid=1, mock `exchangeOps.getPositions` to return one BTCUSDT SHORT. Assert that `_runReconciliation()` calls `exchangeOps.getPositions` and produces the discovery log.
2. GREEN with the discovery loop above.

**Verification on VPS:**
- With `_positions` cold (just after PM2 reload) and a real position on Bybit demo, the next recon cycle (≤60s) must log `[RECON_DISCOVERY] external position ...`.

**Discussion gate:** before patching, operator must answer Q4 (adoption pursued, deferred, or settle-coin-only). If "deferred", the patch ends at logging the discovery (no adoption). If "pursued", queue SYNC-4 right after.

---

#### 4.2.3 SYNC-4 — External positions never adopted (P0, gated on Q4)

**Skip if Q4 = "settle-coin-only" or "deferred".**

If Q4 = "pursued" and operator agrees on simpler design, this is the candidate plan:

Re-implement `_adoptExternalPosition` and `_reconcileAndAdopt` but **without** the 8 defensive layers that the original P-A used. Minimum viable adoption:

**File:** `server/services/serverAT.js` (new functions).

**Spec (simpler than the reverted P-A):**
- `_adoptExternalPosition(userId, exchange, pos)`:
  - Build a position object with `source: 'external'`, `autoTrade: 0`, `dslParams: null`, `mode: 'live'`, `live.status: 'LIVE'`, `live.slOrderId: null`.
  - Persist via `db.atSavePosition` (synchronous transaction).
  - Push into `_positions`.
  - Emit `_broadcastPositions(userId)`.
  - Idempotency: skip if a row with same `(userId, symbol, side, mode='live')` already exists OPEN.
- Hook the call into the SYNC-1 discovery loop (where the WARN currently sits).

**Why simpler:** the reverted P-A added 8 defensive layers that increased complexity (~354 LOC). Operator may prefer a minimal-viable adoption that we harden later if needed.

**Risk to call out to operator:** without the 8 layers, an external position is adopted without a Zeus-managed protective SL. The user's prior P-A plan placed an SL **before** the row insert. Discuss with operator whether to:
- a) Adopt without SL (display-only, fast, simple) — operator must add SL via UI manually.
- b) Re-implement the SL-then-insert layer (more code, but full protection).

**Discussion gate:** confirm with operator BEFORE coding which option (a) or (b).

---

#### 4.2.4 SYNC-5 — `RECON_PHANTOM` closes real Bybit positions (P0)

**File:** `server/services/serverAT.js` — the phantom-detection block inside `_runReconciliation`.

**Symptom:** Server-tracked positions are closed at PnL=$0 within minutes (logs from today: `06:00:39`, `12:09:19`).

**Root cause:** Position registered with `exchange='binance'` (SYNC-2 bug). Recon polls Binance → not found → declared phantom. SYNC-2 fix removes the cause for new positions; this fix adds a **safety net** for legacy data and for any future mis-labelling.

**Pre-code verification:**

- (1.1) Requirement: before declaring a position phantom, confirm we polled the SAME exchange the position is recorded against. If the poll did not happen (e.g., creds missing for that exchange), DEFER phantom detection (do not close).
- (1.2) Security: no new attack surface.
- (1.3) Impact: a position that was genuinely closed externally on `exchange=X` may stay LIVE in Zeus an extra cycle if our poll on X failed. Acceptable — better stale than wrongful close.
- (1.4) Edge cases: <br>(a) Position has `exchange=null` (legacy) → fall back to active creds exchange, log warning. <br>(b) Position polled with `settleCoin=USDT` but is a non-USDT pair → never happens in current code (all linear USDT), but assert.
- (1.5) Pseudocode:
  ```
  for each tracked position p:
      const pollExchange = p.exchange;
      if (!polledThisCycle.has(`${p.userId}:${pollExchange}`)) {
          logger.warn('RECON', `[PHANTOM-DEFER] not polled this cycle uid=${p.userId} exchange=${pollExchange} — skipping phantom check`);
          continue;
      }
      // existing phantom detection logic
  ```

**TDD plan:**
1. RED: tracked position with `exchange='bybit'`, recon poll for binance succeeded but bybit failed → assert no phantom-close happens.
2. GREEN with the deferral above.

**Verification on VPS:** Open a Bybit position, induce a Binance poll failure (e.g., temporary network block), observe NO `RECON_PHANTOM` for the Bybit position.

---

### 4.3 — Phase 2 — Architectural gating

#### 4.3.1 ENG-1 — `SERVER_AT_REQUIRED_FOR_LIVE` gate ignores testnet (P0, gated on Q2)

**File:** `server/services/serverAT.js:942-944`.

**Current code:**
```javascript
if (us.engineMode !== 'demo' && MF.SERVER_AT !== true) {
    logger.warn('AT_ENGINE', `Entry blocked uid=${userId} — SERVER_AT_REQUIRED_FOR_LIVE (mode=${us.engineMode || 'unknown'})`);
    _recordMissedTrade(userId, decision, 'SERVER_AT_REQUIRED_FOR_LIVE');
}
```

**Inconsistency:** Brain dispatch gate at `server/services/serverBrain.js:344` IS testnet-aware:
```javascript
if (MF.SERVER_AT_TESTNET === true && userMode === 'live') return true;
```

But the AT entry gate is not. Result: brain dispatches the decision, AT engine blocks it on entry.

**Pre-code verification:**

- (1.1) Requirement (PENDING Q2 answer): if operator confirms "pass when SERVER_AT_TESTNET && creds=testnet", change the gate. Ambiguity: what if `SERVER_AT_TESTNET=true` but creds=`'live'`? — must still block (testnet flag does not authorize real money).
- (1.2) Security: this gate is part of the real-money protection ladder. Adding a path that lets `engineMode='live'` proceed when `creds.mode='testnet'` is safe; adding one for `creds.mode='live'` without the master `SERVER_AT` is NOT.
- (1.3) Impact: enables AT live entries for users on Bybit/Binance testnet. `liveStats.entries` will start incrementing on `at_state[engine:X]`.
- (1.4) Edge cases: <br>(a) Creds resolve to null → block. <br>(b) Mismatch between brain and AT view of mode → block.
- (1.5) Pseudocode:
  ```
  const credsMode = credentialStore.getExchangeCreds(userId)?.mode;
  const liveOnTestnet = MF.SERVER_AT_TESTNET && credsMode === 'testnet';
  if (us.engineMode !== 'demo' && MF.SERVER_AT !== true && !liveOnTestnet) {
      // block (existing logic)
  }
  ```

**TDD plan:**
1. RED: `engineMode='live'`, `MF.SERVER_AT_TESTNET=true`, creds.mode=`'testnet'` → entry must proceed.
2. RED: `engineMode='live'`, `MF.SERVER_AT_TESTNET=true`, creds.mode=`'live'` → entry must still block.
3. RED: `engineMode='live'`, `MF.SERVER_AT_TESTNET=false`, creds.mode=`'testnet'` → entry must still block.
4. GREEN with the gate above.

**Discussion gate:** operator must answer Q2 before patching.

---

#### 4.3.2 ENG-3 — `at_positions.exchange` schema default (P0)

**File:** schema migration + audit of `db.atSavePosition` callers.

**Risk:** Coupled to SYNC-2 — same family of bugs. Once SYNC-2 fixes the manual path, audit all OTHER callers of `db.atSavePosition` and the underlying `INSERT INTO at_positions` and ensure each threads an explicit `exchange`.

**Pre-code verification:**

- (1.3) Impact: schema migration on production DB. **Always create a DB backup first** (`cp data/zeus.db data/zeus.db.pre-eng3-$(date +%Y%m%d).bak`).
- (1.4) Edge cases: a row inserted during the migration window — ensure migration is in a transaction.

**Pseudocode for migration:**
```
BEGIN TRANSACTION;
-- Step A: backfill missing exchanges from at_state or hardcoded heuristic
UPDATE at_positions SET exchange='binance' WHERE exchange IS NULL OR exchange = '';
-- Step B: drop default
-- SQLite cannot drop a column default in place. Use the rename-rebuild idiom:
CREATE TABLE at_positions_new (
  seq INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER DEFAULT NULL,
  exchange TEXT NOT NULL  -- no default
);
INSERT INTO at_positions_new SELECT * FROM at_positions;
DROP TABLE at_positions;
ALTER TABLE at_positions_new RENAME TO at_positions;
-- Re-create indexes
COMMIT;
```

**Discussion gate:** confirm with operator. Migration changes a NOT NULL constraint — risky. Some callers may break if not all are audited first. Run a dry-run audit (`grep -rn 'atSavePosition\|INSERT INTO at_positions' server/`) before patching.

---

### 4.4 — Phase 3 — Performance

#### 4.4.1 PERF-1 — DB `cache_size = 2 MB` for 788 MB DB (P0)

**File:** `server/services/database.js` (boot-time PRAGMAs).

**Current:** `PRAGMA cache_size` returns `-2000` (2 MB negative-KB notation). DB is 788 MB. Cache hit rate ceiling ≈ 0.25%.

**Pre-code verification:**

- (1.1) Requirement: raise the cache size to a useful fraction of the DB. Target: 256 MB.
- (1.2) Security: none.
- (1.3) Impact: node RSS grows. With current 280 MB usage and PM2 `max_memory_restart=512 MB`, a 256 MB cache will push us above the limit. **MUST raise PM2 `max_memory_restart` to 1024 MB before** changing the PRAGMA.
- (1.4) Edge cases: tiny VPS RAM (we have 7.6 GB total, free 4.7 GB) — well within budget.
- (1.5) Plan:
  1. Edit `ecosystem.config.js` → `max_memory_restart: '1024M'`. Reload.
  2. Add `db.pragma('cache_size = -262144')` (256 MB) at boot.
  3. Optional: `db.pragma('temp_store = MEMORY')`, `db.pragma('mmap_size = 268435456')`.

**TDD plan:** unit test asserts `db.pragma('cache_size', { simple: true })` ≤ -200000 after boot.

**Discussion gate:** confirm new PM2 RAM ceiling with operator before changing.

---

#### 4.4.2 PERF-3 — `PRAGMA synchronous = FULL` → `NORMAL` (P1)

**File:** `server/services/database.js`.

**Current:** `PRAGMA synchronous` returns `2` (FULL).

**Pre-code verification:**

- (1.1) Requirement: speed up commits while preserving WAL durability across checkpoints. Standard SQLite production tuning.
- (1.2) Security: trade-off documented — on power loss, the very last committed transaction may be lost. Acceptable for trading state (recoverable from exchange on next sync).
- (1.3) Impact: writes (especially `dsl_parity_log`) measurably faster.
- (1.4) Edge cases: a crash during checkpoint may need WAL recovery — already handled by SQLite.
- (1.5) Plan: `db.pragma('synchronous = NORMAL')` at boot.

**Discussion gate:** operator must accept the durability trade-off.

---

#### 4.4.3 PERF-2 — `dsl_parity_log` 2.5 M rows (P1)

**File:** cron / scheduled job (consider `server/services/database.js` setup, or a new `server/jobs/dslParityPrune.js`).

**Current:** 2,499,242 rows, growing at ~163 / min.

**Pre-code verification:**

- (1.1) Requirement: keep only last N days (suggest 7) of `dsl_parity_log`. Decide with operator. Also decide if `brain_parity_log` (617K rows) needs the same treatment.
- (1.2) Security: backup before bulk delete.
- (1.3) Impact: WAL growth during delete may spike. Use chunked deletes (1000 rows / commit) to keep WAL bounded.
- (1.4) Edge cases: long-running query if no index on `created_at` — verify index first.
- (1.5) Pseudocode:
  ```
  // run nightly via setInterval (or systemd timer):
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let totalDeleted = 0;
  while (true) {
      const r = db.prepare('DELETE FROM dsl_parity_log WHERE created_at < ? LIMIT 1000').run(cutoff);
      if (r.changes === 0) break;
      totalDeleted += r.changes;
      // micro-sleep to yield event loop
  }
  logger.info('PRUNE', `dsl_parity_log pruned ${totalDeleted} rows`);
  ```

**Discussion gate:** confirm retention with operator.

---

#### 4.4.4 PERF-4 — MarketRadar OI cache schema reject (P1)

**File:** `server/services/marketRadar.js` (cache validator).

**Evidence:** `{"_t":"CACHE","event":"reject_schema","type":"oi","key":"binance:BTCUSDT","caller":"marketRadar"}` every ~30 s.

**Pre-code verification:**

- (1.1) Read one rejected payload first (add a `logger.debug('CACHE', JSON.stringify(payload))` before the reject), decide whether to tighten the producer or relax the validator. **DO NOT** patch blind.
- (1.2) Security: none.
- (1.5) Plan: log one full sample, share with operator, decide.

**Discussion gate:** show sample to operator before fixing.

---

#### 4.4.5 PERF-5 — Brain feed source mismatch (P1, gated on Q3)

**Skip if Q3 = "keep Binance feed".**

If Q3 = "align with active exchange", scope:

**File:** `server/services/serverBrain.js` (symbol resolution + feed selection).

**Discussion gate:** non-trivial. Confirm scope with operator before code.

---

### 4.5 — Phase 4 — Real-time data plane

#### 4.5.1 SYNC-3 — Bybit userData stream (P0, gated on Q4)

**Two paths, choose ONE based on Q4:**

**Path (a) — Quick paliative (~10 LOC):** lower `RECON_INTERVAL_MS` from 60000 to 15000 **only when** active exchange = Bybit, while staying within rate limits. **Risk:** more REST calls per minute → must coordinate with `bybit_rate_state`.

**Path (b) — Real fix:** implement `server/services/bybitUserDataStream.js` mirroring `userDataStream.js` (Binance). Uses Bybit V5 private WS at `wss://stream.bybit.com/v5/private` (testnet: `wss://stream-testnet.bybit.com/v5/private`). Auth via signed handshake. Subscribes to `position`, `execution`, `order`. On message → call `serverAT._onUserDataEvent(uid, payload)` (or equivalent).

**Discussion gate:** operator picks (a) or (b).

---

### 4.6 — Phase 5 — Operability / hygiene

#### 4.6.1 OPS-1 — Binance IP-ban storm prevention (P1)

**File:** `server/services/recoveryBoot.js` (the `getPositions` call inside reconcile).

**Add:** per-boot rate-limit gate that refuses `recoveryBoot.getPositions` if the last call was < 5 s ago.

**Pre-code:** Standard module-level `let _lastBootGetPos = 0; const MIN_INTERVAL_MS = 5000;`. Idempotency.

---

#### 4.6.2 OPS-2 — PM2 restart storm (P2)

**File:** `ecosystem.config.js`.

**Add:** `min_uptime: 30000` (30 s), `max_restarts: 5` within `restart_delay` window. Prevents the 14-boots-in-3-min storm seen on 2026-05-30 02:28.

**Discussion gate:** operator confirms thresholds.

---

#### 4.6.3 OPS-5 — Backup retention (P3)

**File:** new shell script (`scripts/prune-db-backups.sh`) plus cron entry.

**Policy:** keep most recent + 3 previous + 1 monthly checkpoint. Delete the rest. Recovers ~5-6 GB.

---

#### 4.6.4 LOG-1 — `USERDATA stream started` misleading log (P3)

**File:** `server/services/userDataStream.js` (around the skip branch).

**Move the "stream started" log into the actual success branch, not the wrapper that may skip.**

---

#### 4.6.5 DATA-1 — Audit-log all `at_positions.status` mutations (P2)

**File:** any code that does `UPDATE at_positions SET status=...`.

**Add:** `audit.record('AT_POS_STATUS_CHANGE', { seq, from, to, reason })` at every site.

---

#### 4.6.6 NEW-1b — Mobile app reconnect loop every 6-9 s (P1, **NEW** — add to BUG-BOOK)

**Evidence (audit live 17:05):** mobile app holds 1-2 WS, drops 1 → climbs to 2 every 6-9 seconds, no connection-limit warnings (because only ~2 total). Pattern indicates broken WS keepalive on the client OR aggressive server-side idle timeout.

**Investigation steps (no code yet):**
1. Confirm WS keepalive interval on server (`grep -rn 'ping\|keepalive' server/services/wsHub.js`).
2. Confirm reconnect logic on the Android client side (`public/` or Capacitor wrapper) — does it have backoff?
3. Determine whether the disconnect is server-side (idle close) or client-side (heartbeat failure).

**Pre-code verification:** to be filled after the investigation above.

**Discussion gate:** operator confirms whether this is a known issue with the Capacitor wrapper.

---

#### 4.6.7 NEW-3 — `MIXED_DIRECTION_SAME_MODE` gate (P2, needs intent)

**File:** `server/services/serverAT.js:1049-1071`.

**Question for operator:** Is the "no mixed bias per portfolio (per engineMode)" restriction the desired behavior, or is it too strict?

**Discussion gate:** operator confirms intent. If desired → close as `documented`. If too strict → propose a knob (per-user enable/disable in `stc`).

---

### 4.7 — Phase 6 — Infrastructure

#### 4.7.1 OPS-3 — Binance Futures WS blocked by Hetzner (P2)

**Evidence:** `BNB[conn=true frames=0]` constant. REST works (~290 ms from VPS). Hetzner egress filters fstream.binance.com.

**Options:**
- a) Route via Cloudflare WARP or SOCKS through a different ASN.
- b) Document the limitation and remove dependency on Binance Futures WS (everything via REST + alternative WS sources).

**Discussion gate:** operator chooses path.

---

#### 4.7.2 PERF-6 — WS_PROXY active with 0 subscriptions (P3)

**Coupled to OPS-3.** If OPS-3 → option (b), disable `WS_PROXY_ENABLED` flag in prod.

---

### 4.8 — Phase 7 — Security & documentation

#### 4.8.1 SEC-1 — `TRADING_TOKEN` empty (P2)

**File:** `/root/zeus-terminal/.env` (excluded from rsync — safe to set on VPS).

**Action:**
1. Generate a strong token: `openssl rand -hex 32`.
2. `echo "TRADING_TOKEN=<generated>" >> /root/zeus-terminal/.env`.
3. Audit `server/routes/trading.js` to confirm the handler actually checks this token.
4. PM2 reload.

**Discussion gate:** confirm with operator before reload.

---

#### 4.8.2 SEC-2 — Document the path to real-money enablement (no code)

**File:** new `docs/REAL-MONEY-ACTIVATION-CHECKLIST.md`.

**Content:** the full ritual to flip `_SRV_POS_REAL_ENABLED` to `true`. Pre-conditions, sign-offs, smoke tests, rollback plan.

---

## 5. Bug book maintenance

After each fix:
- Open `docs/BUG-BOOK.md` and transition the bug's Status field: `open → discussed → in-progress → merged → verified-prod`.
- Append a short note in the `Discussion:` block of that bug with the commit SHA and verification result.
- Do NOT delete bug entries. The book is append-only at the entry level.

When a NEW bug is found during repair:
- Add it as a new entry in `docs/BUG-BOOK.md` (next free ID in its category: SYNC-6, ENG-4, etc.).
- Open with `Status: open` and an empty `Discussion:` block.
- Reference it in your fix report.

---

## 6. STOP conditions — when to halt and ask

Stop immediately and ask the operator if you encounter any of:

1. A pre-code verification step (1.1-1.5) reveals an ambiguity you cannot resolve from code alone.
2. A proposed change touches more than 2 files and the operator has not explicitly authorized that scope.
3. Tests 275/275 cannot be made green within 3 iterations.
4. A migration is required on production DB (always require operator pre-approval).
5. You'd need to change a migration flag or a `.env` value.
6. You discover that the running code on VPS differs from `git HEAD` (drift — investigate, do not patch).
7. The fix would require disabling `_realBlocked` or any safety gate.

---

## 7. Read-this-list before starting

1. `docs/BUG-BOOK.md` — bug inventory (single source of truth).
2. `docs/REMEDIATION-PLAN-P0.md` — old P0 plan, historical context.
3. `docs/superpowers/plans/2026-05-30-P-A-position-adoption.md` — reverted plan, for context on what the original SYNC-4 attempt looked like.
4. `docs/superpowers/plans/2026-05-30-bybit-manual-trading.md` — Phase M plan (mostly merged).
5. `docs/PRODUCTION-CHECKLIST.md` — pre-deploy gate.
6. This brief (`docs/TERMIUS-BRIEF.md`) — the priority order and how to operate.

---

## 8. Final operator note

The operator is solo. They prefer terse, technical replies. Romanian is the default chat language but English is fine for code and structured docs. They want:

- Adevăr tehnic, nu optimism fals.
- Cauza rădăcină, nu doar simptomul.
- Dacă nu eşti sigur → "ipoteză, nu certitudine".
- Dacă există risc de regresie → spus înainte.

Tests 275/275 is a hard gate. Backup-first is a hard gate. One bug per fix is a hard gate.

**You may now begin. Start by acknowledging this brief and asking operator to answer Q1-Q4 in section 4.1.**

---

*End of brief.*

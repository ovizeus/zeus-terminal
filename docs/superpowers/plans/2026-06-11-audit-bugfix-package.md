# Audit Bugfix Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every actionable finding from `/tmp/zeus-audit-20260611.md` at the root — ML table retention, /tmp test-artifact leak, leftover pm2-root daemon, ML observation-stall diagnosis, nginx security headers, dead client code, scratch-file removal, moderate npm CVEs — with TDD where code changes, ops verification where infra.

**Architecture:** Four code changes are inert/additive (retention prune wired into the EXISTING daily `brainLogger.prune()` timer; nginx config is edge-only; dead-code deletions are client-only build artifacts; scratch-file is a git rm). Three are ops actions on the live VPS (pm2-root kill, /tmp purge + systemd-tmpfiles rule, npm audit fix). One is a read-only diagnosis (ML obs stall) that only produces a fix if it uncovers a real bug. No serverAT.js changes. App runs as user `zeus` — every repo change ends with `chown -R zeus:zeus /opt/zeus-terminal`.

**Tech Stack:** Node CommonJS, better-sqlite3, jest (`--runInBand --forceExit`, named files only, NEVER full suite on live VPS), React/TS + vitest, nginx, systemd-tmpfiles, pm2.

**Sacred rules:** backup taken before start (done: `/root/zeus-db-pre-bugfix-20260611.backup` 1.1G + offsite + git clean @5d809aaf). Commit after every green step. NO pm2 reload inside code tasks — retention rides the next scheduled reload (it's additive + inert until the daily timer fires). Anti-ban: any reload only on a clean minute outside 22:00-02:00 UTC. chown after each repo change.

**Dropped from audit:** F12 (@capacitor/app "unused") is a FALSE POSITIVE — `grep -rln "@capacitor" client/src server/` → `client/src/core/backButtonHandler.ts` + `server/version.js` use it. Do NOT remove. F7 (3000 on 0.0.0.0) is mitigated by ufw (only 22/80/443 open) — addressed as a one-line bind hardening in Task 5b, low priority. F14 (54 empty catches) sampled as non-money-path logging guards — by-design, no action.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `server/services/database.js` | Modify | Add prune statements + `mlAuditPrune`/`parityPrune` to the `_stmts`+API block (mirror `bdPrune`) |
| `server/services/brainLogger.js` | Modify | `prune()` also calls the two new prunes (already runs daily via serverBrain.js:447 timer) |
| `tests/unit/mlRetentionPrune.test.js` | Create | TDD for the two new prunes on a temp DB |
| `/etc/nginx/conf.d/zeus-security-headers.conf` | Create (VPS, not repo) | HSTS/CSP-frame/nosniff at edge + limit_req on /auth |
| `client/src/components/trading/ATPanel.tsx` etc. | Delete (8 files) | Dead components |
| `client/src/stores/orderflowStore.ts`, `teacherStore.ts` | Delete (2 files) | Orphan stores |
| `client/src/stores/index.ts` | Modify | Drop the 2 dead store barrel exports |
| `mint_s2_tokens.js.tmp` | git rm | Tracked dev scratch file |
| `/etc/tmpfiles.d/zeus-test-cleanup.conf` | Create (VPS) | Auto-clean /tmp zeus test artifacts |

**Conventions:** jest `npx jest <file> --runInBand --forceExit > /tmp/<name>.log 2>&1` then grep. Client `cd client && npm run build` must stay clean. Explicit `git add` only (tree has untracked runtime files — leave them). End each repo task with `chown -R zeus:zeus /opt/zeus-terminal`.

---

### Task 1: ML table retention (F1 + F2) — the highest-value fix

`ml_influence_audit` (269K rows, ~11K/day, ALL gate_status='skipped', `created_at` INTEGER ms) and `brain_parity_log` (83K rows, `created_at` INTEGER ms) have ZERO prune → unbounded growth, DB already 1009MB. brain_decisions already has tiered prune via `bdPrune()` called daily from `brainLogger.prune()` (serverBrain.js:447 `setInterval(...,86400000)`). We mirror that exactly.

Retention policy (operator-aligned): `ml_influence_audit` keep 30 days (it's shadow audit, high volume, low long-term value — 30d = ~330K rows ceiling). `brain_parity_log` keep 60 days (parity soak history, mid value).

**Files:**
- Modify: `server/services/database.js` (`_stmts` block near line 10304, API block near `bdPrune` ~11586)
- Modify: `server/services/brainLogger.js` (`prune()` ~line 263)
- Test: `tests/unit/mlRetentionPrune.test.js`

- [ ] **Step 1.1: Write the failing test**

```js
'use strict';
// tests/unit/mlRetentionPrune.test.js
// [AUDIT-F1/F2 2026-06-11] Retention for the two unbounded ML tables.
// Mirrors the existing bdPrune model (brain_decisions). created_at is ms.

const fs = require('fs');
const os = require('os');
const path = require('path');

let db;
beforeAll(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mlretention-'));
    process.env.ZEUS_DB_PATH = path.join(tmp, 'test.db');
    db = require('../../server/services/database').db;
    // Tables exist via migrations; if a fresh test DB lacks them, create minimal shapes.
    db.exec(`CREATE TABLE IF NOT EXISTS ml_influence_audit (id INTEGER PRIMARY KEY, created_at INTEGER);`);
    db.exec(`CREATE TABLE IF NOT EXISTS brain_parity_log (id INTEGER PRIMARY KEY, created_at INTEGER);`);
});

afterEach(() => {
    db.exec('DELETE FROM ml_influence_audit; DELETE FROM brain_parity_log;');
});

describe('ML retention prune', () => {
    const DAY = 86400000;

    test('mlAuditPrune deletes rows older than 30 days, keeps newer', () => {
        const dbapi = require('../../server/services/database');
        const now = Date.now();
        db.prepare('INSERT INTO ml_influence_audit (created_at) VALUES (?)').run(now - 40 * DAY); // old
        db.prepare('INSERT INTO ml_influence_audit (created_at) VALUES (?)').run(now - 5 * DAY);  // fresh
        const deleted = dbapi.mlAuditPrune(now);
        expect(deleted).toBe(1);
        expect(db.prepare('SELECT COUNT(*) c FROM ml_influence_audit').get().c).toBe(1);
    });

    test('parityPrune deletes rows older than 60 days, keeps newer', () => {
        const dbapi = require('../../server/services/database');
        const now = Date.now();
        db.prepare('INSERT INTO brain_parity_log (created_at) VALUES (?)').run(now - 70 * DAY); // old
        db.prepare('INSERT INTO brain_parity_log (created_at) VALUES (?)').run(now - 10 * DAY); // fresh
        const deleted = dbapi.parityPrune(now);
        expect(deleted).toBe(1);
        expect(db.prepare('SELECT COUNT(*) c FROM brain_parity_log').get().c).toBe(1);
    });

    test('prunes never throw on empty tables', () => {
        const dbapi = require('../../server/services/database');
        expect(() => dbapi.mlAuditPrune(Date.now())).not.toThrow();
        expect(() => dbapi.parityPrune(Date.now())).not.toThrow();
    });
});
```

- [ ] **Step 1.2: Run — must FAIL (`mlAuditPrune is not a function`)**

Run: `cd /opt/zeus-terminal && npx jest tests/unit/mlRetentionPrune.test.js --runInBand --forceExit > /tmp/mlret-red.log 2>&1; grep -E "is not a function|Tests:" /tmp/mlret-red.log`

- [ ] **Step 1.3: Add prepared statements** in `server/services/database.js`, in the `_stmts` object right AFTER the `bdPruneTrade` line (~10304):

```js
    // [AUDIT-F1/F2 2026-06-11] Retention for the two unbounded ML tables
    // (created_at is INTEGER ms). Mirrors the bdPrune tiered-retention model.
    mlAuditPruneOld: db.prepare('DELETE FROM ml_influence_audit WHERE created_at < ?'),
    parityPruneOld: db.prepare('DELETE FROM brain_parity_log WHERE created_at < ?'),
```

- [ ] **Step 1.4: Add API functions** in the same file, right AFTER the `bdPrune: () => {...}` block (~11594), inside the same exported object:

```js
    // [AUDIT-F1 2026-06-11] ml_influence_audit retention — keep 30 days.
    mlAuditPrune: (now = Date.now()) => _stmts.mlAuditPruneOld.run(now - 30 * 86400000).changes,
    // [AUDIT-F2 2026-06-11] brain_parity_log retention — keep 60 days.
    parityPrune: (now = Date.now()) => _stmts.parityPruneOld.run(now - 60 * 86400000).changes,
```

**VERIFY:** confirm both new API functions are reachable on the exported `db` object (the file exports a single object literal that contains `bdPrune` — add the two new keys to the SAME object; if `bdPrune` is on a sub-object, match its nesting). Run `node -e "console.log(typeof require('./server/services/database').mlAuditPrune)"` → `function`.

- [ ] **Step 1.5: Run — must PASS 3/3**

Run: `cd /opt/zeus-terminal && npx jest tests/unit/mlRetentionPrune.test.js --runInBand --forceExit > /tmp/mlret-green.log 2>&1; grep "Tests:" /tmp/mlret-green.log`
Expected: `Tests: 3 passed, 3 total`

- [ ] **Step 1.6: Wire into the daily prune** in `server/services/brainLogger.js`, inside `prune()` (~line 263), add after `db.bdPrune();`:

```js
        try { db.mlAuditPrune(); } catch (e) { try { logger.error('BRAIN_LOG', 'mlAuditPrune failed: ' + e.message); } catch (_) {} }
        try { db.parityPrune(); } catch (e) { try { logger.error('BRAIN_LOG', 'parityPrune failed: ' + e.message); } catch (_) {} }
```

- [ ] **Step 1.7: Syntax check + regression**

Run: `cd /opt/zeus-terminal && node --check server/services/database.js && node --check server/services/brainLogger.js && echo SYNTAX_OK`
Run: `npx jest tests/unit/mlRetentionPrune.test.js --runInBand --forceExit > /tmp/mlret-reg.log 2>&1; grep "Tests:" /tmp/mlret-reg.log`

- [ ] **Step 1.8: One-time manual catch-up prune (live DB, additive, safe)** — the daily timer only fires going forward; clear the existing backlog ONCE via a read-then-delete on the live DB. This is a normal DELETE (not schema change), safe under WAL:

Run: `cd /opt/zeus-terminal && node -e "const db=require('./server/services/database'); console.log('mlAudit deleted:', db.mlAuditPrune(), '| parity deleted:', db.parityPrune());"`
Expected: prints the number of >30d / >60d rows removed. Verify after: `sqlite3 "file:data/zeus.db?mode=ro" "SELECT COUNT(*) FROM ml_influence_audit; SELECT COUNT(*) FROM brain_parity_log;"` — both lower.

**NOTE:** this node invocation opens the SAME zeus.db the live process uses. better-sqlite3 + WAL handles concurrent readers/one-writer; the DELETE is fast and atomic. If the live process holds a long write lock, the command waits up to busy_timeout (5s) then retries — acceptable. Do NOT run during a known heavy-write moment; pick a calm second.

- [ ] **Step 1.9: Commit + chown**

```bash
cd /opt/zeus-terminal
git add server/services/database.js server/services/brainLogger.js tests/unit/mlRetentionPrune.test.js
git commit -m "fix(audit-f1/f2): retention prune for ml_influence_audit (30d) + brain_parity_log (60d), wired into daily brainLogger.prune (was unbounded)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
chown -R zeus:zeus /opt/zeus-terminal
```

---

### Task 2: /tmp test-artifact leak (F3) — ops, root cause + sweep

29,446 temp dirs + 2,495 `zeus-*.db` + jest caches = ~21GB in /tmp. Root cause: jest tests `fs.mkdtempSync` temp DBs and `ring5-routes-*` dirs without afterAll cleanup, and systemd-tmpfiles default doesn't sweep them fast enough. Two parts: (a) immediate sweep, (b) a tmpfiles.d rule so it never piles up again.

- [ ] **Step 2.1: Measure before**

Run: `du -sh /tmp 2>/dev/null; find /tmp -maxdepth 1 -name "zeus-*" -o -maxdepth 1 -name "ring5-routes-*" 2>/dev/null | wc -l`

- [ ] **Step 2.2: Sweep zeus test artifacts older than 1 day** (keep very recent ones in case a test is mid-run — but no test runs on the live VPS normally):

Run: `find /tmp -maxdepth 1 \( -name "zeus-*.db*" -o -name "zeus-*test*" -o -name "ring5-routes-*" -o -name "zeus-optin-*" -o -name "zeus-mlretention-*" \) -mmin +60 -exec rm -rf {} + 2>/dev/null; echo swept`
Then jest transform cache: `rm -rf /tmp/jest_0 2>/dev/null; echo jest-cache-cleared`

- [ ] **Step 2.3: Measure after**

Run: `du -sh /tmp 2>/dev/null`
Expected: substantially smaller (target < 2GB).

- [ ] **Step 2.4: Install a systemd-tmpfiles rule** so these auto-clean daily. Create `/etc/tmpfiles.d/zeus-test-cleanup.conf`:

```
# [AUDIT-F3 2026-06-11] Auto-clean Zeus jest test artifacts from /tmp.
# Type e = clean contents of matching paths older than the age.
e /tmp/zeus-*.db* - - - 1d
e /tmp/ring5-routes-* - - - 1d
e /tmp/zeus-*test* - - - 1d
e /tmp/jest_0 - - - 2d
```

Run: `systemd-tmpfiles --clean /etc/tmpfiles.d/zeus-test-cleanup.conf 2>&1 | head; echo "exit=$?"`
(Validates the rule and does an immediate clean pass.)

- [ ] **Step 2.5: No commit** (this is /etc, not repo). Record in NONROOT-OPS runbook in Task 7.

---

### Task 3: leftover pm2-root daemon (F4) — ops

Migration to non-root left the old root pm2 God Daemon (pid 338375) + its pm2-logrotate (pid 338386) running, pointed at `/root/.pm2`. The app is fully under `zeus` pm2 now (pm2-zeus systemd enabled). The root daemon is dead weight; pm2-root.service is already disabled. We kill the root daemon but KEEP the root pm2 binary + dump (rollback lever per the migration plan).

- [ ] **Step 3.1: Confirm the root daemon manages NOTHING live**

Run: `PM2_HOME=/root/.pm2 pm2 list 2>/dev/null | grep -E "online|zeus" | head`
Expected: NO `zeus` app online here (it was deleted at cutover). If `zeus` shows online under /root/.pm2 → STOP, the cutover regressed; investigate before killing.

- [ ] **Step 3.2: Verify the live zeus app is under the zeus daemon**

Run: `sudo -u zeus bash -c 'cd /home/zeus && PM2_HOME=/home/zeus/.pm2 /usr/local/bin/pm2 list' | grep zeus`
Expected: `zeus` online under the zeus daemon.

- [ ] **Step 3.3: Kill the root daemon** (frees ~45MB + the stray logrotate)

Run: `PM2_HOME=/root/.pm2 pm2 kill 2>&1 | tail -2`
Then confirm gone: `ps aux | grep "[G]od Daemon" | grep "/root/.pm2"; echo "exit-grep=$?"` (exit 1 / no line = killed).
Then confirm live app UNAFFECTED: `curl -s http://localhost:3000/health | head -c 60`

- [ ] **Step 3.4: No commit** (ops). Note: `PM2_HOME=/root/.pm2 pm2 resurrect` remains available as rollback (dump.pm2 untouched). Record in runbook (Task 7).

---

### Task 4: ML observation-stall diagnosis (F6) — read-only investigation FIRST

`ml_bandit_posteriors` top cell `1:TESTNET:BTCUSDT:TREND` = 24 obs (was 23 on 06-09). ~+1 per 2 days, not the ~13/day projected → influence ETA is weeks, not days. `observation_count` increments in `banditPosteriors.js:53/59` (`updatePosterior` on win/loss). This task is DIAGNOSIS — produce a fix ONLY if a real bug is found; otherwise document that accrual is simply slower than projected (testnet trade frequency is low).

- [ ] **Step 4.1: Find the attribution caller** — who calls `updatePosterior` and on what trigger:

Run: `cd /opt/zeus-terminal && grep -rn "updatePosterior\|recordObservation\|attribut" server/services/ml/ --include="*.js" | grep -v node_modules | grep -v test | head -15`

- [ ] **Step 4.2: Trace the trigger** — read the caller's surrounding code. Confirm: is it called on every CLOSED+attributed trade, or gated behind a condition that rarely fires? Cite file:line + the gate condition.

- [ ] **Step 4.3: Cross-check trade volume** — how many testnet closes happened in the window vs how many obs were recorded:

Run: `sqlite3 "file:data/zeus.db?mode=ro" "SELECT COUNT(*) closes_7d FROM at_positions WHERE status='CLOSED' AND user_id=1 AND updated_at > datetime('now','-7 days');" 2>&1`
Run: `sqlite3 "file:data/zeus.db?mode=ro" "SELECT SUM(observation_count) total_obs FROM ml_bandit_posteriors WHERE cell_key LIKE '1:TESTNET%';" 2>&1`

- [ ] **Step 4.4: Verdict** — if `closes_7d` ≈ obs added → accrual is correct, just slow (DOCUMENT, no fix; the ML influence ETA is realistically ~2-3 weeks). If `closes_7d` >> obs added → attribution is dropping observations (REAL BUG) → STOP and report the exact gate that's eating them; do NOT fix blind — escalate the finding with evidence for a targeted follow-up. Write the verdict to `/tmp/ml-obs-stall-verdict.md`.

- [ ] **Step 4.5: No repo change unless a bug is confirmed.** If documenting-only, this task is complete after Step 4.4.

---

### Task 5: nginx security headers + rate-limit (F5) + 3000 bind note (F7)

App-layer helmet already sets HSTS/CSP/X-Frame on proxied responses; gap is the EDGE (nginx error pages emit nothing) + no brute-force protection on `/auth`. Add headers + a login rate-limit zone at nginx. Read-only-safe: `nginx -t` before reload, graceful `systemctl reload nginx` (zero downtime).

- [ ] **Step 5.1: Create `/etc/nginx/conf.d/zeus-security-headers.conf`**

```nginx
# [AUDIT-F5 2026-06-11] Edge security headers + login brute-force limit.
# App-layer helmet already sets these on proxied 200s; this guarantees them
# on nginx-generated responses (errors, redirects) too, and rate-limits /auth.

# Rate-limit zone: 10 req/min per IP for login (burst 5).
limit_req_zone $binary_remote_addr zone=zeus_auth:10m rate=10r/m;

# Headers applied to all responses from this server (add_header inherits into
# location blocks only if no location-level add_header overrides — Zeus's
# location / has none, so these propagate).
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```

- [ ] **Step 5.2: Apply the login rate-limit to the auth path** — this needs a `location` inside the server block. Since the Zeus vhost has a single `location /`, add a more-specific `location` for auth by editing `/etc/nginx/sites-available/zeus-terminal`. Add BEFORE the existing `location / {`:

```nginx
    location /auth/ {
        limit_req zone=zeus_auth burst=5 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
```

**VERIFY the real auth path first:** `grep -rn "'/auth\|\"/auth\|/api/auth\|/login" server.js | grep -iE "post|login" | head` — confirm the login endpoint is under `/auth/` (the audit found `/auth` login is public by design). If login is at `/api/auth/login` or `/login.html` POST, change the `location` prefix to match the ACTUAL path or the rate-limit guards nothing. Document the confirmed path in the commit.

- [ ] **Step 5.3: Test config**

Run: `nginx -t 2>&1`
Expected: `syntax is ok` + `test is successful`. If it fails → fix before reload, do NOT reload a broken config.

- [ ] **Step 5.4: Graceful reload + smoke**

Run: `systemctl reload nginx && systemctl is-active nginx && curl -s -o /dev/null -w "app: %{http_code}\n" -k https://localhost/login.html`
Run (verify header present): `curl -sI -k https://localhost/login.html | grep -iE "strict-transport|x-frame|x-content"`
Expected: 200 + the three headers echoed.

- [ ] **Step 5.5 (F7, optional low-pri): note the 3000 bind** — changing `0.0.0.0:3000` → `127.0.0.1:3000` requires an app code change (server.listen host) + reload; ufw already blocks 3000 externally. Defer to a separate change unless trivial. Document as accepted-risk-mitigated in the runbook. No action this task.

- [ ] **Step 5.6: No repo commit** (/etc config). Record both files in the runbook (Task 7).

---

### Task 6: dead client code purge (F10)

8 dead components + 2 orphan stores (confirmed zero references by the Area E audit). Delete + drop barrel exports + rebuild to prove nothing breaks.

**Files to delete:**
- `client/src/components/trading/ATPanel.tsx`
- `client/src/components/trading/DslWidget.tsx`
- `client/src/components/trading/SymbolSelector.tsx`
- `client/src/components/brain/DeepDivePanel.tsx`
- `client/src/components/brain/ForecastPanel.tsx`
- `client/src/components/advanced/OrderFlowPanel.tsx`
- `client/src/components/advanced/TeacherPanel.tsx`
- `client/src/components/advanced/JournalPanel.tsx`
- `client/src/stores/orderflowStore.ts`
- `client/src/stores/teacherStore.ts`

- [ ] **Step 6.1: Re-confirm zero references for EACH** (don't trust the prior audit blindly — verify at delete time):

Run for each component name (example):
```bash
cd /opt/zeus-terminal/client/src
for f in ATPanel DslWidget SymbolSelector DeepDivePanel ForecastPanel OrderFlowPanel TeacherPanel JournalPanel; do
  n=$(grep -rln "\b$f\b" . --include="*.ts" --include="*.tsx" | grep -v "/$f\.tsx$" | grep -v "__tests__" | wc -l);
  echo "$f: $n live refs";
done
for s in useOrderFlowStore useTeacherStore orderflowStore teacherStore; do
  n=$(grep -rln "$s" . --include="*.ts" --include="*.tsx" | grep -vE "stores/(orderflowStore|teacherStore)\.ts$" | grep -v "stores/index.ts" | grep -v __tests__ | wc -l);
  echo "$s: $n live refs (excl. barrel+self)";
done
```
Expected: every component `0 live refs`. For stores, the ONLY allowed refs are `stores/index.ts` (barrel, removed in 6.3) — if a store shows a ref outside barrel+self+the dead components, STOP and exclude that store from deletion.

- [ ] **Step 6.2: Delete the 10 files**

```bash
cd /opt/zeus-terminal
git rm client/src/components/trading/ATPanel.tsx client/src/components/trading/DslWidget.tsx client/src/components/trading/SymbolSelector.tsx client/src/components/brain/DeepDivePanel.tsx client/src/components/brain/ForecastPanel.tsx client/src/components/advanced/OrderFlowPanel.tsx client/src/components/advanced/TeacherPanel.tsx client/src/components/advanced/JournalPanel.tsx client/src/stores/orderflowStore.ts client/src/stores/teacherStore.ts
```

- [ ] **Step 6.3: Remove the 2 dead barrel exports** from `client/src/stores/index.ts` — delete the two lines exporting `orderflowStore`/`useOrderFlowStore` and `teacherStore`/`useTeacherStore` (the audit cited `stores/index.ts:9` and `:10`). READ the file, remove ONLY those two export lines, leave the rest.

- [ ] **Step 6.4: Build — must stay clean** (proves nothing imported the dead code)

Run: `cd /opt/zeus-terminal/client && npm run build > /tmp/deadcode-build.log 2>&1; tail -3 /tmp/deadcode-build.log`
Expected: `✓ built` with no "Could not resolve" / "is not exported" errors. If the build breaks → something DID reference a deleted file; `git checkout` that file and re-investigate (the audit missed a dynamic import).

- [ ] **Step 6.5: Commit + chown**

```bash
cd /opt/zeus-terminal
git add client/src/stores/index.ts
git commit -m "chore(audit-f10): purge 8 dead components + 2 orphan stores (zero refs, superseded by dock/ equivalents)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
chown -R zeus:zeus /opt/zeus-terminal
```

---

### Task 7: scratch file removal (F8) + CVE bump (F13) + runbook update

- [ ] **Step 7.1: Remove the tracked scratch file**

Run: `cd /opt/zeus-terminal && git rm mint_s2_tokens.js.tmp 2>&1; git status --short | head`
(It mints JWTs + hardcodes the operator email + a stale /root path — no place in the repo. The secret was env-sourced, so no credential rotation needed, but it's removed for hygiene.)

- [ ] **Step 7.2: Assess the 3 moderate npm CVEs (server)** — read-only first:

Run: `cd /opt/zeus-terminal && npm audit --omit=dev 2>/dev/null | grep -A4 -iE "moderate|brace-expansion|qs|ws" | head -30`
Determine if a non-breaking fix is available: `npm audit fix --omit=dev --dry-run 2>&1 | tail -15`
- If the dry-run shows ONLY semver-compatible bumps (no `--force`, no major) → apply: `npm audit fix --omit=dev 2>&1 | tail -8` then `node --check server.js && echo OK`.
- If it requires `--force` / major bumps → DO NOT apply (risk > reward for moderates on a live trading server); document the 3 CVEs as accepted-risk in the runbook and leave them. `ws`/`qs`/`brace-expansion` moderates are low real-world exposure here (no untrusted WS upgrade headers parsed directly).

- [ ] **Step 7.3: Append all ops actions to the runbook** — add to `docs/runbooks/NONROOT-OPS.md`:

```markdown

## Audit fixes 2026-06-11
- ML retention: ml_influence_audit 30d + brain_parity_log 60d, daily via brainLogger.prune (serverBrain.js:447 timer). Catch-up prune already run once.
- /tmp auto-clean: /etc/tmpfiles.d/zeus-test-cleanup.conf (jest artifacts age out at 1d).
- pm2-root daemon KILLED (was leftover from migration). Rollback still: `PM2_HOME=/root/.pm2 pm2 resurrect`.
- nginx edge security headers + /auth rate-limit: /etc/nginx/conf.d/zeus-security-headers.conf + /auth/ location in sites-available/zeus-terminal.
- npm moderate CVEs (brace-expansion/qs/ws): <applied | accepted-risk per Step 7.2>.
- F7 (3000 on 0.0.0.0) accepted: ufw blocks external; bind-to-127.0.0.1 deferred (needs app reload).
- F12 (@capacitor/app) was a depcheck FALSE POSITIVE — used by backButtonHandler.ts; NOT removed.
```

- [ ] **Step 7.4: Commit + chown**

```bash
cd /opt/zeus-terminal
git add -u  # stages the git rm of mint_s2_tokens.js.tmp + any package-lock change from 7.2
git add docs/runbooks/NONROOT-OPS.md package.json package-lock.json 2>/dev/null
git commit -m "chore(audit-f8/f13): remove tracked JWT-mint scratch file + npm moderate CVE handling + ops runbook for audit fixes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
chown -R zeus:zeus /opt/zeus-terminal
```

---

### Task 8: final regression + reload decision + version bump

- [ ] **Step 8.1: Run all touched server tests together** (named files only — NOT the full suite):

Run: `cd /opt/zeus-terminal && npx jest tests/unit/mlRetentionPrune.test.js --runInBand --forceExit > /tmp/audit-final.log 2>&1; grep -E "Tests:|Suites:" /tmp/audit-final.log`

- [ ] **Step 8.2: Bump version** in `server/version.js` (b128, one changelog line): "Audit bugfix package: ML retention prune (F1/F2), /tmp auto-clean (F3), pm2-root cleanup (F4), nginx edge headers+rate-limit (F5), 8 dead components purged (F10), scratch file removed (F8)." Commit + tag `audit-bugfix-20260611` + push + chown.

- [ ] **Step 8.3: Reload decision** — the retention code activates at the next reload (daily timer re-arms on boot; the one-time catch-up in Step 1.8 already cleared the backlog, so a reload is NOT urgent). Reload ONLY on a clean minute outside 22:00-02:00 UTC: check `pm2 logs zeus --lines 200 --nostream | grep -cE "HTTP 429"` = 0, then `sudo -u zeus bash -c 'cd /opt/zeus-terminal && PM2_HOME=/home/zeus/.pm2 /usr/local/bin/pm2 reload zeus --update-env'`, then verify boot clean + book=exchange + the daily prune timer logs. If inside the anti-ban window now, DEFER reload to tomorrow's window — everything is inert/already-applied without it.

- [ ] **Step 8.4: Update memory** — append audit-fix closure to `/root/.claude/projects/-root/memory/project_active_session_state_20260610.md` (or a new 0611 file) + MEMORY.md index line.

---

## Self-Review (done at write time)

- **Coverage vs audit:** F1✓(T1) F2✓(T1) F3✓(T2) F4✓(T3) F5✓(T5) F6✓(T4 diagnosis) F7✓(T5.5 documented) F8✓(T7.1) F10✓(T6) F13✓(T7.2). F9 (srv-pos pre-auth diag) — JWT-scoped writes, low-impact, NOT fixed (documented as accepted in runbook is reasonable; could add to T7 note). F11 (omega no-redact, data clean) — diagnosis only, no data leak, deferred. F12 dropped (false positive, documented). F14 by-design. ✓
- **Placeholders:** none — every code step has full code; ops steps have exact commands + expected output; conditional steps (7.2 CVE, 4.4 verdict, 5.2 path verify) state the decision rule explicitly. ✓
- **Consistency:** `mlAuditPrune`/`parityPrune` names identical in test (1.1), impl (1.4), wiring (1.6), runbook (7.3). created_at unit (ms) verified before writing cutoffs. ✓
- **Money-path:** serverAT.js untouched; no execution code changed; retention is DELETE on audit/log tables only. ✓
- **Risks flagged inline:** Step 1.8 concurrent-DB note, 5.2 auth-path verification, 6.1 re-confirm refs, 6.4 build-break recovery, 7.2 no-force rule, 3.1 cutover-regression guard. ✓
- **Gap:** F9 not given its own task — add a one-line note in Task 7.3 runbook ("F9 srv-pos diag pre-auth: JWT-scoped, accepted") to be complete.

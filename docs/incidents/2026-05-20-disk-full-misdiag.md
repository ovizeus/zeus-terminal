# Incident — 2026-05-20 — Disk Full Misdiagnosed as CSS Commit

**Severity:** P2 (app broken on browser + phone for ~30 min)
**Outcome:** Resolved. Root cause identified. Recurrence prevention installed.
**Duration:** ~30 min visible impact + 30 min misdiagnosis detour
**Operator-visible symptom:** Black screen, console flooded with `POST /api/sync/user-context 500`

---

## Timeline (UTC, 2026-05-20)

| Time | Event |
|---|---|
| ~07:14 | Sub-C.1 T10 shipped — v1.7.97 b123 (`dbc8eaf`) |
| ~07:20-07:35 | Operator smoke-tested via browser — all functional |
| 07:36:21 | Last successful nginx access log entry for operator's session |
| 07:42 | CSS commit `cc3c922` — added missing CSS for Omega memory UI. PM2 reloaded |
| 07:46 | Operator reports app broken on **both** browser + phone |
| 07:50 | **Misdiagnosis:** assumed CSS commit caused issue. Reverted (`2c34f5d`). Rebuilt. PM2 reloaded |
| 07:58 | Operator: "tot e stricat" — revert didn't fix it. Real diagnosis begins |
| 08:00 | Invoked `superpowers:systematic-debugging` skill |
| 08:10 | Reproduced 500 with realistic payload via curl |
| 08:13 | Confirmed: direct hit to node `127.0.0.1:3000` returns 200; same payload via nginx returns 500 |
| 08:15 | **Root cause identified:** `df -h` shows `/dev/sda1 100% full` (0 bytes available) |
| 08:18 | First cleanup pass: deleted 125 `doctor-routes-*` dirs, freed 1.6GB |
| 08:25 | Second pass: 7503 orphan dirs older than 1 day deleted, freed +21GB → 24GB available |
| 08:30 | Endpoint returns 200 again. App restored |
| 11:08 | Pro-cleanup phase: full backup, Step 2 final purge (78GB used, 67GB free) |
| 12:00 | systemd-tmpfiles automation installed |
| 12:05 | CSS commit re-applied (`7728171`) — revert was unnecessary |

---

## Root Cause

**`/tmp` filled to 100% disk usage from accumulated orphan test artifacts.**

- **17,969 directories** in `/tmp` at time of incident
- **~80GB total** consumed by test fixture databases (`r5-*`, `r3b-*`, `omega-*`, `doctor-*`, `jest-*`)
- Each dir ~17-29MB containing copied `test.db` + WAL + SHM files
- Originating from: jest `mkdtempSync()` calls in subagent test workflows during Sub-C.1 development (~5,000+ jest runs over the prior month)
- **No automatic cleanup** — jest's afterAll teardown didn't remove dirs

**Why this caused 500s:** nginx buffers request bodies to disk for proxying. With 0 free bytes, nginx cannot write the temp file → returns default 500 error page (without the request reaching the upstream node app at all).

**Why direct-to-node worked:** node uses tmp+rename atomic write pattern. The temp file was small enough that the rename succeeded without needing new disk blocks.

**Why the timing fooled me:** Disk happened to fill around the same time as CSS commit. Operator timing observation ("since you added Omega UI") matched the CSS rebuild's PM2 reload. Correlation ≠ causation, but I jumped to the simpler hypothesis (recent code change) without checking environmental factors.

---

## What Went Wrong in Diagnosis

I violated the systematic-debugging skill's iron law: **"ALWAYS find root cause before attempting fixes."**

Per the skill's Phase 1, the FIRST diagnostic step should be:
> Read error messages carefully — they often contain the exact solution.

If I had read the operator's report ("multiple devices fail") critically, I should have IMMEDIATELY ruled out browser cache (multi-device = systemic) and instead checked:
1. `df -h` — would have shown 100% full
2. `dmesg | tail` — would have shown ENOSPC errors potentially
3. PM2 logs for actual stack trace BEFORE assuming code change

Instead I:
- Jumped to `git revert cc3c922` based on operator's timing hypothesis
- Reverted CSS which was unrelated
- Wasted 30 min on a fix that didn't address root cause

**The skill's "Red Flag" detection should have triggered:**
- "It's probably X, let me fix that" → guess
- "Quick fix for now, investigate later" → expedient over correct

---

## Recurrence Prevention

### Installed: `/etc/tmpfiles.d/zeus-test-cleanup.conf`

```
e /tmp/r5-*       - - - 1d
e /tmp/r3b-*      - - - 1d
e /tmp/omega-*    - - - 1d
e /tmp/doctor-*   - - - 1d
e /tmp/jest-*     - - - 1d
e /tmp/tmp.*      - - - 7d
```

Triggered daily by `systemd-tmpfiles-clean.timer` (already active, runs ~19:49 UTC).

### Memory rule for future debugging

Added `feedback_disk_full_diagnostic.md`:
> On ANY production 500/connection issue, run `df -h` and `pm2 logs zeus --lines 50 | grep -i error` BEFORE hypothesizing about recent code changes. Multi-device failure = systemic, not browser-cache.

### Operator-side action (deferred)

Should also fix the JEST source of leak:
- Identify which jest test files use `mkdtempSync` or `os.tmpdir()` without cleanup
- Wrap tmp dirs in `afterEach(() => fs.rmSync(...))` or use jest's `globalTeardown`

Patterns found in `/tmp` indicate the prefixes: `r5-`, `r3b-`, `omega-`, `doctor-`, `jest-`. Most are from Ring 5 bandit tests, R3B safety tests, Omega services, and various jest tmp dirs.

---

## Outcome Summary

- ✅ App fully restored
- ✅ Sub-C.1 verified working end-to-end (operator confirmed: Omega remembers "Ovi" + Romanian language)
- ✅ Disk freed from 100% → 54% usage (67GB available)
- ✅ Automated cleanup installed (systemd-tmpfiles daily 1d age)
- ✅ CSS re-applied — UI styled
- ✅ Backup created pre-cleanup (418MB at `/root/zeus-terminal-backup-FULL-20260520-110754-pre-pro-cleanup.tar.gz`)
- ⚠️ Sub-C.1 NOT yet pushed to GitHub (secret scanner block on `aa385ae` Stripe test fixture; operator must click "Allow secret")

## Lessons

1. **Always check the environment first.** Disk, memory, network, process count — before suspecting code.
2. **Multi-device failure is a systemic signal.** Single device = client issue. Multiple = server/infra issue.
3. **The systematic-debugging skill exists for a reason.** Following it strictly would have shaved 30 min off this incident.
4. **Test artifact cleanup is mandatory infra.** Either the framework handles it (jest's tmpdir is supposed to) or we install OS-level cleanup. We now have the latter.

---

**Author:** Claude (Opus 4.7) — incident responder
**Reviewed-by:** Ovi (operator) — confirmed root cause + remediation

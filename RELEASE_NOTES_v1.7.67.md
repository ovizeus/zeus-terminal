# Release Notes — v1.7.67

**Tag:** `v1.7.67`
**Commit:** `e4e5b61` (SESSION_RECOVERY)
**Date:** 2026-05-08
**Type:** Bug burn-down checkpoint

---

## TL;DR

Tag pe checkpoint-ul end-of-day pentru bug burn-down session 2026-05-08.

- **141 → 0 raw-open bugs** (post-correction final state)
- **115 RESOLVED** + **22 DEFERRED** cu resume criteria documentate
- **34 batches** BUG-1.1 → BUG-1.34 executed back-to-back
- **22 commits** pushed pe `post-v2/real-finish`
- **PM2 stable** throughout: 165→178 restarts, 0 unstable, jest 161/161 PASS
- **Soak undisturbed** (per Master Working Rule 2)

---

## Notable infrastructure additions

### Server (new files / endpoints)

- **`server/services/mailer.js`** (NEW) — singleton SMTP transport pentru OPS-9 sendCriticalEmail; wired în `telegram.send()` pe Telegram failure
- **`/metrics`** (server.js:155-218) — Prometheus 0.0.4 text exposition endpoint, IP-allowlisted via `PROMETHEUS_ALLOW_IPS` env (default localhost)
- **5 noi crons în `database.js`:**
  - OPS-1 daily API key health check (via `_testKeys`, audit + Telegram pe failure)
  - OPS-3 weekly Monday DB restore probe (validates backup tables + row counts)
  - OPS-5 SERVER_BOOT audit + 24h count alert (>10 boots/day)
  - OPS-7 audit_log 90-day rolling retention
  - SEC-22 trading anomaly detector (5min window, 30 events/user threshold)
  - DB-6 backup single retry post-60s

### DB

- **Migration 030** — partial UNIQUE expression index pe `at_positions(user_id, sym, side, mode) WHERE status='OPEN'`
- **PRAGMA wal_autocheckpoint = 10000** (default 1000)
- **DB-9 query optim** — UNION ALL → 2 indexed queries (verified COVERING INDEX hits via EXPLAIN QUERY PLAN)

### Client

- **WS-2 frame-seq dedup** în `_applyServerATState` (state.ts:986-1003) — pairs cu server WS-1 `_wsFrameSeq` monotonic counter
- **TM-4 `_applyRoundTripFee`** — 0.08% fee deduction la 4 PnL terminal sites
- **TM-9 slippage estimate** — 0.06% notional adăugat la tpPnl/slPnl display values

### Security

- **SEC-19 WS heartbeat token_version re-verify** — force-logout 30s window
- **SEC-20 WS upgrade Origin allowlist**
- **SEC-7 ARES `_stripDangerousKeys`** — prototype pollution defense-in-depth
- **SEC-24 NODE_ENV fail-fast at boot** pe production-like path
- **SEC-27 validateSettingsBody soft→strict flip** (post 0 soft-mode logs verified)
- **SEC-29 chartExtras whitelist** (Sprint 1 root cause for 7,175 user-ctx rejections)
- **AUTH-1 2FA email-send rate limiter** (3/10min)
- **AUTH-2 constant-time bcrypt on unknown email** (timing attack mitigation)
- **AUTH-4 2FA code reuse on /login retry** within window (no orphan codes)

### Trading math

- **TM-4 fee deduction** la 4 terminal sites
- **TM-5 `pos.price > 0` defensive guard**
- **TM-7 sl/tp tick alignment via roundOrderParams**
- **TM-9 expected costs (fees + slippage)** la display values

### Config / Ops

- **CFG-4/5/6 boot warns** + ZEUS_SERVER_URL env override
- **CFG-8 Telegram FIFO throttle queue** 35ms (~28 msgs/sec, sub 30/sec ceiling)
- **CFG-9 SENTRY_DSN boot warn**
- **OPS-9 mailer email fallback** wired în telegram.send()

---

## 22 DEFERRED bugs cu resume criteria

### Workflow scope (single PAT refresh closes 5)

- TEST-3 — npm audit re-enable
- TEST-4 — coverage threshold 50%
- TEST-5 — NODE_ENV=production în CI
- OPS-4 — CI rollback on health fail
- OPS-8 — bundle hash CI assertion

**Patch artifacts:** `.github/workflows/deploy.yml.WITH-*-PATCH-*` (3 files)
**Closed 2026-05-09 13:14 UTC** via commit `dbd4f83` (post PAT refresh).

### Post-soak operator action (6)

- CFG-3 — ENCRYPTION_KEY + JWT_SECRET rotate (ABSOLUTE)
- CFG-1 + CFG-2 — Telegram + SMTP secrets rotate
- CFG-12 + CFG-13 — post-CFG-3 cleanup (170 backup .env + tarballs)
- DB-7 — at_closed FK + NOT NULL schema migration

### Pre-S11 mass user hardening (4)

- SRV-9 — Redis migration (rate limit persistence)
- SEC-15 + SEC-16 — CSP unsafe-inline removal post-legacy bridge sunset
- SEC-23 — pm2 root user → zeus-user migration

### Plan v3 ML opening (2)

- ML-1 — brain_decisions/parity_log env col
- ISO-1 — cross-env state separation

### Multi-day operator-led (3)

- OPS-2 — offsite encrypted backup (cloud creds + tooling)
- MOB-5 — Capacitor App plugin install + cap sync + APK rebuild
- O12 — chart drawing tools rewrite (~3-5 zile)

### Other (3)

- PERF-8 — inline styles → useMemo (profiler-driven)
- SEC-17 — ENCRYPTION_KEY rotation runbook MD
- CFG-11 — magic numbers refactor (low-value, indefinite)

---

## Lesson learned

**Operator caught audit miss 17:55 UTC** ("mai sunt buguri din boom"):

Initial "0 actionable OPEN" claim was WRONG — grep audit folosise doar pattern `^| **X-N** |` (table-row), ratând format `- **X-N**` (bullet-list în dependency map sections). 22 raw-open bugs ratate, recuperate prin BUG-1.29-1.34.

**Rule strengthened pentru future audits:**
```bash
grep -nE "^\| \*\*[A-Z]+-[0-9]+\*\*" file  # table-row
grep -nE "^- \*\*[A-Z]+-[0-9]+\*\*" file    # bullet-list
```

Verification-before-completion (Master Working Rule 6) reinforced: "0 OPEN" claim trebuie validat cu zero false-negative grep regex înainte de declarare.

---

## References

- **Static handover:** [`SESSION_RECOVERY_BUG_BURNDOWN_2026-05-08.md`](./SESSION_RECOVERY_BUG_BURNDOWN_2026-05-08.md) (229 linii)
- **Live state:** `/root/_review/audit/OPEN_BUGS_PRIORITY_RANKING.md`
- **Memory:** `~/.claude/projects/-root/memory/project_bug_burndown_complete_2026-05-08.md` (auto-loaded next session)
- **Tag commit:** `e4e5b61` — full git log: `git log v1.7.66..v1.7.67`

# Release Notes — v1.7.69

**Tag:** `v1.7.69`
**Date:** 2026-05-09
**Type:** S6-B8 close + bug burn-down archive
**Predecessor:** v1.7.68 b94 (2026-05-08)
**Successor (planned):** v1.7.70+ post-S7 DSL server integration

---

## TL;DR

Administrative version bump marking the end of two parallel milestones:
1. **S6-B7 GREEN-FINAL** soak (signed 2026-05-05 12:40 UTC, T+192h sign-off 2026-05-06 clean)
2. **Bug book burn-down** complete (8-9 mai: 161→0 raw-open + 17 DEFERRED + 120 RESOLVED)

**S6-B8 closure unlocks S7 (DSL server integration) work.**

NO Zeus runtime logic change in this version — pure metadata + changelog.
PM2 stable throughout (pid 3649523, 179 restarts, no reload pe metadata bump).

---

## S6-B7 milestone closure

Reference: `/root/_review/audit/archive/S6B7_GREEN_20260505/`

- **T+168h GREEN-FINAL** verdict signed-off **2026-05-05 12:40 UTC** (Phone Claude + Ovi)
  - Decisions=0 = expected DEMO static (per Recovery Plan §1 line 68)
  - Opens=1 + safety=0 = GREEN literal trigger satisfied
- **T+192h sign-off** clean **2026-05-06** (MD5 `2e416255fb90ed6eff7db15c34d57c78`)
- **24h observation tail** expired without incidents
- All flags unchanged: SERVER_BRAIN_DEMO=true, SERVER_AT_DEMO=true, SERVER_AT=false

---

## Bug book burn-down (8-9 mai 2026)

**161 OPEN → 0 raw + 17 DEFERRED + 120 RESOLVED**

Operator + Termius Claude (no Phone Claude during execution). 35+ batches BUG-1.1 → BUG-1.34.

### Categories resolved

| Category | Closures |
|---|---|
| TM (trading math) | TM-1, TM-2, TM-3, TM-4, TM-5, TM-6, TM-7, TM-8, TM-9 — fee deduction 0.08% × 4 PnL sites, slippage 0.06%, tick alignment, defensive `pos.price > 0` guard |
| DB hardening | Migrations 028+029+030 (composite + partial UNIQUE expression indexes), PRAGMA `cache_size=32MB` + `wal_autocheckpoint=10000`, query optim DB-9 (UNION ALL → 2 indexed queries cu COVERING INDEX), defensive `atArchiveClosed` shape, backup retry post-60s |
| WS hardening | WS-1 monotonic `_wsFrameSeq`, WS-2 client-side frame-seq dedup în `_applyServerATState` |
| SEC | SEC-5/6 escHtml + trust contract, SEC-7 ARES `_stripDangerousKeys` prototype pollution defense, SEC-19 WS heartbeat token re-verify (force-logout 30s window), SEC-20 WS upgrade Origin allowlist, SEC-22 trading anomaly detector cron, SEC-24 NODE_ENV fail-fast at boot, SEC-27 validateSettingsBody soft→strict flip, SEC-29 chartExtras whitelist (Sprint 1 root cause for 7,175 user-ctx rejections) |
| AUTH | AUTH-1 2FA email rate limit (3/10min), AUTH-2 constant-time bcrypt on unknown email, AUTH-4 2FA code reuse on /login retry within window |
| OPS automation (5 noi crons) | OPS-1 daily API key health check (`_testKeys` per user × exchange), OPS-3 weekly Monday DB restore probe, OPS-5 SERVER_BOOT count alert (>10/24h), OPS-7 audit_log 90-day rolling retention, SEC-22 anomaly detector (5min/30 events), DB-6 backup single retry. Plus OPS-6 `/metrics` Prometheus endpoint (IP-allowlisted) + OPS-9 mailer email fallback wired în `telegram.send()` |
| CI hardening | TEST-3 npm audit re-enable, TEST-4 jest `--coverage --coverageThreshold 50%`, TEST-5 `NODE_ENV=production` în test step, OPS-4 pre-deploy SHA capture + rollback on health fail, OPS-8 sha256 bundle hash assertion (pushed via PAT refresh post-burn-down) |

### NEW infrastructure files

- `server/services/mailer.js` — singleton SMTP transport (OPS-9 email fallback)
- `/metrics` endpoint (server.js:155-218) — Prometheus 0.0.4 text exposition, IP-allowlisted via `PROMETHEUS_ALLOW_IPS` env
- `data/backups/source/bak-snapshot-20260509-1314.tar.gz` — 252 .bak files archived (cleanup)
- `data/backups/source/public-app-bak-dirs-20260509-1314.tar.gz` — 9 build snapshots archived
- `RELEASE_NOTES_v1.7.67.md` (143 LOC, predecessor)
- `SESSION_RECOVERY_BUG_BURNDOWN_2026-05-08.md` (229 LOC static handover)
- `/root/_review/working_rules.md` (consolidated Master 0-15 + Extended 16-20 + Context Economy 1-10)

---

## 17 DEFERRED bugs cu resume criteria

| Group | Bugs | Trigger |
|---|---|---|
| Post-soak operator action (6) | CFG-3, CFG-1, CFG-2, CFG-12, CFG-13, DB-7 | Operator GO post-soak (secrets rotate + cleanup + schema migration) |
| Pre-S11 mass user hardening (4) | SRV-9, SEC-15, SEC-16, SEC-23 | Pre-Cloudflare expose (Redis migration + CSP unsafe-inline removal + pm2 user migration) |
| Plan v3 ML opening (2) | ML-1, ISO-1 | "GO Plan v3" trigger (env col + cross-env state separation) |
| Multi-day operator-led (3) | OPS-2, MOB-5, O12 | Cloud creds + Capacitor build + chart rewrite |
| Other (2-3) | PERF-8, SEC-17, CFG-11 | Profiler / runbook MD / refactor |

---

## Forward path

### Track A — S-stages roadmap

**S7 (DSL server integration)** acum unblocked. Gating: nothing imediat.

```
S7  → S8 (TESTNET flip) → S9 (Reflection enforcement)
                         ↓
              + Pre-S10: CFG-3 rotate + OPS-2 backup
                         ↓
S10 (LIVE flip per-user opt-in) → Pre-S11 hardening (SRV-9 + SEC-15+16 + SEC-23)
                                ↓
                            S11 (LIVE flip global) → S12 (cleanup client AT dead code)
```

### Track B — ML v3

Phase 1 brainLogger root cause fix REMAINS GATING. ML v3 cod NU începe până:
- Phase 1 brainLogger DATA collection issues fixed (currently 0 records)
- "GO Plan v3" trigger explicit operator
- Plan v3 Gap Closure scaffolding content fill (51 entries × ~10min)

### Track C — Operator-led blockers (parallel)

CFG-3 secrets rotate, OPS-2 offsite backup, SRV-9 Redis migration, SEC-23 pm2 user migration — toate pot avansa parallel cu Track A.

---

## References

- **Predecessor release notes:** [`RELEASE_NOTES_v1.7.67.md`](./RELEASE_NOTES_v1.7.67.md)
- **Static handover:** [`SESSION_RECOVERY_BUG_BURNDOWN_2026-05-08.md`](./SESSION_RECOVERY_BUG_BURNDOWN_2026-05-08.md)
- **Live bug state:** `/root/_review/audit/OPEN_BUGS_PRIORITY_RANKING.md`
- **Memory:** `~/.claude/projects/-root/memory/project_bug_burndown_complete_2026-05-08.md` (auto-loaded next session)
- **Working rules consolidat:** `/root/_review/working_rules.md`
- **S6-B7 archive:** `/root/_review/audit/archive/S6B7_GREEN_20260505/`
- **T+192h sign-off:** `/root/_review/audit/T192H_SIGNOFF_20260506.md`
- **CHANGELOG:** [`CHANGELOG.md`](./CHANGELOG.md)

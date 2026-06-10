# REAL Gate Checklist — the ordered path from testnet to real money

> Operator-driven. NOTHING here is automatic. Every step is one deliberate
> action with its own verification. Abort at any red.

## Phase 0 — prerequisites (any day before)
- [ ] b127 deployed: before the pm2 reload run `git diff data/migration_flags.json` (must be clean —
      a runtime `set()` from the pre-b127 process rewrites the whole file and can silently revert
      `ML_LIVE_OPTIN_REQUIRED` to false); after reload confirm the boot-log flags dump shows
      `ML_LIVE_OPTIN_REQUIRED: true`
- [ ] Offsite backup green for ≥7 consecutive days (`data/logs/offsite-backup.log`, daily OK lines)
- [ ] `pnlReconCron` produced ≥7 daily `PNL_RECON_DAILY_COMPLETE` audit rows, 0 unexplained mismatches
- [ ] Kill switch verified on testnet within the last 7 days (daily-loss trip + resync auto-heal)
- [ ] Operator has REAL Binance API keys (trade-only, NO withdrawal permission, IP-restricted to the VPS)

## Phase 1 — consent & coherence (still zero REAL exposure)
- [ ] Opt in via Omega tab → ML·REAL chip (CONFIRM in the Turn ON dialog) → verify status shows OPTED IN
      (API alternative needs the session cookie AND the CSRF header or it 403s:
      `curl -b "zeus_token=<jwt>" -H "X-Zeus-Request: 1" -H "Content-Type: application/json" -d '{"optedIn":true}' http://localhost:3000/api/ring5/live-optin`)
- [ ] Confirm `ML_LIVE_OPTIN_REQUIRED=true` in boot log flags dump
- [ ] Confirm boot log has NO `REAL GATE INCOHERENT` line

## Phase 2 — arm the stream BEFORE the engine (order matters)
- [ ] Set `_USERDATA_STREAM_REAL_ENABLED=true` (stream first — never trade blind)
- [ ] Add REAL creds in app (mode=real) — expect listenKey opened in log for mode=real
- [ ] Verify: NO entry occurs (exec still blocked by `_SRV_POS_REAL_ENABLED=false` — 3 layers)

## Phase 3 — arm execution (the actual REAL day, operator present at screen)
- [ ] Set `_SRV_POS_REAL_ENABLED=true` → watch Telegram: coherence guard must stay SILENT
      (if it screams → set back false immediately, investigate)
- [ ] Canary sizing: confMin raised / risk fraction minimal per operator decision OF THAT DAY
- [ ] First entry: verify book row, exchange position (positionRisk), fill event in log — all three agree
- [ ] First close: verify HIT_SL/DSL_PL journal row + PNL recon next morning

## Phase 4 — ML on REAL (DAYS later, only if wanted)
- [ ] `ML_LIVE_INFLUENCE_ENABLED=true` ONLY after Phase 3 stable ≥7 days
- [ ] Opt-in already enforced at eligibility (live_optin_missing otherwise)

## Rollback levers (any phase, any moment)
- `_SRV_POS_REAL_ENABLED=false`  → execution dead (3 fail-closed layers)
- `SERVER_AT_FULL_OWNERSHIP=false` → back to client-deferred hybrid (testnet only!)
- kill switch UI overlay / `POST /api/at/toggle {active:false}` → engine off

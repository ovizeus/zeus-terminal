# Non-root operations (since 2026-06-10, SEC-23)

- App runs as user `zeus`, repo at /opt/zeus-terminal (symlink /root/zeus-terminal kept).
- pm2 commands: `sudo -u zeus PM2_HOME=/home/zeus/.pm2 pm2 <cmd>` (alias `zpm2` in /root/.bashrc).
  GOTCHA: run zeus pm2 commands from a cwd zeus can read (`cd /home/zeus` or /opt/zeus-terminal) —
  a cwd under /root makes the spawn fail with EACCES.
- After ANY root-made file change in the repo: `chown -R zeus:zeus /opt/zeus-terminal` BEFORE reload
  (root-created files are unwritable by the app — classic silent breakage).
- Backup key + rclone config stay in /root by DESIGN: the app user must never read them.
- Boot persistence: systemd unit pm2-zeus (enabled). pm2-root is disabled, kept for rollback.
- Rollback (any moment): `sudo -u zeus PM2_HOME=/home/zeus/.pm2 pm2 delete zeus` then
  `PM2_HOME=/root/.pm2 pm2 start /opt/zeus-terminal/ecosystem.config.js` (root reads zeus files).
- Next-morning check after migration: data/logs/offsite-backup.log has the 03:30 OK line and
  audit_log has the day's PNL_RECON_DAILY_COMPLETE row.

## Audit fixes 2026-06-11 (package tag audit-bugfix-20260611)
- ML retention (F1/F2): ml_influence_audit 30d + brain_parity_log 60d, daily via brainLogger.prune (serverBrain.js:447 timer). Catch-up already run (0 removed — tables were 24d old; caps growth from ~18 Jun onward).
- /tmp auto-clean (F3): /etc/tmpfiles.d/zeus-test-cleanup.conf — ORIGINAL May-20 rule was incomplete (missed zeus-/ring5-/opp-guard-/audit-chain-/mig/chat-/market-/idem-/r7- prefixes → regrew to 21GB/29K dirs). Now covers all; one-time sweep reclaimed ~20.9GB (21GB→115MB). systemd-tmpfiles-clean.timer active (daily 22:21 UTC).
- pm2-root daemon (F4): KILLED (`PM2_HOME=/root/.pm2 pm2 kill`) — was leftover logrotate from migration. Rollback still: `PM2_HOME=/root/.pm2 pm2 resurrect`. Boot persistence is now SOLELY pm2-zeus (enabled) — verified.
- ML obs stall (F6): DIAGNOSED, no bug — attribution intact (serverAT:2417→recordContribution on every close); slow accrual is low testnet trade frequency (~3 closes/day across 12 cells). BTC:TREND 24/30, ETA ~2-3 weeks. Verdict: /tmp/ml-obs-stall-verdict.md.
- nginx edge headers + /auth rate-limit (F5): /etc/nginx/conf.d/zeus-security-headers.conf (HSTS/nosniff/X-Frame/Referrer) + `location /auth/` limit_req 10r/m burst 5 in sites-available/zeus-terminal. Graceful reload done.
- 8 dead components + 2 orphan stores purged (F10): commit b2de1dae.
- mint_s2_tokens.js.tmp removed from git (F8) — was env-sourced, no credential rotation needed.
- npm moderate CVEs (F13): `npm audit fix --omit=dev` applied (qs→6.15.2, ws→8.21.0, brace-expansion), 0 vulns, non-breaking. Activates at next reload.
- F7 (3000 on 0.0.0.0): accepted — ufw blocks external (only 22/80/443). Bind-to-127.0.0.1 deferred (needs app reload).
- F9 (srv-pos diag pre-auth): accepted — writes are JWT-scoped, diagnostic tables only, non-money-path.
- F12 (@capacitor/app "unused"): depcheck FALSE POSITIVE — used by client/src/core/backButtonHandler.ts + server/version.js. NOT removed.

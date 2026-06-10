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

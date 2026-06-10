# P0-6 (SEC-23) Non-Root Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the Zeus server as a dedicated unprivileged user `zeus` instead of root, so an application compromise is contained to the app's own files — without breaking pm2 boot persistence, the 4 root cron jobs, the offsite-backup chain, or the operator/Claude deploy workflow.

**Architecture:** Repo moves `/root/zeus-terminal` → `/opt/zeus-terminal` (owned `zeus:zeus`) with a compatibility symlink `/root/zeus-terminal` → `/opt/zeus-terminal` so every existing root-side path (cron jobs, scripts, muscle memory) keeps working. Node v20.20.2 is copied out of root-only `/root/.nvm` to `/opt/node/v20.20.2` with `/usr/local/bin` symlinks so both root and `zeus` can run it. pm2 runs under the `zeus` user (`PM2_HOME=/home/zeus/.pm2`) with a proper enabled systemd unit (`pm2-zeus`) — fixing the pre-existing gap that `pm2-root.service` is dead and the app would NOT survive a VPS reboot today. The backup encryption key, rclone config, and all 4 cron jobs deliberately STAY under root: the app user must never be able to read the backup key (defense in depth — an app compromise must not expose backups).

**Tech Stack:** Linux users/permissions, systemd, pm2, Node 20 (copied from nvm), bash. No application code changes.

**Downtime:** one cutover of ~60-120 s (Task 4), done on a clean minute (no 429s in last 2 min, outside 22:00-02:00 UTC). Open testnet positions are unaffected: serverAT state lives in the DB; userDataStream reconnects on boot.

**Rollback (any point after Task 4):** `sudo -u zeus pm2 delete zeus; PM2_HOME=/root/.pm2 pm2 start /opt/zeus-terminal/ecosystem.config.js` — root can always read zeus-owned files, no chown needed to roll back. The symlink keeps all paths valid in both worlds.

---

## File/Resource Structure

| Resource | Action | Owner after |
|---|---|---|
| `/home/zeus/` | Create (system user home) | zeus:zeus |
| `/opt/node/v20.20.2/` | Create (copy of /root/.nvm/versions/node/v20.20.2) | root (read/exec for all) |
| `/usr/local/bin/{node,npm,npx}` | Create symlinks → /opt/node/v20.20.2/bin/* | root |
| `/opt/zeus-terminal/` | Move from /root/zeus-terminal | zeus:zeus (recursive) |
| `/root/zeus-terminal` | Becomes symlink → /opt/zeus-terminal | root |
| `/opt/zeus-terminal/.env` | chmod 600, chown zeus:zeus | zeus:zeus |
| `/home/zeus/.pm2/` | pm2 runtime for zeus | zeus:zeus |
| `/etc/systemd/system/pm2-zeus.service` | Created by `pm2 startup`, enabled | root |
| `/root/.zeus_backup_key`, `/root/.config/rclone/` | UNTOUCHED (stays root-only) | root |
| root crontab (4 entries) | UNTOUCHED (paths resolve via symlink) | root |
| `pm2-root.service` + root PM2_HOME | zeus app deleted from it; unit left disabled | root |

---

### Task 0: Preflight recon (read-only, no risk)

- [ ] **Step 0.1: Confirm single-app pm2 + capture current state**

Run: `pm2 list && pm2 save && cp /root/.pm2/dump.pm2 /root/pm2-dump-pre-nonroot-backup.pm2`
Expected: only `zeus` app (+ pm2-logrotate module). Backup of the dump saved.

- [ ] **Step 0.2: Verify pm2 binary is usable outside nvm**

Run: `head -1 /usr/local/bin/pm2 && ls -la /usr/local/bin/pm2`
If the shebang is `#!/usr/bin/env node` → fine (will use /usr/local/bin/node after Task 1). If it hardcodes `/root/.nvm/...` or is a symlink into /root/.nvm → note it; Task 1 Step 1.5 reinstalls pm2 globally under the new node.

- [ ] **Step 0.3: Check ecosystem.config.js for hardcoded paths**

Run: `grep -nE "cwd|/root/" /root/zeus-terminal/ecosystem.config.js`
Expected: note any `/root/zeus-terminal` literals. If `cwd` is set to `/root/zeus-terminal` that still resolves via the symlink — acceptable, but prefer updating to `/opt/zeus-terminal` in Task 3 Step 3.3.

- [ ] **Step 0.4: Scan repo for hardcoded absolute /root paths that the APP reads at runtime**

Run: `grep -rln "/root/zeus-terminal\|/root/\.zeus" /root/zeus-terminal/server /root/zeus-terminal/server.js /root/zeus-terminal/scripts /root/zeus-terminal/*.js 2>/dev/null | grep -v node_modules | head -20`
Expected: scripts/ hits are fine (run by ROOT cron via symlink). Any hit in server/ or server.js must be listed and assessed: if the server itself reads a /root path at runtime, that breaks under zeus — report it before cutover (likely none; the app uses relative paths from cwd).

- [ ] **Step 0.5: Confirm working tree clean and last night's backup green**

Run: `cd /root/zeus-terminal && git status --porcelain | grep -v "^??" ; tail -1 data/logs/offsite-backup.log`
Expected: no tracked modifications (commit anything pending first); last log line is an `OK: uploaded ... → gdrive:zeus-backups` from today.

- [ ] **Step 0.6: Commit checkpoint** — nothing to commit in this task; proceed.

---

### Task 1: System node + dedicated user (no app impact yet)

- [ ] **Step 1.1: Create the `zeus` system user**

```bash
useradd --system --create-home --home-dir /home/zeus --shell /bin/bash zeus
passwd -l zeus
```
Verify: `id zeus` → `uid=...(zeus) gid=...(zeus)`; `passwd -S zeus` → `L` (locked — no password login; SSH untouched per standing rule).

- [ ] **Step 1.2: Copy Node v20.20.2 out of /root/.nvm to a world-readable location**

```bash
mkdir -p /opt/node
cp -a /root/.nvm/versions/node/v20.20.2 /opt/node/v20.20.2
chmod -R a+rX /opt/node
```
Verify: `/opt/node/v20.20.2/bin/node -v` → `v20.20.2`

- [ ] **Step 1.3: System-wide symlinks**

```bash
ln -sfn /opt/node/v20.20.2/bin/node /usr/local/bin/node
ln -sfn /opt/node/v20.20.2/bin/npm  /usr/local/bin/npm
ln -sfn /opt/node/v20.20.2/bin/npx  /usr/local/bin/npx
```
Verify: `sudo -u zeus /usr/local/bin/node -v` → `v20.20.2` (proves zeus can execute node).

- [ ] **Step 1.4: Verify zeus can run pm2**

Run: `sudo -u zeus bash -c 'PM2_HOME=/home/zeus/.pm2 /usr/local/bin/pm2 -v'`
Expected: a version number (pm2 daemon for zeus spawns under /home/zeus/.pm2).
If it fails because pm2 resolves node inside /root/.nvm → **Step 1.5 (conditional):** `npm install -g pm2` (with /usr/local/bin/npm, installs under /opt/node/v20.20.2/lib) then re-verify both `pm2 -v` (root) and the sudo command above.

- [ ] **Step 1.6: Boot persistence unit for zeus (created now, app added at cutover)**

```bash
env PATH=$PATH:/usr/local/bin pm2 startup systemd -u zeus --hp /home/zeus
systemctl enable pm2-zeus
```
Verify: `systemctl is-enabled pm2-zeus` → `enabled`. (It will start an empty pm2 daemon at boot until Task 4 saves the app into it — harmless.)

- [ ] **Step 1.7: Commit checkpoint** — infra only, nothing in repo; proceed.

---

### Task 2: Root-side git compatibility (pre-cutover)

- [ ] **Step 2.1: Allow root git ops on a zeus-owned repo (needed after chown)**

```bash
git config --global --add safe.directory /opt/zeus-terminal
git config --global --add safe.directory /root/zeus-terminal
```
Verify: `git config --global --get-all safe.directory` lists both.

- [ ] **Step 2.2: Fresh client build BEFORE cutover** (so we don't build during downtime)

Run: `cd /root/zeus-terminal/client && npm run build > /tmp/nonroot-prebuild.log 2>&1; tail -2 /tmp/nonroot-prebuild.log`
Expected: `✓ built`.

---

### Task 3: Stage ecosystem config for the new path

- [ ] **Step 3.1: Read ecosystem.config.js** and if it contains `cwd: '/root/zeus-terminal'` (or any /root literal found in Step 0.3), update to `/opt/zeus-terminal`. If it has no cwd/path literals, skip.

- [ ] **Step 3.2: Commit (only if modified)**

```bash
cd /root/zeus-terminal && git add ecosystem.config.js && git commit -m "chore(sec-23): ecosystem cwd → /opt/zeus-terminal for non-root migration

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" && git push origin main
```

---

### Task 4: CUTOVER (~60-120 s downtime — clean minute required)

> Precondition gate: `pm2 logs zeus --lines 200 --nostream | grep -cE "429|banned"` → 0, AND current UTC time outside 22:00-02:00.

- [ ] **Step 4.1: Stop and remove the app from root's pm2**

```bash
PM2_HOME=/root/.pm2 pm2 stop zeus && PM2_HOME=/root/.pm2 pm2 delete zeus && PM2_HOME=/root/.pm2 pm2 save
```

- [ ] **Step 4.2: Move the repo + compatibility symlink + ownership**

```bash
mv /root/zeus-terminal /opt/zeus-terminal
ln -s /opt/zeus-terminal /root/zeus-terminal
chown -R zeus:zeus /opt/zeus-terminal
chmod 600 /opt/zeus-terminal/.env
```
Verify (fast): `ls -la /root/zeus-terminal/ | head -3` (resolves via symlink) and `stat -c '%U %a' /opt/zeus-terminal/.env` → `zeus 600`.

- [ ] **Step 4.3: Start the app as zeus**

```bash
sudo -u zeus bash -c 'cd /opt/zeus-terminal && PM2_HOME=/home/zeus/.pm2 /usr/local/bin/pm2 start ecosystem.config.js && PM2_HOME=/home/zeus/.pm2 /usr/local/bin/pm2 save'
```

- [ ] **Step 4.4: Immediate health gate (within 60 s)**

```bash
sleep 15; curl -s http://localhost:3000/health | head -c 200
sudo -u zeus PM2_HOME=/home/zeus/.pm2 /usr/local/bin/pm2 list
ps -o user= -p $(sudo -u zeus PM2_HOME=/home/zeus/.pm2 /usr/local/bin/pm2 jlist | python3 -c "import json,sys; print([p['pid'] for p in json.load(sys.stdin) if p['name']=='zeus'][0])")
```
Expected: health JSON; status online; process user = `zeus`. **If health fails → ROLLBACK** (header of this plan) and investigate offline.

---

### Task 5: Post-cutover verification battery

- [ ] **Step 5.1: Boot log clean**

Run: `sudo -u zeus PM2_HOME=/home/zeus/.pm2 /usr/local/bin/pm2 logs zeus --lines 300 --nostream | grep -E "REAL GATE INCOHERENT|EACCES|EPERM|permission denied|429" | head -10`
Expected: empty (no permission errors — the classic failure mode of this migration; no 429 burst; no incoherence).

- [ ] **Step 5.2: App can WRITE (DB + flags file)**

Run a flag no-op via API (admin JWT + `X-Zeus-Request: 1` header, POST /api/migration/flags re-setting `ML_LIVE_OPTIN_REQUIRED` to `true`) and verify: 200, an `audit_log` row appears, and `data/migration_flags.json` mtime updates with owner zeus.

- [ ] **Step 5.3: Book = exchange** — signed probe (`credentialStore.getExchangeCreds(1)` + `binanceSigner.sendSignedRequest GET /fapi/v2/positionRisk`) run AS ROOT from /opt/zeus-terminal (root reads zeus files fine): open positions count must equal `at_positions` OPEN count.

- [ ] **Step 5.4: Client serves + websockets** — `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/app/` → 200; boot log shows liq feeds connected (BYB/OKX frames flowing).

- [ ] **Step 5.5: Crons still see the repo (symlink proof)**

Run: `bash /root/zeus-terminal/scripts/mem-monitor.sh && echo CRON_PATH_OK` (mem-monitor is the cheapest of the 4 cron scripts).
Expected: exits 0, `CRON_PATH_OK`. The offsite backup proof is next morning's 03:30 log line (checklist item in Task 7).

- [ ] **Step 5.6: Security assertions (the actual point of P0-6)**

```bash
sudo -u zeus cat /root/.zeus_backup_key && echo "FAIL: key readable" || echo "OK: key unreadable by zeus"
sudo -u zeus ls /root/.config/rclone 2>&1 | grep -qi "denied" && echo "OK: rclone config unreadable"
sudo -u zeus touch /etc/cron.d/test-zeus 2>&1 | grep -qi "denied" && echo "OK: zeus cannot write system cron"
```
Expected: all three OK lines.

---

### Task 6: Root-side pm2 cleanup

- [ ] **Step 6.1:** `systemctl disable pm2-root 2>/dev/null; systemctl is-enabled pm2-root` → `disabled` (it was dead anyway; pm2-zeus owns boot now).
- [ ] **Step 6.2:** pm2-logrotate for zeus: `sudo -u zeus PM2_HOME=/home/zeus/.pm2 /usr/local/bin/pm2 install pm2-logrotate && sudo -u zeus PM2_HOME=/home/zeus/.pm2 /usr/local/bin/pm2 set pm2-logrotate:max_size 50M` (mirror root's settings: check `PM2_HOME=/root/.pm2 pm2 conf pm2-logrotate` first and copy values).
- [ ] **Step 6.3:** Leave root's pm2 binary and PM2_HOME in place (rollback lever). Do NOT uninstall anything.

---

### Task 7: Docs, memory, deploy-rule update + tag

- [ ] **Step 7.1:** Append to `docs/runbooks/REAL-GATE-CHECKLIST.md` Phase 0 nothing — instead create `docs/runbooks/NONROOT-OPS.md` with the new operating rules (exact content):

```markdown
# Non-root operations (since 2026-06-10, SEC-23)

- App runs as user `zeus`, repo at /opt/zeus-terminal (symlink /root/zeus-terminal kept).
- pm2 commands: `sudo -u zeus PM2_HOME=/home/zeus/.pm2 pm2 <cmd>` (alias `zpm2` in /root/.bashrc).
- After ANY root-made file change in the repo: `chown -R zeus:zeus /opt/zeus-terminal` BEFORE reload
  (root-created files are unwritable by the app — classic silent breakage).
- Backup key + rclone config stay in /root by DESIGN: the app user must never read them.
- Boot persistence: systemd unit pm2-zeus (enabled). pm2-root is disabled, kept for rollback.
- Next-morning check after migration: data/logs/offsite-backup.log has the 03:30 OK line.
```

- [ ] **Step 7.2:** Add the alias for the operator and Claude: `echo "alias zpm2='sudo -u zeus PM2_HOME=/home/zeus/.pm2 /usr/local/bin/pm2'" >> /root/.bashrc`

- [ ] **Step 7.3: Commit + tag**

```bash
cd /opt/zeus-terminal && git add docs/runbooks/NONROOT-OPS.md && chown zeus:zeus docs/runbooks/NONROOT-OPS.md
git commit -m "docs(sec-23): non-root ops runbook — zeus user, pm2-zeus unit, chown-before-reload rule

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git tag p0-nonroot-20260610 && git push origin main --tags
```

- [ ] **Step 7.4 (next morning):** verify `tail -2 /root/zeus-terminal/data/logs/offsite-backup.log` shows the 03:30 OK line AND `audit_log` has today's `PNL_RECON_DAILY_COMPLETE` (proves in-process cron survived the migration).

---

## Self-Review (done at write time)

- **Coverage:** user creation (T1), node accessibility (T1), boot persistence incl. pre-existing dead pm2-root gap (T1.6/T6), repo move+ownership (T4), all 4 root crons preserved via symlink (T5.5 + T7.4), backup chain untouched and SAFER (T5.6), deploy workflow change documented (T7.1), rollback defined (header). ✓
- **Placeholders:** none — every step has exact commands and expected output. Step 1.5 and 3.1 are explicitly conditional on recon findings. ✓
- **Consistency:** PM2_HOME paths consistent (`/root/.pm2` root, `/home/zeus/.pm2` zeus); /opt/zeus-terminal vs symlink usage consistent. ✓
- **Known risks flagged:** pm2 shebang into nvm (0.2→1.5), app-side /root literals (0.4 gate), root-created files after deploys (NONROOT-OPS rule), downtime window gated on clean minute. ✓

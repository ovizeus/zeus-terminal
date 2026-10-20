#!/usr/bin/env node
'use strict';
/**
 * Zeus health watchdog — the thing that was missing on the night of 2026-10-10,
 * when the server crashed 1082 times over three and a half hours and the
 * operator found it himself. Runs from cron, outside the app, because an app
 * that is down cannot report that it is down.
 *
 * Usage: node scripts/health-watchdog.js [--dry]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { decide } = require('./health-watchdog-decide');

const ROOT = path.join(__dirname, '..');
const STATE_FILE = path.join(ROOT, 'data', 'health-watchdog-state.json');
const LOG_FILE = path.join(ROOT, 'data', 'logs', 'health-watchdog.log');
// [2026-10-20 b290] Marcajul de reusita al backup-ului offsite. Scris de
// scripts/offsite-backup.sh la fiecare urcare reusita; citit de aici ca sa
// alertam daca disaster recovery nu mai are copie proaspata — vezi comentariul
// din health-watchdog-decide.js pentru de ce verificarea sta AICI, afara.
const BACKUP_MARKER = path.join(ROOT, 'data', 'logs', 'offsite-last-success');
const DRY = process.argv.includes('--dry');

function log(msg) {
    const line = `${new Date().toISOString()} ${msg}\n`;
    try { fs.appendFileSync(LOG_FILE, line); } catch (_) { /* never fail on logging */ }
    if (DRY) process.stdout.write(line);
}

function readState() {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
    catch (_) { return { restarts: 0, lastAlertAt: 0, alerting: false }; }
}

function writeState(s) {
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(s)); } catch (e) { log('state write failed: ' + e.message); }
}

function readProc() {
    try {
        const out = execFileSync('sudo', ['-u', 'zeus', 'pm2', 'jlist'], { encoding: 'utf8', timeout: 20000 });
        const row = JSON.parse(out).find((p) => p.name === 'zeus');
        if (!row) return null;
        return {
            status: row.pm2_env.status,
            restarts: row.pm2_env.restart_time,
            uptimeMs: Date.now() - row.pm2_env.pm_uptime,
        };
    } catch (e) { log('pm2 read failed: ' + e.message); return null; }
}

function sendTelegram(text) {
    // Read credentials from .env without pulling the app's config in.
    let token = '', chat = '';
    try {
        for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
            const m = line.match(/^(TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID)\s*=\s*(.+)$/);
            if (!m) continue;
            const v = m[2].trim().replace(/^["']|["']$/g, '');
            if (m[1] === 'TELEGRAM_BOT_TOKEN') token = v; else chat = v;
        }
    } catch (e) { log('.env read failed: ' + e.message); }
    if (!token || !chat) { log('no telegram credentials — alert not sent: ' + text); return; }
    if (DRY) { log('DRY RUN, would send: ' + text); return; }
    try {
        execFileSync('curl', ['-s', '-o', '/dev/null', '-X', 'POST',
            `https://api.telegram.org/bot${token}/sendMessage`,
            '--data-urlencode', `chat_id=${chat}`,
            '--data-urlencode', `text=${text}`], { timeout: 20000 });
        log('alert sent: ' + text);
    } catch (e) { log('telegram send failed: ' + e.message); }
}

function readBackupMarker() {
    try {
        const raw = fs.readFileSync(BACKUP_MARKER, 'utf8').trim();
        const ms = Number(raw) * 1000;  // marcajul e in secunde epoch
        return { lastSuccessMs: Number.isFinite(ms) && ms > 0 ? ms : null };
    } catch (_) { return { lastSuccessMs: null }; }
}

const proc = readProc();
const prev = readState();
const d = decide(proc, prev, Date.now(), readBackupMarker());
if (d.alert) sendTelegram(d.message);
// [2026-10-20 b290] `--dry` NU scrie starea. Era necondiţionat, si fereastra
// noua de suprimare a alertei de backup (24h) i-a dat dinti: o rulare de proba
// seta `lastBackupAlertAt` si inabusea o alerta adevarata o zi intreaga. Mai
// rau, rulat de un user care nu poate citi pm2, scria `alerting: true` in
// starea reala -> urmatoarea rulare ar fi trimis un "revenit" fals.
if (!DRY) writeState(d.state);
if (DRY && !d.alert) log(`quiet — status=${proc ? proc.status : 'MISSING'} restarts=${proc ? proc.restarts : '?'}`);

// [SP1] Automated soak check — runs the direction-parity gate for uid=1 and
// sends a short Telegram status to the operator. Run by cron daily. Read-only
// on the DB; only side effect is a Telegram message + a log line.
const db = require('../server/services/database');
const { evaluateParityGate, SP1_THRESHOLDS, soakWindow } = require('../server/services/parityGate');
const telegram = require('../server/services/telegram');
const fs = require('fs');
const path = require('path');

const UID = 1;
function readSoakStart() {
    try {
        const raw = fs.readFileSync(path.join(__dirname, '../data/logs/sp1-soak-start.txt'), 'utf8').trim();
        const n = Number(raw);
        return isNaN(n) ? null : n;
    } catch (_) { return null; }
}

let msg;
try {
    const now = Date.now();
    const win = soakWindow(db, UID, now, readSoakStart());
    const report = db.queryParityReport({ userId: UID, since: win.since });
    const gateRaw = evaluateParityGate(report);
    const daysOk = win.daysElapsed >= SP1_THRESHOLDS.M;
    const gate = { pass: gateRaw.pass && daysOk, failures: gateRaw.failures.concat(daysOk ? [] : ['days']) };
    const t = report.totals || {};
    const pairs = t.primaryPairs || 0;
    const agree = t.primaryAgreementPct;
    const unpaired = t.primaryUnpaired || 0;
    const dayStr = `day ${Math.min(win.daysElapsed, SP1_THRESHOLDS.M).toFixed(1)}/${SP1_THRESHOLDS.M}`;

    if (gate.pass) {
        msg = `✅ *SP1 SOAK PASSED* (${dayStr})\n`
            + `Pairs ${pairs} (≥${SP1_THRESHOLDS.P}) · Agreement ${agree}% (≥${SP1_THRESHOLDS.N}%) · Unpaired ${unpaired}\n`
            + `Server brain matches the app. Ready for SP1.5 / SP2 — tell Claude.`;
    } else {
        const need = gate.failures.map(f => f === 'paired' ? `more pairs (${pairs}/${SP1_THRESHOLDS.P})`
            : f === 'agreement' ? `agreement (${agree}%/${SP1_THRESHOLDS.N}%)`
            : f === 'unpairedRatio' ? `lower unpaired-ratio` : f === 'days' ? `more time (${dayStr})` : f).join(', ');
        msg = `⏳ *SP1 soak in progress* (${dayStr})\n`
            + `Pairs ${pairs}/${SP1_THRESHOLDS.P} · Agreement ${agree == null ? 'n/a' : agree + '%'} · Unpaired ${unpaired}\n`
            + `Still need: ${need}. (Keep the app open with AT on so pairs accumulate.)`;
    }
} catch (e) {
    msg = `⚠️ SP1 soak check error: ${e.message}`;
}

// Log line + PASS marker file (trivially detectable on resume)
try {
    const logDir = path.join(__dirname, '../data/logs');
    fs.appendFileSync(path.join(logDir, 'sp1-soak.log'), `${new Date().toISOString()} ${msg.replace(/\n/g, ' | ')}\n`);
    const marker = path.join(logDir, 'SP1_SOAK_PASSED');
    if (msg.startsWith('✅')) fs.writeFileSync(marker, `${new Date().toISOString()}\n${msg}\n`);
} catch (_) {}

// Telegram (no-op silently if the operator hasn't configured it)
telegram.sendToUser(UID, msg, 'Markdown');

// give the async telegram send a moment, then exit (services hold open handles)
setTimeout(() => process.exit(0), 4000);

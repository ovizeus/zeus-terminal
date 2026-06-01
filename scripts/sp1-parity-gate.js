// [SP1] Usage: node scripts/sp1-parity-gate.js
// Reports the SP1 direction-parity gate status for uid=1. The soak window starts
// at the soak-start marker (data/logs/sp1-soak-start.txt) so pre-deploy client
// rows are excluded and can't poison the metric. Exit 0 = gate pass, 1 = not yet.
const fs = require('fs');
const path = require('path');
const db = require('../server/services/database');
const { evaluateParityGate, SP1_THRESHOLDS, soakWindow } = require('../server/services/parityGate');

const UID = 1;
function readSoakStart() {
    try {
        const raw = fs.readFileSync(path.join(__dirname, '../data/logs/sp1-soak-start.txt'), 'utf8').trim();
        const n = Number(raw);
        return isNaN(n) ? null : n;
    } catch (_) { return null; }
}

const now = Date.now();
const win = soakWindow(db, UID, now, readSoakStart());
const report = db.queryParityReport({ userId: UID, since: win.since });
const gate = evaluateParityGate(report);
const daysOk = win.daysElapsed >= SP1_THRESHOLDS.M;
const pass = gate.pass && daysOk;

console.log(JSON.stringify({
    soakDaysElapsed: win.daysElapsed,
    sustainedTargetDays: SP1_THRESHOLDS.M,
    daysConditionMet: daysOk,
    gate,
    pass,
    window: { sinceIso: new Date(win.since).toISOString(), soakStart: win.soakStart ? new Date(win.soakStart).toISOString() : null },
    totals: report.totals,
}, null, 2));
process.exit(pass ? 0 : 1);

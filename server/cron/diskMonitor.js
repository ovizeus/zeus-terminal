'use strict';
// [P1 2026-06-09] Disk space monitor — proactive version of the Master
// Working Rule "on ANY production 500: df -h FIRST". Alerts the operator on
// Telegram when the data disk crosses ALERT_PCT, with hysteresis so a disk
// hovering at the threshold doesn't spam (re-arms below REARM_PCT).
// statfs is read on the data/ dir — same disk as zeus.db (the asset that
// dies first when full: SQLITE_FULL on the money book).

const fs = require('fs');
const path = require('path');
const logger = require('../services/logger');

const ALERT_PCT = 90;
const REARM_PCT = 85;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

let _alerted = false;

// Pure decision: {usedPct, freeGB} -> {alert, message}. Hysteresis state in
// module scope (single process), reset via _resetForTest.
function _evaluate(disk) {
    const usedPct = disk && typeof disk.usedPct === 'number' ? disk.usedPct : null;
    if (usedPct === null) return { alert: false };

    if (usedPct < REARM_PCT) _alerted = false;
    if (usedPct < ALERT_PCT || _alerted) return { alert: false };

    _alerted = true;
    const freeGB = typeof disk.freeGB === 'number' ? disk.freeGB : 0;
    return {
        alert: true,
        message: `🚨 *DISK ALERT* — Zeus data disk ${usedPct}% full (${freeGB}GB free). ` +
            `SQLite will fail with SQLITE_FULL soon. Check: df -h, data/logs/, /tmp, data/*.bak`,
    };
}

function _readDisk() {
    const st = fs.statfsSync(path.join(__dirname, '..', '..', 'data'));
    return {
        usedPct: +((1 - st.bfree / st.blocks) * 100).toFixed(1),
        freeGB: +(st.bsize * st.bfree / 1073741824).toFixed(1),
    };
}

function run() {
    const r = _evaluate(_readDisk());
    if (r.alert) {
        logger.error('CRON', `[diskMonitor] ${r.message}`);
        try { require('../services/telegram').send(r.message); } catch (_) {}
    }
    return r;
}

function schedule() {
    setInterval(() => {
        try { run(); } catch (err) {
            logger.warn('CRON', `[diskMonitor] error: ${err.message}`);
        }
    }, CHECK_INTERVAL_MS);
    logger.info('CRON', `[diskMonitor] scheduled every 5min (alert ≥${ALERT_PCT}%, re-arm <${REARM_PCT}%)`);
}

module.exports = { run, schedule, _evaluate, _resetForTest: () => { _alerted = false; } };

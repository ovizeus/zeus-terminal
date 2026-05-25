'use strict';

const { db } = require('../services/database');
const logger = require('../services/logger');

let _lastRunDate = '';
const TARGET_DAY = 0; // Sunday
const TARGET_HOUR_UTC = 3; // 03:00 UTC

function run() {
    const cutoff = Date.now() - 30 * 86400000;
    const result = db.prepare('DELETE FROM position_classifications WHERE ts < ?').run(cutoff);
    const deleted = result.changes || 0;
    if (deleted > 0) {
        logger.info('CRON', `[posClassRetention] pruned ${deleted} rows older than 30d`);
    }
    return deleted;
}

function schedule() {
    setInterval(() => {
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10);
        if (dateStr === _lastRunDate) return;
        if (now.getUTCDay() !== TARGET_DAY) return;
        if (now.getUTCHours() !== TARGET_HOUR_UTC) return;
        _lastRunDate = dateStr;
        try {
            run();
        } catch (err) {
            logger.warn('CRON', `[posClassRetention] error: ${err.message}`);
        }
    }, 60000);
    logger.info('CRON', '[posClassRetention] scheduled weekly Sunday 03:00 UTC');
}

module.exports = { run, schedule, _resetForTest: () => { _lastRunDate = ''; } };

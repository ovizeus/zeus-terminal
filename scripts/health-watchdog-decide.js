'use strict';
/**
 * Pure decision for the Zeus health watchdog.
 *
 * [2026-10-10] Zeus crashed 1082 times over three and a half hours overnight
 * and nothing told anyone. pm2 reported "online" between crashes the whole
 * time, which is why status alone is not enough — a climbing restart count is
 * the real signal.
 *
 * Kept pure (no pm2, no network, no clock) so the rules are testable.
 */

const STORM_RESTARTS = 3;        // more than this between looks = a loop, not a deploy
const REPEAT_AFTER_MS = 30 * 60_000;  // say it again if still broken after this long

/**
 * @param {{status:string,restarts:number,uptimeMs:number}|null} proc  null = process not found
 * @param {{restarts:number,lastAlertAt:number,alerting:boolean}} prev
 * @param {number} now
 */
function decide(proc, prev, now) {
    const state = {
        restarts: proc ? proc.restarts : (prev.restarts || 0),
        lastAlertAt: prev.lastAlertAt || 0,
        alerting: !!prev.alerting,
        initialised: true,
    };

    // First ever run: there is no previous count, so the process's whole
    // lifetime of restarts would read as "since the last look" — 1083 of them
    // on a server that is perfectly fine. Learn the number and say nothing.
    if (!prev || prev.initialised !== true) {
        return { alert: false, message: '', state };
    }
    const quiet = (s) => ({ alert: false, message: '', state: s });
    const speak = (msg) => ({
        alert: true, message: msg,
        state: Object.assign({}, state, { lastAlertAt: now, alerting: true }),
    });

    if (!proc) {
        if (state.alerting && (now - state.lastAlertAt) < REPEAT_AFTER_MS) return quiet(state);
        return speak('🚨 ZEUS: procesul nu există în pm2 — serverul este JOS.');
    }

    const jumped = state.restarts - (prev.restarts || 0);
    const broken = proc.status !== 'online';
    const storm = jumped > STORM_RESTARTS;

    if (broken || storm) {
        // Already shouting about it — do not repeat every minute, but do not go
        // silent forever either.
        if (state.alerting && (now - state.lastAlertAt) < REPEAT_AFTER_MS) return quiet(state);
        const msg = broken
            ? `🚨 ZEUS: starea procesului este "${proc.status}" — serverul nu răspunde.`
            : `🚨 ZEUS: ${jumped} reporniri de la ultima verificare (total ${proc.restarts}) — buclă de prăbuşire.`;
        return speak(msg);
    }

    if (state.alerting) {
        const mins = Math.round(proc.uptimeMs / 60000);
        return Object.assign(
            speak(`✅ ZEUS: revenit — online de ${mins} min, fără reporniri noi.`),
            { state: Object.assign({}, state, { lastAlertAt: now, alerting: false }) }
        );
    }

    return quiet(state);
}

module.exports = { decide, STORM_RESTARTS, REPEAT_AFTER_MS };

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

// [2026-10-20 b290] Prospetimea backup-ului offsite.
// Paznicul se uita doar la procesul pm2, asa ca n-a observat ca offsite-ul a
// murit 7 zile (14-20 oct). Alerta pusa in scriptul de backup acopera doar
// cazul in care scriptul RULEAZA si raporteaza FATAL — nu acopera cron-ul
// oprit, nici scriptul care moare inainte sa ajunga la alerta. Fereastra aia
// nu e teoretica: pe 10 oct scriptul a picat cu `Permission denied` chiar pe
// propriul log. Deci prospetimea se verifica din AFARA, aici.
// Pragul e peste o zi (cron zilnic la 03:30) ca o singura zi ratata sa nu
// alarmeze, dar doua la rand sa o faca. Fail-closed: marcaj lipsa = nicio
// reusita dovedita = alerta, fiindca tocmai tacerea a fost problema.
const BACKUP_STALE_MS = 36 * 60 * 60_000;
const BACKUP_REPEAT_AFTER_MS = 24 * 60 * 60_000;

/**
 * @param {{status:string,restarts:number,uptimeMs:number}|null} proc  null = process not found
 * @param {{restarts:number,lastAlertAt:number,alerting:boolean}} prev
 * @param {number} now
 * @param {{lastSuccessMs:number|null}} [backup]  optional: offsite backup marker
 */
function decide(proc, prev, now, backup) {
    const state = {
        restarts: proc ? proc.restarts : (prev.restarts || 0),
        lastAlertAt: prev.lastAlertAt || 0,
        alerting: !!prev.alerting,
        initialised: true,
        lastBackupAlertAt: prev.lastBackupAlertAt || 0,
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

    // Procesul e sanatos — abia acum ne uitam la plasa de siguranta.
    // Ordinea conteaza: un server jos e mai urgent decat un backup vechi, si
    // nu vrem doua mesaje despre doua lucruri in acelasi minut.
    if (backup) {
        const last = Number(backup.lastSuccessMs);
        const hasSuccess = Number.isFinite(last) && last > 0;
        const ageMs = hasSuccess ? (now - last) : Infinity;
        if (ageMs > BACKUP_STALE_MS) {
            if ((now - state.lastBackupAlertAt) < BACKUP_REPEAT_AFTER_MS) return quiet(state);
            const msg = hasSuccess
                ? `🚨 ZEUS: backup offsite vechi de ${Math.floor(ageMs / 86400000)} zile ` +
                  `(${Math.round(ageMs / 3600000)}h) — disaster recovery nu are copie proaspata.`
                : '🚨 ZEUS: backup offsite — nicio reusita dovedita (marcajul lipseste).';
            return {
                alert: true, message: msg,
                state: Object.assign({}, state, { lastBackupAlertAt: now }),
            };
        }
    }

    return quiet(state);
}

module.exports = { decide, STORM_RESTARTS, REPEAT_AFTER_MS, BACKUP_STALE_MS, BACKUP_REPEAT_AFTER_MS };

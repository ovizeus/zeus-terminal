'use strict';
// [2026-10-20 b290] Paznicul se uita DOAR la procesul pm2. N-a observat ca
// backup-ul offsite a murit 7 zile (14-20 oct). Alerta pe care am pus-o in
// scriptul de backup acopera cazul in care scriptul RULEAZA si da FATAL — dar
// nu acopera cron-ul oprit, nici scriptul care moare inainte de alerta.
// Fereastra aia e dovedita: 10 oct, `Permission denied` pe propriul log.
// Deci prospetimea se verifica din AFARA, de paznic, pe un marcaj de reusita.
// Fail-closed: lipsa marcajului = nicio reusita dovedita = alerta.

const { decide, BACKUP_STALE_MS } = require('../../scripts/health-watchdog-decide');

const OK_PROC = { status: 'online', restarts: 10, uptimeMs: 3600000 };
const PREV = { restarts: 10, lastAlertAt: 0, alerting: false, initialised: true };
const H = 3600000;

describe('watchdog — prospetimea backup-ului offsite', () => {
    test('backup proaspat -> tace', () => {
        const now = 1800000000000;
        const r = decide(OK_PROC, PREV, now, { lastSuccessMs: now - 2 * H });
        expect(r.alert).toBe(false);
    });

    test('backup vechi peste prag -> alerta care spune de cat timp', () => {
        const now = 1800000000000;
        const r = decide(OK_PROC, PREV, now, { lastSuccessMs: now - 7 * 24 * H });
        expect(r.alert).toBe(true);
        expect(r.message).toMatch(/backup/i);
        expect(r.message).toMatch(/7/);
    });

    test('marcaj lipsa = nicio reusita dovedita -> alerta (fail-closed)', () => {
        const now = 1800000000000;
        const r = decide(OK_PROC, PREV, now, { lastSuccessMs: null });
        expect(r.alert).toBe(true);
        expect(r.message).toMatch(/backup/i);
    });

    test('nu repeta la fiecare minut — o data pe zi', () => {
        const now = 1800000000000;
        const first = decide(OK_PROC, PREV, now, { lastSuccessMs: now - 7 * 24 * H });
        expect(first.alert).toBe(true);
        expect(first.state.lastBackupAlertAt).toBe(now);

        const soon = decide(OK_PROC, first.state, now + 60000, { lastSuccessMs: now - 7 * 24 * H });
        expect(soon.alert).toBe(false);

        const nextDay = decide(OK_PROC, first.state, now + 25 * H, { lastSuccessMs: now - 8 * 24 * H });
        expect(nextDay.alert).toBe(true);
    });

    test('procesul jos are PRIORITATE peste backup-ul vechi', () => {
        const now = 1800000000000;
        const r = decide({ status: 'stopped', restarts: 10, uptimeMs: 0 }, PREV, now, { lastSuccessMs: null });
        expect(r.alert).toBe(true);
        expect(r.message).toMatch(/nu răspunde|JOS/);
        expect(r.message).not.toMatch(/backup/i);
    });

    test('se opreste de alertat cand backup-ul revine', () => {
        const now = 1800000000000;
        const stale = decide(OK_PROC, PREV, now, { lastSuccessMs: now - 7 * 24 * H });
        const recovered = decide(OK_PROC, stale.state, now + 25 * H, { lastSuccessMs: now + 24 * H });
        expect(recovered.alert).toBe(false);
    });

    test('fara argumentul de backup se comporta exact ca inainte', () => {
        const now = 1800000000000;
        expect(decide(OK_PROC, PREV, now).alert).toBe(false);
        expect(decide(null, PREV, now).alert).toBe(true);
    });

    test('pragul e peste o zi, ca o singura zi ratata sa nu alarmeze degeaba', () => {
        expect(BACKUP_STALE_MS).toBeGreaterThan(24 * H);
        expect(BACKUP_STALE_MS).toBeLessThanOrEqual(48 * H);
    });
});

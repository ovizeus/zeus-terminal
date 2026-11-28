'use strict';
/**
 * [2026-11-27] Securitate etapa 3 — Sentinel, varianta usoara.
 *
 * Citeste audit_log o data pe minut (doar randurile NOI, dupa id) si trimite adminilor o alerta pe
 * telefon (tipul `security`, mereu pornit pentru admini) cand:
 *   - vin multe inscrieri (>= 5 in 10 min), cereri de resetare (>= 5 in 10 min) sau parole/coduri
 *     gresite (>= 10 in 10 min) — atacul din 13–27 nov ar fi sunat din prima ora;
 *   - un ADMIN intra de pe un IP pe care nu l-a mai folosit;
 *   - pe un cont de ADMIN se schimba parola, emailul, 2FA, sau se foloseste un cod de rezerva.
 * Doar OBSERVA: nu blocheaza nimic (blocarea o fac limitele din auth.js si Cloudflare).
 * Dupa o alerta de rafala, acelasi fel tace 30 de minute — „sa nu fie abundente".
 */
const WINDOW_MS = 10 * 60_000;
const COOLDOWN_MS = 30 * 60_000;
const BURSTS = {
    signup: { actions: ['USER_REGISTERED', 'REGISTER_BLOCKED_SUSPICIOUS'], min: 5,
        line: (n, rows) => `Sign-up burst: ${n} in 10 min (${rows.filter((r) => r.action === 'REGISTER_BLOCKED_SUSPICIOUS').length} blocked as bots)` },
    reset: { actions: ['FORGOT_PASSWORD_REQUESTED', 'FORGOT_PASSWORD_THROTTLED'], min: 5,
        line: (n, rows) => `Password-reset burst: ${n} requests in 10 min on ${new Set(rows.map((r) => r.user_id).filter((u) => u != null)).size} accounts` },
    failed: { actions: ['LOGIN_FAILED', 'LOGIN_2FA_FAILED', 'LOGIN_2FA_THROTTLED', 'LOGIN_PASSKEY_FAILED'], min: 10,
        line: (n, rows) => `${n} failed sign-ins in 10 min from ${new Set(rows.map((r) => r.ip)).size} IPs` },
};
const ADMIN_EVENTS = {
    CHANGE_PASSWORD_SUCCESS: 'Admin account: password changed',
    FORGOT_PASSWORD_SUCCESS: 'Admin account: password reset by email',
    ADMIN_RESET_PASSWORD: 'Admin account: password reset by an admin',
    CHANGE_EMAIL_SUCCESS: 'Admin account: sign-in email changed',
    TWO_FACTOR_DISABLED: 'Admin account: two-factor authentication turned off',
    TWO_FACTOR_ENABLED: 'Admin account: two-factor authentication turned on',
    LOGIN_RECOVERY_CODE_USED: 'Admin account: signed in with a backup code',
    PASSKEY_ADDED: 'Admin account: passkey added',          // [2026-11-28]
    PASSKEY_REMOVED: 'Admin account: passkey removed',
};

const _ts = (r) => { const t = Date.parse(String(r.created_at || '').replace(' ', 'T') + 'Z'); return Number.isFinite(t) ? t : 0; };

function createSentinel(deps) {
    const d = deps;
    let lastId = 0;
    const recent = { signup: [], reset: [], failed: [] };
    const lastAlert = {};
    let day = '';
    let counts = null;
    const zero = () => ({ signUps: 0, blockedSignUps: 0, resetRequests: 0, failedSignIns: 0, adminSignIns: 0, alertsSent: 0 });

    function _day(now) {
        const k = new Date(now).toISOString().slice(0, 10);
        if (k !== day) { day = k; counts = zero(); }
    }

    function _send(line) {
        for (const uid of d.adminIds()) {
            try { d.send(uid, line); counts.alertsSent++; } catch (_) { /* un telefon cazut nu opreste restul */ }
        }
    }

    function init() { lastId = Number(d.maxId()) || 0; }

    function tick(now) {
        const t = Number.isFinite(now) ? now : Date.now();
        _day(t);
        let rows;
        try { rows = d.readSince(lastId) || []; } catch (_) { return; }
        for (const r of rows) {
            lastId = Math.max(lastId, r.id);
            const a = r.action;
            if (a === 'USER_REGISTERED') counts.signUps++;
            if (a === 'REGISTER_BLOCKED_SUSPICIOUS') { counts.signUps++; counts.blockedSignUps++; }
            if (a === 'FORGOT_PASSWORD_REQUESTED') counts.resetRequests++;
            if (a === 'LOGIN_FAILED' || a === 'LOGIN_2FA_FAILED' || a === 'LOGIN_PASSKEY_FAILED') counts.failedSignIns++;
            for (const [k, b] of Object.entries(BURSTS)) if (b.actions.includes(a)) recent[k].push(r);
            let admin = false;
            try { admin = r.user_id != null && d.isAdmin(r.user_id); } catch (_) { admin = false; }
            if (!admin) continue;
            if (a === 'LOGIN_SUCCESS') {
                counts.adminSignIns++;
                if (!r.ip) continue;   // fara IP nu se poate spune „nou" (altfel ar suna la fiecare intrare)
                let seen = true;
                try { seen = d.ipSeenBefore(r.user_id, r.ip, r.id); } catch (_) { seen = true; }
                if (!seen) _send(`Admin sign-in from a new IP: ${r.ip}`);
            } else if (ADMIN_EVENTS[a]) {
                _send(`${ADMIN_EVENTS[a]} (IP ${r.ip || 'unknown'})`);
            }
        }
        for (const [k, b] of Object.entries(BURSTS)) {
            recent[k] = recent[k].filter((r) => t - _ts(r) <= WINDOW_MS);
            if (recent[k].length >= b.min && !(lastAlert[k] && t - lastAlert[k] < COOLDOWN_MS)) {
                lastAlert[k] = t;
                _send(b.line(recent[k].length, recent[k]));
            }
        }
    }

    function summary(now) {
        _day(Number.isFinite(now) ? now : Date.now());
        return { day, ...counts };
    }

    return { init, tick, summary };
}

/** Raportul din admin: ultimele `hours` ore din audit_log (din baza — corect si dupa o repornire). */
function dailyReport(db, hours) {
    const h = Number.isFinite(hours) ? hours : 24;
    const since = `-${h} hours`;
    const c = (actions) => db.prepare(`SELECT count(*) n FROM audit_log WHERE created_at > datetime('now', ?) AND action IN (${actions.map(() => '?').join(',')})`)
        .get(since, ...actions).n;
    const fails = ['LOGIN_FAILED', 'LOGIN_2FA_FAILED', 'LOGIN_PASSKEY_FAILED'];
    return {
        hours: h,
        failedSignIns: c(fails),
        resetRequests: c(['FORGOT_PASSWORD_REQUESTED']),
        signUps: c(['USER_REGISTERED', 'REGISTER_BLOCKED_SUSPICIOUS']),
        blockedSignUps: c(['REGISTER_BLOCKED_SUSPICIOUS']),
        signIns: c(['LOGIN_SUCCESS']),
        topFailIps: db.prepare(`SELECT ip, count(*) n FROM audit_log WHERE created_at > datetime('now', ?) AND action IN (?, ?, ?, 'FORGOT_PASSWORD_REQUESTED')
            AND ip IS NOT NULL GROUP BY ip ORDER BY n DESC LIMIT 5`).all(since, ...fails).map((r) => ({ ip: r.ip, n: r.n })),
    };
}

/** Legatura cu productia: audit_log + notifyEvents (+ Telegram, daca adminul il are). */
let _live = null;
function start() {
    if (_live) return _live;
    const dbm = require('./database');
    const notify = require('./notifyEvents');
    const logger = require('./logger');
    const q = {
        since: dbm.db.prepare('SELECT id, user_id, action, ip, created_at FROM audit_log WHERE id > ? ORDER BY id LIMIT 5000'),
        max: dbm.db.prepare('SELECT coalesce(max(id), 0) m FROM audit_log'),
        admins: dbm.db.prepare("SELECT id FROM users WHERE role = 'admin' AND status = 'active'"),
        seen: dbm.db.prepare("SELECT 1 FROM audit_log WHERE user_id = ? AND ip = ? AND action = 'LOGIN_SUCCESS' AND id < ? AND created_at > datetime('now', '-180 days') LIMIT 1"),
    };
    _live = createSentinel({
        readSince: (id) => q.since.all(id),
        maxId: () => q.max.get().m,
        adminIds: () => q.admins.all().map((r) => r.id),
        isAdmin: (uid) => { const u = dbm.findUserById(uid); return !!(u && u.role === 'admin'); },
        ipSeenBefore: (uid, ip, beforeId) => !!q.seen.get(uid, ip, beforeId),
        send: (uid, line) => {
            notify.push(uid, 'security', line);
            try { require('./telegram').sendToUser(uid, '🛡️ Zeus security: ' + line); } catch (_) { /* Telegram e optional */ }
            try { logger.warn('SENTINEL', line); } catch (_) {}
        },
    });
    _live.init();
    setInterval(() => { try { _live.tick(); } catch (_) {} }, 60_000).unref();
    try { logger.info('SENTINEL', 'security sentinel watching audit_log (alerts only, blocks nothing)'); } catch (_) {}
    return _live;
}

module.exports = { createSentinel, start, dailyReport, summary: () => (_live ? _live.summary() : null), WINDOW_MS, COOLDOWN_MS };

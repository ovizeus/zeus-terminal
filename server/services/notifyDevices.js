// server/services/notifyDevices.js
// [2026-11-22] Notificari pe telefon pentru mesajele IMPORTANTE (cerut de operator:
// „sa-mi vina notificare pe telefon cand am mesaje importante de la suport").
//
// Fara serviciul Google de notificari (Firebase): aplicatia Android verifica singura, in
// fundal, la 15 minute (minimul permis de Android), ruta GET /api/notify/pending.
// Telefonul se autentifica cu o CHEIE proprie primita la inregistrare — nu cu cookie-ul de
// sesiune, pe care o sarcina in fundal nu-l are. In baza se tine doar hash-ul cheii.
//
// Ce e „important":
//   - oricine: raspunsurile suportului necitite;
//   - admin: mesajele utilizatorilor necitite + conturile noi care asteapta aprobarea
//     (aceeasi cifra ca bulina de pe ADMIN din aplicatie).
'use strict';
const crypto = require('crypto');

const _db = () => require('./database').db;
const MAX_ITEMS = 10;
const path = require('path');
const fs = require('fs');
// [2026-11-22] Notificare de PROBA: operatorul lasa `data/notify-test.json` = {userId, title, body};
// se livreaza O SINGURA DATA telefonului acelui cont, apoi fisierul se sterge. Nu atinge baza.
const TEST_FILE = () => path.join(process.env.ZEUS_NOTIFY_TEST_DIR || path.join(__dirname, '..', '..', 'data'), 'notify-test.json');
function _takeTest(userId) {
    try {
        const f = TEST_FILE();
        if (!fs.existsSync(f)) return null;
        const t = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (Number(t.userId) !== Number(userId)) return null;
        fs.unlinkSync(f);
        return { id: 'test:' + Date.now(), kind: 'test', title: String(t.title || 'Zeus Terminal').slice(0, 80), body: _clip(t.body || 'Test notification') };
    } catch (_) { return null; }
}
const BODY_MAX = 140;

function _hash(token) { return crypto.createHash('sha256').update(String(token)).digest('hex'); }
function _clip(s) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > BODY_MAX ? s.slice(0, BODY_MAX - 1) + '…' : s; }

/** Cheie noua pentru un telefon al utilizatorului. Se intoarce O SINGURA DATA. */
function register(userId, now = Date.now()) {
    const token = crypto.randomBytes(32).toString('base64url');
    _db().prepare('INSERT INTO notify_devices (user_id, token_hash, created_at, last_seen) VALUES (?, ?, ?, ?)')
        .run(Number(userId), _hash(token), now, now);
    return token;
}

/** Utilizatorul (activ) caruia ii apartine cheia, sau null. */
function userForToken(token, now = Date.now()) {
    if (!token || typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
    const row = _db().prepare(`SELECT d.id, d.user_id, u.role, u.status FROM notify_devices d
        JOIN users u ON u.id = d.user_id WHERE d.token_hash = ? AND d.revoked = 0`).get(_hash(token));
    if (!row || (row.status && row.status !== 'active')) return null;
    try { _db().prepare('UPDATE notify_devices SET last_seen = ? WHERE id = ?').run(now, row.id); } catch (_) { /* */ }
    return { userId: row.user_id, isAdmin: row.role === 'admin' };
}

/** Ce trebuie anuntat acum. `badge` = cifra de pe iconita. */
function pending(userId, isAdmin) {
    const db = _db();
    const items = [];
    const test = _takeTest(userId);
    if (test) items.push(test);
    const replies = db.prepare(`SELECT id, message FROM support_messages
        WHERE user_id = ? AND sender = 'admin' AND read_by_user = 0 ORDER BY id DESC LIMIT ?`).all(Number(userId), MAX_ITEMS);
    for (const r of replies) items.push({ id: 'sup-reply:' + r.id, kind: 'support', title: 'Zeus Support replied', body: _clip(r.message) });
    let badge = replies.length + (test ? 1 : 0);
    if (isAdmin) {
        const fromUsers = db.prepare(`SELECT id, message FROM support_messages
            WHERE sender = 'user' AND read_by_admin = 0 ORDER BY id DESC LIMIT ?`).all(MAX_ITEMS);
        for (const r of fromUsers) items.push({ id: 'sup-user:' + r.id, kind: 'support', title: 'New support message', body: _clip(r.message) });
        badge += db.prepare(`SELECT COUNT(*) n FROM support_messages WHERE sender = 'user' AND read_by_admin = 0`).get().n;
        const waiting = db.prepare(`SELECT id FROM users WHERE coalesce(approved, 0) = 0 AND coalesce(role, 'user') <> 'admin' ORDER BY id DESC LIMIT ?`).all(MAX_ITEMS);
        for (const u of waiting) items.push({ id: 'approve:' + u.id, kind: 'approval', title: 'New account awaiting approval', body: 'Open Admin to approve or reject it.' });
        badge += db.prepare(`SELECT COUNT(*) n FROM users WHERE coalesce(approved, 0) = 0 AND coalesce(role, 'user') <> 'admin'`).get().n;
    }
    return { badge, items: items.slice(0, MAX_ITEMS) };
}

/** La deconectare: telefonul nu mai primeste notificari pentru contul acesta. */
function revoke(token) {
    if (!token) return 0;
    return _db().prepare('UPDATE notify_devices SET revoked = 1 WHERE token_hash = ?').run(_hash(token)).changes;
}

module.exports = { register, userForToken, pending, revoke, _hash };

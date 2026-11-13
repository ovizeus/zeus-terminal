#!/usr/bin/env node
'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// Scoate un cont CU TOTUL din baza: randul din `users` si tot ce poarta id-ul
// lui, in orice tabel. Butonul „Delete" din Admin sterge doar contul si lasa
// restul orfan.
// ═══════════════════════════════════════════════════════════════════════════
// [2026-11-13] Scris pentru contul de proba al operatorului (uid=11).
//
//   node scripts/purge-user.js --id 11 --email x@y.z            (numara, nu scrie)
//   node scripts/purge-user.js --id 11 --email x@y.z --apply    (sterge)
//
// Reguli:
//   - fara --apply NU scrie nimic (baza se deschide doar pentru citire);
//   - id-ul SI emailul trebuie sa se potriveasca aceluiasi rand — o cifra
//     gresita nu poate sterge alt cont;
//   - un admin nu poate fi sters de aici;
//   - cu --apply serverul trebuie sa fie OPRIT: motorul tine contul in memorie
//     si i-ar rescrie starea la urmatoarea salvare;
//   - totul intr-o singura tranzactie: ori dispare tot, ori nimic.
const path = require('path');
const Database = require('better-sqlite3');

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const id = Number(arg('--id'));
const email = String(arg('--email') || '').toLowerCase().trim();
const apply = process.argv.includes('--apply');
const dbPath = arg('--db') || process.env.ZEUS_DB_PATH || path.resolve(__dirname, '../data/zeus.db');

if (!Number.isInteger(id) || id <= 0 || !email) {
    console.error('usage: purge-user.js --id <n> --email <addr> [--apply] [--db <path>]');
    process.exit(2);
}

const db = new Database(dbPath, apply ? {} : { readonly: true });
const user = db.prepare('SELECT id, email, role, approved, created_at FROM users WHERE id = ?').get(id);
if (!user) { console.error(`no user with id ${id}`); process.exit(3); }
if (String(user.email).toLowerCase() !== email) { console.error(`id ${id} is ${user.email}, not ${email} — refusing`); process.exit(4); }
if (user.role === 'admin') { console.error('refusing to purge an admin'); process.exit(5); }

// Orice tabel cu o coloana `user_id`, plus cheile din at_state care poarta id-ul in nume.
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
const plan = [];
for (const t of tables) {
    if (t === 'users') continue;
    const cols = db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
    if (!cols.includes('user_id')) continue;
    const n = db.prepare(`SELECT COUNT(*) n FROM "${t}" WHERE user_id = ?`).get(id).n;
    if (n > 0) plan.push({ table: t, where: 'user_id = ?', args: [id], n });
}
// at_state: chei de forma `ceva:<id>` sau `ceva:<id>:ceva`, chiar daca user_id e gol.
if (tables.includes('at_state')) {
    const cols = db.prepare('PRAGMA table_info("at_state")').all().map((c) => c.name);
    const guard = cols.includes('user_id') ? ' AND (user_id IS NULL OR user_id != ?)' : '';
    const a = [`%:${id}`, `%:${id}:%`].concat(guard ? [id] : []);
    const n = db.prepare(`SELECT COUNT(*) n FROM at_state WHERE (key LIKE ? OR key LIKE ?)${guard}`).get(...a).n;
    if (n > 0) plan.push({ table: 'at_state (by key)', sql: `DELETE FROM at_state WHERE (key LIKE ? OR key LIKE ?)${guard}`, args: a, n });
}
const open = tables.includes('at_positions')
    ? db.prepare("SELECT COUNT(*) n FROM at_positions WHERE user_id = ? AND UPPER(status) = 'OPEN'").get(id).n : 0;

const total = plan.reduce((s, p) => s + p.n, 0);
console.log(`user #${user.id} ${user.email} (role ${user.role}, created ${user.created_at})`);
console.log(`open positions: ${open}`);
for (const p of plan.sort((a, b) => b.n - a.n)) console.log(`  ${String(p.n).padStart(8)}  ${p.table}`);
console.log(`  ${String(total).padStart(8)}  rows in ${plan.length} tables, plus the users row`);

if (!apply) { console.log('\nDRY RUN — nothing was written. Add --apply (with the server stopped) to delete.'); process.exit(0); }

const run = db.transaction(() => {
    let gone = 0;
    for (const p of plan) gone += db.prepare(p.sql || `DELETE FROM "${p.table}" WHERE ${p.where}`).run(...p.args).changes;
    const u = db.prepare("DELETE FROM users WHERE id = ? AND lower(email) = ? AND role != 'admin'").run(id, email).changes;
    if (u !== 1) throw new Error('users row was not deleted — rolling back');
    return gone;
});
const gone = run();
// Verificare dupa: nimic nu mai poarta id-ul.
let left = 0;
for (const t of tables) {
    const cols = db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
    if (t !== 'users' && cols.includes('user_id')) left += db.prepare(`SELECT COUNT(*) n FROM "${t}" WHERE user_id = ?`).get(id).n;
}
left += db.prepare('SELECT COUNT(*) n FROM users WHERE id = ?').get(id).n;
console.log(`\nDELETED ${gone} rows + the users row. Rows still carrying id ${id}: ${left}`);
process.exit(left === 0 ? 0 : 6);

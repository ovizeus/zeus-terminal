'use strict';
// [2026-11-13] Stergerea completa a unui cont e ireversibila, deci scriptul se
// verifica pe o baza de proba inainte sa atinga cea vie.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');

const SCRIPT = path.resolve(__dirname, '../../scripts/purge-user.js');

function mkDb() {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'purge-')), 't.db');
    const db = new Database(file);
    db.exec(`
        CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, role TEXT, approved INTEGER, created_at TEXT);
        CREATE TABLE brain_decisions (id INTEGER PRIMARY KEY, user_id INTEGER, x TEXT);
        CREATE TABLE at_closed (seq INTEGER PRIMARY KEY, user_id INTEGER, data TEXT);
        CREATE TABLE at_positions (seq INTEGER PRIMARY KEY, user_id INTEGER, status TEXT);
        CREATE TABLE at_state (key TEXT PRIMARY KEY, value TEXT, user_id INTEGER);
        CREATE TABLE no_user_col (id INTEGER PRIMARY KEY, v TEXT);
        INSERT INTO users VALUES (1,'boss@t.io','admin',1,'x'),(11,'probe@t.io','user',1,'x'),(12,'other@t.io','user',1,'x'),(111,'far@t.io','user',1,'x');
        INSERT INTO brain_decisions (user_id,x) VALUES (11,'a'),(11,'b'),(12,'c'),(111,'d');
        INSERT INTO at_closed (user_id,data) VALUES (11,'{}'),(12,'{}');
        INSERT INTO at_state VALUES ('stc:11','{}',11),('brain:cooldowns:11','{}',NULL),('at:11:demo','{}',NULL),
                                    ('stc:12','{}',12),('stc:111','{}',111),('brain:cooldowns:111','{}',NULL),('at:111:demo','{}',NULL);
        INSERT INTO no_user_col (v) VALUES ('keep');
    `);
    db.close();
    return file;
}
const run = (file, ...args) => spawnSync(process.execPath, [SCRIPT, '--db', file, ...args], { encoding: 'utf8' });
const count = (file, sql) => { const d = new Database(file, { readonly: true }); const n = d.prepare(sql).get().n; d.close(); return n; };

describe('purge-user.js', () => {
    test('fara --apply numara si NU scrie nimic', () => {
        const f = mkDb();
        const r = run(f, '--id', '11', '--email', 'probe@t.io');
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('DRY RUN');
        expect(count(f, 'SELECT COUNT(*) n FROM users')).toBe(4);
        expect(count(f, 'SELECT COUNT(*) n FROM brain_decisions')).toBe(4);
    });

    test('⛔ id si email trebuie sa fie ale aceluiasi cont', () => {
        const f = mkDb();
        const r = run(f, '--id', '12', '--email', 'probe@t.io', '--apply');
        expect(r.status).toBe(4);
        expect(count(f, 'SELECT COUNT(*) n FROM users')).toBe(4);
        expect(count(f, 'SELECT COUNT(*) n FROM brain_decisions WHERE user_id = 12')).toBe(1);
    });

    test('⛔ un admin nu se sterge de aici', () => {
        const f = mkDb();
        expect(run(f, '--id', '1', '--email', 'boss@t.io', '--apply').status).toBe(5);
        expect(count(f, 'SELECT COUNT(*) n FROM users WHERE id = 1')).toBe(1);
    });

    test('cont inexistent / argumente lipsa: iese fara sa atinga nimic', () => {
        const f = mkDb();
        expect(run(f, '--id', '999', '--email', 'x@t.io', '--apply').status).toBe(3);
        expect(run(f, '--id', '11').status).toBe(2);
        expect(count(f, 'SELECT COUNT(*) n FROM users')).toBe(4);
    });

    test('--apply scoate contul cu tot ce poarta id-ul lui si NIMIC altceva', () => {
        const f = mkDb();
        const r = run(f, '--id', '11', '--email', 'PROBE@t.io', '--apply');
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('Rows still carrying id 11: 0');
        expect(count(f, 'SELECT COUNT(*) n FROM users WHERE id = 11')).toBe(0);
        expect(count(f, 'SELECT COUNT(*) n FROM brain_decisions WHERE user_id = 11')).toBe(0);
        expect(count(f, 'SELECT COUNT(*) n FROM at_closed WHERE user_id = 11')).toBe(0);
        expect(count(f, "SELECT COUNT(*) n FROM at_state WHERE key IN ('stc:11','brain:cooldowns:11','at:11:demo')")).toBe(0);
        // ceilalti raman intregi — inclusiv uid 111, al carui id CONTINE „11"
        expect(count(f, 'SELECT COUNT(*) n FROM users')).toBe(3);
        expect(count(f, 'SELECT COUNT(*) n FROM brain_decisions')).toBe(2);
        expect(count(f, 'SELECT COUNT(*) n FROM at_closed')).toBe(1);
        expect(count(f, 'SELECT COUNT(*) n FROM at_state')).toBe(4);
        expect(count(f, "SELECT COUNT(*) n FROM at_state WHERE key LIKE '%111%'")).toBe(3);
        expect(count(f, 'SELECT COUNT(*) n FROM no_user_col')).toBe(1);
    });
});

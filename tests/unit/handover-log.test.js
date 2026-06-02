'use strict';
const Database = require('better-sqlite3');
describe('handover_log schema/writer shape', () => {
  test('insert + read a handover row (schema valid)', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE handover_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, from_owner TEXT, to_owner TEXT, reason TEXT, created_at INTEGER NOT NULL);`);
    const ins = db.prepare('INSERT INTO handover_log (user_id, from_owner, to_owner, reason, created_at) VALUES (?,?,?,?,?)');
    ins.run(1, 'CLIENT', 'SERVER', 'client_absent', 123);
    const row = db.prepare('SELECT * FROM handover_log WHERE user_id=1').get();
    expect(row.from_owner).toBe('CLIENT');
    expect(row.to_owner).toBe('SERVER');
    expect(row.reason).toBe('client_absent');
    expect(row.created_at).toBe(123);
    db.close();
  });
});

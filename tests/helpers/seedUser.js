'use strict';

/**
 * [2026-11-07] Make sure a user row exists.
 *
 * Needed once the suite stopped running against the production database.
 * Several tests passed a user id straight into code that writes rows with a
 * foreign key onto `users`, and that worked only because the live file
 * happened to contain that user. On an empty database the insert fails with
 * "FOREIGN KEY constraint failed" — the test was reading production without
 * ever saying so.
 *
 * Idempotent, so it is safe in a beforeEach.
 */
function seedUser(db, id = 1, overrides = {}) {
    const row = Object.assign({
        email: `test${id}@example.invalid`,
        password_hash: 'x',
        role: id === 1 ? 'admin' : 'user',
        approved: 1,
        status: 'active',
    }, overrides);
    try {
        db.db.prepare(`
            INSERT INTO users (id, email, password_hash, role, approved, status)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING
        `).run(id, row.email, row.password_hash, row.role, row.approved, row.status);
    } catch (_) {
        // A schema without one of these columns means this helper is being
        // used somewhere it does not fit; the test's own assertion will say so
        // more clearly than a throw from here would.
    }
    return id;
}

module.exports = { seedUser };

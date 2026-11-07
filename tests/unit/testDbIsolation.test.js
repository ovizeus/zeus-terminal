'use strict';

/**
 * [2026-11-07] The suite must never run against the production database.
 *
 * This is here because it already happened: migration 425 was applied to the
 * live file by a test run, with the server process never restarting. It was
 * harmless that time — CREATE TABLE IF NOT EXISTS, zero rows — but a
 * destructive migration would have been applied to live data and nobody would
 * have known until something was missing.
 *
 * If someone removes jest.globalSetup, or a future config stops loading it,
 * this fails loudly instead of letting the suite quietly reattach itself to
 * production.
 */
const path = require('path');
const fs = require('fs');

const PROD = path.resolve(__dirname, '../../data/zeus.db');

describe('test database isolation', () => {
    it('runs against an explicitly chosen database, never the default', () => {
        expect(process.env.ZEUS_DB_PATH).toBeTruthy();
    });

    it('is NOT the production file', () => {
        expect(path.resolve(process.env.ZEUS_DB_PATH)).not.toBe(PROD);
    });

    it('is not merely a sibling of it either', () => {
        // a path like data/zeus-test.db would still sit in the live data
        // directory, where a stray migration or a tidy-up script can reach it
        expect(path.dirname(path.resolve(process.env.ZEUS_DB_PATH))).not.toBe(path.dirname(PROD));
    });

    it('the database module actually opened that file', () => {
        const db = require('../../server/services/database');
        const file = db.db.prepare('PRAGMA database_list').all().find((r) => r.name === 'main');
        expect(file).toBeTruthy();
        expect(path.resolve(file.file)).toBe(path.resolve(process.env.ZEUS_DB_PATH));
        expect(path.resolve(file.file)).not.toBe(PROD);
    });

    it('writes land in the throwaway file, and production keeps its size', () => {
        const before = fs.existsSync(PROD) ? fs.statSync(PROD).size : null;
        const db = require('../../server/services/database');
        db.db.exec('CREATE TABLE IF NOT EXISTS _isolation_probe (x INTEGER)');
        db.db.prepare('INSERT INTO _isolation_probe (x) VALUES (?)').run(1);
        const n = db.db.prepare('SELECT COUNT(*) AS n FROM _isolation_probe').get().n;
        expect(n).toBeGreaterThan(0);
        if (before !== null) expect(fs.statSync(PROD).size).toBe(before);
    });

    it('production is not even reachable for writing from here', () => {
        // the probe table must exist in the throwaway database and NOT in
        // production — the clearest statement that the two are different files
        const db = require('../../server/services/database');
        db.db.exec('CREATE TABLE IF NOT EXISTS _isolation_probe (x INTEGER)');
        const prod = require('../helpers/prodDb').openProdReadOnly();
        if (!prod) return; // no production database here; nothing to prove
        try {
            const row = prod.prepare("SELECT name FROM sqlite_master WHERE name='_isolation_probe'").get();
            expect(row).toBeUndefined();
        } finally {
            try { prod.close(); } catch (_) { /* already closed */ }
        }
    });
});

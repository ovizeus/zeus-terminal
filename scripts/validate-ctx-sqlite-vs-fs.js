#!/usr/bin/env node
// Phase 8 C4 — Validate SQLite vs FS consistency for user_ctx sections
//
// Usage:
//   node scripts/validate-ctx-sqlite-vs-fs.js
//
// Compares each of the 14 SQLite-eligible sections between:
//   - SQLite (user_ctx_data table)
//   - FS (data/user_ctx/{userId}.json → sections.{key})
//
// Reports: MATCH, DRIFT (with diff summary), MISSING_SQLITE, MISSING_FS

'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'zeus.db');
const CTX_DIR = path.join(__dirname, '..', 'data', 'user_ctx');

const SQLITE_SECTIONS = [
    'indSettings', 'llvSettings', 'signalRegistry', 'perfStats',
    'dailyPnl', 'postmortem', 'adaptive', 'notifications',
    'scannerSyms', 'midstackOrder', 'aubData', 'ofHud',
    'teacherData', 'ariaNovaHud',
];

function deepEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

function run() {
    console.log('═══════════════════════════════════════════════════');
    console.log(' Phase 8 C4 — SQLite vs FS validation');
    console.log('═══════════════════════════════════════════════════');

    const db = new Database(DB_PATH, { readonly: true });
    const files = fs.readdirSync(CTX_DIR).filter(f => /^\d+\.json$/.test(f));

    let totalMatch = 0, totalDrift = 0, totalMissingSqlite = 0, totalMissingFs = 0;

    for (const file of files) {
        const userId = parseInt(file.replace('.json', ''), 10);
        if (!Number.isFinite(userId) || userId <= 0) continue;

        const fp = path.join(CTX_DIR, file);
        let fsData;
        try {
            fsData = JSON.parse(fs.readFileSync(fp, 'utf8'));
        } catch (e) {
            console.warn(`  [WARN] Cannot parse ${file}: ${e.message}`);
            continue;
        }
        const fsSections = fsData.sections || {};

        const sqliteRows = db.prepare('SELECT section, data FROM user_ctx_data WHERE user_id = ?').all(userId);
        const sqliteMap = {};
        for (const r of sqliteRows) {
            try { sqliteMap[r.section] = JSON.parse(r.data); } catch (_) { sqliteMap[r.section] = null; }
        }

        console.log(`\n  User ${userId}:`);

        for (const key of SQLITE_SECTIONS) {
            const fsVal = fsSections[key];
            const sqlVal = sqliteMap[key];
            const hasFsVal = fsVal !== undefined && fsVal !== null;
            const hasSqlVal = sqlVal !== undefined && sqlVal !== null;

            if (!hasFsVal && !hasSqlVal) {
                continue; // neither has it — ok
            }
            if (!hasSqlVal) {
                console.log(`    ${key}: MISSING_SQLITE`);
                totalMissingSqlite++;
                continue;
            }
            if (!hasFsVal) {
                console.log(`    ${key}: MISSING_FS (sqlite has ${JSON.stringify(sqlVal).length}b)`);
                totalMissingFs++;
                continue;
            }

            if (deepEqual(fsVal, sqlVal)) {
                console.log(`    ${key}: MATCH (${JSON.stringify(fsVal).length}b)`);
                totalMatch++;
            } else {
                const fsSize = JSON.stringify(fsVal).length;
                const sqlSize = JSON.stringify(sqlVal).length;
                console.log(`    ${key}: DRIFT — FS=${fsSize}b SQLite=${sqlSize}b`);
                totalDrift++;
            }
        }
    }

    db.close();

    console.log('\n═══════════════════════════════════════════════════');
    console.log(` Results: ${totalMatch} MATCH, ${totalDrift} DRIFT, ${totalMissingSqlite} MISSING_SQLITE, ${totalMissingFs} MISSING_FS`);
    const ok = totalDrift === 0 && totalMissingSqlite === 0;
    console.log(` Verdict: ${ok ? 'PASS — zero drift' : 'FAIL — drift detected'}`);
    console.log('═══════════════════════════════════════════════════');
    process.exit(ok ? 0 : 1);
}

run();

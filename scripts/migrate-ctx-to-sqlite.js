#!/usr/bin/env node
// Phase 8 — Migrate user_ctx FS sections into user_ctx_data SQLite table
//
// Usage:
//   node scripts/migrate-ctx-to-sqlite.js [--force] [--dry-run]
//
// Behavior:
//   - Reads all data/user_ctx/*.json files
//   - For each of the 14 eligible sections, INSERTs into user_ctx_data
//   - SKIP if row already exists (unless --force → overwrite)
//   - settings → SKIP (already in user_settings)
//   - aresData → SKIP (already in ares_state)
//   - uiContext, panels, uiScale → SKIP (remain FS-only)
//
// Exit codes: 0 success, 1 error

'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'zeus.db');
const CTX_DIR = path.join(__dirname, '..', 'data', 'user_ctx');

const FORCE = process.argv.includes('--force');
const DRY_RUN = process.argv.includes('--dry-run');

// 14 sections that go into user_ctx_data
const SQLITE_SECTIONS = new Set([
    'indSettings', 'llvSettings', 'signalRegistry', 'perfStats',
    'dailyPnl', 'postmortem', 'adaptive', 'notifications',
    'scannerSyms', 'midstackOrder', 'aubData', 'ofHud',
    'teacherData', 'ariaNovaHud',
]);

// Sections handled elsewhere or remaining FS-only
const SKIP_SECTIONS = new Set([
    'settings',    // → user_settings table
    'aresData',    // → ares_state table
    'uiContext',   // → FS-only
    'panels',      // → FS-only
    'uiScale',     // → FS-only
]);

function run() {
    console.log('═══════════════════════════════════════════════════');
    console.log(' Phase 8 — user_ctx FS → SQLite migration');
    console.log(' Mode:', DRY_RUN ? 'DRY-RUN' : (FORCE ? 'FORCE (overwrite)' : 'INSERT (skip existing)'));
    console.log('═══════════════════════════════════════════════════');

    if (!fs.existsSync(DB_PATH)) {
        console.error('ERROR: DB not found at', DB_PATH);
        process.exit(1);
    }
    if (!fs.existsSync(CTX_DIR)) {
        console.log('No user_ctx directory found — nothing to migrate.');
        return;
    }

    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');

    // Ensure table exists (migration 021 should have created it)
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_ctx_data'").get();
    if (!tableExists) {
        console.error('ERROR: user_ctx_data table does not exist. Run the server once to apply migration 021.');
        db.close();
        process.exit(1);
    }

    const checkStmt = db.prepare('SELECT 1 FROM user_ctx_data WHERE user_id = ? AND section = ?');
    const upsertStmt = db.prepare("INSERT INTO user_ctx_data (user_id, section, data, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(user_id, section) DO UPDATE SET data = excluded.data, updated_at = datetime('now')");
    const insertStmt = db.prepare("INSERT OR IGNORE INTO user_ctx_data (user_id, section, data, updated_at) VALUES (?, ?, ?, datetime('now'))");

    const files = fs.readdirSync(CTX_DIR).filter(f => /^\d+\.json$/.test(f));
    let totalInserted = 0, totalSkipped = 0, totalOverwritten = 0, totalErrors = 0;

    const tx = db.transaction(() => {
        for (const file of files) {
            const userId = parseInt(file.replace('.json', ''), 10);
            if (!Number.isFinite(userId) || userId <= 0) continue;

            const fp = path.join(CTX_DIR, file);
            let raw, data;
            try {
                raw = fs.readFileSync(fp, 'utf8');
                data = JSON.parse(raw);
            } catch (e) {
                console.warn(`  [WARN] Cannot parse ${file}: ${e.message}`);
                totalErrors++;
                continue;
            }

            const sections = data.sections || {};
            console.log(`\n  User ${userId}: ${Object.keys(sections).length} sections in FS`);

            for (const [key, value] of Object.entries(sections)) {
                if (SKIP_SECTIONS.has(key)) {
                    console.log(`    ${key}: SKIP (handled elsewhere)`);
                    totalSkipped++;
                    continue;
                }
                if (!SQLITE_SECTIONS.has(key)) {
                    console.log(`    ${key}: SKIP (unknown section)`);
                    totalSkipped++;
                    continue;
                }

                const sectionData = value && typeof value === 'object' ? value : {};
                const jsonStr = JSON.stringify(sectionData);

                if (jsonStr.length > 64 * 1024) {
                    console.warn(`    ${key}: SKIP (too large: ${jsonStr.length} bytes)`);
                    totalSkipped++;
                    continue;
                }

                const exists = checkStmt.get(userId, key);

                if (DRY_RUN) {
                    if (exists && !FORCE) {
                        console.log(`    ${key}: WOULD SKIP (already exists, ${jsonStr.length}b)`);
                        totalSkipped++;
                    } else if (exists && FORCE) {
                        console.log(`    ${key}: WOULD OVERWRITE (${jsonStr.length}b)`);
                        totalOverwritten++;
                    } else {
                        console.log(`    ${key}: WOULD INSERT (${jsonStr.length}b)`);
                        totalInserted++;
                    }
                    continue;
                }

                if (exists && !FORCE) {
                    console.log(`    ${key}: SKIP (already exists)`);
                    totalSkipped++;
                    continue;
                }

                if (exists && FORCE) {
                    upsertStmt.run(userId, key, jsonStr);
                    console.log(`    ${key}: OVERWRITTEN (${jsonStr.length}b)`);
                    totalOverwritten++;
                } else {
                    insertStmt.run(userId, key, jsonStr);
                    console.log(`    ${key}: INSERTED (${jsonStr.length}b)`);
                    totalInserted++;
                }
            }
        }
    });

    if (!DRY_RUN) {
        tx();
    } else {
        tx(); // dry-run still reads inside transaction, just no writes happen
    }

    db.close();

    console.log('\n═══════════════════════════════════════════════════');
    console.log(` Results: ${totalInserted} inserted, ${totalOverwritten} overwritten, ${totalSkipped} skipped, ${totalErrors} errors`);
    console.log('═══════════════════════════════════════════════════');
}

run();

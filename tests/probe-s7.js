// [S7] Standalone probe — exercises DSL parity shadow flag + migration 031.
// Tests that the DSL_PARITY_SHADOW_ENABLED flag defaults to false.
// Tests that migration 031_dsl_parity_log creates table + 2 indexes.
// Run: npm test -- --forceExit --silent --testPathPattern probe-s7
'use strict';

const MF = require('../server/migrationFlags');
const Database = require('better-sqlite3');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { console.log('  ✓ ' + name); pass++; }
    else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); fail++; }
}

console.log('=== S7 DSL Parity Shadow Flag Tests ===\n');

console.log('T1 — Flag defaults and property access');
check('DSL_PARITY_SHADOW_ENABLED property exists', typeof MF.DSL_PARITY_SHADOW_ENABLED === 'boolean');
check('DSL_PARITY_SHADOW_ENABLED defaults to false', MF.DSL_PARITY_SHADOW_ENABLED === false);
check('DSL_PARITY_SHADOW_ENABLED is boolean type', typeof MF.DSL_PARITY_SHADOW_ENABLED === 'boolean');

console.log('\nT2 — Migration 031_dsl_parity_log table structure');

// Load database to trigger migrations
require('../server/services/database');

// Open a connection to verify migration applied
const dbPath = path.join(__dirname, '..', 'data', 'zeus.db');
const verifyDb = new Database(dbPath, { readonly: true });

try {
    // Check if table exists
    const tableCheck = verifyDb.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='dsl_parity_log'
    `).all();
    check('dsl_parity_log table exists', tableCheck.length > 0, tableCheck.length ? 'found' : 'not found');

    // Check table schema (columns)
    const schema = verifyDb.prepare(`PRAGMA table_info(dsl_parity_log)`).all();
    const colMap = {};
    schema.forEach(col => { colMap[col.name] = col; });

    check('Column: id exists', !!colMap.id);
    check('Column: user_id exists (NOT NULL)', !!colMap.user_id && colMap.user_id.notnull === 1);
    check('Column: pos_id exists (NOT NULL)', !!colMap.pos_id && colMap.pos_id.notnull === 1);
    check('Column: symbol exists (NOT NULL)', !!colMap.symbol && colMap.symbol.notnull === 1);
    check('Column: source exists (NOT NULL)', !!colMap.source && colMap.source.notnull === 1);
    check('Column: phase exists', !!colMap.phase);
    check('Column: current_sl exists', !!colMap.current_sl);
    check('Column: pivot_left exists', !!colMap.pivot_left);
    check('Column: pivot_right exists', !!colMap.pivot_right);
    check('Column: impulse_val exists', !!colMap.impulse_val);
    check('Column: entry_price exists', !!colMap.entry_price);
    check('Column: tick_price exists', !!colMap.tick_price);
    check('Column: created_at exists (NOT NULL)', !!colMap.created_at && colMap.created_at.notnull === 1);

    // Check indexes
    const indexes = verifyDb.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='dsl_parity_log'
    `).all();
    const indexNames = indexes.map(idx => idx.name);

    check('Index: idx_dsl_parity_user_pos_ts exists',
          indexNames.includes('idx_dsl_parity_user_pos_ts'));
    check('Index: idx_dsl_parity_source_ts exists',
          indexNames.includes('idx_dsl_parity_source_ts'));

} catch (err) {
    console.log('  ✗ Error checking table structure — ' + err.message);
    fail++;
} finally {
    verifyDb.close();
}

console.log('\n=== Summary ===');
console.log(`  PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);

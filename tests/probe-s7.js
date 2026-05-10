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

// ─── T3 — logDslParityRow + queryDslParityReport helpers ───────────────────

const dbModule = require('../server/services/database');

// Cleanup: remove test rows before and after
const cleanupTestRows = () => {
    try {
        dbModule.db.prepare("DELETE FROM dsl_parity_log WHERE pos_id LIKE 'test-%'").run();
    } catch (_) {}
};
cleanupTestRows();

console.log('\nT3 — Helper functions exist in db module');
check('logDslParityRow is a function', typeof dbModule.logDslParityRow === 'function');
check('queryDslParityReport is a function', typeof dbModule.queryDslParityReport === 'function');

console.log('\nT4 — logDslParityRow writes row to dsl_parity_log');
{
    const userId = 9999;
    const posId = 'test-pos-001';
    const symbol = 'BTCUSDT';
    const ts = Date.now();

    try {
        dbModule.logDslParityRow(userId, posId, symbol, 'server', {
            phase: 'ACTIVE',
            currentSL: 60000,
            pivotLeft: 59000,
            pivotRight: 61000,
            impulseVal: 0.5,
            entry: 62000,
            price: 63000,
        });

        const row = dbModule.db.prepare(
            "SELECT * FROM dsl_parity_log WHERE pos_id = ? AND source = 'server'"
        ).get(posId);

        check('T4: row inserted successfully', !!row, row ? 'found' : 'not found');
        check('T4: user_id matches', row && row.user_id === userId, row ? String(row.user_id) : 'no row');
        check('T4: symbol matches', row && row.symbol === symbol);
        check('T4: source is server', row && row.source === 'server');
        check('T4: phase matches', row && row.phase === 'ACTIVE');
        check('T4: current_sl matches', row && row.current_sl === 60000);
        check('T4: entry_price matches', row && row.entry_price === 62000);
        check('T4: created_at is recent', row && Math.abs(row.created_at - ts) < 5000);
    } catch (err) {
        check('T4: no exception thrown', false, err.message);
    }

    // T4 silent-on-failure: bad input should not throw
    try {
        dbModule.logDslParityRow(userId, posId, symbol, 'server', {
            currentSL: NaN,
            entry: 0,
            price: null,
        });
        check('T4: silent on NaN/null values (no throw)', true);
    } catch (err) {
        check('T4: silent on NaN/null values (no throw)', false, err.message);
    }

    // T4 input guards — M-6/M-7: null/undefined/invalid inputs must not insert rows
    cleanupTestRows();
    const countBefore = () => dbModule.db.prepare("SELECT COUNT(*) AS n FROM dsl_parity_log WHERE pos_id LIKE 'test-%'").get().n;
    const n0 = countBefore();
    dbModule.logDslParityRow(null, 'test-guard-p1', 'SYM', 'server', {});
    check('T4 input guards: reject missing userId', countBefore() === n0, 'rows changed');
    dbModule.logDslParityRow(1, null, 'SYM', 'server', {});
    check('T4 input guards: reject missing posId', countBefore() === n0, 'rows changed');
    dbModule.logDslParityRow(1, 'test-guard-p1', null, 'server', {});
    check('T4 input guards: reject missing symbol', countBefore() === n0, 'rows changed');
    dbModule.logDslParityRow(1, 'test-guard-p1', 'SYM', 'invalid', {});
    check('T4 input guards: reject invalid source', countBefore() === n0, 'rows changed');
    dbModule.logDslParityRow(1, 'test-guard-p1', 'SYM', 'server', null);
    check('T4 input guards: reject non-object dslState', countBefore() === n0, 'rows changed');
}

console.log('\nT5 — queryDslParityReport math correctness');
{
    cleanupTestRows();

    const now = Date.now();
    const userId = 9999;
    const posId = 'test-pos-math';
    const symbol = 'ETHUSDT';

    // Insert paired rows: server SL=100, client SL=101, entry=100 → divergence=1.0%
    dbModule.logDslParityRow(userId, posId, symbol, 'server', {
        phase: 'ACTIVE',
        currentSL: 100,
        entry: 100,
        price: 105,
    });

    // Client row within 2s window (same ms effectively)
    dbModule.logDslParityRow(userId, posId, symbol, 'client', {
        phase: 'ACTIVE',
        currentSL: 101,
        entry: 100,
        price: 105,
    });

    const since = now - 10000; // 10s back to catch just-inserted rows
    const report = dbModule.queryDslParityReport({ since, userId });

    check('T5: paired >= 1', report.paired >= 1, 'paired=' + report.paired);
    check('T5: divergencePct.mean ≈ 1.0 (within 0.001)',
        Math.abs(report.divergencePct.mean - 1.0) < 0.001,
        'mean=' + report.divergencePct.mean);
    check('T5: phaseMatchPct === 100',
        report.phaseMatchPct === 100,
        'phaseMatchPct=' + report.phaseMatchPct);
    check('T5: gate.primary_pass === false (paired < 500)',
        report.gate.primary_pass === false,
        'primary_pass=' + report.gate.primary_pass);
    check('T5: gate.secondary_pass === false (phaseValidPairs < 100)',
        report.gate.secondary_pass === false,
        'secondary_pass=' + report.gate.secondary_pass);
    check('T5: divergencePct.count >= 1', report.divergencePct.count >= 1);
    check('T5: phaseValidPairs >= 1', report.phaseValidPairs >= 1);

    // Math edge-case: server=100, client=100, entry=100 → div=0
    const posId2 = 'test-pos-nodiv';
    dbModule.logDslParityRow(userId, posId2, symbol, 'server', { phase: 'ACTIVE', currentSL: 100, entry: 100, price: 100 });
    dbModule.logDslParityRow(userId, posId2, symbol, 'client', { phase: 'ACTIVE', currentSL: 100, entry: 100, price: 100 });

    const report2 = dbModule.queryDslParityReport({ since, userId });
    check('T5: zero-divergence pair included', report2.divergencePct.count >= 2);

    // Math edge-case: entry=0 row should be skipped in divergence calc
    const posId3 = 'test-pos-zeroentry';
    dbModule.logDslParityRow(userId, posId3, symbol, 'server', { phase: 'ACTIVE', currentSL: 100, entry: 0, price: 100 });
    dbModule.logDslParityRow(userId, posId3, symbol, 'client', { phase: 'ACTIVE', currentSL: 101, entry: 0, price: 100 });

    const beforeCount = report2.divergencePct.count;
    const report3 = dbModule.queryDslParityReport({ since, userId });
    check('T5: entry=0 rows skipped in divergence calc (count unchanged)',
        report3.divergencePct.count === beforeCount,
        'count was ' + beforeCount + ', now ' + report3.divergencePct.count);

    // T5 SQL injection safety — I-1: parameterized binding must survive injection strings
    try {
        const injReport1 = dbModule.queryDslParityReport({ userId: "1; DROP TABLE dsl_parity_log;--" });
        check('T5 SQL injection safe userId: no crash', true);
        // Number("1; DROP TABLE...") => NaN, won't match any user_id => 0 paired
        check('T5 SQL injection safe userId: returns valid report shape', typeof injReport1.paired === 'number');
    } catch (err) {
        check('T5 SQL injection safe userId: no crash', false, err.message);
        check('T5 SQL injection safe userId: returns valid report shape', false, 'threw');
    }

    try {
        const injReport2 = dbModule.queryDslParityReport({ posId: "test'; DROP TABLE dsl_parity_log;--" });
        check('T5 SQL injection safe posId: no crash', true);
        check('T5 SQL injection safe posId: returns valid report shape', typeof injReport2.paired === 'number');
    } catch (err) {
        check('T5 SQL injection safe posId: no crash', false, err.message);
        check('T5 SQL injection safe posId: returns valid report shape', false, 'threw');
    }
}

cleanupTestRows();

console.log('\nT6 — DSL parity routes registered in brainParity router');
{
    // Reload router fresh to pick up any changes to the routes file.
    delete require.cache[require.resolve('../server/routes/brainParity')];
    const brainParityRouter = require('../server/routes/brainParity');
    const paths = brainParityRouter.stack
        .filter(layer => layer.route)
        .map(layer => ({ path: layer.route.path, methods: Object.keys(layer.route.methods) }));

    const dslClient = paths.find(p => p.path === '/dsl/client');
    check('T6 POST /dsl/client registered',
        !!(dslClient && dslClient.methods.includes('post')),
        dslClient ? ('methods=' + dslClient.methods.join(',')) : 'route not found');

    const dslReport = paths.find(p => p.path === '/dsl/report');
    check('T6 GET /dsl/report registered',
        !!(dslReport && dslReport.methods.includes('get')),
        dslReport ? ('methods=' + dslReport.methods.join(',')) : 'route not found');

    // Sanity: existing brain parity routes still present (no regression).
    const brainClient = paths.find(p => p.path === '/client');
    check('T6 existing POST /client still registered',
        !!(brainClient && brainClient.methods.includes('post')));
    const brainReport = paths.find(p => p.path === '/report');
    check('T6 existing GET /report still registered',
        !!(brainReport && brainReport.methods.includes('get')));
}

console.log('\nT7 — Server tick instrumentation in serverAT.js');
{
    const fs = require('fs');
    const serverATSource = fs.readFileSync(
        path.join(__dirname, '..', 'server', 'services', 'serverAT.js'),
        'utf-8'
    );

    check('T7: _dslPhaseString helper defined',
        /function _dslPhaseString\(s\)/.test(serverATSource));

    check('T7: helper maps inactive state to NONE',
        /if \(!s \|\| !s\.active\) return 'NONE'/.test(serverATSource));

    check('T7: helper maps IMPULSE phase explicitly',
        /if \(s\.phase === 'IMPULSE'\) return 'IMPULSE'/.test(serverATSource));

    check('T7: instrumentation uses property form MF.DSL_PARITY_SHADOW_ENABLED',
        /if \(MF\.DSL_PARITY_SHADOW_ENABLED\)/.test(serverATSource));

    check('T7: instrumentation does NOT use function form getDslParityShadowEnabled',
        !/MF\.getDslParityShadowEnabled\(\)/.test(serverATSource));

    check("T7: calls logDslParityRow with 'server' source",
        /db\.logDslParityRow\([^,]+,[^,]+,[^,]+, 'server'/.test(serverATSource));

    check('T7: null guard on dslState before logDslParityRow',
        /if \(dslState\) \{[\s\S]{0,400}?logDslParityRow/.test(serverATSource));

    check('T7: instrumentation block placed before classic SL/TP check',
        (() => {
            const idxBlock = serverATSource.indexOf('MF.DSL_PARITY_SHADOW_ENABLED');
            const idxClassic = serverATSource.indexOf('Classic SL/TP check');
            return idxBlock > 0 && idxClassic > 0 && idxBlock < idxClassic;
        })());

    check('T7: instrumentation block placed after dslChangedUsers.add',
        (() => {
            const idxAdd = serverATSource.indexOf('dslChangedUsers.add(pos.userId)');
            const idxBlock = serverATSource.indexOf('MF.DSL_PARITY_SHADOW_ENABLED');
            return idxAdd > 0 && idxBlock > 0 && idxAdd < idxBlock;
        })());
}

console.log('\nT8 — Client tick instrumentation in client/src/trading/dsl.ts');
{
    const fs = require('fs');
    const dslSource = fs.readFileSync(
        path.join(__dirname, '..', 'client', 'src', 'trading', 'dsl.ts'),
        'utf-8'
    );

    check('T8: localStorage gate present',
        /localStorage\.getItem\('zeus_dsl_parity_shadow'\)/.test(dslSource));

    check('T8: 5s throttle via _dslParityLastEmit',
        /_dslParityLastEmit[\s\S]*?>= 5000/.test(dslSource));

    check('T8: fetch to /api/brain/parity/dsl/client',
        /fetch\('\/api\/brain\/parity\/dsl\/client'/.test(dslSource));

    check('T8: phase mirror with impulseTriggered',
        /!dsl\.active \? 'NONE'[\s\S]*?dsl\.impulseTriggered \? 'IMPULSE'/.test(dslSource));

    check('T8: try/catch wraps emit',
        /try \{[\s\S]*?fetch\([\s\S]*?\}\)\.catch[\s\S]*?\} catch \(_\) \{[\s\S]*?never disturb DSL/.test(dslSource));

    check('T8: x-zeus-request header present',
        /'x-zeus-request': '1'/.test(dslSource) || /"x-zeus-request": "1"/.test(dslSource));

    check('T8: credentials same-origin for cookie auth',
        /credentials: 'same-origin'/.test(dslSource));

    check('T8: POST method declared',
        (() => {
            // Match POST inside the parity block (after fetch /api/brain/parity/dsl/client)
            const idxFetch = dslSource.indexOf("/api/brain/parity/dsl/client");
            if (idxFetch < 0) return false;
            const tail = dslSource.slice(idxFetch, idxFetch + 600);
            return /method:\s*'POST'/.test(tail);
        })());

    check('T8: posId, symbol, phase, prices in body',
        (() => {
            const idxFetch = dslSource.indexOf("/api/brain/parity/dsl/client");
            if (idxFetch < 0) return false;
            const tail = dslSource.slice(idxFetch, idxFetch + 1500);
            return /posId/.test(tail) && /symbol/.test(tail) && /phase/.test(tail)
                && /currentSL/.test(tail) && /pivotLeft/.test(tail) && /pivotRight/.test(tail)
                && /impulseVal/.test(tail) && /entry/.test(tail) && /price/.test(tail);
        })());

    check('T8: instrumentation inside _runClientDSLOnPositions loop',
        (() => {
            const idxLoop = dslSource.indexOf('_runClientDSLOnPositions');
            const idxBlock = dslSource.indexOf('zeus_dsl_parity_shadow');
            const idxRender = dslSource.indexOf('// ─── RENDER DSL WIDGET');
            return idxLoop > 0 && idxBlock > 0 && idxRender > 0
                && idxLoop < idxBlock && idxBlock < idxRender;
        })());
}

console.log('\n=== Summary ===');
console.log(`  PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);

/**
 * S7 Shadow Parity probe-s7.js
 *
 * Task coverage:
 * - T1 (flag): DSL_PARITY_SHADOW_ENABLED default OFF, property getter
 * - T2 (migration 031): dsl_parity_log table + 2 indexes
 * - T3 (helpers): logDslParityRow exists, queryDslParityReport exists
 * - T4 (logDslParityRow): row insertion, silent-on-bad-input, input guards
 * - T5 (queryDslParityReport): pair correlation, divergence math, gate eval,
 *                              SQL injection safety, edge-case skips
 * - T6 (routes): /api/brain/parity/dsl/{client,report} registered
 * - T7 (server tick): static check pe serverAT.js instrumentation
 * - T8 (client tick): static check pe dsl.ts instrumentation
 * - T9 (E2E integration): paired flow scenarios — zero/low/high divergence,
 *                         phase mismatch, entry=0 skip, >2s window, multi-pair
 *                         aggregation
 *
 * Cleanup invariant: pos_id LIKE 'test-%' OR 'e2e-%' deleted before/after.
 * All test fixtures use those prefixes — see cleanupTestRows() helper.
 *
 * Run: node tests/probe-s7.js
 *      npm test -- --forceExit --silent --testPathPattern probe-s7
 */
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

// Cleanup invariant: remove test fixture rows before and after.
// Both 'test-%' (T4/T5 fixtures) and 'e2e-%' (T9 fixtures) are deleted so
// that probe-s7 leaves dsl_parity_log in the same state it found it.
const cleanupTestRows = () => {
    try {
        dbModule.db
            .prepare("DELETE FROM dsl_parity_log WHERE pos_id LIKE 'test-%' OR pos_id LIKE 'e2e-%'")
            .run();
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

    check('Server tick: 1s throttle via _dslParityLastEmitServer',
        /pos\._dslParityLastEmitServer[\s\S]*?>= 1000/.test(serverATSource));

    check('Server tick: throttle gate before getState call',
        /if \(_nowParity - _lastEmitServer >= 1000\)[\s\S]*?serverDSL\.getState/.test(serverATSource));
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

// ─── T9 — E2E integration: paired flow + gate evaluation ──────────────────
// Insert paired (server+client) DSL fixtures via the public helpers
// (logDslParityRow stamps created_at = Date.now() so the 2s pair window
// is satisfied for back-to-back inserts). queryDslParityReport then
// exercises divergence math, phase match logic, and gate aggregation
// across multiple scenarios. Edge cases that need explicit timestamps
// (>2s pair window) bypass the helper and INSERT directly so we control
// created_at.

console.log('\nT9 — E2E integration scenarios (paired flow + gate eval)');
{
    cleanupTestRows();

    const userId = 8888;
    const symbol = 'BTCUSDT';
    const since = Date.now() - 10000;

    // Scenario 1 — Zero divergence (perfect parity)
    const posS1 = 'e2e-s1-zero';
    dbModule.logDslParityRow(userId, posS1, symbol, 'server', {
        phase: 'ACTIVE', currentSL: 50000, entry: 50000, price: 51000,
    });
    dbModule.logDslParityRow(userId, posS1, symbol, 'client', {
        phase: 'ACTIVE', currentSL: 50000, entry: 50000, price: 51000,
    });
    const r1 = dbModule.queryDslParityReport({ since, userId, posId: posS1 });
    check('T9 S1 zero-div: paired === 1', r1.paired === 1, 'paired=' + r1.paired);
    check('T9 S1 zero-div: divergencePct.mean === 0',
        r1.divergencePct.mean === 0, 'mean=' + r1.divergencePct.mean);
    check('T9 S1 zero-div: divergencePct.p95 === 0',
        r1.divergencePct.p95 === 0, 'p95=' + r1.divergencePct.p95);
    check('T9 S1 zero-div: phaseMatchPct === 100',
        r1.phaseMatchPct === 100, 'phaseMatchPct=' + r1.phaseMatchPct);

    // Scenario 2 — 1% divergence (under primary mean threshold but n<500)
    const posS2 = 'e2e-s2-onepct';
    dbModule.logDslParityRow(userId, posS2, symbol, 'server', {
        phase: 'ACTIVE', currentSL: 100, entry: 100, price: 100,
    });
    dbModule.logDslParityRow(userId, posS2, symbol, 'client', {
        phase: 'ACTIVE', currentSL: 101, entry: 100, price: 100,
    });
    const r2 = dbModule.queryDslParityReport({ since, userId, posId: posS2 });
    check('T9 S2 1pct-div: divergencePct.mean ≈ 1.0',
        Math.abs(r2.divergencePct.mean - 1.0) < 0.001, 'mean=' + r2.divergencePct.mean);
    check('T9 S2 1pct-div: gate.primary_pass === false (paired<500)',
        r2.gate.primary_pass === false, 'primary_pass=' + r2.gate.primary_pass);

    // Scenario 3 — 2.5% divergence (would fail primary mean threshold if n>=500)
    const posS3 = 'e2e-s3-twoandhalfpct';
    dbModule.logDslParityRow(userId, posS3, symbol, 'server', {
        phase: 'ACTIVE', currentSL: 100, entry: 100, price: 100,
    });
    dbModule.logDslParityRow(userId, posS3, symbol, 'client', {
        phase: 'ACTIVE', currentSL: 102.5, entry: 100, price: 100,
    });
    const r3 = dbModule.queryDslParityReport({ since, userId, posId: posS3 });
    check('T9 S3 2.5pct-div: divergencePct.mean ≈ 2.5',
        Math.abs(r3.divergencePct.mean - 2.5) < 0.001, 'mean=' + r3.divergencePct.mean);
    check('T9 S3 2.5pct-div: gate.primary_pass === false (mean>=2.0 OR n<500)',
        r3.gate.primary_pass === false, 'primary_pass=' + r3.gate.primary_pass);

    // Scenario 4 — Phase divergence (server=ACTIVE, client=IMPULSE), SL still valid
    const posS4 = 'e2e-s4-phasediv';
    dbModule.logDslParityRow(userId, posS4, symbol, 'server', {
        phase: 'ACTIVE', currentSL: 100, entry: 100, price: 100,
    });
    dbModule.logDslParityRow(userId, posS4, symbol, 'client', {
        phase: 'IMPULSE', currentSL: 100, entry: 100, price: 100,
    });
    const r4 = dbModule.queryDslParityReport({ since, userId, posId: posS4 });
    check('T9 S4 phase-mismatch: paired === 1',
        r4.paired === 1, 'paired=' + r4.paired);
    check('T9 S4 phase-mismatch: phaseMatchPct === 0',
        r4.phaseMatchPct === 0, 'phaseMatchPct=' + r4.phaseMatchPct);
    check('T9 S4 phase-mismatch: divergencePct.count === 1 (SL still computed)',
        r4.divergencePct.count === 1, 'count=' + r4.divergencePct.count);

    // Scenario 5 — Edge: entry=0 on both sides → divergence skipped, pair counted
    const posS5 = 'e2e-s5-zeroentry';
    dbModule.logDslParityRow(userId, posS5, symbol, 'server', {
        phase: 'ACTIVE', currentSL: 100, entry: 0, price: 100,
    });
    dbModule.logDslParityRow(userId, posS5, symbol, 'client', {
        phase: 'ACTIVE', currentSL: 105, entry: 0, price: 100,
    });
    const r5 = dbModule.queryDslParityReport({ since, userId, posId: posS5 });
    check('T9 S5 entry=0: paired === 1 (correlation still works)',
        r5.paired === 1, 'paired=' + r5.paired);
    check('T9 S5 entry=0: divergencePct.count === 0 (skipped from math)',
        r5.divergencePct.count === 0, 'count=' + r5.divergencePct.count);

    // Scenario 6 — Pair window > 2s: no pair formed.
    // logDslParityRow stamps created_at internally so we INSERT directly to
    // control timestamps (server t0, client t0+3000ms → outside 2s window).
    const posS6 = 'e2e-s6-window';
    const t6 = Date.now();
    const insertStmt = dbModule.db.prepare(
        'INSERT INTO dsl_parity_log ' +
        '(user_id, pos_id, symbol, source, phase, current_sl, pivot_left, pivot_right, ' +
        ' impulse_val, entry_price, tick_price, created_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    insertStmt.run(userId, posS6, symbol, 'server', 'ACTIVE', 100, null, null, null, 100, 100, t6);
    insertStmt.run(userId, posS6, symbol, 'client', 'ACTIVE', 101, null, null, null, 100, 100, t6 + 3000);
    const r6 = dbModule.queryDslParityReport({ since, userId, posId: posS6 });
    check('T9 S6 >2s-window: paired === 0 (pair window exceeded)',
        r6.paired === 0, 'paired=' + r6.paired);

    // Scenario 7 — Multi-pair gate aggregation: 3 pairs at 0%, 1%, 2% divergence.
    // Mean ≈ 1.0, max = 2.0, p95 = element at floor(3*0.95)=floor(2.85)=2 → 2.0.
    cleanupTestRows();
    const posS7a = 'e2e-s7-pair-a';
    const posS7b = 'e2e-s7-pair-b';
    const posS7c = 'e2e-s7-pair-c';
    dbModule.logDslParityRow(userId, posS7a, symbol, 'server', { phase: 'ACTIVE', currentSL: 100, entry: 100, price: 100 });
    dbModule.logDslParityRow(userId, posS7a, symbol, 'client', { phase: 'ACTIVE', currentSL: 100, entry: 100, price: 100 });
    dbModule.logDslParityRow(userId, posS7b, symbol, 'server', { phase: 'ACTIVE', currentSL: 100, entry: 100, price: 100 });
    dbModule.logDslParityRow(userId, posS7b, symbol, 'client', { phase: 'ACTIVE', currentSL: 101, entry: 100, price: 100 });
    dbModule.logDslParityRow(userId, posS7c, symbol, 'server', { phase: 'ACTIVE', currentSL: 100, entry: 100, price: 100 });
    dbModule.logDslParityRow(userId, posS7c, symbol, 'client', { phase: 'ACTIVE', currentSL: 102, entry: 100, price: 100 });
    const r7 = dbModule.queryDslParityReport({ since, userId });
    check('T9 S7 multi-pair: paired === 3', r7.paired === 3, 'paired=' + r7.paired);
    check('T9 S7 multi-pair: divergencePct.mean ≈ 1.0',
        Math.abs(r7.divergencePct.mean - 1.0) < 0.001, 'mean=' + r7.divergencePct.mean);
    check('T9 S7 multi-pair: divergencePct.max === 2.0',
        Math.abs(r7.divergencePct.max - 2.0) < 0.001, 'max=' + r7.divergencePct.max);
    check('T9 S7 multi-pair: gate.secondary_pass === false (phaseValidPairs<100)',
        r7.gate.secondary_pass === false, 'secondary_pass=' + r7.gate.secondary_pass);

    cleanupTestRows();
}

console.log('\n=== Summary ===');
console.log(`  PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);

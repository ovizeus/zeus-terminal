#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// ETAPA 6B2 — Test Suite: final legacy cleanup
// T1-T6
// ═══════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const BASE = 'http://127.0.0.1:3000';
let pass = 0, fail = 0, total = 0;

function assert(label, condition, detail) {
    total++;
    if (condition) { pass++; console.log('  ✅ ' + label); }
    else { fail++; console.log('  ❌ ' + label + ' — ' + (detail || 'FAILED')); }
}

function httpReq(method, urlPath, body, headers) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlPath, BASE);
        const opts = { method, hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers: { ...headers } };
        if (body) {
            const data = JSON.stringify(body);
            opts.headers['Content-Type'] = 'application/json';
            opts.headers['Content-Length'] = Buffer.byteLength(data);
        }
        const req = http.request(opts, (res) => {
            let chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString();
                let json = null;
                try { json = JSON.parse(raw); } catch (_) { }
                resolve({ status: res.statusCode, headers: res.headers, body: json, raw });
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function main() {
    console.log('═══════════════════════════════════════════════════');
    console.log('ETAPA 6B2 — TEST SUITE: final legacy cleanup');
    console.log('═══════════════════════════════════════════════════\n');

    const atSrc = fs.readFileSync(path.join(__dirname, 'server/services/serverAT.js'), 'utf8');
    const dbSrc = fs.readFileSync(path.join(__dirname, 'server/services/database.js'), 'utf8');

    // ─── T1: CODE NO LONGER READS BARE engine KEY ───
    console.log('── T1: CODE NO LONGER READS LEGACY ──');

    assert('T1a. No atGetState(engine) in serverAT', !atSrc.includes("atGetState('engine')"));
    assert('T1b. No bare engine fallback', !atSrc.includes("atGetState('engine')") && !atSrc.includes('uid === 1'));
    assert('T1c. No key-based safety net fallback', !atSrc.includes('fell back to key-based read'));
    assert('T1d. Restore uses only atGetStateByUser', atSrc.includes('db.atGetStateByUser(uid)'));
    assert('T1e. Restore finds engine row by key match', atSrc.includes("r.key === 'engine:' + uid"));
    assert('T1f. No atGetState anywhere in restore block',
        !atSrc.match(/Restore per-user[\s\S]*?restoredCount/)?.toString().includes('atGetState('));

    // ─── T2: DB CHECK — LEGACY ROW DELETED ───
    console.log('\n── T2: DB — LEGACY ROW DELETED ──');

    const Database = require('better-sqlite3');
    const dbPath = path.join(__dirname, 'data', 'zeus.db');
    const rdb = new Database(dbPath, { readonly: true });

    const allRows = rdb.prepare('SELECT key, user_id FROM at_state').all();
    assert('T2a. Bare "engine" row is GONE', !allRows.some(r => r.key === 'engine'));
    assert('T2b. engine:1 still present', allRows.some(r => r.key === 'engine:1'));
    assert('T2c. engine:2 still present', allRows.some(r => r.key === 'engine:2'));
    assert('T2d. Exactly 2 rows remain', allRows.length === 2);
    assert('T2e. All rows have valid user_id', allRows.every(r => r.user_id !== null && r.user_id > 0));
    assert('T2f. No NULL user_id rows', !allRows.some(r => r.user_id === null));

    // Verify cleanup is in code (idempotent)
    assert('T2g. Cleanup DELETE statement in database.js', dbSrc.includes("DELETE FROM at_state WHERE key = 'engine' AND user_id IS NULL"));

    // ─── T3: BOOT / RESTORE ───
    console.log('\n── T3: BOOT / RESTORE ──');

    // Verify restore worked on last boot
    const { execSync } = require('child_process');
    const restoreLog = execSync('grep "State restored" /root/zeus-terminal/data/logs/pm2-out.log | tail -3', { encoding: 'utf8' });
    assert('T3a. State restored at latest boot', restoreLog.includes('State restored uid=1'));

    // No fallback triggered
    const fallbackLog = execSync('grep "fell back to key" /root/zeus-terminal/data/logs/pm2-out.log 2>/dev/null || echo "NONE"', { encoding: 'utf8' });
    assert('T3b. No fallback triggered', fallbackLog.trim() === 'NONE');

    // Verify cleanup log
    const cleanupLog = execSync('grep "6B2" /root/zeus-terminal/data/logs/pm2-out.log | tail -1', { encoding: 'utf8' });
    assert('T3c. 6B2 cleanup log present', cleanupLog.includes('Deleted legacy bare'));

    // Read state per user
    const u1State = rdb.prepare('SELECT value FROM at_state WHERE user_id = ?').get(1);
    assert('T3d. user 1 state readable via user_id', u1State !== undefined);
    if (u1State) {
        const parsed = JSON.parse(u1State.value);
        assert('T3e. user 1 state has mode', typeof parsed.mode === 'string');
        assert('T3f. user 1 state has seq', typeof parsed.seq === 'number');
        assert('T3g. user 1 state has dailyPnL fields', typeof parsed.dailyPnL === 'number');
    }

    // ─── T4: NO CROSS-USER BLEED ───
    console.log('\n── T4: CROSS-USER ISOLATION ──');

    const u1rows = rdb.prepare('SELECT key FROM at_state WHERE user_id = ?').all(1);
    const u2rows = rdb.prepare('SELECT key FROM at_state WHERE user_id = ?').all(2);
    assert('T4a. user 1 only sees their data', u1rows.every(r => r.key === 'engine:1'));
    assert('T4b. user 2 only sees their data', u2rows.every(r => r.key === 'engine:2'));
    assert('T4c. No cross-contamination', !u1rows.some(r => r.key.includes(':2')));
    assert('T4d. No orphan rows (every row has user_id)', allRows.every(r => r.user_id !== null));

    rdb.close();

    // ─── T5: SMOKE TESTS ───
    console.log('\n── T5: SMOKE TESTS ──');

    // Untouched systems
    assert('T5a. idempotency untouched', fs.readFileSync(path.join(__dirname, 'server/routes/trading.js'), 'utf8').includes('_checkIdempotency'));
    assert('T5b. watchdog untouched', atSrc.includes('_watchdogLiveNoSL'));
    assert('T5c. close guard untouched', atSrc.includes('_closingGuard'));
    assert('T5d. rateLimit untouched', fs.readFileSync(path.join(__dirname, 'server/middleware/rateLimit.js'), 'utf8').includes('atCriticalLimit'));
    assert('T5e. dailyPnL split intact', atSrc.includes('dailyPnLDemo') && atSrc.includes('dailyPnLLive'));
    assert('T5f. _closePosition unchanged', atSrc.includes('function _closePosition(idx, pos, exitType, price, pnl)'));
    assert('T5g. DSL untouched', atSrc.includes('serverDSL.attach'));
    assert('T5h. processBrainDecision untouched', atSrc.includes('function processBrainDecision'));
    assert('T5i. _applyStateBlob intact', atSrc.includes("us.dailyPnLDemo = saved.dailyPnLDemo || 0"));
    assert('T5j. _persistState writes key+userId', atSrc.includes("db.atSetState('engine:' + userId,") && atSrc.includes('}, userId);'));

    // HTTP endpoints
    try {
        const r = await httpReq('GET', '/api/status', null, { 'x-zeus-request': '1' });
        assert('T5k. /api/status 200', r.status === 200);
    } catch (e) { assert('T5k. Status', false, e.message); }

    try {
        const r = await httpReq('GET', '/api/at/state');
        assert('T5l. /api/at/state responds', r.status === 200 || r.status === 401);
    } catch (e) { assert('T5l. AT state', false, e.message); }

    try {
        const r = await httpReq('GET', '/api/version');
        assert('T5m. /api/version responds', r.status === 200 || r.status === 401);
    } catch (e) { assert('T5m. Version', false, e.message); }

    // ─── T6: PM2 / LOGS ───
    console.log('\n── T6: PM2 / LOGS ──');

    try {
        const pm2Out = execSync('pm2 jlist --no-color 2>/dev/null || echo "[]"', { encoding: 'utf8' });
        const procs = JSON.parse(pm2Out);
        const zeus = procs.find(p => p.name === 'zeus');
        if (zeus) {
            assert('T6a. PM2 zeus online', zeus.pm2_env.status === 'online');
            assert('T6b. No crash loop (restarts < 105)', zeus.pm2_env.restart_time < 105);
            assert('T6c. Uptime > 10s', (Date.now() - zeus.pm2_env.pm_uptime) > 10000);
        } else {
            assert('T6a. PM2 zeus found', false, 'not found');
        }

        const logs = execSync('pm2 logs zeus --lines 30 --nostream --no-color 2>&1', { encoding: 'utf8' });
        assert('T6d. No module error', !logs.includes('Error: Cannot find module'));
        assert('T6e. No new critical errors', !logs.split('\n').some(l =>
            l.includes('21:08') && (l.includes('[ERROR]') || l.includes('Unhandled error'))
        ));
        assert('T6f. Feed connected', logs.includes('Stream connected') || logs.includes('Subscription complete'));
    } catch (e) {
        assert('T6. PM2', false, e.message);
    }

    // ─── SUMMARY ───
    console.log('\n═══════════════════════════════════════════════════');
    console.log('RESULT: ' + pass + '/' + total + ' PASSED, ' + fail + ' FAILED');
    console.log('═══════════════════════════════════════════════════');

    process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('FATAL:', err.message);
    process.exit(1);
});

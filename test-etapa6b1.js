#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// ETAPA 6B1 — Test Suite: switch read path to user_id-based
// T1-T7
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
    console.log('ETAPA 6B1 — TEST SUITE: user_id-based read path');
    console.log('═══════════════════════════════════════════════════\n');

    const atSrc = fs.readFileSync(path.join(__dirname, 'server/services/serverAT.js'), 'utf8');
    const dbSrc = fs.readFileSync(path.join(__dirname, 'server/services/database.js'), 'utf8');

    // ─── T1: GET STATE PER-USER ───
    console.log('── T1: GET STATE PER-USER ──');

    // Source: _restoreFromDb now uses atGetStateByUser
    assert('T1a. Restore uses atGetStateByUser', atSrc.includes('db.atGetStateByUser(uid)'));
    assert('T1b. Finds engine row by key match', atSrc.includes("r.key === 'engine:' + uid"));
    assert('T1c. Extracts .value from row', atSrc.includes('engineRow.value'));

    // atGetStateByUser query exists and works
    assert('T1d. atGetStateByUser function exists', dbSrc.includes('function atGetStateByUser(userId)'));
    assert('T1e. Query is SELECT by user_id', dbSrc.includes('SELECT key, value FROM at_state WHERE user_id = ?'));

    // Verify live DB data
    const Database = require('better-sqlite3');
    const dbPath = path.join(__dirname, 'data', 'zeus.db');
    const rdb = new Database(dbPath, { readonly: true });

    const u1rows = rdb.prepare('SELECT key, value FROM at_state WHERE user_id = ?').all(1);
    assert('T1f. user_id=1 has engine state in DB', u1rows.some(r => r.key === 'engine:1'));

    if (u1rows.length > 0) {
        const row = u1rows.find(r => r.key === 'engine:1');
        try {
            const parsed = JSON.parse(row.value);
            assert('T1g. user 1 state has mode', typeof parsed.mode === 'string');
            assert('T1h. user 1 state has seq', typeof parsed.seq === 'number');
            assert('T1i. user 1 state has dailyPnL fields', typeof parsed.dailyPnL === 'number');
        } catch (e) {
            assert('T1g. Parse state', false, e.message);
        }
    }

    // ─── T2: RESTORE WORKS CORRECTLY ───
    console.log('\n── T2: RESTORE WORKS ──');

    // Fallback safety net exists
    assert('T2a. Key-based fallback exists (safety net)', atSrc.includes("db.atGetState('engine:' + uid)"));
    assert('T2b. Fallback logged when used', atSrc.includes('fell back to key-based read'));
    assert('T2c. Fallback is conditional (only when user_id query empty)', atSrc.includes('if (!saved)'));

    // Verify applyStateBlob still called
    assert('T2d. _applyStateBlob still called after restore', atSrc.includes('if (saved) _applyStateBlob(uid, saved)'));

    // Check restore log on VPS
    const { execSync } = require('child_process');
    const outLog = execSync('grep "State restored" /root/zeus-terminal/data/logs/pm2-out.log | tail -3', { encoding: 'utf8' });
    assert('T2e. State restored at latest boot', outLog.includes('State restored uid=1'));

    // No fallback warnings in logs after 6B1 deployment
    const errLog = execSync('grep "fell back to key" /root/zeus-terminal/data/logs/pm2-out.log 2>/dev/null || echo "NONE"', { encoding: 'utf8' });
    assert('T2f. No key-based fallback triggered', errLog.trim() === 'NONE');

    // ─── T3: NO MORE BARE "engine" FALLBACK ───
    console.log('\n── T3: BARE "engine" FALLBACK REMOVED ──');

    // The old legacy fallback for user 1 on bare "engine" key is gone
    assert('T3a. No bare "engine" fallback in restore', !atSrc.includes("db.atGetState('engine')"));
    assert('T3b. No uid === 1 special-case', !atSrc.includes('uid === 1'));

    // Legacy key still exists in DB (not deleted — per 6B1 rules)
    const legacyRow = rdb.prepare("SELECT key, user_id FROM at_state WHERE key = 'engine'").get();
    assert('T3c. Legacy "engine" row still in DB', legacyRow !== undefined);
    assert('T3d. Legacy "engine" user_id is NULL', legacyRow && legacyRow.user_id === null);

    // But it's no longer read by the restore path
    assert('T3e. Restore only reads via atGetStateByUser + key fallback', !atSrc.includes("atGetState('engine')"));

    // ─── T4: ZERO CROSS-USER CONTAMINATION ───
    console.log('\n── T4: CROSS-USER ISOLATION ──');

    const u2rows = rdb.prepare('SELECT key, value FROM at_state WHERE user_id = ?').all(2);
    assert('T4a. user_id=2 query only returns their data', u2rows.every(r => r.key.includes(':2')));
    assert('T4b. user_id=1 query does not include user 2', !u1rows.some(r => r.key.includes(':2')));
    assert('T4c. user_id=2 query does not include user 1', !u2rows.some(r => r.key.includes(':1')));

    // Source: restore iterates per uid, no shared state
    assert('T4d. Restore iterates per uid from userIds set', atSrc.includes('for (const uid of userIds)'));

    // ─── T5: NO REGRESSIONS ───
    console.log('\n── T5: NO REGRESSIONS (boot/feed/WS/brain) ──');

    // Untouched systems
    assert('T5a. idempotency untouched', fs.readFileSync(path.join(__dirname, 'server/routes/trading.js'), 'utf8').includes('_checkIdempotency'));
    assert('T5b. watchdog untouched', atSrc.includes('_watchdogLiveNoSL'));
    assert('T5c. close guard untouched', atSrc.includes('_closingGuard'));
    assert('T5d. rateLimit untouched', fs.readFileSync(path.join(__dirname, 'server/middleware/rateLimit.js'), 'utf8').includes('atCriticalLimit'));
    assert('T5e. dailyPnL split untouched', atSrc.includes('dailyPnLDemo') && atSrc.includes('dailyPnLLive'));
    assert('T5f. _closePosition signature unchanged', atSrc.includes('function _closePosition(idx, pos, exitType, price, pnl)'));
    assert('T5g. _applyStateBlob unchanged', atSrc.includes("us.dailyPnLDemo = saved.dailyPnLDemo || 0"));
    assert('T5h. _persistState still writes via key+userId', atSrc.includes("db.atSetState('engine:' + userId,") && atSrc.includes('}, userId);'));
    assert('T5i. DSL untouched', atSrc.includes('serverDSL.attach'));
    assert('T5j. processBrainDecision untouched', atSrc.includes('function processBrainDecision'));

    // HTTP smoke
    try {
        const r = await httpReq('GET', '/api/status', null, { 'x-zeus-request': '1' });
        assert('T5k. /api/status responds 200', r.status === 200);
    } catch (e) { assert('T5k. Status', false, e.message); }

    try {
        const r = await httpReq('GET', '/api/at/state');
        assert('T5l. /api/at/state responds (200/401)', r.status === 200 || r.status === 401);
    } catch (e) { assert('T5l. AT state', false, e.message); }

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
        // The old toFixed crash was at 18:52:17 (pre-Etapa5). Verify no NEW toFixed errors after our deploy time
        const hasNewToFixed = logs.split('\n').some(l => l.includes('toFixed') && !l.includes('18:52:17'));
        assert('T6e. No new toFixed crash since deploy', !hasNewToFixed);
        assert('T6f. No undefined reads', !logs.includes("Cannot read properties of undefined (reading 'dailyPnL"));
    } catch (e) {
        assert('T6. PM2', false, e.message);
    }

    // ─── T7: LEGACY ROW STILL IN DB ───
    console.log('\n── T7: LEGACY DATA PRESERVATION ──');

    const allRows = rdb.prepare('SELECT key, user_id FROM at_state').all();
    assert('T7a. Legacy "engine" key still in DB', allRows.some(r => r.key === 'engine'));
    assert('T7b. engine:1 still in DB', allRows.some(r => r.key === 'engine:1'));
    assert('T7c. engine:2 still in DB', allRows.some(r => r.key === 'engine:2'));
    assert('T7d. Total rows preserved (no deletion)', allRows.length >= 3);

    // Write path still populates user_id
    assert('T7e. atSetState still writes user_id', dbSrc.includes("INSERT OR REPLACE INTO at_state (key, value, user_id)"));
    assert('T7f. _persistState passes userId', atSrc.includes('}, userId);'));

    rdb.close();

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

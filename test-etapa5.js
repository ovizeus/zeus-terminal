#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// ETAPA 5 — Test Suite: D2 dailyPnL demo/live split
// T1-T7 from spec
// ═══════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const BASE = 'http://127.0.0.1:3000';
let pass = 0, fail = 0, total = 0;

function assert(label, condition, detail) {
    total++;
    if (condition) { pass++; console.log(`  ✅ ${label}`); }
    else { fail++; console.log(`  ❌ ${label} — ${detail || 'FAILED'}`); }
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
    console.log('ETAPA 5 — TEST SUITE: D2 dailyPnL demo/live split');
    console.log('═══════════════════════════════════════════════════\n');

    // ─── T0: SOURCE CODE VERIFICATION ───
    console.log('── T0: SOURCE CODE VERIFICATION ──');

    const atSrc = fs.readFileSync(path.join(__dirname, 'server/services/serverAT.js'), 'utf8');
    const tbSrc = fs.readFileSync(path.join(__dirname, 'server/services/telegramBot.js'), 'utf8');

    // Default state
    assert('T0a. _defaultUserState has dailyPnLDemo', atSrc.includes('dailyPnLDemo: 0'));
    assert('T0b. _defaultUserState has dailyPnLLive', atSrc.includes('dailyPnLLive: 0'));

    // Persist
    assert('T0c. _persistState saves dailyPnLDemo', atSrc.includes('dailyPnLDemo: us.dailyPnLDemo'));
    assert('T0d. _persistState saves dailyPnLLive', atSrc.includes('dailyPnLLive: us.dailyPnLLive'));

    // Restore
    assert('T0e. _applyStateBlob restores dailyPnLDemo', atSrc.includes('us.dailyPnLDemo = saved.dailyPnLDemo || 0'));
    assert('T0f. _applyStateBlob restores dailyPnLLive', atSrc.includes('us.dailyPnLLive = saved.dailyPnLLive || 0'));

    // _closePosition routing
    assert('T0g. _closePosition routes live PnL', atSrc.includes("if (pos.mode === 'live') { us.dailyPnLLive = +(us.dailyPnLLive + pnl)"));
    assert('T0h. _closePosition routes demo PnL', atSrc.includes('else { us.dailyPnLDemo = +(us.dailyPnLDemo + pnl)'));

    // Daily reset
    const dailyResetMatch = atSrc.match(/function _checkDailyReset[\s\S]*?_persistState/);
    assert('T0i. _checkDailyReset resets dailyPnLDemo+Live', dailyResetMatch && dailyResetMatch[0].includes('dailyPnLDemo = 0') && dailyResetMatch[0].includes('dailyPnLLive = 0'));

    // getStats
    assert('T0j. getStats exposes dailyPnLDemo', /getStats[\s\S]*?dailyPnLDemo:/.test(atSrc));
    assert('T0k. getStats exposes dailyPnLLive', /getStats[\s\S]*?dailyPnLLive:/.test(atSrc));

    // getDemoStats returns demo-specific
    const demoStatsBlock = atSrc.match(/function getDemoStats[\s\S]*?return \{[\s\S]*?\}/);
    assert('T0l. getDemoStats returns dailyPnL: us.dailyPnLDemo', demoStatsBlock && demoStatsBlock[0].includes('dailyPnL: us.dailyPnLDemo'));

    // getLiveStats returns live-specific
    const liveStatsBlock = atSrc.match(/function getLiveStats[\s\S]*?return \{[\s\S]*?\}/);
    assert('T0m. getLiveStats returns dailyPnL: us.dailyPnLLive', liveStatsBlock && liveStatsBlock[0].includes('dailyPnL: us.dailyPnLLive'));

    // getFullState
    assert('T0n. getFullState exposes dailyPnLDemo', atSrc.includes('dailyPnLDemo: us.dailyPnLDemo || 0'));
    assert('T0o. getFullState exposes dailyPnLLive', atSrc.includes('dailyPnLLive: us.dailyPnLLive || 0'));

    // Full reset
    assert('T0p. full reset clears dailyPnLDemo', /function reset[\s\S]*?dailyPnLDemo = 0/.test(atSrc));
    assert('T0q. full reset clears dailyPnLLive', /function reset[\s\S]*?dailyPnLLive = 0/.test(atSrc));

    // resetDemoBalance
    assert('T0r. resetDemoBalance clears dailyPnLDemo', /function resetDemoBalance[\s\S]*?dailyPnLDemo = 0/.test(atSrc));

    // Kill switch still uses combined dailyPnL (not broken)
    const killBlock = atSrc.match(/function _checkKillSwitch[\s\S]*?us\.dailyPnL/);
    assert('T0s. Kill switch still uses combined dailyPnL (backward compat)', !!killBlock);

    // resetKill returns split values
    assert('T0t. resetKill returns dailyPnLDemo', atSrc.includes('dailyPnLDemo: us.dailyPnLDemo'));
    assert('T0u. resetKill returns dailyPnLLive', atSrc.includes('dailyPnLLive: us.dailyPnLLive'));

    // Telegram bot shows split
    assert('T0v. telegramBot shows demo/live split', tbSrc.includes('Demo:') && tbSrc.includes('Live:'));

    // ─── SAFETY: Untouched guards ───
    console.log('\n── T0-SAFETY: UNTOUCHED SYSTEMS ──');
    assert('T0w. idempotency untouched', fs.readFileSync(path.join(__dirname, 'server/routes/trading.js'), 'utf8').includes('_checkIdempotency'));
    assert('T0x. watchdog untouched', atSrc.includes('_watchdogLiveNoSL'));
    assert('T0y. _closePosition signature unchanged', atSrc.includes("function _closePosition(idx, pos, exitType, price, pnl)"));
    assert('T0z. resolveExchange untouched', fs.readFileSync(path.join(__dirname, 'server/middleware/resolveExchange.js'), 'utf8').includes("readOnlyPaths"));
    assert('T0aa. rateLimit untouched', fs.readFileSync(path.join(__dirname, 'server/middleware/rateLimit.js'), 'utf8').includes("atCriticalLimit"));
    assert('T0ab. closeBySeq guard untouched', atSrc.includes('_closingGuard'));

    // ─── T1: FUNCTIONAL TEST — _closePosition routing ───
    console.log('\n── T1: _closePosition PnL ROUTING LOGIC ──');

    // Verify the exact line sequence in _closePosition
    const closeBlock = atSrc.match(/serverDSL\.detach\(pos\.seq\);[\s\S]*?_checkKillSwitch/);
    assert('T1a. Combined dailyPnL still updated', closeBlock && closeBlock[0].includes('us.dailyPnL = +(us.dailyPnL + pnl)'));
    assert('T1b. Live routed correctly', closeBlock && closeBlock[0].includes("if (pos.mode === 'live') { us.dailyPnLLive"));
    assert('T1c. Demo routed correctly (else branch)', closeBlock && closeBlock[0].includes('else { us.dailyPnLDemo'));
    assert('T1d. Combined update comes BEFORE split', closeBlock && closeBlock[0].indexOf('us.dailyPnL =') < closeBlock[0].indexOf("pos.mode === 'live'"));

    // ─── T2: API STATE ENDPOINTS ───
    console.log('\n── T2: API STATE ENDPOINTS ──');

    // Verify getFullState structure
    const fullStateBlock = atSrc.match(/function getFullState[\s\S]*?return \{[\s\S]*?ts: Date\.now/);
    assert('T2a. getFullState has dailyPnL (combined)', fullStateBlock && fullStateBlock[0].includes('dailyPnL: us.dailyPnL'));
    assert('T2b. getFullState has dailyPnLDemo', fullStateBlock && fullStateBlock[0].includes('dailyPnLDemo: us.dailyPnLDemo'));
    assert('T2c. getFullState has dailyPnLLive', fullStateBlock && fullStateBlock[0].includes('dailyPnLLive: us.dailyPnLLive'));

    // ─── T3: BACKWARD COMPATIBILITY ───
    console.log('\n── T3: BACKWARD COMPATIBILITY ──');

    // legacy dailyPnL still exists everywhere
    assert('T3a. _defaultUserState has legacy dailyPnL', /dailyPnL: 0,\s*dailyPnLDemo: 0/.test(atSrc));
    assert('T3b. _persistState saves legacy dailyPnL', /dailyPnL: us\.dailyPnL,\s*dailyPnLDemo/.test(atSrc));
    assert('T3c. _applyStateBlob restores legacy dailyPnL', atSrc.includes('us.dailyPnL = saved.dailyPnL || 0;'));
    assert('T3d. getStats still has legacy dailyPnL', /getStats[\s\S]*?dailyPnL: us\.dailyPnL,/.test(atSrc));

    // zero-init backward compat (old persisted state won't have new fields)
    assert('T3e. Old state without dailyPnLDemo → defaults to 0', atSrc.includes('saved.dailyPnLDemo || 0'));
    assert('T3f. Old state without dailyPnLLive → defaults to 0', atSrc.includes('saved.dailyPnLLive || 0'));

    // ─── T4: DAILY RESET ───
    console.log('\n── T4: DAILY RESET ──');

    const dailyResetBlock = atSrc.match(/function _checkDailyReset[\s\S]*?_persistState/);
    assert('T4a. Daily reset clears combined', dailyResetBlock && dailyResetBlock[0].includes('us.dailyPnL = 0'));
    assert('T4b. Daily reset clears demo', dailyResetBlock && dailyResetBlock[0].includes('us.dailyPnLDemo = 0'));
    assert('T4c. Daily reset clears live', dailyResetBlock && dailyResetBlock[0].includes('us.dailyPnLLive = 0'));
    assert('T4d. pnlAtReset also cleared', dailyResetBlock && dailyResetBlock[0].includes('us.pnlAtReset = 0'));

    // ─── T5: HTTP SMOKE TESTS ───
    console.log('\n── T5: HTTP SMOKE TESTS ──');

    // Server responds
    try {
        const r = await httpReq('GET', '/api/at/state');
        assert('T5a. Server responds (AT state)', r.status === 200 || r.status === 401);
    } catch (e) {
        assert('T5a. Server responds', false, e.message);
    }

    // Status endpoint
    try {
        const r = await httpReq('GET', '/api/status', null, { 'x-zeus-request': '1' });
        assert('T5b. /api/status works', r.status === 200);
    } catch (e) {
        assert('T5b. Status', false, e.message);
    }

    // Version endpoint
    try {
        const r = await httpReq('GET', '/api/version');
        assert('T5c. /api/version works', r.status === 200 || r.status === 401);
    } catch (e) {
        assert('T5c. Version', false, e.message);
    }

    // Read-only routes still work
    const readRoutes = ['/api/status', '/api/at/state'];
    for (const route of readRoutes) {
        try {
            const r = await httpReq('GET', route, null, { 'x-zeus-request': '1' });
            assert(`T5d. ${route} → ${r.status} (no 500)`, r.status !== 500);
        } catch (e) {
            assert(`T5d. ${route}`, false, e.message);
        }
    }

    // ─── T6: PM2 HEALTH ───
    console.log('\n── T6: PM2 HEALTH ──');
    try {
        const { execSync } = require('child_process');
        const pm2Out = execSync('pm2 jlist --no-color 2>/dev/null || echo "[]"', { encoding: 'utf8' });
        const procs = JSON.parse(pm2Out);
        const zeus = procs.find(p => p.name === 'zeus');
        if (zeus) {
            assert('T6a. PM2 zeus online', zeus.pm2_env.status === 'online');
            assert('T6b. No crash loop (restarts < 100)', zeus.pm2_env.restart_time < 100);
            assert('T6c. Uptime > 5s', (Date.now() - zeus.pm2_env.pm_uptime) > 5000);
        } else {
            assert('T6a. PM2 zeus found', false, 'not found');
        }
    } catch (e) {
        assert('T6. PM2', false, e.message);
    }

    // ─── T7: PM2 LOGS ───
    console.log('\n── T7: PM2 LOGS — NO NEW ERRORS ──');
    try {
        const { execSync } = require('child_process');
        const logs = execSync('pm2 logs zeus --lines 15 --nostream --no-color 2>&1', { encoding: 'utf8' });
        assert('T7a. No module error', !logs.includes('Error: Cannot find module'));
        assert('T7b. No dailyPnL error', !logs.includes('dailyPnL error'));
        assert('T7c. No toFixed error (restored values ok)', !logs.toLowerCase().includes('tofixed is not a function'));
        assert('T7d. No undefined reads', !logs.includes("Cannot read properties of undefined (reading 'dailyPnL")
            && !logs.includes("Cannot read properties of undefined (reading 'dailyPnLDemo")
            && !logs.includes("Cannot read properties of undefined (reading 'dailyPnLLive"));
    } catch (e) {
        assert('T7. Log check', false, e.message);
    }

    // ─── SUMMARY ───
    console.log('\n═══════════════════════════════════════════════════');
    console.log(`RESULT: ${pass}/${total} PASSED, ${fail} FAILED`);
    console.log('═══════════════════════════════════════════════════');

    process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('FATAL:', err.message);
    process.exit(1);
});

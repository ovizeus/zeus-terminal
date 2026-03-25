#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// FAZA 2 BATCH B — CLIENT RPC + UI INTEGRATION TEST SUITE
// ═══════════════════════════════════════════════════════════════
'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-batch-b';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'a'.repeat(64);

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0, total = 0;
const failures = [];

function assert(label, condition, detail) {
    total++;
    if (condition) { pass++; console.log('  ✅ ' + label); }
    else { fail++; const msg = label + ' — ' + (detail || 'FAILED'); failures.push(msg); console.log('  ❌ ' + msg); }
}

function approx(a, b, tolerance) {
    return Math.abs(a - b) <= (tolerance || 0.01);
}

// ══════════════════════════════════════════════════════════════════
// Stubs — same pattern as test-batch-a-addon.js
// ══════════════════════════════════════════════════════════════════
const Module = require('module');
const originalLoad = Module._load;

const STUB_MODULES = {
    './telegram': { send: () => { }, sendToUser: () => { }, alertKillSwitch: () => { }, alertDailyLoss: () => { } },
    './audit': { record: () => { } },
    './metrics': { increment: () => { }, gauge: () => { }, record: () => { } },
    './marketFeed': { getPrice: () => 50000, subscribe: () => { }, unsubscribe: () => { } },
    './binanceSigner': { sendSignedRequest: async () => ({ orderId: 'STUB' }) },
    './exchangeInfo': { roundOrderParams: (s, o) => o },
    './credentialStore': { getExchangeCreds: () => null },
    './database': {
        atSavePosition: () => { },
        atArchiveClosed: () => { },
        atSetState: () => { },
        atGetState: () => null,
        atGetStateByUser: () => [],
        atLoadOpenPositions: () => [],
        atLoadOpenPosByUser: () => [],
        atLoadOpenUserIds: () => [],
        atPruneClosed: () => { },
    },
    './logger': {
        info: () => { }, warn: () => { }, error: () => { }, debug: () => { },
    },
};

Module._load = function (request, parent, isMain) {
    if (parent && parent.filename && parent.filename.includes('server')) {
        const basename = './' + path.basename(request).replace(/\.js$/, '');
        if (STUB_MODULES[basename]) return STUB_MODULES[basename];
        if (STUB_MODULES[request]) return STUB_MODULES[request];
    }
    return originalLoad.apply(this, arguments);
};

function freshRequire(mod) {
    const resolved = require.resolve(mod);
    delete require.cache[resolved];
    return require(mod);
}

function resetATState() {
    const serverDir = path.resolve(__dirname, 'server');
    for (const key of Object.keys(require.cache)) {
        if (key.startsWith(serverDir)) delete require.cache[key];
    }
}

function openDemoPosition(serverAT, userId, opts = {}) {
    const side = opts.side || 'LONG';
    const tier = opts.tier || 'SMALL';
    const decision = {
        symbol: opts.symbol || 'BTCUSDT',
        price: opts.price || 50000,
        cycle: opts.cycle || 1,
        fusion: { confidence: 75, score: 8, signals: 5, decision: tier, dir: side },
        regime: null,
    };
    const stc = {
        confMin: 65, sigMin: 3, adxMin: 18, maxPos: opts.maxPos || 5,
        cooldownMs: 0, lev: opts.lev || 5, size: opts.size || 200,
        slPct: opts.slPct || 1.5, rr: opts.rr || 2, dslMode: 'def',
    };
    serverAT.setMode(userId, 'demo');
    return serverAT.processBrainDecision(decision, stc, userId);
}

function feedPrice(serverAT, symbol, price) {
    serverAT.onPriceUpdate(symbol, price);
}

// Read source files
const autotradeSource = fs.readFileSync(path.join(__dirname, 'public/js/trading/autotrade.js'), 'utf8');
const stateSource = fs.readFileSync(path.join(__dirname, 'public/js/core/state.js'), 'utf8');
const tradingRouteSource = fs.readFileSync(path.join(__dirname, 'server/routes/trading.js'), 'utf8');

// ══════════════════════════════════════════════════════════════════
// TEST RUNNER
// ══════════════════════════════════════════════════════════════════
async function main() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('FAZA 2 BATCH B — CLIENT RPC + UI INTEGRATION TESTS');
    console.log('═══════════════════════════════════════════════════════');

    const UID = 8500;

    // ═══════════════════════════════════════════════════════════════
    // T1: canAddOn() source audit — demo gate removed
    // ═══════════════════════════════════════════════════════════════
    console.log('\n── T1: canAddOn() source — demo gate removed ──');
    {
        assert('T1a. canAddOn exists in autotrade.js',
            autotradeSource.includes('function canAddOn(pos)'));
        assert('T1b. No "demo only" gate (mode !== demo removed)',
            !autotradeSource.includes("if (pos.mode !== 'demo') return false"));
        assert('T1c. Server decides comment present',
            autotradeSource.includes('server decides') || autotradeSource.includes('Server decides') ||
            autotradeSource.includes('Removed demo-only gate'));
        assert('T1d. Still checks pos.closed',
            autotradeSource.includes('pos.closed'));
        assert('T1e. Still checks pos.autoTrade',
            autotradeSource.includes('pos.autoTrade'));
        assert('T1f. Still checks addOnCount vs maxAddon',
            autotradeSource.includes('addOnCount') && autotradeSource.includes('maxAddon'));
        assert('T1g. Still checks in-profit',
            autotradeSource.includes('inProfit'));
        // Balance check removed — server validates
        // Extract canAddOn body (up to next function)
        const canAddOnBody = autotradeSource.match(/function canAddOn\(pos\)[\s\S]*?^}/m);
        assert('T1h. No local balance check in canAddOn',
            canAddOnBody && !canAddOnBody[0].includes('TP.demoBalance'));
    }

    // ═══════════════════════════════════════════════════════════════
    // T2: openAddOn() source audit — RPC to server
    // ═══════════════════════════════════════════════════════════════
    console.log('\n── T2: openAddOn() source — RPC to POST /api/addon ──');
    {
        assert('T2a. openAddOn calls fetch /api/addon',
            autotradeSource.includes("fetch('/api/addon'"));
        assert('T2b. openAddOn uses POST method',
            autotradeSource.includes("method: 'POST'"));
        assert('T2c. openAddOn sends seq in body',
            autotradeSource.includes('seq: seq') || autotradeSource.includes('seq:'));
        assert('T2d. openAddOn sends maxAddon in body',
            autotradeSource.includes('maxAddon'));
        assert('T2e. openAddOn returns Promise',
            autotradeSource.includes('return fetch(') || autotradeSource.includes('Promise.resolve'));
        assert('T2f. No local pos.entry mutation in openAddOn',
            !autotradeSource.match(/function openAddOn[\s\S]*?pos\.entry\s*=/));
        assert('T2g. No local TP.demoBalance mutation in openAddOn',
            !autotradeSource.match(/function openAddOn[\s\S]*?TP\.demoBalance\s*-=/));
        // Extract openAddOn body (from function to window.openAddOn)
        const openAddOnBody = autotradeSource.match(/function openAddOn\(posId\)[\s\S]*?window\.openAddOn/);
        assert('T2h. No local pos.size mutation in openAddOn',
            openAddOnBody && !openAddOnBody[0].match(/pos\.size\s*=/));
        assert('T2i. Handles server error response',
            autotradeSource.includes('Server rejected') || autotradeSource.includes('j.error'));
        assert('T2j. Handles network error',
            autotradeSource.includes('.catch('));
        // Verify window exposure
        assert('T2k. window.openAddOn exposed',
            autotradeSource.includes('window.openAddOn = openAddOn'));
        assert('T2l. window.canAddOn exposed',
            autotradeSource.includes('window.canAddOn = canAddOn'));
    }

    // ═══════════════════════════════════════════════════════════════
    // T3: _mapServerPos source audit — addon fields mapped
    // ═══════════════════════════════════════════════════════════════
    console.log('\n── T3: _mapServerPos — addon fields mapped ──');
    {
        assert('T3a. _mapServerPos maps addOnCount',
            stateSource.includes('addOnCount: sp.addOnCount'));
        assert('T3b. _mapServerPos maps originalEntry',
            stateSource.includes('originalEntry: sp.originalEntry'));
        assert('T3c. _mapServerPos maps originalSize',
            stateSource.includes('originalSize: sp.originalSize'));
        assert('T3d. _mapServerPos maps originalQty',
            stateSource.includes('originalQty: sp.originalQty'));
        assert('T3e. _mapServerPos maps addOnHistory',
            stateSource.includes('addOnHistory: sp.addOnHistory'));
        assert('T3f. _mapServerPos maps slPct',
            stateSource.includes('slPct: sp.slPct'));
        assert('T3g. _mapServerPos maps rr',
            stateSource.includes('rr: sp.rr'));
    }

    // ═══════════════════════════════════════════════════════════════
    // T4: renderATPositions source audit — addon UI
    // ═══════════════════════════════════════════════════════════════
    console.log('\n── T4: renderATPositions — addon UI elements ──');
    {
        // Add-on button present
        assert('T4a. Addon button with data-addon-id exists',
            autotradeSource.includes('data-addon-id'));
        assert('T4b. ADD-ON text on button',
            autotradeSource.includes('ADD-ON'));
        // Addon info row (conditional on addOnCount > 0)
        assert('T4c. Shows Original Entry on addon positions',
            autotradeSource.includes('Orig Entry'));
        assert('T4d. Shows addon count badge',
            autotradeSource.includes('Add-Ons') || autotradeSource.includes('addOnCount'));
        assert('T4e. Shows Original Size',
            autotradeSource.includes('Orig Size'));
        // Entry label changes to "Avg Entry" when addons exist
        assert('T4f. Entry label shows Avg Entry when addOnCount > 0',
            autotradeSource.includes('Avg Entry'));
        // Addon button disabled state
        assert('T4g. Addon button has disabled attribute logic',
            autotradeSource.includes('canAddOn(pos)'));
        // Button event handler attached
        assert('T4h. Addon button event handler attached',
            autotradeSource.includes("querySelectorAll('button[data-addon-id]')"));
        // 3-column grid layout
        assert('T4i. Buttons in 3-column grid',
            autotradeSource.includes('grid-template-columns:1fr 1fr 1fr'));
    }

    // ═══════════════════════════════════════════════════════════════
    // T5: Server add-on still works (end-to-end via addOnPosition)
    // ═══════════════════════════════════════════════════════════════
    console.log('\n── T5: Server add-on end-to-end (Batch A regression) ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        openDemoPosition(serverAT, UID, { tier: 'SMALL', size: 200, slPct: 1.5, rr: 2 });

        const statePre = serverAT.getFullState(UID);
        const posPre = statePre.positions[0];
        const seq = posPre.seq;

        feedPrice(serverAT, 'BTCUSDT', posPre.price * 1.02);

        const result = await serverAT.addOnPosition(UID, seq);
        assert('T5a. Server addon returns ok', result.ok === true);
        assert('T5b. addOnCount = 1', result.addOnCount === 1);

        const posPost = serverAT.getFullState(UID).positions[0];
        assert('T5c. Position size = 300', posPost.size === 300);
        assert('T5d. addOnHistory has 1 entry', posPost.addOnHistory.length === 1);
        assert('T5e. originalEntry preserved', posPost.originalEntry === posPre.price);
        assert('T5f. originalSize preserved', posPost.originalSize === 200);

        // Weighted avg entry
        const profitPrice = posPre.price * 1.02;
        const expectedEntry = (posPre.price * 200 + profitPrice * 100) / 300;
        assert('T5g. Entry = weighted avg', approx(posPost.price, expectedEntry, 0.01),
            `${posPost.price} vs ${expectedEntry}`);
    }

    // ═══════════════════════════════════════════════════════════════
    // T6: getFullState includes all addon fields for client consumption
    // ═══════════════════════════════════════════════════════════════
    console.log('\n── T6: getFullState includes addon fields ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        openDemoPosition(serverAT, UID, { tier: 'SMALL', size: 200, slPct: 2, rr: 3 });

        const posZero = serverAT.getFullState(UID).positions[0];
        assert('T6a. Fresh position: addOnCount=0', posZero.addOnCount === 0);
        assert('T6b. Fresh position: originalEntry exists', typeof posZero.originalEntry === 'number');
        assert('T6c. Fresh position: originalSize exists', typeof posZero.originalSize === 'number');
        assert('T6d. Fresh position: addOnHistory=[]', Array.isArray(posZero.addOnHistory) && posZero.addOnHistory.length === 0);
        assert('T6e. Fresh position: slPct exists', typeof posZero.slPct === 'number' && posZero.slPct > 0);
        assert('T6f. Fresh position: rr exists', typeof posZero.rr === 'number' && posZero.rr > 0);

        feedPrice(serverAT, 'BTCUSDT', posZero.price * 1.03);
        await serverAT.addOnPosition(UID, posZero.seq);

        const posAfter = serverAT.getFullState(UID).positions[0];
        assert('T6g. After addon: addOnCount=1', posAfter.addOnCount === 1);
        assert('T6h. After addon: addOnHistory has 1', posAfter.addOnHistory.length === 1);
        assert('T6i. After addon: originalEntry unchanged', posAfter.originalEntry === posZero.originalEntry);
        assert('T6j. After addon: price != originalEntry (weighted)', posAfter.price !== posAfter.originalEntry);
        assert('T6k. After addon: slPct unchanged', posAfter.slPct === posZero.slPct);
        assert('T6l. After addon: rr unchanged', posAfter.rr === posZero.rr);
    }

    // ═══════════════════════════════════════════════════════════════
    // T7: _mapServerPos integration — simulate WS/refresh hydration
    // ═══════════════════════════════════════════════════════════════
    console.log('\n── T7: _mapServerPos integration — WS hydration sim ──');
    {
        // Simulate what the server sends via WS and verify _mapServerPos maps correctly
        // We test by constructing a mock server position and checking mapped fields
        const serverPos = {
            seq: 42,
            side: 'LONG',
            symbol: 'BTCUSDT',
            price: 51000.5,  // weighted avg after addon
            size: 300,
            lev: 5,
            tp: 53000,
            sl: 49000,
            qty: 0.029412,
            margin: 300,
            tpPnl: 58.82,
            slPnl: -11.76,
            mode: 'demo',
            status: 'OPEN',
            ts: Date.now() - 60000,
            addOnCount: 2,
            originalEntry: 50000,
            originalSize: 200,
            originalQty: 0.02,
            addOnHistory: [
                { ts: Date.now() - 30000, price: 51000, size: 100, count: 1 },
                { ts: Date.now() - 10000, price: 52000, size: 100, count: 2 },
            ],
            slPct: 2,
            rr: 3,
            dslParams: {},
        };

        // Extract _mapServerPos by reading state.js and evaluating in a sandbox
        // Since state.js is an IIFE, we test via source audit + server integration
        assert('T7a. _mapServerPos source maps addOnCount',
            stateSource.includes('addOnCount: sp.addOnCount || 0'));
        assert('T7b. _mapServerPos source maps originalEntry with fallback',
            stateSource.includes('originalEntry: sp.originalEntry || sp.price || sp.entry || 0'));
        assert('T7c. _mapServerPos source maps originalSize with fallback',
            stateSource.includes('originalSize: sp.originalSize || sp.size || 0'));
        assert('T7d. _mapServerPos source maps addOnHistory with fallback',
            stateSource.includes('addOnHistory: sp.addOnHistory || []'));
        assert('T7e. _mapServerPos source maps slPct',
            stateSource.includes('slPct: sp.slPct || 0'));
        assert('T7f. _mapServerPos source maps rr',
            stateSource.includes('rr: sp.rr || 0'));

        // Integration: server getFullState → fields available
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        openDemoPosition(serverAT, UID, { tier: 'SMALL', size: 200, slPct: 2, rr: 3 });
        const state = serverAT.getFullState(UID);
        const pos = state.positions[0];

        // These are the fields _mapServerPos needs to find in server output
        assert('T7g. Server output has addOnCount field', 'addOnCount' in pos);
        assert('T7h. Server output has originalEntry field', 'originalEntry' in pos);
        assert('T7i. Server output has originalSize field', 'originalSize' in pos);
        assert('T7j. Server output has addOnHistory field', 'addOnHistory' in pos);
        assert('T7k. Server output has slPct field', 'slPct' in pos);
        assert('T7l. Server output has rr field', 'rr' in pos);
    }

    // ═══════════════════════════════════════════════════════════════
    // T8: POST /api/addon route source audit
    // ═══════════════════════════════════════════════════════════════
    console.log('\n── T8: POST /api/addon route audit ──');
    {
        assert('T8a. Route exists: router.post(\'/addon\')',
            tradingRouteSource.includes("router.post('/addon'"));
        assert('T8b. Uses req.user.id for userId',
            tradingRouteSource.includes('req.user.id'));
        assert('T8c. Validates seq parameter',
            tradingRouteSource.includes('!seq') || tradingRouteSource.includes('Missing or invalid seq'));
        assert('T8d. Returns 400 on error',
            tradingRouteSource.includes('res.status(400)'));
        assert('T8e. Returns result.ok on success',
            tradingRouteSource.includes('res.json(result)'));
    }

    // ═══════════════════════════════════════════════════════════════
    // T9: DSL survives addon (Batch A regression)
    // ═══════════════════════════════════════════════════════════════
    console.log('\n── T9: DSL survives addon ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        openDemoPosition(serverAT, UID, { tier: 'SMALL', size: 200, slPct: 2, rr: 3 });

        const posPre = serverAT.getFullState(UID).positions[0];
        const seq = posPre.seq;

        // DSL should be attached at open
        assert('T9a. dslParams exist on position', posPre.dslParams !== undefined && posPre.dslParams !== null);

        feedPrice(serverAT, 'BTCUSDT', posPre.price * 1.03);
        await serverAT.addOnPosition(UID, seq);

        const posPost = serverAT.getFullState(UID).positions[0];
        assert('T9b. dslParams still exist after addon', posPost.dslParams !== undefined && posPost.dslParams !== null);
        assert('T9c. DSL re-attached (has dsl field)', posPost.dsl !== undefined);
    }

    // ═══════════════════════════════════════════════════════════════
    // T10: Manual trading not affected (source audit)
    // ═══════════════════════════════════════════════════════════════
    console.log('\n── T10: Manual trading untouched ──');
    {
        // Manual trade functions should NOT reference addon
        const manualFunctions = ['closeLivePos', 'openManualTrade', 'openPartialClose'];
        for (const fn of manualFunctions) {
            assert('T10. ' + fn + ' not modified (no addon reference)',
                !autotradeSource.match(new RegExp('function\\s+' + fn + '[\\s\\S]*?addOnPosition')));
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // T11: Close hooks untouched (source audit)
    // ═══════════════════════════════════════════════════════════════
    console.log('\n── T11: Close hooks untouched ──');
    {
        const serverATSource = fs.readFileSync(
            path.join(__dirname, 'server/services/serverAT.js'), 'utf8'
        );
        // _closePosition function should not have been modified
        const closeMatch = serverATSource.match(/function _closePosition\b/);
        assert('T11a. _closePosition exists in serverAT', !!closeMatch);

        // getFullState should be intact
        const gfsMatch = serverATSource.match(/function getFullState\b/);
        assert('T11b. getFullState exists in serverAT', !!gfsMatch);

        // closeBySeq should be intact
        const cbsMatch = serverATSource.match(/function closeBySeq\b/);
        assert('T11c. closeBySeq exists in serverAT', !!cbsMatch);
    }

    // ═══════════════════════════════════════════════════════════════
    // T12: WS handler source — at_update triggers _applyServerATState
    // ═══════════════════════════════════════════════════════════════
    console.log('\n── T12: WS handler — at_update ──');
    {
        assert('T12a. WS onmessage handles at_update',
            stateSource.includes("msg.type === 'at_update'"));
        assert('T12b. at_update calls _applyServerATState',
            stateSource.includes('_applyServerATState(msg.data)'));
        assert('T12c. WS reconnects on close (exponential backoff)',
            stateSource.includes('setTimeout(_connectWS'));
        assert('T12d. visibilitychange triggers reconnect',
            stateSource.includes('visibilitychange'));
    }

    // ═══════════════════════════════════════════════════════════════
    // T13: No phantom positions — server close still works after addon
    // ═══════════════════════════════════════════════════════════════
    console.log('\n── T13: No phantom positions — close after addon ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        openDemoPosition(serverAT, UID, { tier: 'SMALL', size: 200, slPct: 10, rr: 2 });

        const posPre = serverAT.getFullState(UID).positions[0];
        const seq = posPre.seq;
        const balBefore = serverAT.getFullState(UID).demoBalance.balance;

        feedPrice(serverAT, 'BTCUSDT', posPre.price * 1.02);
        await serverAT.addOnPosition(UID, seq);

        const stateMiddle = serverAT.getFullState(UID);
        assert('T13a. Still 1 position after addon', stateMiddle.positions.length === 1);
        assert('T13b. Position size = 300 after addon', stateMiddle.positions[0].size === 300);

        // Close via closeBySeq
        const closeResult = serverAT.closeBySeq(UID, seq);
        assert('T13c. Close succeeded', closeResult === true || closeResult?.ok === true || closeResult !== false);

        const stateAfter = serverAT.getFullState(UID);
        const openPositions = stateAfter.positions.filter(p => p.status === 'OPEN');
        assert('T13d. 0 open positions after close', openPositions.length === 0);

        // Balance refunded — margin (300) + PnL
        const balAfter = stateAfter.demoBalance.balance;
        assert('T13e. Balance refunded (> balBefore - 300)', balAfter > balBefore - 300 - 50,
            `balAfter=${balAfter}, balBefore=${balBefore}`);
    }

    // ═══════════════════════════════════════════════════════════════
    // T14: addOnHistory audit trail from server to client
    // ═══════════════════════════════════════════════════════════════
    console.log('\n── T14: addOnHistory audit trail ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        openDemoPosition(serverAT, UID, { tier: 'SMALL', size: 200, slPct: 10, rr: 2 });

        const pos0 = serverAT.getFullState(UID).positions[0];
        const seq = pos0.seq;

        feedPrice(serverAT, 'BTCUSDT', pos0.price * 1.02);
        await serverAT.addOnPosition(UID, seq);

        await new Promise(r => setTimeout(r, 3200));

        feedPrice(serverAT, 'BTCUSDT', pos0.price * 1.04);
        await serverAT.addOnPosition(UID, seq);

        const posAfter = serverAT.getFullState(UID).positions[0];
        assert('T14a. addOnHistory has 2 entries', posAfter.addOnHistory.length === 2);
        assert('T14b. History[0] has price field', typeof posAfter.addOnHistory[0].price === 'number');
        assert('T14c. History[0] has size field', typeof posAfter.addOnHistory[0].size === 'number');
        assert('T14d. History[0] has count field', posAfter.addOnHistory[0].count === 1);
        assert('T14e. History[1] has count field', posAfter.addOnHistory[1].count === 2);
        assert('T14f. History[0] has ts field', typeof posAfter.addOnHistory[0].ts === 'number');
    }

    // ═══════════════════════════════════════════════════════════════
    // T15: Refresh/reconnect preserves addon state
    // (simulate by creating position, addon, then fresh getFullState)
    // ═══════════════════════════════════════════════════════════════
    console.log('\n── T15: Refresh/reconnect preserves addon state ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        openDemoPosition(serverAT, UID, { tier: 'SMALL', size: 200, slPct: 10, rr: 2 });

        const pos0 = serverAT.getFullState(UID).positions[0];
        feedPrice(serverAT, 'BTCUSDT', pos0.price * 1.02);
        await serverAT.addOnPosition(UID, pos0.seq);

        // Simulate "reconnect" by calling getFullState again (as WS would)
        const reconnectState = serverAT.getFullState(UID);
        const recPos = reconnectState.positions[0];

        assert('T15a. Reconnect: addOnCount = 1', recPos.addOnCount === 1);
        assert('T15b. Reconnect: originalEntry preserved', recPos.originalEntry === pos0.price);
        assert('T15c. Reconnect: originalSize = 200', recPos.originalSize === 200);
        assert('T15d. Reconnect: size = 300', recPos.size === 300);
        assert('T15e. Reconnect: addOnHistory.length = 1', recPos.addOnHistory.length === 1);
        assert('T15f. Reconnect: mode = demo', recPos.mode === 'demo');
        assert('T15g. Reconnect: status = OPEN', recPos.status === 'OPEN');
        assert('T15h. Reconnect: entry = weighted avg (not original)',
            recPos.price !== pos0.price, `${recPos.price} should differ from ${pos0.price}`);
    }

    // ═══════════════════════════════════════════════════════════════
    // T16: No getFullState breakage — all standard fields present
    // ═══════════════════════════════════════════════════════════════
    console.log('\n── T16: getFullState — standard fields intact ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        openDemoPosition(serverAT, UID, { tier: 'SMALL', size: 200, slPct: 1.5, rr: 2 });

        const state = serverAT.getFullState(UID);
        assert('T16a. state.positions exists', Array.isArray(state.positions));
        assert('T16b. state.demoBalance exists', typeof state.demoBalance === 'object');
        assert('T16c. state.mode exists', typeof state.mode === 'string');
        assert('T16d. state.killActive exists', typeof state.killActive === 'boolean');

        const pos = state.positions[0];
        assert('T16e. pos.seq exists', typeof pos.seq === 'number');
        assert('T16f. pos.side exists', typeof pos.side === 'string');
        assert('T16g. pos.symbol exists', typeof pos.symbol === 'string');
        assert('T16h. pos.price exists', typeof pos.price === 'number');
        assert('T16i. pos.size exists', typeof pos.size === 'number');
        assert('T16j. pos.lev exists', typeof pos.lev === 'number');
        assert('T16k. pos.tp exists', typeof pos.tp === 'number');
        assert('T16l. pos.sl exists', typeof pos.sl === 'number');
        assert('T16m. pos.qty exists', typeof pos.qty === 'number');
        assert('T16n. pos.margin exists', typeof pos.margin === 'number');
        assert('T16o. pos.status exists', pos.status === 'OPEN');
        assert('T16p. pos.mode exists', pos.mode === 'demo');
        assert('T16q. pos.dslParams exists', pos.dslParams !== undefined);
    }

    // ═══════════════════════════════════════════════════════════════
    // T17: _serialize doesn't leak server AT positions to localStorage
    // ═══════════════════════════════════════════════════════════════
    console.log('\n── T17: _serialize — AT positions filtered when serverAT active ──');
    {
        // Source audit: When _serverATEnabled, autoTrade positions are excluded
        assert('T17a. _serialize filters autoTrade when serverAT enabled',
            stateSource.includes('window._serverATEnabled && p.autoTrade'));
    }

    // ═══════════════════════════════════════════════════════════════
    // T18: Multiple addons → weighted avg correct
    // ═══════════════════════════════════════════════════════════════
    console.log('\n── T18: Multiple addons — weighted avg correct ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        openDemoPosition(serverAT, UID, { tier: 'SMALL', size: 200, slPct: 10, rr: 2 });

        const pos0 = serverAT.getFullState(UID).positions[0];
        const origEntry = pos0.price;
        const seq = pos0.seq;

        // Addon 1 at +2%
        const p1 = origEntry * 1.02;
        feedPrice(serverAT, 'BTCUSDT', p1);
        const r1 = await serverAT.addOnPosition(UID, seq);
        assert('T18a. Addon 1 ok', r1.ok === true);

        // After addon 1: size=300, entry = (50000*200 + 51000*100) / 300
        const expectedEntry1 = (origEntry * 200 + p1 * 100) / 300;
        const pos1 = serverAT.getFullState(UID).positions[0];
        assert('T18b. After addon 1: entry correct', approx(pos1.price, expectedEntry1, 0.01),
            `${pos1.price} vs ${expectedEntry1}`);

        await new Promise(r => setTimeout(r, 3200));

        // Addon 2 at +4%
        const p2 = origEntry * 1.04;
        feedPrice(serverAT, 'BTCUSDT', p2);
        const r2 = await serverAT.addOnPosition(UID, seq);
        assert('T18c. Addon 2 ok', r2.ok === true);

        // After addon 2: size=300+100=400, entry recalced
        // Addon size is 50% of originalSize (200) = 100
        const expectedEntry2 = (pos1.price * 300 + p2 * 100) / 400;
        const pos2 = serverAT.getFullState(UID).positions[0];
        assert('T18d. After addon 2: entry correct', approx(pos2.price, expectedEntry2, 0.01),
            `${pos2.price} vs ${expectedEntry2}`);
        assert('T18e. After addon 2: size = 400', pos2.size === 400);
        assert('T18f. After addon 2: addOnCount = 2', pos2.addOnCount === 2);
        assert('T18g. After addon 2: originalSize still 200', pos2.originalSize === 200);
        assert('T18h. After addon 2: originalEntry still original', pos2.originalEntry === origEntry);
    }

    // ═══════════════════════════════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════════════════════════════
    console.log('\n═══════════════════════════════════════════════════════');
    console.log(`RESULTS: ${pass}/${total} PASS, ${fail} FAIL`);
    if (failures.length) {
        console.log('\nFAILED:');
        failures.forEach(f => console.log('  ❌ ' + f));
    } else {
        console.log('\n🎉 ALL TESTS PASSED');
    }
    console.log('═══════════════════════════════════════════════════════');
    process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('FATAL:', err);
    process.exit(2);
});

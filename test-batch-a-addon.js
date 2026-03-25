#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// FAZA 2 BATCH A — ADD-ON SERVER-SIDE (demo) TEST SUITE
// ═══════════════════════════════════════════════════════════════
'use strict';

// Set required env vars BEFORE any server module loads config.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-batch-a';
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
// Stubs — same pattern as test-risk-rails-v1.js
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
    // Clear all cached server modules
    const serverDir = path.resolve(__dirname, 'server');
    for (const key of Object.keys(require.cache)) {
        if (key.startsWith(serverDir)) delete require.cache[key];
    }
}

// ══════════════════════════════════════════════════════════════════
// Helpers — create a position via processBrainDecision
// ══════════════════════════════════════════════════════════════════
function openDemoPosition(serverAT, userId, opts = {}) {
    const side = opts.side || 'LONG';
    const tier = opts.tier || 'MEDIUM';
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

// Simulate price update so _lastPrice is set
function feedPrice(serverAT, symbol, price) {
    serverAT.onPriceUpdate(symbol, price);
}

// ══════════════════════════════════════════════════════════════════
// TEST RUNNER
// ══════════════════════════════════════════════════════════════════
async function main() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('FAZA 2 BATCH A — ADD-ON SERVER-SIDE TEST SUITE');
    console.log('═══════════════════════════════════════════════════════');

    const UID = 8000;  // Unique userId for these tests

    // ── TEST 1: Position open includes addon fields ──
    console.log('\n── TEST 1: Position open — addon fields present ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        const result = openDemoPosition(serverAT, UID);
        assert('T1a. Position created', !!result);
        const state = serverAT.getFullState(UID);
        const pos = state.positions[0];
        assert('T1b. originalEntry exists', typeof pos.originalEntry === 'number');
        assert('T1c. originalEntry = price', pos.originalEntry === pos.price);
        assert('T1d. originalSize exists', typeof pos.originalSize === 'number');
        assert('T1e. originalSize = size', pos.originalSize === pos.size);
        assert('T1f. originalQty exists', typeof pos.originalQty === 'number');
        assert('T1g. originalQty = qty', pos.originalQty === pos.qty);
        assert('T1h. addOnCount = 0', pos.addOnCount === 0);
        assert('T1i. addOnHistory = []', Array.isArray(pos.addOnHistory) && pos.addOnHistory.length === 0);
    }

    // ── TEST 2: Basic demo add-on success ──
    console.log('\n── TEST 2: Basic demo add-on ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        openDemoPosition(serverAT, UID, { tier: 'SMALL', size: 200, slPct: 1.5, rr: 2 });

        const statePre = serverAT.getFullState(UID);
        const posPre = statePre.positions[0];
        const seq = posPre.seq;
        const balBefore = statePre.demoBalance.balance;

        // Price goes up 2% → in profit for LONG
        const profitPrice = posPre.price * 1.02;
        feedPrice(serverAT, 'BTCUSDT', profitPrice);

        const result = await serverAT.addOnPosition(UID, seq);
        assert('T2a. addOn returned ok', result.ok === true);
        assert('T2b. addOnCount = 1', result.addOnCount === 1);
        assert('T2c. addOnSize = 100 (50% of 200)', result.addOnSize === 100);

        const statePost = serverAT.getFullState(UID);
        const posPost = statePost.positions[0];
        assert('T2d. Position size = 300 (200+100)', posPost.size === 300);
        assert('T2e. Position margin = 300', posPost.margin === 300);
        assert('T2f. addOnCount on position = 1', posPost.addOnCount === 1);
        assert('T2g. addOnHistory has 1 entry', posPost.addOnHistory.length === 1);

        // Weighted avg entry check
        const expectedEntry = (posPre.price * 200 + profitPrice * 100) / 300;
        assert('T2h. Entry = weighted avg', approx(posPost.price, expectedEntry, 0.01), `${posPost.price} vs ${expectedEntry}`);

        // qty recalculated
        const expectedQty = (300 * posPost.lev) / posPost.price;
        assert('T2i. qty recalculated', approx(posPost.qty, expectedQty, 0.001), `${posPost.qty} vs ${expectedQty}`);

        // Balance deducted
        const balAfter = statePost.demoBalance.balance;
        assert('T2j. Demo balance deducted by 100', approx(balBefore - balAfter, 100, 0.1), `${balBefore} - ${balAfter} = ${balBefore - balAfter}`);

        // originalEntry unchanged
        assert('T2k. originalEntry unchanged', posPost.originalEntry === posPre.price);
        assert('T2l. originalSize unchanged', posPost.originalSize === 200);
        assert('T2m. originalQty unchanged', posPost.originalQty === posPre.qty);
    }

    // ── TEST 3: SL/TP recalc after add-on ──
    console.log('\n── TEST 3: SL/TP recalc after add-on ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        openDemoPosition(serverAT, UID, { tier: 'SMALL', size: 200, slPct: 2, rr: 3 });

        const statePre = serverAT.getFullState(UID);
        const posPre = statePre.positions[0];
        const seq = posPre.seq;

        feedPrice(serverAT, 'BTCUSDT', posPre.price * 1.03);

        await serverAT.addOnPosition(UID, seq);
        const posPost = serverAT.getFullState(UID).positions[0];

        const slDist = posPost.price * posPost.slPct / 100;
        const tpDist = slDist * posPost.rr;
        assert('T3a. SL recalculated from new entry (LONG)', approx(posPost.sl, posPost.price - slDist, 0.05), `${posPost.sl} vs ${posPost.price - slDist}`);
        assert('T3b. TP recalculated from new entry (LONG)', approx(posPost.tp, posPost.price + tpDist, 0.05), `${posPost.tp} vs ${posPost.price + tpDist}`);
        assert('T3c. slPct preserved', posPost.slPct === 2);
        assert('T3d. rr preserved', posPost.rr === 3);
    }

    // ── TEST 4: SHORT position add-on ──
    console.log('\n── TEST 4: SHORT position add-on ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        openDemoPosition(serverAT, UID, { side: 'SHORT', symbol: 'ETHUSDT', size: 200, slPct: 1.5, rr: 2 });

        const statePre = serverAT.getFullState(UID);
        const posPre = statePre.positions.find(p => p.symbol === 'ETHUSDT');
        const seq = posPre.seq;

        // Price goes DOWN 2% → in profit for SHORT
        feedPrice(serverAT, 'ETHUSDT', posPre.price * 0.98);

        const result = await serverAT.addOnPosition(UID, seq);
        assert('T4a. SHORT add-on ok', result.ok === true);

        const posPost = serverAT.getFullState(UID).positions.find(p => p.seq === seq);
        assert('T4b. SL above entry (SHORT)', posPost.sl > posPost.price);
        assert('T4c. TP below entry (SHORT)', posPost.tp < posPost.price);
        assert('T4d. Entry shifted down (weighted avg)', posPost.price < posPre.price);
    }

    // ── TEST 5: Multiple add-ons + maxAddon limit ──
    console.log('\n── TEST 5: Multiple add-ons + maxAddon limit ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        openDemoPosition(serverAT, UID, { tier: 'SMALL', size: 200, slPct: 10, rr: 2 });

        const state = serverAT.getFullState(UID);
        const seq = state.positions[0].seq;

        // Do 3 add-ons (default max = 3), waiting for guard between each
        feedPrice(serverAT, 'BTCUSDT', 51000);
        const r1 = await serverAT.addOnPosition(UID, seq);
        assert('T5a. Add-on #1 ok', r1.ok === true && r1.addOnCount === 1);

        await new Promise(r => setTimeout(r, 3200));
        feedPrice(serverAT, 'BTCUSDT', 51500);
        const r2 = await serverAT.addOnPosition(UID, seq);
        assert('T5b. Add-on #2 ok', r2.ok === true && r2.addOnCount === 2);

        await new Promise(r => setTimeout(r, 3200));
        feedPrice(serverAT, 'BTCUSDT', 52000);
        const r3 = await serverAT.addOnPosition(UID, seq);
        assert('T5c. Add-on #3 ok', r3.ok === true && r3.addOnCount === 3);

        // 4th should be blocked by maxAddon, not by price or TP
        await new Promise(r => setTimeout(r, 3200));
        feedPrice(serverAT, 'BTCUSDT', 52500);
        const r4 = await serverAT.addOnPosition(UID, seq);
        assert('T5d. Add-on #4 BLOCKED (max 3)', r4.ok === false);
        assert('T5e. Error mentions max', r4.error && r4.error.includes('Max'), r4.error);

        const posPost = serverAT.getFullState(UID).positions[0];
        assert('T5f. addOnCount = 3', posPost.addOnCount === 3);
        assert('T5g. addOnHistory length = 3', posPost.addOnHistory.length === 3);
        assert('T5h. size = 200 + 100*3 = 500', posPost.size === 500);
        assert('T5i. originalSize still 200', posPost.originalSize === 200);

        // Custom maxAddon = 2
        resetATState();
        const serverAT2 = freshRequire('./server/services/serverAT');
        openDemoPosition(serverAT2, UID, { tier: 'SMALL', size: 200, slPct: 10 });
        const state2 = serverAT2.getFullState(UID);
        const seq2 = state2.positions[0].seq;
        feedPrice(serverAT2, 'BTCUSDT', 51000);
        await serverAT2.addOnPosition(UID, seq2, { maxAddon: 2 });
        await new Promise(r => setTimeout(r, 3200));
        feedPrice(serverAT2, 'BTCUSDT', 51500);
        await serverAT2.addOnPosition(UID, seq2, { maxAddon: 2 });
        await new Promise(r => setTimeout(r, 3200));
        feedPrice(serverAT2, 'BTCUSDT', 52000);
        const r5 = await serverAT2.addOnPosition(UID, seq2, { maxAddon: 2 });
        assert('T5j. Custom maxAddon=2 blocks 3rd', r5.ok === false);
    }

    // ── TEST 6: Validation guards ──
    console.log('\n── TEST 6: Validation guards ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        openDemoPosition(serverAT, UID, { tier: 'SMALL', size: 200 });

        const state = serverAT.getFullState(UID);
        const seq = state.positions[0].seq;
        const posPre = state.positions[0];

        // 6a. Not in profit → denied
        feedPrice(serverAT, 'BTCUSDT', posPre.price * 0.99); // below entry for LONG
        const r1 = await serverAT.addOnPosition(UID, seq);
        assert('T6a. Not in profit → denied', r1.ok === false);
        assert('T6b. Error mentions profit', r1.error && r1.error.includes('profit'), r1.error);

        // 6c. Wrong userId → not found
        const r2 = await serverAT.addOnPosition(9999, seq);
        assert('T6c. Wrong userId → not found', r2.ok === false);

        // 6d. Wrong seq → not found
        feedPrice(serverAT, 'BTCUSDT', posPre.price * 1.02);
        const r3 = await serverAT.addOnPosition(UID, 999999);
        assert('T6d. Wrong seq → not found', r3.ok === false);

        // 6e. Missing userId
        const r4 = await serverAT.addOnPosition(null, seq);
        assert('T6e. Missing userId → error', r4.ok === false);

        // 6f. Missing seq
        const r5 = await serverAT.addOnPosition(UID, null);
        assert('T6f. Missing seq → error', r5.ok === false);

        // 6g. Insufficient balance
        resetATState();
        const serverAT2 = freshRequire('./server/services/serverAT');
        // Open a large position that nearly exhausts balance (SMALL tier, 1.0x)
        openDemoPosition(serverAT2, UID, { tier: 'SMALL', size: 9950, slPct: 1.5 });
        const state2 = serverAT2.getFullState(UID);
        const pos2 = state2.positions[0];
        feedPrice(serverAT2, 'BTCUSDT', pos2.price * 1.02);
        // addOnSize = 50% of 9950 = 4975, but balance ≈ 10000-9950 = 50
        const r6 = await serverAT2.addOnPosition(UID, pos2.seq);
        assert('T6g. Insufficient balance → denied', r6.ok === false);
        assert('T6h. Error mentions balance', r6.error && r6.error.includes('balance'), r6.error);
    }

    // ── TEST 7: Race guard / mutex ──
    console.log('\n── TEST 7: Race guard (addon lock) ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        openDemoPosition(serverAT, UID, { tier: 'SMALL', size: 200, slPct: 10, rr: 2 });

        const state = serverAT.getFullState(UID);
        const seq = state.positions[0].seq;
        feedPrice(serverAT, 'BTCUSDT', state.positions[0].price * 1.02);

        // First call succeeds
        const r1 = await serverAT.addOnPosition(UID, seq);
        assert('T7a. First addon ok', r1.ok === true);

        // Second call within 3s guard → blocked
        feedPrice(serverAT, 'BTCUSDT', state.positions[0].price * 1.03);
        const r2 = await serverAT.addOnPosition(UID, seq);
        assert('T7b. Second addon within guard → blocked', r2.ok === false);
        assert('T7c. Error mentions in progress', r2.error && r2.error.includes('in progress'), r2.error);

        // Wait for guard to clear
        await new Promise(r => setTimeout(r, 3200));
        feedPrice(serverAT, 'BTCUSDT', state.positions[0].price * 1.04);
        const r3 = await serverAT.addOnPosition(UID, seq);
        assert('T7d. After guard clears → addon works', r3.ok === true);
    }

    // ── TEST 8: Close hooks intact after add-on ──
    console.log('\n── TEST 8: Close hooks — PnL correct after add-on ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        openDemoPosition(serverAT, UID, { tier: 'SMALL', size: 200, lev: 5, slPct: 1.5, rr: 2 });

        const statePre = serverAT.getFullState(UID);
        const posPre = statePre.positions[0];
        const seq = posPre.seq;
        const balStart = statePre.demoBalance.balance; // 10000 - 200 = 9800

        // Add-on
        feedPrice(serverAT, 'BTCUSDT', posPre.price * 1.02);
        await serverAT.addOnPosition(UID, seq);

        const stateAddon = serverAT.getFullState(UID);
        const posAddon = stateAddon.positions[0];
        const balAfterAddon = stateAddon.demoBalance.balance; // 9800 - 100 = 9700

        // Close via SL (price drops to SL)
        feedPrice(serverAT, 'BTCUSDT', posAddon.sl);

        const stateAfter = serverAT.getFullState(UID);
        assert('T8a. Position closed (0 open)', stateAfter.positions.length === 0);

        // Balance should be: balAfterAddon + margin(300) + slPnl
        // _closePosition does: demoBalance + pos.margin + pnl
        const balFinal = stateAfter.demoBalance.balance;
        assert('T8b. exits = 1', stateAfter.stats.exits === 1);
        assert('T8c. losses = 1', stateAfter.stats.losses === 1);
        // Margin refund: balance goes up by pos.margin (300)
        // PnL at SL is negative → balance goes down by |slPnl|
        // Net: balAfterAddon + 300 + slPnl
        const expectedBal = balAfterAddon + posAddon.margin + posAddon.slPnl;
        assert('T8d. Demo balance = prev + margin + slPnl', approx(balFinal, expectedBal, 1), `${balFinal} vs ${expectedBal}`);
    }

    // ── TEST 9: TP close after add-on ──
    console.log('\n── TEST 9: TP close after add-on ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        openDemoPosition(serverAT, UID, { tier: 'SMALL', size: 200, lev: 5, slPct: 1.5, rr: 2 });

        const statePre = serverAT.getFullState(UID);
        const posPre = statePre.positions[0];
        const seq = posPre.seq;

        feedPrice(serverAT, 'BTCUSDT', posPre.price * 1.02);
        await serverAT.addOnPosition(UID, seq);

        const posAddon = serverAT.getFullState(UID).positions[0];
        const balAfterAddon = serverAT.getFullState(UID).demoBalance.balance;

        // Hit TP
        feedPrice(serverAT, 'BTCUSDT', posAddon.tp);

        const stateAfter = serverAT.getFullState(UID);
        assert('T9a. Position closed at TP', stateAfter.positions.length === 0);
        assert('T9b. wins = 1', stateAfter.stats.wins === 1);
        const expectedBal = balAfterAddon + posAddon.margin + posAddon.tpPnl;
        assert('T9c. Demo balance = prev + margin + tpPnl', approx(stateAfter.demoBalance.balance, expectedBal, 1), `${stateAfter.demoBalance.balance} vs ${expectedBal}`);
    }

    // ── TEST 10: Manual close (closeBySeq) after add-on ──
    console.log('\n── TEST 10: Manual closeBySeq after add-on ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        openDemoPosition(serverAT, UID, { tier: 'SMALL', size: 200, lev: 5, slPct: 1.5, rr: 2 });

        const posPre = serverAT.getFullState(UID).positions[0];
        const seq = posPre.seq;

        feedPrice(serverAT, 'BTCUSDT', posPre.price * 1.02);
        await serverAT.addOnPosition(UID, seq);

        const posAddon = serverAT.getFullState(UID).positions[0];

        // Manual close at current price
        feedPrice(serverAT, 'BTCUSDT', posPre.price * 1.03);
        const closeResult = serverAT.closeBySeq(UID, seq);
        assert('T10a. closeBySeq ok', closeResult.ok === true);
        assert('T10b. PnL is positive (closed above weighted avg entry)', closeResult.pnl > 0);

        const stateAfter = serverAT.getFullState(UID);
        assert('T10c. Position removed', stateAfter.positions.length === 0);
        assert('T10d. exits = 1', stateAfter.stats.exits === 1);
    }

    // ── TEST 11: addOnHistory audit trail ──
    console.log('\n── TEST 11: addOnHistory audit trail ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        openDemoPosition(serverAT, UID, { tier: 'SMALL', size: 200, slPct: 10, rr: 2 });

        const posPre = serverAT.getFullState(UID).positions[0];
        const seq = posPre.seq;
        const origEntry = posPre.price;

        feedPrice(serverAT, 'BTCUSDT', 51500);
        await serverAT.addOnPosition(UID, seq);

        await new Promise(r => setTimeout(r, 3200));
        feedPrice(serverAT, 'BTCUSDT', 52000);
        await serverAT.addOnPosition(UID, seq);

        const posAfter = serverAT.getFullState(UID).positions[0];
        const h = posAfter.addOnHistory;

        assert('T11a. History length = 2', h.length === 2);
        assert('T11b. H[0].price = 51500', h[0].price === 51500);
        assert('T11c. H[0].prevEntry = original entry', h[0].prevEntry === origEntry);
        assert('T11d. H[0].size = 100', h[0].size === 100);
        assert('T11e. H[0].count = 1', h[0].count === 1);
        assert('T11f. H[1].price = 52000', h[1].price === 52000);
        assert('T11g. H[1].prevEntry = H[0].newEntry', h[1].prevEntry === h[0].newEntry);
        assert('T11h. H[1].count = 2', h[1].count === 2);
        assert('T11i. H[1].newSize = 400', h[1].newSize === 400);
        assert('T11j. originalEntry still = original', posAfter.originalEntry === origEntry);
    }

    // ── TEST 12: DSL intact — DSL re-attached after addon ──
    console.log('\n── TEST 12: DSL intact after add-on ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        const serverDSL = freshRequire('./server/services/serverDSL');

        openDemoPosition(serverAT, UID, { size: 200, slPct: 1.5, rr: 2 });
        const posPre = serverAT.getFullState(UID).positions[0];
        const seq = posPre.seq;

        // DSL should be attached
        const dslPre = serverDSL.tick(seq, posPre.price * 1.01);
        assert('T12a. DSL active pre-addon', dslPre.phase !== undefined);

        feedPrice(serverAT, 'BTCUSDT', posPre.price * 1.02);
        await serverAT.addOnPosition(UID, seq);

        // DSL should still be active after addon (re-attached with new SL)
        const posPost = serverAT.getFullState(UID).positions[0];
        const dslPost = serverDSL.tick(seq, posPost.price * 1.01);
        assert('T12b. DSL still active post-addon', dslPost.phase !== undefined);
    }

    // ── TEST 13: Per-user isolation ──
    console.log('\n── TEST 13: Per-user isolation ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        const uidA = 8001, uidB = 8002;

        openDemoPosition(serverAT, uidA, { tier: 'SMALL', size: 200, symbol: 'BTCUSDT' });
        // Open 2 positions for uidB so posB gets seq=2 (different from uidA's seq=1)
        openDemoPosition(serverAT, uidB, { tier: 'SMALL', size: 200, symbol: 'BTCUSDT' });
        openDemoPosition(serverAT, uidB, { tier: 'SMALL', size: 200, symbol: 'ETHUSDT' });

        const posA = serverAT.getFullState(uidA).positions[0];
        const posB = serverAT.getFullState(uidB).positions.find(p => p.symbol === 'ETHUSDT');

        feedPrice(serverAT, 'BTCUSDT', posA.price * 1.02);
        feedPrice(serverAT, 'ETHUSDT', posB.price * 1.02);

        // User A addon on user B's seq (seq=2, which uidA doesn't have) → denied
        const r1 = await serverAT.addOnPosition(uidA, posB.seq);
        assert('T13a. Cross-user addon denied', r1.ok === false);

        // User A addon on own position → ok
        const r2 = await serverAT.addOnPosition(uidA, posA.seq);
        assert('T13b. Own position addon ok', r2.ok === true);

        // User B state unchanged on ETHUSDT position
        const stateBPost = serverAT.getFullState(uidB);
        const posBPost = stateBPost.positions.find(p => p.symbol === 'ETHUSDT');
        assert('T13c. User B addOnCount still 0', posBPost.addOnCount === 0);

        // User B can addon on own position
        const r3 = await serverAT.addOnPosition(uidB, posB.seq);
        assert('T13d. User B addon on own ok', r3.ok === true);
    }

    // ── TEST 14: Addon on closed position denied ──
    console.log('\n── TEST 14: Addon on closed position ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        openDemoPosition(serverAT, UID, { tier: 'SMALL', size: 200 });

        const pos = serverAT.getFullState(UID).positions[0];
        feedPrice(serverAT, 'BTCUSDT', pos.price * 1.02);

        // Close it
        serverAT.closeBySeq(UID, pos.seq);

        // Try addon on closed
        await new Promise(r => setTimeout(r, 100));
        const r = await serverAT.addOnPosition(UID, pos.seq);
        assert('T14a. Addon on closed position → denied', r.ok === false);
    }

    // ── TEST 15: Persistence survives resetATState (simulates restart) ──
    console.log('\n── TEST 15: Fields survive in getFullState (broadcast) ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        openDemoPosition(serverAT, UID, { tier: 'SMALL', size: 200 });

        const statePre = serverAT.getFullState(UID);
        const posPre = statePre.positions[0];
        feedPrice(serverAT, 'BTCUSDT', posPre.price * 1.02);
        await serverAT.addOnPosition(UID, posPre.seq);

        // getFullState should include all addon fields (WS broadcast uses this)
        const statePost = serverAT.getFullState(UID);
        const p = statePost.positions[0];
        assert('T15a. getFullState includes addOnCount', typeof p.addOnCount === 'number' && p.addOnCount === 1);
        assert('T15b. getFullState includes addOnHistory', Array.isArray(p.addOnHistory) && p.addOnHistory.length === 1);
        assert('T15c. getFullState includes originalEntry', typeof p.originalEntry === 'number');
        assert('T15d. getFullState includes originalSize', typeof p.originalSize === 'number');
        assert('T15e. getFullState includes originalQty', typeof p.originalQty === 'number');
    }

    // ── TEST 16: POST /api/addon endpoint validation ──
    console.log('\n── TEST 16: POST /api/addon endpoint exists ──');
    {
        // Source audit: verify endpoint is registered
        const tradingSrc = fs.readFileSync(path.join(__dirname, 'server', 'routes', 'trading.js'), 'utf8');
        assert('T16a. POST /addon route exists', tradingSrc.includes("router.post('/addon'"));
        assert('T16b. Calls addOnPosition', tradingSrc.includes('addOnPosition'));
        assert('T16c. Validates seq', tradingSrc.includes('Missing or invalid seq'));
        assert('T16d. Returns 400 on error', tradingSrc.includes('res.status(400)'));
    }

    // ── TEST 17: tpPnl/slPnl recalculated after addon ──
    console.log('\n── TEST 17: Expected PnL recalculated after addon ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        openDemoPosition(serverAT, UID, { tier: 'SMALL', size: 200, lev: 5, slPct: 2, rr: 2 });

        const posPre = serverAT.getFullState(UID).positions[0];
        const seq = posPre.seq;

        feedPrice(serverAT, 'BTCUSDT', posPre.price * 1.03);
        await serverAT.addOnPosition(UID, seq);

        const posPost = serverAT.getFullState(UID).positions[0];
        // Expected: tpPnl = (tpDist / price) * size * lev with new price/size
        const slDist = posPost.price * posPost.slPct / 100;
        const tpDist = slDist * posPost.rr;
        const expTpPnl = (tpDist / posPost.price) * posPost.size * posPost.lev;
        const expSlPnl = -((slDist / posPost.price) * posPost.size * posPost.lev);
        assert('T17a. tpPnl recalculated', approx(posPost.tpPnl, expTpPnl, 0.5), `${posPost.tpPnl} vs ${expTpPnl}`);
        assert('T17b. slPnl recalculated', approx(posPost.slPnl, expSlPnl, 0.5), `${posPost.slPnl} vs ${expSlPnl}`);
    }

    // ══════════════════════════════════════════════════════════════════
    // SUMMARY
    // ══════════════════════════════════════════════════════════════════
    console.log('\n═══════════════════════════════════════════════════════');
    console.log(`RESULTS: ${pass}/${total} PASS | ${fail} FAIL`);
    console.log('═══════════════════════════════════════════════════════');
    if (failures.length > 0) {
        console.log('\nFAILURES:');
        failures.forEach((f, i) => console.log('  ' + (i + 1) + '. ' + f));
    }
    console.log('\n' + (fail === 0 ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'));
    process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error('Test runner crashed:', err); process.exit(1); });

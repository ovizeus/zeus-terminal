// Zeus Terminal — Phase 3 Server Brain Integration Test
// Tests the brain cycle with real Binance data (same as P2 test) then runs brain decisions.
// Usage: node test-brain-cycle.js
'use strict';

// Stub required env vars for testing (config.js fail-fast requires these)
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-brain-jwt-secret-32chars!!';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-brain-enc-key-32chars!!!!';

const marketFeed = require('./server/services/marketFeed');
const serverState = require('./server/services/serverState');
const serverBrain = require('./server/services/serverBrain');
const logger = require('./server/services/logger');

const SYMBOL = 'BTCUSDT';
const TFS = ['5m'];

async function runTest() {
    console.log('═══════════════════════════════════════════════════');
    console.log('  Phase 3 — Server Brain Cycle Test');
    console.log('═══════════════════════════════════════════════════\n');

    // ── 1. Init server state ──
    console.log('[1] Initializing server state...');
    serverState.init(SYMBOL, TFS);

    // ── 2. Fetch initial candle data ──
    console.log('[2] Fetching 200 candles from Binance...');
    const bars = await marketFeed.fetchKlines(SYMBOL, '5m', 200);
    console.log(`    ✓ ${bars.length} bars fetched, last close: $${bars[bars.length - 1].close}`);

    // Inject bars into serverState via event simulation
    marketFeed._emit_test = marketFeed.on; // We'll trigger directly
    // Simulate initial kline load
    const klineHandler = serverState._getHandlers ? serverState._getHandlers().onKline : null;

    // Instead, let's use the event system properly
    // Feed initial bars through the event
    const listeners = { kline: [], price: [], fundingRate: [], openInterest: [] };

    // Fire the kline event with initial data
    for (const fn of marketFeed._listeners_for_test || []) { /* not accessible */ }

    // Alternative: manually populate SD and run brain
    // ServerState's init wires events, but we don't have a WS connection.
    // We'll emit events via marketFeed's internal emit.
    // Since marketFeed.on() registers listeners, and serverState.init() registered,
    // we just need to emit events.

    // Actually, serverState.init already called marketFeed.on('kline', _onKline)
    // So we need to emit through marketFeed. But marketFeed._emit is private.
    // Let's use a direct approach — require the module internals.

    // Workaround: Feed data through REST fetch → event pipeline
    // serverState.init() already registered event listeners
    // We need to trigger the kline event. Since _emit is private, we'll
    // subscribe to catch the data and also trigger the handlers.

    // Better approach: subscribe triggers fetchKlines which triggers _emit('kline', {initial, bars})
    console.log('[3] Subscribing to Binance feed...');
    await marketFeed.subscribe(SYMBOL, TFS);

    // Wait for initial candle load and indicator computation
    console.log('[4] Waiting 5s for data pipeline to settle...');
    await new Promise(r => setTimeout(r, 5000));

    // ── 3. Check SD state ──
    const snap = serverState.getSnapshot();
    console.log('\n[5] Server Data State:');
    console.log(`    Symbol:    ${snap.symbol}`);
    console.log(`    Price:     $${snap.price}`);
    console.log(`    RSI 5m:    ${snap.rsi['5m'] != null ? snap.rsi['5m'].toFixed(1) : '—'}`);
    console.log(`    ADX:       ${snap.adx != null ? snap.adx.toFixed(1) : '—'}`);
    console.log(`    ATR:       ${snap.atr != null ? snap.atr.toFixed(2) : '—'}`);
    console.log(`    FR:        ${snap.fr != null ? snap.fr : '—'}`);
    console.log(`    OI:        ${snap.oi != null ? snap.oi : '—'}`);
    console.log(`    Stale:     ${snap.stale}`);
    console.log(`    DataReady: ${serverState.isDataReady()}`);

    if (snap.indicators) {
        const ind = snap.indicators;
        console.log('\n    Indicators:');
        console.log(`      Regime:     ${ind.regime} (conf=${ind.regimeConf}%)`);
        console.log(`      TrendBias:  ${ind.trendBias}`);
        console.log(`      MACD dir:   ${ind.macdDir}`);
        console.log(`      ST dir:     ${ind.stDir}`);
        console.log(`      Confluence: ${ind.confluence}`);
        console.log(`      WickChaos:  ${ind.wickChaos}`);
        console.log(`      TrapRisk:   ${ind.trapRisk}`);
    }

    // ── 4. Fetch FR and OI ──
    console.log('\n[6] Fetching funding rate + open interest...');
    try {
        const frData = await marketFeed.fetchFundingRate(SYMBOL);
        const oiData = await marketFeed.fetchOpenInterest(SYMBOL);
        console.log(`    FR: ${frData.rate}`);
        console.log(`    OI: ${oiData.value}`);
    } catch (e) {
        console.log(`    (FR/OI fetch failed: ${e.message})`);
    }

    // Wait for FR/OI to propagate
    await new Promise(r => setTimeout(r, 1000));

    // ── 5. Run brain cycle manually ──
    console.log('\n[7] Running brain cycle...');
    // We can't call _runCycle directly (private), but we can start/stop
    // Or we test through the public API
    serverBrain.start();

    // Wait for first cycle (5s delay + execution)
    console.log('    Waiting 8s for first brain cycle...');
    await new Promise(r => setTimeout(r, 8000));

    const status = serverBrain.getStatus();
    console.log(`\n[8] Brain Status:`);
    console.log(`    Running:    ${status.running}`);
    console.log(`    Cycles:     ${status.cycleCount}`);
    console.log(`    Regime:     ${status.prevRegime || '—'}`);

    if (status.lastDecision) {
        const d = status.lastDecision;
        console.log(`\n    Last Decision:`);
        console.log(`      Symbol:     ${d.symbol}`);
        console.log(`      Price:      $${d.price}`);
        console.log(`      Confluence: ${d.confluence.score} (bull=${d.confluence.bullDirs} bear=${d.confluence.bearDirs})`);
        console.log(`      Regime:     ${d.regime.regime} (${d.regime.confidence}%)`);
        console.log(`      TrendBias:  ${d.regime.trendBias}`);
        console.log(`      TrapRisk:   ${d.regime.trapRisk}`);
        console.log(`      Gates OK:   ${d.gates.allOk}`);
        if (!d.gates.allOk) {
            console.log(`      Gate fails: ${d.gates.reasons.join(', ')}`);
        }
        console.log(`      Fusion:     ${d.fusion.decision} ${d.fusion.dir} (${d.fusion.confidence}%)`);
        console.log(`      Reasons:    ${d.fusion.reasons.join(', ')}`);
    }

    const log = serverBrain.getDecisionLog(5);
    if (log.length > 0) {
        console.log(`\n    Decision Log (last ${log.length}):`);
        for (const entry of log) {
            console.log(`      [${new Date(entry.ts).toISOString().slice(11, 19)}] ${entry.type} — ${entry.reason} ${JSON.stringify(entry.extra)}`);
        }
    }

    // ── 6. Test config update ──
    console.log('\n[9] Testing config update...');
    serverBrain.updateConfig({ confMin: 70, adxMin: 20 });
    const newSTC = serverBrain.STC;
    console.log(`    confMin: ${newSTC.confMin} (was 65)`);
    console.log(`    adxMin:  ${newSTC.adxMin} (was 18)`);

    // ── Cleanup ──
    serverBrain.stop();
    marketFeed.unsubscribeAll();

    console.log('\n═══════════════════════════════════════════════════');
    console.log('  ✅ Phase 3 brain cycle test COMPLETE');
    console.log('═══════════════════════════════════════════════════');

    process.exit(0);
}

runTest().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});

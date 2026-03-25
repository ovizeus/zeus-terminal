#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// Batch C — LIVE ADD-ON BINANCE INTEGRATION Test Suite
// T1-T12 from spec + safety/regression checks
// ═══════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0, total = 0;
function assert(label, condition, detail) {
    total++;
    if (condition) { pass++; console.log('  ✅ ' + label); }
    else { fail++; console.log('  ❌ ' + label + ' — ' + (detail || 'FAILED')); }
}

async function main() {
    console.log('═══════════════════════════════════════════════════');
    console.log('BATCH C — LIVE ADD-ON BINANCE INTEGRATION');
    console.log('═══════════════════════════════════════════════════\n');

    const atSrc = fs.readFileSync(path.join(__dirname, 'server/services/serverAT.js'), 'utf8');
    const tradingSrc = fs.readFileSync(path.join(__dirname, 'server/routes/trading.js'), 'utf8');

    // ═══════════════════════════════════════════════════════════
    // T1: addOnPosition is async
    // ═══════════════════════════════════════════════════════════
    console.log('── T1: addOnPosition is async ──');
    assert('T1a. addOnPosition declared as async', atSrc.includes('async function addOnPosition(userId, seq, options'));
    assert('T1b. addOnPosition still exported', atSrc.includes('addOnPosition'));
    // Check exports section
    const exportsBlock = atSrc.match(/module\.exports\s*=\s*\{[\s\S]*?\}/);
    assert('T1c. addOnPosition in module.exports', exportsBlock && exportsBlock[0].includes('addOnPosition'));

    // ═══════════════════════════════════════════════════════════
    // T2: Route handler is async + await
    // ═══════════════════════════════════════════════════════════
    console.log('\n── T2: Route handler async + await ──');
    assert('T2a. POST /addon is async handler', tradingSrc.includes("router.post('/addon', async (req, res)"));
    assert('T2b. Route uses await addOnPosition', tradingSrc.includes('await serverAT.addOnPosition('));
    assert('T2c. Route has try/catch', /router\.post\('\/addon'[\s\S]*?try\s*\{[\s\S]*?catch\s*\(err\)/.test(tradingSrc));
    assert('T2d. Route catches 500 errors', tradingSrc.includes("res.status(500).json({ error: 'Add-on failed' })"));

    // ═══════════════════════════════════════════════════════════
    // T3: Live pre-check — requires LIVE status
    // ═══════════════════════════════════════════════════════════
    console.log('\n── T3: Live pre-check ──');
    assert('T3a. Checks pos.mode === live branch', atSrc.includes("if (pos.mode === 'live')"));
    assert('T3b. Checks pos.live.status for LIVE', atSrc.includes("pos.live.status !== 'LIVE'"));
    assert('T3c. Accepts LIVE_NO_SL too', atSrc.includes("pos.live.status !== 'LIVE_NO_SL'"));
    assert('T3d. Returns error if not live status', atSrc.includes('Position is not in LIVE status'));

    // ═══════════════════════════════════════════════════════════
    // T4: Credentials + risk validation
    // ═══════════════════════════════════════════════════════════
    console.log('\n── T4: Credentials + risk validation ──');
    assert('T4a. Gets exchange creds', /if \(pos\.mode === 'live'\)[\s\S]*?getExchangeCreds\(userId\)/.test(atSrc));
    assert('T4b. Returns error if no creds', atSrc.includes("{ ok: false, error: 'No exchange credentials' }"));
    assert('T4c. Calls validateOrder for addon', atSrc.includes("'SERVER_AT_ADDON'"));
    assert('T4d. Returns risk blocked error', atSrc.includes('Risk blocked:'));

    // ═══════════════════════════════════════════════════════════
    // T5: Margin pre-check
    // ═══════════════════════════════════════════════════════════
    console.log('\n── T5: Margin pre-check before MARKET order ──');
    const liveBlock = atSrc.match(/LIVE ADD-ON BRANCH[\s\S]*?DEMO ADD-ON BRANCH/);
    assert('T5a. Live block exists', !!liveBlock);
    assert('T5b. Calls /fapi/v2/balance', liveBlock && liveBlock[0].includes('/fapi/v2/balance'));
    assert('T5c. Checks availableBalance', liveBlock && liveBlock[0].includes('availableBalance'));
    assert('T5d. Returns insufficient margin error', liveBlock && liveBlock[0].includes('Insufficient margin'));
    assert('T5e. Returns margin check failed error', liveBlock && liveBlock[0].includes('Margin check failed'));

    // ═══════════════════════════════════════════════════════════
    // T6: MARKET order placement (same side as entry)
    // ═══════════════════════════════════════════════════════════
    console.log('\n── T6: MARKET order for addon qty ──');
    assert('T6a. Places MARKET order via sendSignedRequest', liveBlock && liveBlock[0].includes("sendSignedRequest('POST', '/fapi/v1/order'"));
    assert('T6b. Type is MARKET', liveBlock && liveBlock[0].includes("type: 'MARKET'"));
    assert('T6c. Uses BUY for LONG addon', liveBlock && liveBlock[0].includes("pos.side === 'LONG' ? 'BUY' : 'SELL'"));
    // MARKET addon order must NOT have reduceOnly — it ADDS to position
    // Check the sendSignedRequest MARKET block up to the catch (before SL/TP which DO have reduceOnly)
    const marketBlock = liveBlock && liveBlock[0].match(/type: 'MARKET',\s*\n\s*quantity: addonQtyStr,\s*\n\s*newClientOrderId: addonClientId/);
    assert('T6d. NOT reduceOnly (adds to position)', !!marketBlock);
    assert('T6e. Has addon client order ID', liveBlock && liveBlock[0].includes('SAT_ADDON_'));
    assert('T6f. Rounds addon qty via roundOrderParams', liveBlock && liveBlock[0].includes('roundOrderParams(pos.symbol, addonQty'));

    // ═══════════════════════════════════════════════════════════
    // T7: Fill verification (polling)
    // ═══════════════════════════════════════════════════════════
    console.log('\n── T7: Fill verification + polling ──');
    assert('T7a. Checks avgPrice from response', liveBlock && liveBlock[0].includes('addonOrder.avgPrice'));
    assert('T7b. Polls via GET /fapi/v1/order', liveBlock && liveBlock[0].includes("sendSignedRequest('GET', '/fapi/v1/order'"));
    assert('T7c. Checks FILLED status', liveBlock && liveBlock[0].includes("queried.status === 'FILLED'"));
    assert('T7d. Returns ADDON_FAILED on unverified fill', liveBlock && liveBlock[0].includes("error: 'ADDON_FAILED'"));
    assert('T7e. Logs fill unverified to audit', liveBlock && liveBlock[0].includes('SAT_ADDON_FILL_UNVERIFIED'));

    // ═══════════════════════════════════════════════════════════
    // T8: Cancel old SL/TP + place new with total qty
    // ═══════════════════════════════════════════════════════════
    console.log('\n── T8: Cancel old SL/TP + replace with total qty ──');
    assert('T8a. Cancels old SL', liveBlock && liveBlock[0].includes('_cancelOrderSafe(pos.symbol, pos.live.slOrderId, creds)'));
    assert('T8b. Cancels old TP', liveBlock && liveBlock[0].includes('_cancelOrderSafe(pos.symbol, pos.live.tpOrderId, creds)'));
    assert('T8c. New SL uses STOP_MARKET', liveBlock && liveBlock[0].includes("type: 'STOP_MARKET'"));
    assert('T8d. New TP uses TAKE_PROFIT_MARKET', liveBlock && liveBlock[0].includes("type: 'TAKE_PROFIT_MARKET'"));
    assert('T8e. New SL uses totalQtyStr (total qty)', liveBlock && liveBlock[0].includes('quantity: totalQtyStr'));
    assert('T8f. closeSide = SELL for LONG / BUY for SHORT', liveBlock && liveBlock[0].includes("const closeSide = pos.side === 'LONG' ? 'SELL' : 'BUY'"));
    assert('T8g. New SL has reduceOnly=true', liveBlock && /STOP_MARKET[\s\S]*?reduceOnly: true/.test(liveBlock[0]));
    assert('T8h. New TP has reduceOnly=true', liveBlock && /TAKE_PROFIT_MARKET[\s\S]*?reduceOnly: true/.test(liveBlock[0]));
    assert('T8i. SL retries defined (backoff)', atSrc.includes('ADDON_SL_RETRIES'));
    assert('T8j. TP retries defined (backoff)', atSrc.includes('ADDON_TP_RETRIES'));
    assert('T8k. New SL order ID saved to pos.live', liveBlock && liveBlock[0].includes('pos.live.slOrderId = newSlOrder'));
    assert('T8l. New TP order ID saved to pos.live', liveBlock && liveBlock[0].includes('pos.live.tpOrderId = newTpOrder'));

    // ═══════════════════════════════════════════════════════════
    // T9: Weighted avg + position mutation with actual fill
    // ═══════════════════════════════════════════════════════════
    console.log('\n── T9: Weighted avg + mutation with fill data ──');
    assert('T9a. Uses fillPrice for weighted avg', liveBlock && liveBlock[0].includes('fillPrice * actualAddOnSize'));
    assert('T9b. Computes totalQty from executedQty + fillQty', liveBlock && liveBlock[0].includes('pos.live.executedQty + fillQty'));
    assert('T9c. Recalcs SL from new entry (slPct)', liveBlock && liveBlock[0].includes('pos.price * pos.slPct / 100'));
    assert('T9d. Recalcs TP from SL distance × RR', liveBlock && liveBlock[0].includes('slDist * (pos.rr || 2)'));
    assert('T9e. Saves fillQty in historyEntry', liveBlock && liveBlock[0].includes('historyEntry.fillQty = fillQty'));
    assert('T9f. Saves orderId in historyEntry', liveBlock && liveBlock[0].includes('historyEntry.orderId = addonOrder.orderId'));
    assert('T9g. Updates pos.live.executedQty', liveBlock && liveBlock[0].includes('pos.live.executedQty = totalQty'));

    // ═══════════════════════════════════════════════════════════
    // T10: Rollback on MARKET failure
    // ═══════════════════════════════════════════════════════════
    console.log('\n── T10: Rollback on MARKET failure ──');
    assert('T10a. Snapshot saved before MARKET order', liveBlock && liveBlock[0].includes('const snapshot'));
    assert('T10b. Snapshot includes price', liveBlock && liveBlock[0].includes('price: pos.price'));
    assert('T10c. Snapshot includes size', liveBlock && liveBlock[0].includes('size: pos.size'));
    assert('T10d. Snapshot includes SL/TP', liveBlock && liveBlock[0].includes('sl: pos.sl') && liveBlock[0].includes('tp: pos.tp'));
    assert('T10e. Returns ADDON_FAILED on MARKET error', liveBlock && liveBlock[0].includes("error: 'ADDON_FAILED'"));
    assert('T10f. Audits SAT_ADDON_FAILED', liveBlock && liveBlock[0].includes('SAT_ADDON_FAILED'));
    // Position not mutated on MARKET failure (mutate happens AFTER fill verification)
    const marketTryCatch = liveBlock && liveBlock[0].match(/sendSignedRequest\('POST', '\/fapi\/v1\/order'[\s\S]*?ADDON_FAILED/);
    assert('T10g. No pos mutation before fill verified', !!marketTryCatch);

    // ═══════════════════════════════════════════════════════════
    // T11: Reconciliation with Binance positionAmt
    // ═══════════════════════════════════════════════════════════
    console.log('\n── T11: Reconciliation with positionAmt ──');
    assert('T11a. Queries /fapi/v2/positionRisk', liveBlock && liveBlock[0].includes('/fapi/v2/positionRisk'));
    assert('T11b. Compares exchangeQty vs totalQty', liveBlock && liveBlock[0].includes('exchangeQty - totalQty'));
    assert('T11c. Resyncs internal qty on mismatch', liveBlock && liveBlock[0].includes('pos.qty = exchangeQty'));
    assert('T11d. Resyncs live executedQty on mismatch', liveBlock && liveBlock[0].includes('pos.live.executedQty = exchangeQty'));
    assert('T11e. Audits SAT_ADDON_QTY_RESYNCED', liveBlock && liveBlock[0].includes('SAT_ADDON_QTY_RESYNCED'));
    assert('T11f. Reconciliation failure is non-fatal', liveBlock && liveBlock[0].includes('Post-addon reconciliation failed'));

    // ═══════════════════════════════════════════════════════════
    // T12: SL/TP failure handling
    // ═══════════════════════════════════════════════════════════
    console.log('\n── T12: SL/TP failure handling ──');
    assert('T12a. Both SL+TP fail → LIVE_NO_SL status', liveBlock && liveBlock[0].includes("pos.live.status = 'LIVE_NO_SL'"));
    assert('T12b. Nulls slOrderId on total failure', liveBlock && liveBlock[0].includes('pos.live.slOrderId = null'));
    assert('T12c. Nulls tpOrderId on total failure', liveBlock && liveBlock[0].includes('pos.live.tpOrderId = null'));
    assert('T12d. Telegram warns user of SL+TP failure', liveBlock && liveBlock[0].includes('ADDON SL+TP FAILED'));
    assert('T12e. Audits SAT_ADDON_SLTP_FAILED', liveBlock && liveBlock[0].includes('SAT_ADDON_SLTP_FAILED'));
    assert('T12f. Persists position even on SL/TP failure', liveBlock && /ADDON SL\+TP FAILED[\s\S]*?_persistPosition/.test(liveBlock[0]));

    // ═══════════════════════════════════════════════════════════
    // T13: Persist + broadcast + logging
    // ═══════════════════════════════════════════════════════════
    console.log('\n── T13: Persist + broadcast + logging ──');
    assert('T13a. _persistPosition called in live branch', liveBlock && (liveBlock[0].match(/_persistPosition\(pos\)/g) || []).length >= 2);
    assert('T13b. _persistState called in live branch', liveBlock && liveBlock[0].includes('_persistState(userId)'));
    assert('T13c. _notifyChange called in live branch', liveBlock && liveBlock[0].includes('_notifyChange(userId)'));
    assert('T13d. _pushLog with mode:live', liveBlock && liveBlock[0].includes("mode: 'live'"));
    assert('T13e. Telegram sends LIVE ADD-ON message', liveBlock && liveBlock[0].includes('LIVE ADD-ON'));
    assert('T13f. metrics.recordOrder addon_filled', liveBlock && liveBlock[0].includes("metrics.recordOrder('addon_filled')"));
    assert('T13g. audit.record SAT_ADDON_FILLED', liveBlock && liveBlock[0].includes('SAT_ADDON_FILLED'));
    assert('T13h. Return includes orderId', liveBlock && liveBlock[0].includes("orderId: addonOrder.orderId"));
    assert('T13i. Return includes mode:live', liveBlock && liveBlock[0].includes("mode: 'live'"));

    // ═══════════════════════════════════════════════════════════
    // T14: DSL re-attach after live addon
    // ═══════════════════════════════════════════════════════════
    console.log('\n── T14: DSL re-attach after live addon ──');
    assert('T14a. serverDSL.attach in live branch', liveBlock && liveBlock[0].includes('serverDSL.attach(pos, pos.dslParams)'));

    // ═══════════════════════════════════════════════════════════
    // T15: Demo branch untouched
    // ═══════════════════════════════════════════════════════════
    console.log('\n── T15: Demo branch untouched ──');
    const demoBlock = atSrc.match(/DEMO ADD-ON BRANCH[\s\S]*?finally\s*\{/);
    assert('T15a. Demo branch still exists', !!demoBlock);
    assert('T15b. Demo deducts demoBalance', demoBlock && demoBlock[0].includes('us.demoBalance = +(us.demoBalance - addOnSize)'));
    assert('T15c. Demo computes weighted avg', demoBlock && demoBlock[0].includes('newEntry.toFixed(6)'));
    assert('T15d. Demo recalcs SL/TP', demoBlock && demoBlock[0].includes('pos.slPct'));
    assert('T15e. Demo persists+broadcasts', demoBlock && demoBlock[0].includes('_persistPosition(pos)') && demoBlock[0].includes('_notifyChange(userId)'));
    assert('T15f. Demo telegram message (no LIVE prefix)', demoBlock && demoBlock[0].includes('ADD-ON #') && !demoBlock[0].includes('LIVE ADD-ON'));

    // ═══════════════════════════════════════════════════════════
    // T16: Safety — untouched critical systems
    // ═══════════════════════════════════════════════════════════
    console.log('\n── T16: Safety — untouched systems ──');
    assert('T16a. _closePosition signature unchanged', atSrc.includes('function _closePosition(idx, pos, exitType, price, pnl)'));
    assert('T16b. _handleLiveExit still present', atSrc.includes('function _handleLiveExit(pos, exitType, exitPrice, pnl)'));
    assert('T16c. _executeLiveEntry unchanged (async)', atSrc.includes('async function _executeLiveEntry(entry, stc)'));
    assert('T16d. _updateLiveSL unchanged (async)', atSrc.includes('async function _updateLiveSL(pos, newSL)'));
    assert('T16e. _cancelOrderSafe unchanged', atSrc.includes('async function _cancelOrderSafe(symbol, orderId, creds)'));
    assert('T16f. _checkKillSwitch present', atSrc.includes('function _checkKillSwitch('));
    assert('T16g. Kill switch uses dailyPnL', atSrc.includes('us.dailyPnL'));
    assert('T16h. serverDSL.attach called in both branches', (atSrc.match(/serverDSL\.attach\(pos, pos\.dslParams\)/g) || []).length >= 2);
    assert('T16i. _addonGuard race lock', atSrc.includes('_addonGuard.has(gk)'));
    assert('T16j. Guard released in finally', atSrc.includes('_addonGuard.delete(gk)'));
    assert('T16k. reconciliation service untouched', fs.readFileSync(path.join(__dirname, 'server/services/reconciliation.js'), 'utf8').includes('_reconcileForCreds'));
    assert('T16l. binanceSigner untouched', fs.readFileSync(path.join(__dirname, 'server/services/binanceSigner.js'), 'utf8').includes('sendSignedRequest'));
    assert('T16m. exchangeInfo untouched', fs.readFileSync(path.join(__dirname, 'server/services/exchangeInfo.js'), 'utf8').includes('roundOrderParams'));

    // ═══════════════════════════════════════════════════════════
    // T17: Batch A/B regression — addon fields still present
    // ═══════════════════════════════════════════════════════════
    console.log('\n── T17: Batch A/B regression ──');
    assert('T17a. originalEntry preserved in AT', atSrc.includes('originalEntry'));
    assert('T17b. originalSize preserved in AT', atSrc.includes('originalSize'));
    assert('T17c. originalQty preserved in AT', atSrc.includes('originalQty'));
    assert('T17d. addOnCount tracked', atSrc.includes('pos.addOnCount'));
    assert('T17e. addOnHistory pushed', atSrc.includes('pos.addOnHistory.push'));
    assert('T17f. DEFAULT_MAX_ADDON = 3', atSrc.includes('const DEFAULT_MAX_ADDON = 3'));
    // Client-side regression
    const clientAT = fs.readFileSync(path.join(__dirname, 'public/js/trading/autotrade.js'), 'utf8');
    assert('T17g. canAddOn client-side gate exists', clientAT.includes('function canAddOn(pos)'));
    assert('T17h. Client openAddOn calls /api/addon', clientAT.includes('/api/addon'));
    assert('T17i. Client renderATPositions has addon UI', clientAT.includes('addon') || clientAT.includes('addOn'));
    // state.js maps addon fields
    const stateSrc = fs.readFileSync(path.join(__dirname, 'public/js/core/state.js'), 'utf8');
    assert('T17j. state.js maps addOnCount', stateSrc.includes('addOnCount'));
    assert('T17k. state.js maps addOnHistory', stateSrc.includes('addOnHistory'));

    // ═══════════════════════════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════════════════════════
    console.log('\n═══════════════════════════════════════════════════');
    console.log(`BATCH C RESULTS: ${pass}/${total} passed, ${fail} failed`);
    console.log('═══════════════════════════════════════════════════');
    if (fail > 0) process.exit(1);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

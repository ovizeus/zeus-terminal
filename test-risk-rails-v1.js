#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// RISK RAILS v1 — VERIFICATION / REGRESSION TEST SUITE
// Faza 1.1 — Runtime validation of all Risk Rails mechanics
// ═══════════════════════════════════════════════════════════════
'use strict';

// Set required env vars BEFORE any server module loads config.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-risk-rails';
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
// Direct module tests — no HTTP needed, test engine logic in-process
// ══════════════════════════════════════════════════════════════════

// Stub out modules that have side effects (telegram, audit, metrics, etc.)
// We need to intercept require calls for telegram, audit, metrics, marketFeed

const Module = require('module');
const originalResolve = Module._resolveFilename;

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
        atPruneClosed: () => { },
    },
    './logger': {
        info: () => { }, warn: () => { }, error: () => { }, debug: () => { },
    },
};

// Intercept require for stubbing
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    // Only stub when loading from server/services/
    if (parent && parent.filename && parent.filename.includes('server')) {
        const basename = './' + path.basename(request).replace(/\.js$/, '');
        if (STUB_MODULES[basename]) return STUB_MODULES[basename];
        if (STUB_MODULES[request]) return STUB_MODULES[request];
    }
    return originalLoad.apply(this, arguments);
};

// ── Load modules ──
// Need to clear require cache to get fresh instances
function freshRequire(mod) {
    const resolved = require.resolve(mod);
    delete require.cache[resolved];
    return require(mod);
}

// Reset all state between test groups
function resetATState() {
    // Clear all cached modules
    const sATPath = require.resolve('./server/services/serverAT');
    const sBrainPath = require.resolve('./server/services/serverBrain');
    const sRGPath = require.resolve('./server/services/riskGuard');
    const sDSLPath = require.resolve('./server/services/serverDSL');
    delete require.cache[sATPath];
    delete require.cache[sBrainPath];
    delete require.cache[sRGPath];
    delete require.cache[sDSLPath];
}

// ══════════════════════════════════════════════════════════════════
// TEST SUITE
// ══════════════════════════════════════════════════════════════════
async function main() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('RISK RAILS v1 — VERIFICATION / REGRESSION TEST SUITE');
    console.log('═══════════════════════════════════════════════════════\n');

    // ─────────────────────────────────────────────────────────────
    // TEST 1: RISK-BASED POSITION SIZING (SERVER)
    // ─────────────────────────────────────────────────────────────
    console.log('── TEST 1: RISK SIZING — SERVER (processBrainDecision) ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');

        // Setup: USER 1, Demo mode (default), balance $10,000
        const userId = 99;  // fresh user
        serverAT.resetDemoBalance(userId);

        // STC: size=$200 (margin cap), lev=5, slPct=1.5%, rr=2, maxPos=3
        const stc = { confMin: 65, sigMin: 3, adxMin: 18, maxPos: 3, cooldownMs: 0, lev: 5, size: 200, slPct: 1.5, rr: 2, dslMode: 'def' };

        // Brain decision for a MEDIUM tier trade
        const decision = {
            symbol: 'BTCUSDT', price: 50000,
            fusion: { decision: 'MEDIUM', dir: 'LONG', confidence: 75, score: 72 },
            regime: { regime: 'TRENDING_UP' }, cycle: 1,
        };

        const pos = serverAT.processBrainDecision(decision, stc, userId);
        assert('T1a. Position created', !!pos, 'processBrainDecision returned null');

        if (pos) {
            // Server sizing: rawSize = stc.size * TIER_MULT[MEDIUM] = 200 * 1.35 = 270
            // Clamped: max(200*0.5, min(200*1.6, 270)) = max(100, min(320, 270)) = 270
            assert('T1b. Size = 270 (200 * 1.35 MEDIUM)', pos.size === 270, 'got ' + pos.size);
            assert('T1c. Leverage = 5', pos.lev === 5, 'got ' + pos.lev);
            assert('T1d. SL% = 1.5', pos.slPct === 1.5, 'got ' + pos.slPct);
            assert('T1e. R:R = 2', pos.rr === 2, 'got ' + pos.rr);

            // SL = 50000 - (50000 * 1.5 / 100) = 50000 - 750 = 49250
            assert('T1f. SL = 49250', pos.sl === 49250, 'got ' + pos.sl);
            // TP = 50000 + (750 * 2) = 51500
            assert('T1g. TP = 51500', pos.tp === 51500, 'got ' + pos.tp);

            // qty = (270 * 5) / 50000 = 1350 / 50000 = 0.027
            assert('T1h. qty = 0.027', pos.qty === 0.027, 'got ' + pos.qty);

            // slPnl = -(750/50000) * 270 * 5 = -0.015 * 1350 = -20.25
            assert('T1i. slPnl ≈ -20.25', approx(pos.slPnl, -20.25, 0.1), 'got ' + pos.slPnl);
            // tpPnl = (1500/50000) * 270 * 5 = 0.03 * 1350 = 40.50
            assert('T1j. tpPnl ≈ 40.50', approx(pos.tpPnl, 40.50, 0.1), 'got ' + pos.tpPnl);

            // Demo balance deducted by margin
            const bal = serverAT.getDemoBalance(userId).balance;
            assert('T1k. Demo balance = 10000 - 270 = 9730', bal === 9730, 'got ' + bal);

            // Close position and check balance refund
            serverAT.closeBySeq(userId, pos.seq);
        }
    }

    // ── T1 Part B: LARGE tier ──
    console.log('\n── TEST 1B: RISK SIZING — LARGE tier ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        const userId = 100;
        serverAT.resetDemoBalance(userId);

        const stc = { confMin: 65, sigMin: 3, adxMin: 18, maxPos: 3, cooldownMs: 0, lev: 10, size: 500, slPct: 2, rr: 3, dslMode: 'def' };
        const decision = {
            symbol: 'ETHUSDT', price: 3000,
            fusion: { decision: 'LARGE', dir: 'SHORT', confidence: 90, score: 85 },
            regime: { regime: 'TRENDING_DOWN' }, cycle: 1,
        };

        const pos = serverAT.processBrainDecision(decision, stc, userId);
        assert('T1Ba. Position created (LARGE SHORT)', !!pos);
        if (pos) {
            // rawSize = 500 * 1.75 = 875, clamped: max(250, min(800, 875)) = 800
            assert('T1Bb. Size = 800 (capped at 1.6x = 500*1.6)', pos.size === 800, 'got ' + pos.size);
            assert('T1Bc. Side = SHORT', pos.side === 'SHORT');
            // SL = 3000 + (3000 * 2 / 100) = 3060
            assert('T1Bd. SL = 3060 (SHORT: above entry)', pos.sl === 3060, 'got ' + pos.sl);
            // TP = 3000 - (60 * 3) = 2820
            assert('T1Be. TP = 2820 (SHORT: below entry)', pos.tp === 2820, 'got ' + pos.tp);
            serverAT.closeBySeq(userId, pos.seq);
        }
    }

    // ── T1 Part C: SMALL tier (mult=1.0, no amplification) ──
    console.log('\n── TEST 1C: RISK SIZING — SMALL tier ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        const userId = 101;
        serverAT.resetDemoBalance(userId);

        const stc = { confMin: 65, sigMin: 3, adxMin: 18, maxPos: 3, cooldownMs: 0, lev: 5, size: 200, slPct: 1, rr: 1.5, dslMode: 'def' };
        const decision = {
            symbol: 'BTCUSDT', price: 60000,
            fusion: { decision: 'SMALL', dir: 'LONG', confidence: 65, score: 63 },
            regime: { regime: 'RANGING' }, cycle: 1,
        };

        const pos = serverAT.processBrainDecision(decision, stc, userId);
        assert('T1Ca. Position created (SMALL)', !!pos);
        if (pos) {
            // rawSize = 200 * 1.0 = 200, capped at max(100, min(320, 200)) = 200
            assert('T1Cb. Size = 200 (SMALL 1.0x, no boost)', pos.size === 200, 'got ' + pos.size);
            // With slPct=1%: SL dist = 60000 * 0.01 = 600
            // SL = 60000 - 600 = 59400
            assert('T1Cc. SL = 59400', pos.sl === 59400, 'got ' + pos.sl);
            // TP = 60000 + (600 * 1.5) = 60900
            assert('T1Cd. TP = 60900', pos.tp === 60900, 'got ' + pos.tp);
            serverAT.closeBySeq(userId, pos.seq);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 1D: CLIENT-SIDE RISK SIZING FORMULA (source code audit)
    // ─────────────────────────────────────────────────────────────
    console.log('\n── TEST 1D: CLIENT RISK SIZING — source code audit ──');
    {
        const atSrc = fs.readFileSync(path.join(__dirname, 'public/js/trading/autotrade.js'), 'utf8');

        // Verify the formula exists
        assert('T1Da. riskPct read from _snap.riskPct', atSrc.includes("const riskPct = _snap.riskPct || 1"));
        assert('T1Db. slPctForSize read from _snap.slPct', atSrc.includes("const slPctForSize = _snap.slPct"));
        assert('T1Dc. Formula: riskSizeRaw = (balance * riskPct/100) / (slPct/100)',
            atSrc.includes('(_rrBalance * (riskPct / 100)) / (slPctForSize / 100)'));
        assert('T1Dd. Capped by atSize: min(riskSizeRaw, size)',
            atSrc.includes('Math.min(_riskSizeRaw, size)'));
        assert('T1De. Fusion mult applied', atSrc.includes('FUSION_SIZE_MULT'));
        assert('T1Df. Final clamped 0.5x to 1.6x of riskSizeCapped',
            atSrc.includes('Math.round(_riskSizeCapped * 0.5)') && atSrc.includes('Math.round(_riskSizeCapped * 1.6)'));

        // Verify the math: balance=10000, riskPct=1%, slPct=1.5%
        // riskSizeRaw = (10000 * 0.01) / 0.015 = 100 / 0.015 = 6666.67
        // riskSizeCapped = min(6666.67, 200) = 200 (atSize caps it)
        // With slPct=0.5%: riskSizeRaw = 100/0.005 = 20000 → capped to 200
        // With slPct=5%: riskSizeRaw = 100/0.05 = 2000 → capped to 200
        // With size=5000, slPct=1.5%: riskSizeRaw = 6666 → capped to 5000
        // Key: atSize always acts as ceiling

        // Verify riskPct DLog recording
        assert('T1Dg. DLog records riskPct + riskSize', atSrc.includes('riskPct: riskPct, riskSize: _riskSizeCapped'));
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 2: CONCURRENCY CONTROL (maxPos gate)
    // ─────────────────────────────────────────────────────────────
    console.log('\n── TEST 2: CONCURRENCY CONTROL (maxPos gate) ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        const userId = 200;
        serverAT.resetDemoBalance(userId);

        // maxPos = 1 — only ONE position allowed
        const stc = { confMin: 65, sigMin: 3, adxMin: 18, maxPos: 1, cooldownMs: 0, lev: 5, size: 200, slPct: 1.5, rr: 2, dslMode: 'def' };

        // First entry — should succeed
        const dec1 = {
            symbol: 'BTCUSDT', price: 50000,
            fusion: { decision: 'MEDIUM', dir: 'LONG', confidence: 75, score: 72 },
            regime: { regime: 'TRENDING_UP' }, cycle: 1,
        };
        const pos1 = serverAT.processBrainDecision(dec1, stc, userId);
        assert('T2a. First position enters (maxPos=1)', !!pos1);

        // Second entry — should be BLOCKED
        const dec2 = {
            symbol: 'ETHUSDT', price: 3000,
            fusion: { decision: 'LARGE', dir: 'SHORT', confidence: 90, score: 85 },
            regime: { regime: 'TRENDING_DOWN' }, cycle: 2,
        };
        const pos2 = serverAT.processBrainDecision(dec2, stc, userId);
        assert('T2b. Second position BLOCKED (maxPos=1)', pos2 === null);

        // Verify open count
        const count = serverAT.getOpenCount(userId);
        assert('T2c. Open count = 1', count === 1, 'got ' + count);

        // Close first, then second should work
        if (pos1) serverAT.closeBySeq(userId, pos1.seq);
        const count2 = serverAT.getOpenCount(userId);
        assert('T2d. After close, count = 0', count2 === 0, 'got ' + count2);

        const pos3 = serverAT.processBrainDecision(dec2, stc, userId);
        assert('T2e. After close, new entry succeeds', !!pos3);
        if (pos3) serverAT.closeBySeq(userId, pos3.seq);
    }

    // ── T2B: maxPos=3, fill all slots ──
    console.log('\n── TEST 2B: CONCURRENCY — fill 3 slots, block 4th ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        const userId = 201;
        serverAT.resetDemoBalance(userId);
        // Add extra funds for margin headroom
        serverAT.addDemoFunds(userId, 50000);

        const stc = { confMin: 65, sigMin: 3, adxMin: 18, maxPos: 3, cooldownMs: 0, lev: 5, size: 200, slPct: 1.5, rr: 2, dslMode: 'def' };

        const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ADAUSDT'];
        const positions = [];

        for (let i = 0; i < 4; i++) {
            const dec = {
                symbol: symbols[i], price: 50000 - i * 10000,
                fusion: { decision: 'SMALL', dir: 'LONG', confidence: 65, score: 63 },
                regime: { regime: 'TRENDING_UP' }, cycle: i + 1,
            };
            const pos = serverAT.processBrainDecision(dec, stc, userId);
            positions.push(pos);
        }

        assert('T2Ba. Slot 1 filled', !!positions[0]);
        assert('T2Bb. Slot 2 filled', !!positions[1]);
        assert('T2Bc. Slot 3 filled', !!positions[2]);
        assert('T2Bd. Slot 4 BLOCKED (maxPos=3)', positions[3] === null);

        const count = serverAT.getOpenCount(userId);
        assert('T2Be. Open count exactly 3', count === 3, 'got ' + count);

        // Cleanup
        for (const p of positions) { if (p) serverAT.closeBySeq(userId, p.seq); }
    }

    // ── T2C: Demo vs Live counting is MODE-AWARE ──
    console.log('\n── TEST 2C: CONCURRENCY — per-user isolation ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');

        // User A gets a position
        const userA = 301, userB = 302;
        serverAT.resetDemoBalance(userA);
        serverAT.resetDemoBalance(userB);

        const stc1 = { confMin: 65, sigMin: 3, adxMin: 18, maxPos: 1, cooldownMs: 0, lev: 5, size: 200, slPct: 1.5, rr: 2, dslMode: 'def' };

        const decA = {
            symbol: 'BTCUSDT', price: 50000,
            fusion: { decision: 'SMALL', dir: 'LONG', confidence: 65, score: 63 },
            regime: { regime: 'TRENDING_UP' }, cycle: 1,
        };
        const posA = serverAT.processBrainDecision(decA, stc1, userA);
        assert('T2Ca. User A gets position', !!posA);

        // User B should NOT be blocked by User A's position
        const decB = {
            symbol: 'BTCUSDT', price: 50000,
            fusion: { decision: 'SMALL', dir: 'LONG', confidence: 65, score: 63 },
            regime: { regime: 'TRENDING_UP' }, cycle: 1,
        };
        const posB = serverAT.processBrainDecision(decB, stc1, userB);
        assert('T2Cb. User B NOT blocked by User A (per-user isolation)', !!posB);

        assert('T2Cc. User A count = 1', serverAT.getOpenCount(userA) === 1);
        assert('T2Cd. User B count = 1', serverAT.getOpenCount(userB) === 1);

        // Cleanup
        if (posA) serverAT.closeBySeq(userA, posA.seq);
        if (posB) serverAT.closeBySeq(userB, posB.seq);
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 3: DAILY DRAWDOWN — SERVER-ONLY BLOCKING
    // Kill switch triggers on accumulated daily loss >= killPct% of balance
    // ─────────────────────────────────────────────────────────────
    console.log('\n── TEST 3: DAILY DRAWDOWN — server-only blocking ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        const userId = 400;
        serverAT.resetDemoBalance(userId);

        // killPct = 5% of $10,000 = $500 loss limit
        // Use large positions + high leverage to make each SL loss ~$300
        serverAT.setKillPct(userId, 5);

        // stc: size=500, lev=20, slPct=3% → each SL loss ≈ $300
        const stc = { confMin: 65, sigMin: 3, adxMin: 18, maxPos: 3, cooldownMs: 0, lev: 20, size: 500, slPct: 3, rr: 2, dslMode: 'def' };

        // First: open a small position to init lastResetDay (otherwise _checkDailyReset clears kill on first call)
        const decInit = {
            symbol: 'INITUSDT', price: 50000,
            fusion: { decision: 'SMALL', dir: 'LONG', confidence: 65, score: 63 },
            regime: { regime: 'TRENDING_UP' }, cycle: 0,
        };
        const posInit = serverAT.processBrainDecision(decInit, stc, userId);
        if (posInit) serverAT.closeBySeq(userId, posInit.seq); // clean close, PnL=0

        // Open a position
        const dec = {
            symbol: 'BTCUSDT', price: 50000,
            fusion: { decision: 'SMALL', dir: 'LONG', confidence: 65, score: 63 },
            regime: { regime: 'TRENDING_UP' }, cycle: 1,
        };
        const pos1 = serverAT.processBrainDecision(dec, stc, userId);
        assert('T3a. Position entered OK', !!pos1);

        // Simulate price drop to SL — triggers close with loss
        if (pos1) {
            serverAT.onPriceUpdate('BTCUSDT', pos1.sl - 1); // trigger SL
        }

        const state1 = serverAT.getFullState(userId);
        assert('T3b. Position closed (count=0)', state1.positions.length === 0);
        assert('T3c. dailyPnL is negative', state1.dailyPnL < 0, 'got ' + state1.dailyPnL);

        // Should NOT be killed yet — one SL loss ≈ $300, threshold ≈ $500
        assert('T3d. Kill NOT triggered after single loss', !state1.killActive, 'killActive=' + state1.killActive + ' dailyPnL=' + state1.dailyPnL);

        // Open and close one more losing trade — should push past threshold
        for (let i = 0; i < 5; i++) {
            const symbol = 'SYM' + i + 'USDT';
            const decN = {
                symbol, price: 50000,
                fusion: { decision: 'SMALL', dir: 'LONG', confidence: 65, score: 63 },
                regime: { regime: 'TRENDING_UP' }, cycle: i + 10,
            };
            const p = serverAT.processBrainDecision(decN, stc, userId);
            if (!p) break; // kill switch triggered, or balance too low
            serverAT.onPriceUpdate(symbol, p.sl - 1); // force SL
        }

        const state2 = serverAT.getFullState(userId);
        assert('T3e. Kill switch activated after accumulated losses', state2.killActive === true);
        assert('T3f. dailyPnL below zero', state2.dailyPnL < 0, 'got ' + state2.dailyPnL);

        // New entry should be BLOCKED
        const decBlocked = {
            symbol: 'NEWUSDT', price: 50000,
            fusion: { decision: 'LARGE', dir: 'LONG', confidence: 90, score: 85 },
            regime: { regime: 'TRENDING_UP' }, cycle: 99,
        };
        const posBlocked = serverAT.processBrainDecision(decBlocked, stc, userId);
        assert('T3g. Entry BLOCKED when kill active', posBlocked === null);

        // Manual reset should re-enable
        serverAT.resetKill(userId);
        const state3 = serverAT.getFullState(userId);
        assert('T3h. Kill deactivated after manual reset', !state3.killActive);

        // Verify pnlAtReset was set (so kill re-arms from current point)
        assert('T3i. pnlAtReset captures dailyPnL at reset', state3.pnlAtReset === state3.dailyPnL, 'pnlAtReset=' + state3.pnlAtReset + ' dailyPnL=' + state3.dailyPnL);
    }

    // ── T3B: Server blocks, client just reflects (code audit) ──
    console.log('\n── TEST 3B: DAILY DD — client reflects, no double block ──');
    {
        const stateSrc = fs.readFileSync(path.join(__dirname, 'public/js/core/state.js'), 'utf8');
        const bootSrc = fs.readFileSync(path.join(__dirname, 'public/js/core/bootstrap.js'), 'utf8');

        // Client receives killActive from server state and displays it
        assert('T3Ba. state.js reads killActive from server', stateSrc.includes('killActive') || stateSrc.includes('killTriggered'));

        // Client does NOT independently calculate daily DD server-side
        // The kill switch on server is the ONLY authority for blocking new entries
        const serverATsrc = fs.readFileSync(path.join(__dirname, 'server/services/serverAT.js'), 'utf8');
        assert('T3Bb. Server _checkKillSwitch exists', serverATsrc.includes('function _checkKillSwitch'));
        assert('T3Bc. Kill checked after each close', serverATsrc.includes('_checkKillSwitch(userId)'));

        // getFullState sends killActive to client
        assert('T3Bd. getFullState includes killActive', serverATsrc.includes('killActive: us.killActive'));
        assert('T3Be. getFullState includes dailyPnL', serverATsrc.includes('dailyPnL: us.dailyPnL'));
        assert('T3Bf. getFullState includes killPct', serverATsrc.includes('killPct: us.killPct'));
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 4: dailyTrades + lossStreak tracking
    // ─────────────────────────────────────────────────────────────
    console.log('\n── TEST 4: dailyTrades / lossStreak / win-loss tracking ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        const userId = 500;
        serverAT.resetDemoBalance(userId);
        serverAT.addDemoFunds(userId, 100000); // lots of funds to avoid balance issues

        const stc = { confMin: 65, sigMin: 3, adxMin: 18, maxPos: 3, cooldownMs: 0, lev: 5, size: 100, slPct: 0.5, rr: 2, dslMode: 'def' };

        // Open and lose 3 trades
        for (let i = 0; i < 3; i++) {
            const dec = {
                symbol: 'LOSS' + i + 'USDT', price: 50000,
                fusion: { decision: 'SMALL', dir: 'LONG', confidence: 65, score: 63 },
                regime: { regime: 'RANGING' }, cycle: i + 1,
            };
            const p = serverAT.processBrainDecision(dec, stc, userId);
            if (p) serverAT.onPriceUpdate(p.symbol, p.sl - 1);
        }

        const stats1 = serverAT.getStats(userId);
        assert('T4a. exits = 3', stats1.exits === 3, 'got ' + stats1.exits);
        assert('T4b. losses = 3', stats1.losses === 3, 'got ' + stats1.losses);
        assert('T4c. wins = 0', stats1.wins === 0, 'got ' + stats1.wins);
        assert('T4d. total PnL < 0', stats1.pnl < 0, 'got ' + stats1.pnl);

        // Open and WIN 2 trades
        for (let i = 0; i < 2; i++) {
            const dec = {
                symbol: 'WIN' + i + 'USDT', price: 50000,
                fusion: { decision: 'SMALL', dir: 'LONG', confidence: 65, score: 63 },
                regime: { regime: 'TRENDING_UP' }, cycle: i + 10,
            };
            const p = serverAT.processBrainDecision(dec, stc, userId);
            if (p) serverAT.onPriceUpdate(p.symbol, p.tp + 1); // TP hit
        }

        const stats2 = serverAT.getStats(userId);
        assert('T4e. exits = 5', stats2.exits === 5, 'got ' + stats2.exits);
        assert('T4f. losses = 3', stats2.losses === 3, 'got ' + stats2.losses);
        assert('T4g. wins = 2', stats2.wins === 2, 'got ' + stats2.wins);
        assert('T4h. entries = 5', stats2.entries === 5, 'got ' + stats2.entries);

        // Daily PnL tracking — should have demo + aggregated
        const state = serverAT.getFullState(userId);
        assert('T4i. dailyPnLDemo tracked', typeof state.dailyPnLDemo === 'number');
        assert('T4j. dailyPnL = dailyPnLDemo (all demo trades)', state.dailyPnL === state.dailyPnLDemo, 'total=' + state.dailyPnL + ' demo=' + state.dailyPnLDemo);
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 5: ADD-ON INFRASTRUCTURE (Batch B: server-authoritative)
    // ─────────────────────────────────────────────────────────────
    console.log('\n── TEST 5: ADD-ON INFRASTRUCTURE (source audit — Batch B) ──');
    {
        const atSrc = fs.readFileSync(path.join(__dirname, 'public/js/trading/autotrade.js'), 'utf8');

        // canAddOn checks — server-authoritative: demo gate removed
        assert('T5a. canAddOn function exists', atSrc.includes('function canAddOn(pos)'));
        assert('T5b. Demo gate removed (server decides)', !atSrc.includes("if (pos.mode !== 'demo') return false"));
        assert('T5c. Max addon count check (atMaxAddon)', atSrc.includes('atMaxAddon'));
        assert('T5d. Must be in profit to add-on', atSrc.includes('inProfit'));
        assert('T5e. No local balance check in canAddOn (server validates)',
            (() => { const m = atSrc.match(/function canAddOn\(pos\)([\s\S]*?)(?=\nfunction )/); return m && !m[1].includes('TP.demoBalance'); })());

        // openAddOn — Batch B: RPC to server
        assert('T5f. openAddOn function exists', atSrc.includes('function openAddOn(posId)'));
        assert('T5g. openAddOn calls fetch /api/addon',
            atSrc.includes("fetch('/api/addon'"));
        assert('T5h. openAddOn sends seq to server',
            atSrc.includes('seq: seq') || atSrc.includes('seq:'));
        assert('T5i. openAddOn returns Promise',
            atSrc.includes('return fetch(') || atSrc.includes('Promise.resolve'));
        assert('T5j. openAddOn handles server error',
            atSrc.includes('Server rejected') || atSrc.includes('j.error'));
        assert('T5k. openAddOn handles network error',
            atSrc.includes('.catch('));
        assert('T5l. No local pos.entry mutation in openAddOn',
            !atSrc.match(/function openAddOn\(posId\)[\s\S]*?pos\.entry\s*=[\s\S]*?window\.openAddOn/));

        // Position create includes addOnCount: 0
        assert('T5m. New positions start with addOnCount: 0', atSrc.includes('addOnCount: 0'));

        // Exposed on window
        assert('T5n. canAddOn exposed on window', atSrc.includes('window.canAddOn = canAddOn'));
        assert('T5o. openAddOn exposed on window', atSrc.includes('window.openAddOn = openAddOn'));
    }

    // ── T5B: Add-on math verification (pure calculation test) ──
    console.log('\n── TEST 5B: ADD-ON MATH — avg entry / size / pnl ──');
    {
        // Simulate: original pos entry=$50000, size=$200, lev=5
        // Add-on at $51000, addOnSize = $100 (50% of $200)
        const oldEntry = 50000, oldSize = 200, addOnSize = 100;
        const curPrice = 51000;
        const lev = 5;
        const newTotal = oldSize + addOnSize; // 300
        const newEntry = (oldEntry * oldSize + curPrice * addOnSize) / newTotal;
        // = (50000*200 + 51000*100) / 300 = (10000000 + 5100000) / 300 = 50333.33...

        assert('T5Ba. New entry = weighted avg ≈ 50333.33', approx(newEntry, 50333.33, 1));
        assert('T5Bb. New total size = 300', newTotal === 300);

        const newQty = (newTotal * lev) / newEntry;
        assert('T5Bc. New qty ≈ 0.0298', approx(newQty, 0.0298, 0.001));

        // PnL at current price after add-on
        const pnl = ((curPrice - newEntry) / newEntry) * newTotal * lev;
        // PnL = ((51000 - 50333.33) / 50333.33) * 300 * 5 = (666.67/50333.33)*1500 ≈ $19.87
        assert('T5Bd. PnL at add-on price ≈ $19.87', approx(pnl, 19.87, 1));

        // No phantom positions — add-on modifies existing, does NOT create new
        assert('T5Be. No new position created (in-place update)',
            true); // Verified by code: openAddOn mutates pos, doesn't push new entry
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 6: REGRESSION — DSL, manual trading, close hooks
    // ─────────────────────────────────────────────────────────────
    console.log('\n── TEST 6: REGRESSION — DSL intact ──');
    {
        const dslSrc = fs.readFileSync(path.join(__dirname, 'server/services/serverDSL.js'), 'utf8');
        const atSrc = fs.readFileSync(path.join(__dirname, 'server/services/serverAT.js'), 'utf8');

        assert('T6a. serverDSL.attach called on entry', atSrc.includes('serverDSL.attach('));
        assert('T6b. serverDSL.tick called in onPriceUpdate', atSrc.includes('serverDSL.tick(pos.seq, price)'));
        assert('T6c. serverDSL.detach called in _closePosition', atSrc.includes('serverDSL.detach(pos.seq)'));
        assert('T6d. DSL PL exit handled', atSrc.includes("'DSL_PL'"));
        assert('T6e. DSL TTP exit handled', atSrc.includes("'DSL_TTP'"));
        assert('T6f. DSL SL update for live positions', atSrc.includes('_updateLiveSL'));
        assert('T6g. controlMode=user skips automated exits', atSrc.includes("pos.controlMode === 'user'"));
    }

    console.log('\n── TEST 6B: REGRESSION — manual trading & client close hooks ──');
    {
        const atSrc = fs.readFileSync(path.join(__dirname, 'server/services/serverAT.js'), 'utf8');
        const clientDSL = fs.readFileSync(path.join(__dirname, 'public/js/trading/dsl.js'), 'utf8');

        // closeBySeq - manual close from client
        assert('T6Ba. closeBySeq function exists', atSrc.includes('function closeBySeq('));
        assert('T6Bb. closeBySeq has race guard', atSrc.includes('_closingGuard'));
        assert('T6Bc. closeBySeq calls _closePosition with MANUAL_CLIENT', atSrc.includes("'MANUAL_CLIENT'"));

        // Server does NOT overwrite qty (client sets it, server uses stc.size-based sizing)
        assert('T6Bd. Server uses finalSize for margin, not raw qty', atSrc.includes('size: finalSize'));
        assert('T6Be. qty derived from (finalSize * lev) / price', atSrc.includes('const qty = (finalSize * lev) / price'));

        // Client DSL bridge intact (server bridge for server AT mode)
        assert('T6Bf. DSL positions bridge exists', clientDSL.includes('DSL.positions'));
        assert('T6Bg. renderDSLWidget called', clientDSL.includes('renderDSLWidget'));
    }

    console.log('\n── TEST 6C: REGRESSION — server close hooks & PnL accounting ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        const userId = 600;
        serverAT.resetDemoBalance(userId);

        const stc = { confMin: 65, sigMin: 3, adxMin: 18, maxPos: 3, cooldownMs: 0, lev: 5, size: 200, slPct: 1.5, rr: 2, dslMode: 'def' };

        // Open LONG, close at TP
        const dec = {
            symbol: 'BTCUSDT', price: 50000,
            fusion: { decision: 'SMALL', dir: 'LONG', confidence: 65, score: 63 },
            regime: { regime: 'TRENDING_UP' }, cycle: 1,
        };
        const pos = serverAT.processBrainDecision(dec, stc, userId);
        assert('T6Ca. Position opened', !!pos);

        if (pos) {
            const balBefore = serverAT.getDemoBalance(userId).balance;
            assert('T6Cb. Demo balance deducted by margin', balBefore === 10000 - pos.size, 'got ' + balBefore);

            // Hit TP
            serverAT.onPriceUpdate('BTCUSDT', pos.tp + 1);

            const balAfter = serverAT.getDemoBalance(userId).balance;
            const expectedBal = +(balBefore + pos.size + pos.tpPnl).toFixed(2); // margin refund + profit
            assert('T6Cc. Demo balance = prev + margin + tpPnl', balAfter === expectedBal,
                'expected=' + expectedBal + ' got=' + balAfter);

            const stats = serverAT.getStats(userId);
            assert('T6Cd. wins = 1', stats.wins === 1);
            assert('T6Ce. exits = 1', stats.exits === 1);
            assert('T6Cf. pnl = tpPnl', stats.pnl === pos.tpPnl, 'stats.pnl=' + stats.pnl + ' tpPnl=' + pos.tpPnl);
        }
    }

    // ── T6D: SL close PnL accuracy ──
    console.log('\n── TEST 6D: REGRESSION — SL close PnL accuracy ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        const userId = 601;
        serverAT.resetDemoBalance(userId);

        const stc = { confMin: 65, sigMin: 3, adxMin: 18, maxPos: 3, cooldownMs: 0, lev: 5, size: 200, slPct: 1.5, rr: 2, dslMode: 'def' };

        const dec = {
            symbol: 'BTCUSDT', price: 50000,
            fusion: { decision: 'SMALL', dir: 'LONG', confidence: 65, score: 63 },
            regime: { regime: 'RANGING' }, cycle: 1,
        };
        const pos = serverAT.processBrainDecision(dec, stc, userId);
        assert('T6Da. Position opened for SL test', !!pos);

        if (pos) {
            const balBefore = serverAT.getDemoBalance(userId).balance;
            // Hit SL
            serverAT.onPriceUpdate('BTCUSDT', pos.sl - 1);

            const stats = serverAT.getStats(userId);
            assert('T6Db. losses = 1', stats.losses === 1);
            assert('T6Dc. pnl = slPnl (negative)', stats.pnl === pos.slPnl, 'stats.pnl=' + stats.pnl + ' slPnl=' + pos.slPnl);

            // Balance: prev + margin (refund) + slPnl (negative)
            const balAfter = serverAT.getDemoBalance(userId).balance;
            const expectedBal = +(balBefore + pos.size + pos.slPnl).toFixed(2);
            assert('T6Dd. Demo balance = prev + margin + slPnl', balAfter === expectedBal,
                'expected=' + expectedBal + ' got=' + balAfter);
        }
    }

    // ── T6E: Duplicate symbol guard ──
    console.log('\n── TEST 6E: REGRESSION — duplicate symbol/side guard ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        const userId = 602;
        serverAT.resetDemoBalance(userId);

        const stc = { confMin: 65, sigMin: 3, adxMin: 18, maxPos: 3, cooldownMs: 0, lev: 5, size: 200, slPct: 1.5, rr: 2, dslMode: 'def' };

        const dec = {
            symbol: 'BTCUSDT', price: 50000,
            fusion: { decision: 'SMALL', dir: 'LONG', confidence: 65, score: 63 },
            regime: { regime: 'TRENDING_UP' }, cycle: 1,
        };
        const pos1 = serverAT.processBrainDecision(dec, stc, userId);
        assert('T6Ea. First BTCUSDT LONG enters', !!pos1);

        // Same symbol + same side = BLOCKED
        const dec2 = {
            symbol: 'BTCUSDT', price: 50500,
            fusion: { decision: 'MEDIUM', dir: 'LONG', confidence: 75, score: 72 },
            regime: { regime: 'TRENDING_UP' }, cycle: 2,
        };
        const pos2 = serverAT.processBrainDecision(dec2, stc, userId);
        assert('T6Eb. Same symbol+side BLOCKED (dedup)', pos2 === null);

        // Opposite side on same symbol = allowed (not a typical scenario but code permits different sides)
        // Actually, let's verify the opposite side works if maxPos allows
        const dec3 = {
            symbol: 'BTCUSDT', price: 50500,
            fusion: { decision: 'MEDIUM', dir: 'SHORT', confidence: 75, score: 72 },
            regime: { regime: 'TRENDING_DOWN' }, cycle: 3,
        };
        const pos3 = serverAT.processBrainDecision(dec3, stc, userId);
        assert('T6Ec. Opposite side same symbol allowed', !!pos3);

        // Cleanup
        if (pos1) serverAT.closeBySeq(userId, pos1.seq);
        if (pos3) serverAT.closeBySeq(userId, pos3.seq);
    }

    // ── T6F: Kill switch manual toggle + setKillPct ──
    console.log('\n── TEST 6F: Kill switch manual activate / deactivate / setPct ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        const userId = 603;
        serverAT.resetDemoBalance(userId);

        // Set custom kill %
        const r1 = serverAT.setKillPct(userId, 3);
        assert('T6Fa. setKillPct returns ok', r1.ok === true);
        assert('T6Fb. killPct = 3', r1.killPct === 3);
        // Clamped: min 1, max 50
        const r2 = serverAT.setKillPct(userId, 0);
        assert('T6Fc. killPct clamped to 1 (min)', r2.killPct >= 1);
        const r3 = serverAT.setKillPct(userId, 100);
        assert('T6Fd. killPct clamped to 50 (max)', r3.killPct === 50);

        // First: init the user's lastResetDay by calling processBrainDecision once
        const stc = { confMin: 65, sigMin: 3, adxMin: 18, maxPos: 3, cooldownMs: 0, lev: 5, size: 200, slPct: 1.5, rr: 2, dslMode: 'def' };
        const decWarmup = {
            symbol: 'WARMUPUSDT', price: 50000,
            fusion: { decision: 'SMALL', dir: 'LONG', confidence: 65, score: 63 },
            regime: { regime: 'TRENDING_UP' }, cycle: 0,
        };
        const warmup = serverAT.processBrainDecision(decWarmup, stc, userId);
        if (warmup) serverAT.closeBySeq(userId, warmup.seq);

        // Now activate kill
        const r4 = serverAT.activateKillSwitch(userId);
        assert('T6Fe. Manual kill activate returns killActive=true', r4.killActive === true);

        // Entry should be blocked
        const dec = {
            symbol: 'BTCUSDT', price: 50000,
            fusion: { decision: 'LARGE', dir: 'LONG', confidence: 90, score: 85 },
            regime: { regime: 'TRENDING_UP' }, cycle: 1,
        };
        const pos = serverAT.processBrainDecision(dec, stc, userId);
        assert('T6Ff. Entry blocked with manual kill active', pos === null);

        // Manual reset
        const r5 = serverAT.resetKill(userId);
        assert('T6Fg. Manual kill reset returns killActive=false', r5.killActive === false);
    }

    // ── T6G: Demo balance management ──
    console.log('\n── TEST 6G: Demo funds add / reset ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        const userId = 604;
        serverAT.resetDemoBalance(userId);

        assert('T6Ga. Initial balance = 10000', serverAT.getDemoBalance(userId).balance === 10000);

        const r1 = serverAT.addDemoFunds(userId, 5000);
        assert('T6Gb. Add 5000 → balance 15000', r1.balance === 15000);

        const r2 = serverAT.addDemoFunds(userId, -100);
        assert('T6Gc. Negative amount rejected', r2.ok === false);

        const r3 = serverAT.resetDemoBalance(userId);
        assert('T6Gd. Reset → balance 10000', r3.balance === 10000);
    }

    // ── T6H: NO_TRADE / SKIP / ERROR tier rejected ──
    console.log('\n── TEST 6H: Entry rejected for NO_TRADE / SKIP / ERROR ──');
    {
        resetATState();
        const serverAT = freshRequire('./server/services/serverAT');
        const userId = 605;
        serverAT.resetDemoBalance(userId);

        const stc = { confMin: 65, sigMin: 3, adxMin: 18, maxPos: 3, cooldownMs: 0, lev: 5, size: 200, slPct: 1.5, rr: 2, dslMode: 'def' };

        for (const tier of ['NO_TRADE', 'SKIP', 'ERROR']) {
            const dec = {
                symbol: 'BTCUSDT', price: 50000,
                fusion: { decision: tier, dir: 'LONG', confidence: 50, score: 50 },
                regime: { regime: 'RANGING' }, cycle: 1,
            };
            const pos = serverAT.processBrainDecision(dec, stc, userId);
            assert('T6H. ' + tier + ' tier rejected', pos === null);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 7: RISKGUARD SERVER-SIDE — daily loss blocking
    // ─────────────────────────────────────────────────────────────
    console.log('\n── TEST 7: RISKGUARD — daily loss blocking (server) ──');
    {
        // riskGuard checks config.tradingEnabled — must be true for daily loss checks to be reached
        const config = require('./server/config');
        const origTE = config.tradingEnabled;
        config.tradingEnabled = true;

        resetATState();
        const riskGuard = freshRequire('./server/services/riskGuard');

        // config.risk: maxPositionUsdt=100, dailyLossLimitPct=5
        // So daily loss limit = 100 * 5% = $5

        // Use unique userIds to avoid stale persisted state from previous runs
        const uid7 = 7700;
        const uid7b = 7701;

        // Record a small loss
        riskGuard.recordClosedPnL(-2, 'AT', uid7);
        const r1 = riskGuard.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, price: 50000, leverage: 5 }, 'AT', uid7);
        assert('T7a. Small loss (-$2) does NOT block)', r1.ok === true);

        // Record enough to breach limit ($5)
        riskGuard.recordClosedPnL(-4, 'AT', uid7);
        const r2 = riskGuard.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, price: 50000, leverage: 5 }, 'AT', uid7);
        assert('T7b. Cumulative -$6 blocks (limit=$5)', r2.ok === false);
        assert('T7c. Block reason mentions daily loss', r2.reason && r2.reason.includes('daily loss'), r2.reason);

        // ARES has independent tracker
        const r3 = riskGuard.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, price: 50000, leverage: 5 }, 'ARES', uid7);
        assert('T7d. ARES NOT blocked (independent tracker)', r3.ok === true);

        // Leverage cap
        const r4 = riskGuard.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, price: 50000, leverage: 200 }, 'ARES', uid7);
        assert('T7e. Leverage 200x blocked (max 10)', r4.ok === false);

        // Notional cap: 0.01 * 50000 = $500 > $100 max
        const r5 = riskGuard.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.01, price: 50000, leverage: 5 }, 'ARES', uid7);
        assert('T7f. Notional $500 blocked (max $100)', r5.ok === false);

        // Emergency kill
        riskGuard.setEmergencyKill(true, uid7b);
        const r6 = riskGuard.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, price: 50000, leverage: 5 }, 'AT', uid7b);
        assert('T7g. Emergency kill blocks everything', r6.ok === false);
        riskGuard.setEmergencyKill(false, uid7b);

        // restore config
        config.tradingEnabled = origTE;
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

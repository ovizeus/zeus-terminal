'use strict';

// [Day 33 #3] TA-only first — wire serverState indicators (RSI/MACD/ADX/regime)
// la chat: new intent `_replyIndicators` + symbolDeep enriched.

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-ta-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';
process.env.MARKET_RADAR_ENABLED = '0';
delete process.env.GROQ_API_KEY;

const responder = require('../../../server/services/ml/_voice/chatResponder');
const marketRadar = require('../../../server/services/marketRadar');
const serverState = require('../../../server/services/serverState');

// Stub serverState — chatResponder accesses indicators via require('../../serverState')
// We monkey-patch getSnapshotForSymbol for deterministic test data.
const ORIGINAL_FN = serverState.getSnapshotForSymbol;
function stubSnapshot(sym, data) {
    serverState.getSnapshotForSymbol = (s) => {
        if (s && s.toUpperCase() === sym) return data;
        return null;
    };
}
function restoreSnapshot() {
    serverState.getSnapshotForSymbol = ORIGINAL_FN;
}

beforeEach(() => {
    marketRadar._ingestSnapshotForTest([
        { symbol: 'BTCUSDT', price: 70000, priceChangePercent24h: 2.5, quoteVolume: 5e9 },
    ]);
});

afterEach(() => {
    marketRadar._resetSnapshotForTest();
    restoreSnapshot();
    responder._resetConvoForTest();
});

describe('chatResponder TA / indicators intent', () => {
    test('EN "RSI on BTC" surfaces real RSI value', async () => {
        stubSnapshot('BTCUSDT', {
            symbol: 'BTCUSDT', price: 70000,
            rsi: { '5m': 67.3, '15m': 62.1, '1h': 58.4 },
            adx: 28, atr: 450,
            indicators: { macdDir: 'BULL', macdHist: 120, stDir: 'BULL' },
            mtfIndicators: { '4h': { stDir: 'BULL', macdDir: 'BULL', rsi: 60 } },
        });
        const r = await responder.respond({ userId: 1, text: 'cum stă RSI pe BTC' });
        expect(r.reply).toMatch(/RSI/i);
        expect(r.reply).toMatch(/67|62|58/);
    });

    test('RO "indicatori BTC" returns indicator block', async () => {
        stubSnapshot('BTCUSDT', {
            symbol: 'BTCUSDT', price: 70000,
            rsi: { '5m': 67.3 },
            adx: 28, atr: 450,
            indicators: { macdDir: 'BULL', macdHist: 120, stDir: 'BULL' },
            mtfIndicators: {},
        });
        const r = await responder.respond({ userId: 1, text: 'arată-mi indicatorii pe btc' });
        expect(r.reply).toMatch(/RSI|MACD|ADX/i);
    });

    test('EN "MACD on ETH" routes to indicators intent', async () => {
        stubSnapshot('ETHUSDT', {
            symbol: 'ETHUSDT', price: 3800,
            rsi: { '5m': 45 }, adx: 18, atr: 80,
            indicators: { macdDir: 'BEAR', macdHist: -50, stDir: 'BEAR' },
            mtfIndicators: {},
        });
        const r = await responder.respond({ userId: 1, text: 'MACD on ETH' });
        expect(r.reply).toMatch(/MACD/i);
        expect(r.reply).toMatch(/BEAR|BULL/i);
    });

    test('indicators intent when no symbol snapshot returns warming msg', async () => {
        // No stub → returns null → graceful fallback
        const r = await responder.respond({ userId: 1, text: 'RSI on XYZ' });
        // Should mention no data OR fall through to help — but NOT crash
        expect(r.reply).toBeDefined();
        expect(typeof r.reply).toBe('string');
    });

    test('LLM context symbolDeep includes indicators when present', () => {
        stubSnapshot('BTCUSDT', {
            symbol: 'BTCUSDT', price: 70000,
            rsi: { '5m': 67.3, '1h': 58.4 },
            adx: 28, atr: 450,
            indicators: { macdDir: 'BULL', macdHist: 120, stDir: 'BULL' },
            mtfIndicators: { '4h': { stDir: 'BULL', macdDir: 'BULL', rsi: 60 } },
        });
        const ctx = responder._buildLLMContextForTest({ userId: 1, text: 'cum vezi BTC long sau short' });
        expect(ctx.symbolDeep).toBeDefined();
        expect(ctx.symbolDeep.indicators).toBeDefined();
        // At least one of these fields populated
        const ind = ctx.symbolDeep.indicators;
        expect(ind.rsi || ind.macdDir || ind.adx).toBeDefined();
    });

    test('symbolDeep indicators=null when serverState has no snapshot', () => {
        // No stub — serverState returns null
        const ctx = responder._buildLLMContextForTest({ userId: 1, text: 'cum vezi BTC' });
        expect(ctx.symbolDeep).toBeDefined();
        // indicators field present but null (graceful)
        expect(ctx.symbolDeep.indicators === null || ctx.symbolDeep.indicators === undefined).toBe(true);
    });
});

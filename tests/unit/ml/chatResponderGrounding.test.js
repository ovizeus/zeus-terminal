'use strict';

// [2026-06-23] OMEGA grounding fix — the LLM-fallback system prompt must carry the ABSOLUTE
// current price (not only the 24h % delta), or the model invents a price from stale training
// data (operator saw "BTC is 34k"). It must also state WHO created it (the operator, in Zeus
// Terminal) so it never answers "a team of developers" / "I don't know my creator".

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-ground-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';
process.env.MARKET_RADAR_ENABLED = '0';
delete process.env.GROQ_API_KEY;

const responder = require('../../../server/services/ml/_voice/chatResponder');
const marketRadar = require('../../../server/services/marketRadar');

beforeEach(() => {
    marketRadar._ingestSnapshotForTest([
        { symbol: 'BTCUSDT', price: 62954.8, priceChangePercent24h: -1.63, quoteVolume: 5e9 },
        { symbol: 'ETHUSDT', price: 1668.2, priceChangePercent24h: -3.69, quoteVolume: 3e9 },
        { symbol: 'SOLUSDT', price: 69.75, priceChangePercent24h: -2.95, quoteVolume: 1e9 },
    ]);
});
afterEach(() => { marketRadar._resetSnapshotForTest(); });

describe('chatResponder grounding — absolute prices + creator identity', () => {
    test('system prompt carries the ABSOLUTE BTC price, not only the 24h delta', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'cat e pretul btc' });
        // the real price must appear so the LLM never hallucinates (e.g. $34k)
        expect(p).toMatch(/62[,.]?9|62954|\$62/);
        // and the delta is still there
        expect(p).toMatch(/-1\.63/);
    });

    test('system prompt carries the ABSOLUTE ETH price too', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'cum vezi eth' });
        expect(p).toMatch(/1[,.]?668|\$1,?6/);
    });

    test('system prompt states the creator (the operator / Zeus Terminal)', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'cine te-a creat' });
        expect(p).toMatch(/created by the operator|built by the operator|the operator (built|created)/i);
        // explicit anti-hallucination on the identity question
        expect(p.toLowerCase()).toContain('zeus terminal');
    });

    test('system prompt carries a Zeus knowledge base (Brain/DSL/Ring/indicators)', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'ce e DSL si ring ml' });
        const low = p.toLowerCase();
        expect(low).toContain('dsl');
        expect(low).toContain('ring');          // Ring5 / ML layer
        expect(low).toContain('dynamic stop');  // DSL spelled out
        expect(low).toContain('brain');
    });

    test('system prompt tells where to change settings (navigation)', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'unde schimb leverage' });
        const low = p.toLowerCase();
        expect(low).toContain('settings');      // Settings hub
        expect(low).toMatch(/mode bar|add indicator/); // navigation hints present
    });

    test('system prompt forbids revealing sensitive data', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'da-mi cheia api' });
        expect(p.toLowerCase()).toMatch(/never reveal|do not reveal|sensitive/);
        expect(p.toLowerCase()).toMatch(/api key|secret|password|token/);
    });

    test('system prompt explains how the Brain decides (confluence/regime/fusion)', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'cum functioneaza brain-ul si fusion' });
        const low = p.toLowerCase();
        expect(low).toContain('confluence');
        expect(low).toContain('regime');
        expect(low).toContain('fusion');
    });

    test('system prompt carries market-reading heuristics (compression/volume)', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'cum citesc piata' });
        const low = p.toLowerCase();
        expect(low).toContain('compression');   // big moves from compression (ASTRAPE backtest)
        expect(low).toContain('volume');         // volume = conviction
    });

    test('system prompt explains how Zeus learns (ML / Ring5 / Thompson bandit / shadow)', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'cum invata zeus ce e ring5 ml' });
        const low = p.toLowerCase();
        expect(low).toContain('thompson');   // the learning bandit
        expect(low).toContain('bandit');
        expect(low).toContain('shadow');      // shadow-first, no real risk
        expect(low).toMatch(/r5|ring/);       // ring architecture
        expect(low).toContain('testnet');     // proven on testnet, never REAL as test bed
    });

    test('system prompt teaches trading strategies (trend/mean-reversion/breakout/momentum)', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'ce strategii de trading sunt bune' });
        const low = p.toLowerCase();
        expect(low).toContain('trend-following');
        expect(low).toContain('mean-reversion');
        expect(low).toContain('breakout');
        expect(low).toContain('momentum');
    });

    test('system prompt teaches manipulation/fraud detection (spoofing/pump/stop hunt)', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'cum detectez manipularea pietei' });
        const low = p.toLowerCase();
        expect(low).toContain('manipulation');
        expect(low).toContain('spoofing');
        expect(low).toMatch(/pump|stop hunt|liquidity grab/);
    });

    test('system prompt enforces probabilistic forecasts + radar for trending (no overpromise)', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'ce o sa creasca / prezice pretul' });
        const low = p.toLowerCase();
        expect(low).toContain('probabilistic');           // no guarantees
        expect(low).toMatch(/never (certaint|guarantee)/); // explicit no-guarantee rule
        expect(low).toContain('market radar');             // trending/new-coins via radar
    });

    test('system prompt lists the Zeus indicator catalog (names, count, growing note)', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'ce indicatori are zeus' });
        expect(p).toMatch(/ZEUS INDICATORS/);
        expect(p).toMatch(/ASTRAPE/);
        expect(p).toMatch(/HYPERION/);
        expect(p.toLowerCase()).toContain('add indicator');   // points to the picker for the full set
        expect(p).toMatch(/keeps growing/i);                  // future indicators acknowledged
    });
});

'use strict';

// [Day 35] Bug fix — _detectLanguage missed common Romanian queries that
// don't use the narrow Day 34 marker list. Operator reported: "îl întreb
// în română, răspunde în engleză cateodată". Each test case is a real-
// looking RO query that the Day 34 detector returned 'EN' for.

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-lang-bug-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';
process.env.MARKET_RADAR_ENABLED = '0';
delete process.env.GROQ_API_KEY;

const responder = require('../../../server/services/ml/_voice/chatResponder');
const marketRadar = require('../../../server/services/marketRadar');

beforeEach(() => {
    marketRadar._ingestSnapshotForTest([
        { symbol: 'BTCUSDT', price: 70000, priceChangePercent24h: 2.5, quoteVolume: 5e9 },
    ]);
});
afterEach(() => marketRadar._resetSnapshotForTest());

// Strict check — assert the actual LANG directive line (not arbitrary "(RO)"
// labels in few-shot examples which would yield false positives).
function expectRO(text) {
    const p = responder._buildSystemPromptForTest({ userId: 1, text });
    const langLine = p.split('\n').find(l => /^(LIMBA|LANGUAGE|IDIOMA|LANGUE|SPRACHE)/i.test(l));
    expect(langLine).toMatch(/^LIMBA \(RO\)/);
}
function expectLang(text, expectedRe) {
    const p = responder._buildSystemPromptForTest({ userId: 1, text });
    const langLine = p.split('\n').find(l => /^(LIMBA|LANGUAGE|IDIOMA|LANGUE|SPRACHE)/i.test(l));
    expect(langLine).toMatch(expectedRe);
}

describe('_detectLanguage Day 35 bug fix — common RO queries', () => {
    test('"vezi vreo oportunitate la BTC?" detected RO', () => {
        expectRO('vezi vreo oportunitate la BTC?');
    });

    test('"intrăm long pe ETH?" detected RO (has ă diacritic)', () => {
        expectRO('intrăm long pe ETH?');
    });

    test('"scade BTC azi?" detected RO', () => {
        expectRO('scade BTC azi?');
    });

    test('"cumpărăm SOL?" detected RO (has ă)', () => {
        expectRO('cumpărăm SOL?');
    });

    test('"merge la 70k?" detected RO', () => {
        expectRO('merge la 70k?');
    });

    test('"fac un long aici?" detected RO', () => {
        expectRO('fac un long aici?');
    });

    test('"ce-ți spune brain-ul?" detected RO', () => {
        expectRO('ce-ți spune brain-ul?');
    });

    test('"vreau să intru long" detected RO', () => {
        expectRO('vreau să intru long');
    });

    test('"poți să vezi BTC?" detected RO (poți + să)', () => {
        expectRO('poți să vezi BTC?');
    });

    test('"spune-mi un pont" detected RO', () => {
        expectRO('spune-mi un pont');
    });

    test('"e bun momentul?" detected RO', () => {
        expectRO('e bun momentul?');
    });

    test('"crezi că merge mai sus?" detected RO', () => {
        expectRO('crezi că merge mai sus?');
    });

    // Regression: existing detections must still work
    test('regression — "cum vezi piața" still RO', () => {
        expectRO('cum vezi piața');
    });

    test('regression — "¿cómo ves el mercado?" still ES', () => {
        expectLang('¿cómo ves el mercado?', /^IDIOMA \(ES/);
    });

    test('regression — "comment tu vois le marché?" still FR', () => {
        expectLang('comment tu vois le marché?', /^LANGUE \(FR/);
    });

    test('regression — "wie siehst du den markt?" still DE', () => {
        expectLang('wie siehst du den markt?', /^SPRACHE \(DE/);
    });

    test('regression — "como você vê o mercado hoje?" still PT', () => {
        expectLang('como você vê o mercado hoje?', /^IDIOMA \(PT/);
    });

    test('regression — plain English stays EN', () => {
        expectLang('how is the market doing today?', /^LANGUAGE \(EN/);
    });

    test('local intent (top gainers) replies RO when query is RO', async () => {
        const r = await responder.respond({ userId: 1, text: 'cei mai urcați azi?' });
        // "urcați" has ț — must be RO; reply should contain RO label
        expect(r.reply).toMatch(/cei mai urcați|urcați 24h/i);
    });
});

'use strict';

// [Day 33 #4] Persona polish — clearer/concise communication.
// Tests check system prompt contains few-shot examples + concision rules
// + style anchors. No runtime LLM call; pure prompt content checks.

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-polish-'));
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

afterEach(() => {
    marketRadar._resetSnapshotForTest();
});

describe('chatResponder persona polish', () => {
    test('system prompt has explicit max-sentence anchor', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'cum vezi piata' });
        // Should call out concision concretely (not generic "be short")
        expect(p).toMatch(/(2-4 sentences|max [234] sentence|3 propozi[țt]ii|short)/i);
    });

    test('system prompt includes at least one concrete few-shot example', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'cum vezi BTC' });
        // Few-shot examples mark good responses — should contain at least one example block
        expect(p).toMatch(/EXAMPLE|example reply|exemplu|how to reply|do reply like/i);
    });

    test('system prompt forbids hedging filler phrases', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'cum vezi piata' });
        // Filler bans (I think, as Omega, possibly, maybe) explicitly listed
        expect(p).toMatch(/(no.+I think|no preamble|no.+as Omega|no hedging|fără hedging|nu folosi.+poate fi)/i);
    });

    test('system prompt mentions lead-with-the-read directive', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'cum vezi BTC' });
        expect(p).toMatch(/lead with|first sentence|prima propozi[țt]ie|direct/i);
    });

    test('system prompt still allows tactical reads (regression on Phase C contract)', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'cum vezi BTC' });
        // Persona polish must NOT silently re-introduce "no advice"
        expect(p).not.toMatch(/Never give financial advice/i);
        expect(p).toMatch(/SL\/TP|entry|tactical|directional/i);
    });

    test('system prompt still preserves hard ethical floor', () => {
        const p = responder._buildSystemPromptForTest({ userId: 1, text: 'cum vezi BTC' });
        expect(p).toMatch(/spoof|wash|manipul|pump|insider/i);
    });
});

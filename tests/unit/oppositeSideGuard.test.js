'use strict';

// Same-mode opposite-side hard block — operator-reported brain opening
// LONG + SHORT same symbol same mode = directional incoherence. Block at
// processBrainDecision before _executeLiveEntry. Cross-mode opposite
// allowed per Wave 8 reversal (demo+live independent sandboxes).

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'opp-guard-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');

const { db } = require('../../server/services/database');
const serverAT = require('../../server/services/serverAT');
const exchangeInfo = require('../../server/services/exchangeInfo');

// Inject filters for symbols the test exercises (BTCUSDT, ETHUSDT)
exchangeInfo._setFiltersForTest('BTCUSDT', { stepSize: '0.001', tickSize: '0.10', minNotional: 5 });
exchangeInfo._setFiltersForTest('ETHUSDT', { stepSize: '0.01', tickSize: '0.01', minNotional: 5 });

function seedUser(uid) {
    try {
        db.prepare(`INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)`)
          .run(uid, `u${uid}@test.local`, 'x');
    } catch (_) {}
}

function _decision(symbol, dir) {
    // processBrainDecision expects fusion.dir = 'LONG' | 'SHORT' (NOT bull/bear)
    return {
        symbol, priceTs: Date.now(), price: 1000,
        fusion: { decision: 'MEDIUM', dir, confidence: 70, score: 5 },
        regime: { regime: 'TREND' },
    };
}

const STC = { size: 100, lev: 10, slPct: 1, rr: 2, maxPos: 10, cooldownMs: 0 };

beforeEach(() => {
    seedUser(1);
    serverAT.reset(1);
    // Activate AT for demo mode so processBrainDecision doesn't short-circuit
    // on _isATActiveForMode check.
    serverAT.toggleActive(1, true, 'demo');
});

describe('processBrainDecision — opposite-side same-mode guard', () => {
    test('SHORT entry blocked when LONG exists same mode (DEMO)', () => {
        // Open existing LONG on demo
        const long1 = serverAT.processBrainDecision(_decision('BTCUSDT', 'LONG'), STC, 1, STC.size);
        expect(long1).not.toBeNull();
        expect(long1.side).toBe('LONG');
        // Brain now tries SHORT same symbol same mode
        const short1 = serverAT.processBrainDecision(_decision('BTCUSDT', 'SHORT'), STC, 1, STC.size);
        expect(short1).toBeNull();
    });

    test('LONG entry blocked when SHORT exists same mode (DEMO)', () => {
        const short1 = serverAT.processBrainDecision(_decision('BTCUSDT', 'SHORT'), STC, 1, STC.size);
        expect(short1).not.toBeNull();
        const long1 = serverAT.processBrainDecision(_decision('BTCUSDT', 'LONG'), STC, 1, STC.size);
        expect(long1).toBeNull();
    });

    test('Different symbol opposite-side allowed', () => {
        serverAT.processBrainDecision(_decision('BTCUSDT', 'LONG'), STC, 1, STC.size);
        const ethShort = serverAT.processBrainDecision(_decision('ETHUSDT', 'SHORT'), STC, 1, STC.size);
        expect(ethShort).not.toBeNull();
        expect(ethShort.side).toBe('SHORT');
    });

    test('Same symbol same side dedupes (existing dup check still works)', () => {
        const long1 = serverAT.processBrainDecision(_decision('BTCUSDT', 'LONG'), STC, 1, STC.size);
        expect(long1).not.toBeNull();
        const long2 = serverAT.processBrainDecision(_decision('BTCUSDT', 'LONG'), STC, 1, STC.size);
        expect(long2).toBeNull();
    });
});

describe('R1 enforcementEngine — same-mode-aware NO_OPPOSITE_ENTRY_ON_OPEN', () => {
    const r1 = require('../../server/services/ml/R1_constitution/enforcementEngine');

    test('cross-mode opposite NOT flagged (Wave 8 sandbox model)', () => {
        const r = r1.evaluate({
            userId: 1,
            decision: {
                symbol: 'ETHUSDT', side: 'SHORT', mode: 'demo',
                size: 100, balance: 1000, leverage: 5, sl: 1500,
                reflection: { proceed: true, concerns: [] },
                openPositions: [
                    { symbol: 'ETHUSDT', side: 'LONG', size: 200, mode: 'live' },
                ],
                recentCloses: [], correlatedExposure: { totalPct: 0 },
            },
        });
        const ids = r.violations.map(v => v.id);
        expect(ids).not.toContain('NO_OPPOSITE_ENTRY_ON_OPEN');
    });

    test('same-mode opposite IS flagged', () => {
        const r = r1.evaluate({
            userId: 1,
            decision: {
                symbol: 'ETHUSDT', side: 'SHORT', mode: 'demo',
                size: 100, balance: 1000, leverage: 5, sl: 1500,
                reflection: { proceed: true, concerns: [] },
                openPositions: [
                    { symbol: 'ETHUSDT', side: 'LONG', size: 200, mode: 'demo' },
                ],
                recentCloses: [], correlatedExposure: { totalPct: 0 },
            },
        });
        const ids = r.violations.map(v => v.id);
        expect(ids).toContain('NO_OPPOSITE_ENTRY_ON_OPEN');
    });

    test('missing mode on existing pos treats as demo (backward compat)', () => {
        const r = r1.evaluate({
            userId: 1,
            decision: {
                symbol: 'ETHUSDT', side: 'SHORT', mode: 'demo',
                size: 100, balance: 1000, leverage: 5, sl: 1500,
                reflection: { proceed: true, concerns: [] },
                openPositions: [
                    { symbol: 'ETHUSDT', side: 'LONG', size: 200 },  // no mode field
                ],
                recentCloses: [], correlatedExposure: { totalPct: 0 },
            },
        });
        const ids = r.violations.map(v => v.id);
        expect(ids).toContain('NO_OPPOSITE_ENTRY_ON_OPEN');
    });
});

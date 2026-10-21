'use strict';
// [R1 PLUMBING 2026-10-21] Punctul de refuz al constitutiei, in
// processBrainDecision — un singur loc prin care trec AMBELE cai de intrare
// (directa si pending, care isi reia aceeasi decizie la executie).
// Marcajul `decision._r1Blocked` e pus de serverBrain DOAR cand
// R1_ENFORCEMENT_MODE === 'blocking'. Implicit flagul e 'advisory', deci campul
// nu apare niciodata si nimic nu se schimba fata de azi — dar ţeava exista si
// e verificata, ca sa nu se mai intample ca cineva sa creada ca a aprins
// blocarea si sa nu blocheze nimic.
const path = require('path');
const fs = require('fs');
const os = require('os');
const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r1-block-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');

const { db } = require('../../server/services/database');
const serverAT = require('../../server/services/serverAT');
const exchangeInfo = require('../../server/services/exchangeInfo');
exchangeInfo._setFiltersForTest('BTCUSDT', { stepSize: '0.001', tickSize: '0.10', minNotional: 5 });

function seedUser(uid) {
  try {
    db.prepare('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(uid, `u${uid}@test.local`, 'x');
  } catch (_) {}
}
function _decision(extra) {
  return Object.assign({
    symbol: 'BTCUSDT', priceTs: Date.now(), price: 1000,
    fusion: { decision: 'MEDIUM', dir: 'LONG', confidence: 70, score: 5 },
    regime: { regime: 'TREND' },
  }, extra || {});
}
const STC = { size: 100, lev: 10, slPct: 1, rr: 2, maxPos: 10, cooldownMs: 0 };

beforeEach(() => {
  seedUser(1);
  serverAT.reset(1);
  serverAT.toggleActive(1, true, 'demo');
});

describe('processBrainDecision — refuzul constitutiei R1', () => {
  test('o decizie NEMARCATA intra normal (comportamentul implicit, neschimbat)', () => {
    const entry = serverAT.processBrainDecision(_decision(), STC, 1, STC.size);
    expect(entry).toBeTruthy();
  });

  test('o decizie marcata `_r1Blocked` e REFUZATA', () => {
    const entry = serverAT.processBrainDecision(_decision({ _r1Blocked: 'MAX_POSITION_SIZE_PCT' }), STC, 1, STC.size);
    expect(entry).toBeNull();
  });

  test('refuzul lasa urma in missed_trades cu motivul R1_CONSTITUTION', () => {
    serverAT.processBrainDecision(_decision({ _r1Blocked: 'MAX_LEVERAGE' }), STC, 1, STC.size);
    const row = db.prepare("SELECT reason, symbol, side FROM missed_trades WHERE reason='R1_CONSTITUTION' ORDER BY id DESC LIMIT 1").get();
    expect(row).toBeTruthy();
    expect(row.reason).toBe('R1_CONSTITUTION');
    expect(row.symbol).toBe('BTCUSDT');
  });

  test('refuzul NU deschide nicio pozitie', () => {
    serverAT.processBrainDecision(_decision({ _r1Blocked: 'HARD' }), STC, 1, STC.size);
    expect(serverAT.getOpenPositions(1).length).toBe(0);
  });

  test('un marcaj gol sau fals NU blocheaza (doar un motiv real blocheaza)', () => {
    expect(serverAT.processBrainDecision(_decision({ _r1Blocked: '' }), STC, 1, STC.size)).toBeTruthy();
    serverAT.reset(1); serverAT.toggleActive(1, true, 'demo');
    expect(serverAT.processBrainDecision(_decision({ _r1Blocked: false }), STC, 1, STC.size)).toBeTruthy();
  });
});

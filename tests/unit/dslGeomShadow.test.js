'use strict';
// [GEOM SHADOW 2026-10-21] Contrafactualul pe GEOMETRIA DSL nu se poate face pe
// trecut: urmele de preţ stau in memorie (`priceTrace`) si se sterg la inchidere
// (serverAT.js:2633). Deci singura cale e sa INCEAPA sa se colecteze.
//
// Ironia gasita azi: cohortul `shadow` exista din b140 si simuleaza... ACELASI
// preset cu care a rulat poziţia. `dslArm` nu e atribuit NICAIERI in cod (doar
// citit la serverAT.js:2591), deci `arm` cade mereu pe `dslModeAtOpen`. Prin
// urmare cohortul nu produce nicio informaţie despre geometrie — masoara doar
// cat de optimist e simulatorul faţa de realitate (ceea ce s-a dovedit util, dar
// nu e intrebarea).
//
// Modulul asta simuleaza TOATE presetele pe aceeasi urma si intoarce un rand pe
// geometrie, cu baza = PnL-ul REALIZAT. Optimismul simulatorului (+0,0333 pp
// curat) e COMUN tuturor randurilor, deci se anuleaza la comparaţia arm-vs-arm —
// exact de aceea design-ul merge pentru o decizie de geometrie, chiar dacă
// valoarea absoluta are nevoie de corecţie.
const { buildGeomRows } = require('../../server/services/dslGeomShadow');

const PRESETS = {
  fast:  { openDslPct: 0.35, pivotLeftPct: 0.50, pivotRightPct: 0.40, impulseVPct: 0.20 },
  def:   { openDslPct: 0.60, pivotLeftPct: 0.80, pivotRightPct: 0.70, impulseVPct: 0.30 },
  swing: { openDslPct: 1.00, pivotLeftPct: 1.30, pivotRightPct: 1.10, impulseVPct: 0.40 },
};
const META = { side: 'LONG', entry: 100, originalSL: 97.5 };
const PRICES = [100, 100.5, 101, 100.8, 101.5, 101.2];

// simulator fals, determinist: pnl = openDslPct * 10, ca sa pot verifica maparea
const fakeSim = (p) => ({ exitReason: 'DSL_PL', exitPrice: 0, pnlPct: p.openDslPct * 10 });

describe('buildGeomRows — colecteaza contrafactualul pe geometrie', () => {
  test('e o functie exportata', () => {
    expect(typeof buildGeomRows).toBe('function');
  });

  test('un rand per preset, cu numele presetului ca arm', () => {
    const rows = buildGeomRows({ presets: PRESETS, meta: META, prices: PRICES, realizedPnlPct: 1, simulate: fakeSim });
    expect(rows.map(r => r.arm).sort()).toEqual(['def', 'fast', 'swing']);
  });

  test('avantajul e simularea MINUS realizatul', () => {
    const rows = buildGeomRows({ presets: PRESETS, meta: META, prices: PRICES, realizedPnlPct: 2, simulate: fakeSim });
    const fast = rows.find(r => r.arm === 'fast');
    expect(fast.simPnlPct).toBeCloseTo(3.5);      // 0.35 * 10
    expect(fast.advantage).toBeCloseTo(1.5);      // 3.5 - 2
  });

  test('baza e aceeasi pentru toate randurile (asa se anuleaza biasul la arm-vs-arm)', () => {
    const rows = buildGeomRows({ presets: PRESETS, meta: META, prices: PRICES, realizedPnlPct: 2, simulate: fakeSim });
    for (const r of rows) expect(r.baselinePnlPct).toBe(2);
  });

  test('urma prea scurta → niciun rand (nu inventam un contrafactual din 1 preţ)', () => {
    expect(buildGeomRows({ presets: PRESETS, meta: META, prices: [100], realizedPnlPct: 1, simulate: fakeSim })).toEqual([]);
    expect(buildGeomRows({ presets: PRESETS, meta: META, prices: [], realizedPnlPct: 1, simulate: fakeSim })).toEqual([]);
    expect(buildGeomRows({ presets: PRESETS, meta: META, prices: null, realizedPnlPct: 1, simulate: fakeSim })).toEqual([]);
  });

  test('un preset care ARUNCA nu omoara celelalte randuri', () => {
    const flaky = (p) => { if (p.openDslPct === 0.6) throw new Error('crapat'); return { pnlPct: 1 }; };
    const rows = buildGeomRows({ presets: PRESETS, meta: META, prices: PRICES, realizedPnlPct: 0, simulate: flaky });
    expect(rows.map(r => r.arm).sort()).toEqual(['fast', 'swing']);
  });

  test('un pnl simulat nefinit e sarit, nu propagat ca NaN', () => {
    const bad = () => ({ pnlPct: NaN });
    expect(buildGeomRows({ presets: PRESETS, meta: META, prices: PRICES, realizedPnlPct: 0, simulate: bad })).toEqual([]);
  });

  test('realizat nefinit → niciun rand (fara baza nu exista avantaj)', () => {
    expect(buildGeomRows({ presets: PRESETS, meta: META, prices: PRICES, realizedPnlPct: NaN, simulate: fakeSim })).toEqual([]);
  });

  test('presete lipsa → niciun rand, fara excepţie', () => {
    expect(() => buildGeomRows({ presets: null, meta: META, prices: PRICES, realizedPnlPct: 0, simulate: fakeSim })).not.toThrow();
    expect(buildGeomRows({ presets: null, meta: META, prices: PRICES, realizedPnlPct: 0, simulate: fakeSim })).toEqual([]);
  });
});

// ── Citirea ─────────────────────────────────────────────────────────────────
// Colectarea fara citire e cum a stat cohortul `shadow` patru luni: date pe care
// nimeni nu se uita, cu semantica greşita, si nimeni n-a observat. Deci agregarea
// pe geometrie se verifica aici, nu se lasa pe mai tarziu.
const { summarizeGeomRows } = require('../../server/services/dslGeomShadow');

describe('summarizeGeomRows — face datele colectate citibile', () => {
  const R = (arm, adv) => ({ arm, advantage: adv });

  test('e o functie exportata', () => {
    expect(typeof summarizeGeomRows).toBe('function');
  });

  test('grupeaza pe geometrie si numara', () => {
    const s = summarizeGeomRows([R('fast', 1), R('fast', 3), R('swing', 2)]);
    expect(s.find(x => x.arm === 'fast').n).toBe(2);
    expect(s.find(x => x.arm === 'swing').n).toBe(1);
  });

  test('da media SI mediana — media singura minte cand avantajul e pe coada', () => {
    const s = summarizeGeomRows([R('fast', 0), R('fast', 0), R('fast', 30)]);
    const f = s.find(x => x.arm === 'fast');
    expect(f.avgAdvantage).toBeCloseTo(10);
    expect(f.medianAdvantage).toBe(0);
  });

  test('numara cazurile mai bune si mai rele, nu doar media', () => {
    const s = summarizeGeomRows([R('fast', 2), R('fast', -1), R('fast', 0)]);
    const f = s.find(x => x.arm === 'fast');
    expect(f.better).toBe(1);
    expect(f.worse).toBe(1);
    expect(f.neutral).toBe(1);
  });

  test('ordoneaza descrescator pe avantaj, ca prima linie sa fie geometria cea mai buna', () => {
    const s = summarizeGeomRows([R('a', 1), R('b', 5), R('c', 3)]);
    expect(s.map(x => x.arm)).toEqual(['b', 'c', 'a']);
  });

  test('randuri fara arm sau cu avantaj nefinit sunt ignorate, nu propagate ca NaN', () => {
    const s = summarizeGeomRows([R('fast', 2), R(null, 5), R('fast', NaN), { advantage: 1 }]);
    const f = s.find(x => x.arm === 'fast');
    expect(f.n).toBe(1);
    expect(f.avgAdvantage).toBe(2);
    expect(s.length).toBe(1);
  });

  test('intrare goala sau invalida → lista goala, fara excepţie', () => {
    expect(summarizeGeomRows([])).toEqual([]);
    expect(summarizeGeomRows(null)).toEqual([]);
    expect(() => summarizeGeomRows('aiurea')).not.toThrow();
  });
});

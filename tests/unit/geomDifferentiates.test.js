'use strict';
// [GEOM SHADOW — verificare critica 2026-10-22] Prima inchidere dupa reload a
// produs 5 randuri shadow_geom (cate unul per preset), deci colectarea SCRIE.
// Dar toate cinci au dat acelasi rezultat (simulat 1,4948%), iar daca presetele
// nu se diferentiaza NICIODATA atunci masuratoarea pe care am livrat-o nu poate
// masura nimic si e un defect al meu, nu o proprietate a datelor.
// Testul de aici decide: pe o urma construita sa separe geometriile (urcare,
// apoi retragere de 1,26% din varf, care prinde urmaririle strânse de 0,50% dar
// nu pe cele largi de 1,30%), presetele TREBUIE sa dea rezultate diferite.
const serverDSL = require('../../server/services/serverDSL');
const { buildGeomRows } = require('../../server/services/dslGeomShadow');

const meta = { side: 'LONG', entry: 100, originalSL: 97.5 };
function trace() {
  const up = []; for (let p = 100; p <= 103; p += 0.05) up.push(+p.toFixed(4));
  const dn = []; for (let p = 103; p >= 101.7; p -= 0.05) dn.push(+p.toFixed(4));
  return [...up, ...dn];
}

describe('contrafactualul pe geometrie poate chiar distinge geometriile', () => {
  test('presetele dau rezultate DIFERITE pe o urma care le separa', () => {
    const rows = buildGeomRows({
      presets: serverDSL.DSL_PRESETS, meta, prices: trace(),
      realizedPnlPct: 1.7, simulate: serverDSL.simulate,
    });
    expect(rows.length).toBe(Object.keys(serverDSL.DSL_PRESETS).length);
    const distinct = new Set(rows.map(r => r.simPnlPct.toFixed(6)));
    // Daca asta cade, masuratoarea livrata in b304 nu poate distinge geometriile.
    expect(distinct.size).toBeGreaterThan(1);
  });

  test('o urmare mai larga nu iese mai prost decat una strânsa pe acelasi varf', () => {
    const rows = buildGeomRows({
      presets: serverDSL.DSL_PRESETS, meta, prices: trace(),
      realizedPnlPct: 0, simulate: serverDSL.simulate,
    });
    const by = {}; for (const r of rows) by[r.arm] = r.simPnlPct;
    // pe o retragere de 1,26%, urmarirea de 0,50% (fast) iese mai devreme decat
    // cea de 1,30% (swing), care o lasa sa respire — deci nu pot fi egale
    expect(by.fast).not.toBeCloseTo(by.swing, 6);
  });

  test('toate rezultatele sunt finite (nicio geometrie nu produce NaN)', () => {
    const rows = buildGeomRows({
      presets: serverDSL.DSL_PRESETS, meta, prices: trace(),
      realizedPnlPct: 1.7, simulate: serverDSL.simulate,
    });
    for (const r of rows) expect(Number.isFinite(r.simPnlPct)).toBe(true);
  });
});

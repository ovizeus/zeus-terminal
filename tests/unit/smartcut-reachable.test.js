'use strict';
// [SMART_CUT RESURRECTION 2026-10-21] `SMART_CUT` (b161, 22 iunie) n-a inchis
// NICIODATA nimic: 0 randuri in istoric, 0 apariţii in jurnale, desi a avut
// ocazii pe TESTNET unde poarta `pos.env === 'TESTNET'` i-o permitea.
// Cauza: `const _dslRrSim = require('./dslRrSim')` era declarat la linia 2586,
// in `_closePosition()`, dar folosit la 3602, in `onPriceUpdate()` — functii
// SURORI de nivel superior, fara nicio inchidere intre ele si fara declaraţie
// la nivel de modul. Deci 3602 arunca `ReferenceError: _dslRrSim is not
// defined` la FIECARE tick, iar `catch (e) { }` GOL o inghitea. Patru luni,
// zero semnal.
// Bugul a supravieţuit fiindca blocul era INTESTABIL: inglobat in mijlocul lui
// `onPriceUpdate`, care cere tot mediul de rulare. De aceea reparaţia nu e doar
// mutarea lui `require` — pasul e extras intr-un ajutor exportat, ca sa poata
// fi tinut in loc de un test.
const serverAT = require('../../server/services/serverAT');

describe('_smartCutTick — pasul de tăiere a pierderii, accesibil şi testabil', () => {
  const POS = () => ({ side: 'LONG', price: 100, env: 'TESTNET', _lsCutState: null });

  test('e exportat (altfel bugul de 4 luni ar fi invizibil din nou)', () => {
    expect(typeof serverAT._smartCutTick).toBe('function');
  });

  test('REGRESIE: NU arunca ReferenceError — exact ce ascundea catch-ul gol', () => {
    expect(() => serverAT._smartCutTick(POS(), 99)).not.toThrow();
  });

  test('intoarce o stare, nu undefined (dovada ca _dslRrSim e in domeniu)', () => {
    const r = serverAT._smartCutTick(POS(), 99);
    expect(r).toBeTruthy();
    expect(typeof r.cut).toBe('boolean');
    expect(r.state).toBeTruthy();
    expect(typeof r.state.extreme).toBe('number');
    expect(typeof r.state.consec).toBe('number');
  });

  test('nu taie pe un singur tick advers (cere K=2 extreme succesive)', () => {
    const pos = POS();
    const r1 = serverAT._smartCutTick(pos, 99.0);
    expect(r1.cut).toBe(false);
  });

  test('TAIE pe advers SUSTINUT — comportamentul cerut de b161', () => {
    const pos = POS();
    let cut = false;
    for (let i = 1; i <= 10 && !cut; i++) {
      const r = serverAT._smartCutTick(pos, 100 - i * 0.5);
      pos._lsCutState = r.state;
      cut = r.cut;
    }
    expect(cut).toBe(true);
  });

  test('NU taie cand preţul merge in favoare (nu omoara un castigator)', () => {
    const pos = POS();
    let cut = false;
    for (let i = 1; i <= 10; i++) {
      const r = serverAT._smartCutTick(pos, 100 + i * 0.5);
      pos._lsCutState = r.state;
      if (r.cut) cut = true;
    }
    expect(cut).toBe(false);
  });

  test('SHORT: taie pe advers susţinut in sus, nu in jos', () => {
    const s = { side: 'SHORT', price: 100, env: 'TESTNET', _lsCutState: null };
    let cut = false;
    for (let i = 1; i <= 10 && !cut; i++) {
      const r = serverAT._smartCutTick(s, 100 + i * 0.5);
      s._lsCutState = r.state;
      cut = r.cut;
    }
    expect(cut).toBe(true);
  });

  test('poziţie invalida → fara excepţie, fara tăiere', () => {
    expect(() => serverAT._smartCutTick(null, 99)).not.toThrow();
    expect(serverAT._smartCutTick(null, 99).cut).toBe(false);
    expect(serverAT._smartCutTick(POS(), NaN).cut).toBe(false);
  });
});

'use strict';
// [GUARD FAIL-CLOSED 2026-10-21] `_findSameModeOpposite` filtra `p.userId === userId`.
// O poziţie cu `userId` lipsă din obiect era deci SĂRITĂ în linişte, iar garda
// direcţională raporta „nicio poziţie opusă" — aşa a deschis brain-ul LONG+SHORT
// în acelaşi mod. Măsurat pe 3 441 de tranzacţii închise: 92 de conflicte, 72
// doar în octombrie, ultimul 2026-10-20 13:03; rejucat prin garda reală, TOATE
// cele 92 au avut la bază exclusiv poziţii opuse fără `userId`.
//
// Scriitorul acelor obiecte nu a putut fi găsit în codul actual (forma lor —
// `confluence`/`tier`, fără `qty`/`cycle` — nu se potriveşte cu niciun
// constructor de azi), deci garda nu are voie să depindă de repararea lui:
// un proprietar NECUNOSCUT în acelaşi mod trebuie să BLOCHEZE, nu să fie ignorat.
// Direcţia sigură e blocarea: costul e o intrare ratată (înregistrată ca
// missed trade), nu o carte mixtă pe bani. Politica operatorului din 2026-05-19
// e explicită: fără carte mixtă LONG+SHORT în acelaşi mod.
const serverAT = require('../../server/services/serverAT');
const find = serverAT._findSameModeOpposite;

const q = { userId: 1, side: 'SHORT', mode: 'demo' };

describe('_findSameModeOpposite — cedează ÎNCHIS la proprietar necunoscut', () => {
  test('poziţia opusă a MEA (userId=1) blochează — comportament nemodificat', () => {
    expect(find([{ userId: 1, side: 'LONG', mode: 'demo', symbol: 'BTCUSDT' }], q)).toBeTruthy();
  });

  test('REGRESIE: poziţia opusă cu userId LIPSĂ blochează (înainte era sărită)', () => {
    expect(find([{ side: 'LONG', mode: 'demo', symbol: 'SOLUSDT' }], q)).toBeTruthy();
  });

  test('REGRESIE: userId null blochează', () => {
    expect(find([{ userId: null, side: 'LONG', mode: 'demo', symbol: 'SOLUSDT' }], q)).toBeTruthy();
  });

  test('poziţia opusă a ALTUI utilizator cunoscut NU blochează (fără scurgere între conturi)', () => {
    expect(find([{ userId: 2, side: 'LONG', mode: 'demo', symbol: 'BTCUSDT' }], q)).toBeNull();
  });

  test('aceeaşi direcţie nu blochează niciodată, nici cu userId lipsă', () => {
    expect(find([{ side: 'SHORT', mode: 'demo', symbol: 'BTCUSDT' }], q)).toBeNull();
  });

  test('alt MOD nu blochează, nici cu userId lipsă (demo şi live sunt cutii separate)', () => {
    expect(find([{ side: 'LONG', mode: 'live', symbol: 'BTCUSDT' }], q)).toBeNull();
  });

  test('modul lipsă se citeşte ca demo pe AMBELE părţi (rânduri vechi)', () => {
    expect(find([{ side: 'LONG', symbol: 'BTCUSDT' }], { userId: 1, side: 'SHORT' })).toBeTruthy();
  });

  test('cartea goală / intrare invalidă → null, fără excepţie', () => {
    expect(find([], q)).toBeNull();
    expect(find(null, q)).toBeNull();
    expect(find([null, undefined], q)).toBeNull();
  });

  test('preferă o potrivire CUNOSCUTĂ când ambele există (mesaj mai util)', () => {
    const r = find([
      { side: 'LONG', mode: 'demo', symbol: 'FANTOMA' },
      { userId: 1, side: 'LONG', mode: 'demo', symbol: 'REALA' },
    ], q);
    expect(r).toBeTruthy();
    expect(r.symbol).toBe('REALA');
  });
});

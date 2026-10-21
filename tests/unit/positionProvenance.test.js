'use strict';
// [PROVENANCE FIX 2026-10-21] Auditul de azi a arătat că obiectul poziţiei e
// persistat INCOMPLET pe căile de execuţie: `_buildPendingPositionData`
// (binanceOps) şi echivalentul din bybitOps scriu symbol/side/qty/.../mode dar
// NU `userId` şi NU `env`. Coloana `user_id` primeşte uid-ul, obiectul nu.
// Consecinţele măsurate pe 3 441 de tranzacţii închise:
//   - `userId` lipsă  → `_findSameModeOpposite` (serverAT.js:1149) compară
//     `p.userId === userId`, deci NU vede poziţia opusă → brain deschide
//     LONG+SHORT în acelaşi mod (92 de conflicte, 72 doar în octombrie).
//   - `env` lipsă     → poarta `pos.env === 'TESTNET'` (serverAT.js:3600)
//     dezarmează SMART_CUT → 16 tranzacţii, −10 057, cea mai mare gaură.
// Ironie documentată: comentariul lui `_buildPendingPositionData` spune chiar
// „would ... confuse the directional guard" — s-a reparat `mode` şi s-a ratat
// exact câmpul pe care garda îl testează PRIMUL.
// Un singur loc pur, cerut de ambele burse, ca să nu se mai poată desincroniza.
const { resolveProvenance } = require('../../server/services/positionProvenance');

describe('resolveProvenance — userId + env pentru rândul PENDING', () => {
  const params = { symbol: 'BTCUSDT', side: 'LONG', mode: 'live' };

  test('este o funcţie exportată', () => {
    expect(typeof resolveProvenance).toBe('function');
  });

  // ── userId: câmpul care orbeşte garda direcţională ──
  test('stampilează userId din uid', () => {
    expect(resolveProvenance(7, params, { mode: 'testnet' }).userId).toBe(7);
  });

  test('uid lipsă → userId null, NU inventat (fără scurgere între utilizatori)', () => {
    expect(resolveProvenance(undefined, params, { mode: 'testnet' }).userId).toBeNull();
    expect(resolveProvenance(null, params, { mode: 'testnet' }).userId).toBeNull();
    expect(resolveProvenance(0, params, { mode: 'testnet' }).userId).toBeNull();
  });

  test('userId rămâne numeric, nu şir (garda compară cu ===)', () => {
    const p = resolveProvenance('7', params, { mode: 'testnet' });
    expect(p.userId).toBe(7);
    expect(typeof p.userId).toBe('number');
  });

  // ── env: câmpul care dezarmează tăietorul de pierderi ──
  test("mode='demo' → env 'DEMO'", () => {
    expect(resolveProvenance(1, { ...params, mode: 'demo' }, null).env).toBe('DEMO');
  });

  test("creds.mode='testnet' → env 'TESTNET' (poarta SMART_CUT se deschide)", () => {
    expect(resolveProvenance(1, params, { mode: 'testnet' }).env).toBe('TESTNET');
  });

  test("creds.mode='live' → env 'REAL'", () => {
    expect(resolveProvenance(1, params, { mode: 'live' }).env).toBe('REAL');
  });

  test('FAIL-CLOSED: fără creds pe un mod non-demo → env null, NICIODATĂ REAL', () => {
    expect(resolveProvenance(1, params, null).env).toBeNull();
    expect(resolveProvenance(1, params, {}).env).toBeNull();
    expect(resolveProvenance(1, params, { mode: 'altceva' }).env).toBeNull();
  });

  test("demo CÂŞTIGĂ faţă de creds: mode='demo' + creds live → DEMO, nu REAL", () => {
    expect(resolveProvenance(1, { ...params, mode: 'demo' }, { mode: 'live' }).env).toBe('DEMO');
  });

  test('params lipsă de tot → nu aruncă, env null', () => {
    expect(() => resolveProvenance(1, null, null)).not.toThrow();
    expect(resolveProvenance(1, null, null).env).toBeNull();
  });

  test('întoarce exact cele două chei, nimic altceva', () => {
    expect(Object.keys(resolveProvenance(1, params, { mode: 'testnet' })).sort())
      .toEqual(['env', 'userId']);
  });
});

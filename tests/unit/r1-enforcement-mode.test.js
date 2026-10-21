'use strict';
// [R1 PLUMBING 2026-10-21] `enforcementEngine.evaluate()` calculeaza
// `allowed: !hardViolation`, dar unicul apelant (serverBrain.js:1582) scria
// `enforcementMode: 'advisory'` ca SIR LITERAL si citea `allowed` doar ca
// eticheta de audit pentru charter (linia 1609) — niciodata ca sa blocheze.
// Deci cele 31 460 de incalcari `hard` erau detectate si lasate sa treaca, iar
// comentariul promitea „operator can flip to blocking later via env flag" —
// un flag care NU exista. Capcana: cineva care ar fi pus mintea pe el si ar fi
// crezut ca a activat blocarea n-ar fi blocat nimic.
// Reparat: modul vine dintr-un flag (implicit 'advisory' = comportamentul de
// azi, NESCHIMBAT) si verdictul trece prin acest predicat pur.
// Nota: azi blocarea n-ar opri nimic in plus — garda fail-closed din b297
// prinde 143/143 conflictele direcţionale in amonte, iar
// MAX_POSITION_SIZE_PCT s-a rezolvat prin creşterea capitalului (ultima
// incalcare 2026-10-07). Reparam ŢEAVA, nu aprindem comutatorul.
const { shouldBlock } = require('../../server/services/ml/R1_constitution/enforcementEngine');

describe('shouldBlock — verdictul constitutiei devine executabil', () => {
  test('e exportat (altfel nu se poate verifica)', () => {
    expect(typeof shouldBlock).toBe('function');
  });

  test("mod 'blocking' + incalcare hard → BLOCHEAZA", () => {
    expect(shouldBlock('blocking', false)).toBe(true);
  });

  test("mod 'blocking' fara incalcare hard → trece", () => {
    expect(shouldBlock('blocking', true)).toBe(false);
  });

  test("mod 'advisory' + incalcare hard → TRECE (comportamentul de azi, neschimbat)", () => {
    expect(shouldBlock('advisory', false)).toBe(false);
  });

  test('mod absent sau necunoscut → trece; doar „blocking" blocheaza, explicit', () => {
    expect(shouldBlock(undefined, false)).toBe(false);
    expect(shouldBlock(null, false)).toBe(false);
    expect(shouldBlock('', false)).toBe(false);
    expect(shouldBlock('BLOCKING', false)).toBe(false);
    expect(shouldBlock('aiurea', false)).toBe(false);
  });

  test('allowed nedefinit NU e tratat ca permis cand modul blocheaza', () => {
    expect(shouldBlock('blocking', undefined)).toBe(true);
    expect(shouldBlock('blocking', null)).toBe(true);
  });
});

describe('flagul care alimenteaza modul', () => {
  const MF = require('../../server/migrationFlags');

  test('R1_ENFORCEMENT_MODE exista ca flag', () => {
    expect(MF.R1_ENFORCEMENT_MODE).toBeDefined();
  });

  test("implicit e 'advisory' — nimic nu se schimba pana nu decide operatorul", () => {
    expect(MF.R1_ENFORCEMENT_MODE).toBe('advisory');
  });
});

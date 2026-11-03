'use strict';
// [2026-11-03] Raspunsul la "cum e bandit-ul" spunea, negru pe alb:
//   "influence: ACTIVE. seed + preReg live. eligibility passes for cells >= 30 obs."
//
// Fals pe toate cele trei bucati. Masurat: 522.400 de evaluari de influenta,
// TOATE skipped — niciuna n-a schimbat vreodata o decizie. Conditia verificata
// de raspuns (exista o pre-inregistrare REGISTERED) nu e conditia verificata de
// POARTA, care cere si ca fereastra de evaluare sa nu fie expirata. A
// pre-inregistrarii 6554 s-a inchis pe 9 iulie 2026, si se vede in audit ca
// `eval_window_expired`.
//
// Un asistent care raporteaza ACTIVE despre ceva care n-a functionat niciodata
// e mai rau decat unul care tace: operatorul ia decizii crezandu-l.
const { influenceStatus } = require('../../../server/services/ml/_voice/omegaContext');
const fs = require('fs');
const path = require('path');

const DAY = 86400000;

describe('influenceStatus', () => {
    test('REGRESIE: nu mai spune ACTIVE cand nu s-a aplicat niciodata', () => {
        const out = influenceStatus({
            evals: 20160, applied: 0,
            reasons: [{ reason: 'not_eligible_insufficient_observations', n: 20158 },
                      { reason: 'not_eligible_eval_window_expired', n: 2 }],
        });
        expect(out).toMatch(/NEVER APPLIED/);
        expect(out).not.toMatch(/ACTIVE/);
        expect(out).toMatch(/20160 evaluations/);
        // Motivele, pe intelesul lui, fara prefixul de cod.
        expect(out).toMatch(/insufficient_observations ×20158/);
        expect(out).toMatch(/eval_window_expired ×2/);
    });

    test('REGRESIE: spune ca fereastra e inchisa, si de cate zile', () => {
        const out = influenceStatus({
            evals: 100, applied: 0, reasons: [],
            preRegExpiredAt: Date.now() - 117 * DAY,
        });
        expect(out).toMatch(/window closed 117 days ago/);
        expect(out).toMatch(/even a cell with 30\+ observations is refused/);
    });

    test('o fereastra inca deschisa NU se raporteaza ca inchisa', () => {
        const out = influenceStatus({ evals: 100, applied: 0, reasons: [], preRegExpiredAt: null });
        expect(out).not.toMatch(/window closed/);
    });

    test('daca CHIAR s-ar aplica, spune asta', () => {
        expect(influenceStatus({ evals: 100, applied: 7 })).toMatch(/APPLIED 7 of 100/);
    });

    test('fara evaluari spune ca e liniste, nu ca e activ', () => {
        expect(influenceStatus({ evals: 0 })).toMatch(/no evaluations/);
        expect(influenceStatus(null)).toMatch(/no evaluations/);
    });

    test('ce nu e numar nu devine zero sau NaN', () => {
        const out = influenceStatus({ evals: '20160', applied: null, reasons: null });
        expect(out).not.toMatch(/NaN|undefined/);
    });
});

describe('sursa — raspunsul nu mai ghiceste verdictul portii', () => {
    const SRC = fs.readFileSync(
        path.join(__dirname, '../../../server/services/ml/_voice/chatResponder.js'), 'utf8');
    const body = SRC.slice(SRC.indexOf('function _replyBandit'), SRC.indexOf('function _replyDecisions'));

    test('REGRESIE: propozitia veche, falsa, nu mai exista nicaieri', () => {
        expect(SRC).not.toContain('influence: ACTIVE');
        expect(SRC).not.toContain('eligibility passes for cells');
    });

    test('citeste verdictul real din audit, nu doar existenta unei pre-inregistrari', () => {
        expect(body).toContain('gate_reason');
        expect(body).toContain('influenceStatus');
    });

    test('si verifica fereastra de evaluare, a doua conditie a portii', () => {
        // Pe SELECT, nu pe simpla aparitie a numelui: prima versiune a acestui
        // test cerea doar `toContain('eval_window_to')`, iar numele apare si in
        // `preReg.eval_window_to` de mai jos — deci mutatia care-l scotea din
        // interogare (facand campul `undefined` si fereastra invizibila) trecea.
        expect(body).toMatch(/SELECT[^;]*eval_window_to[^;]*FROM ml_hypothesis_pre_registrations/);
        expect(body).toContain('preReg.eval_window_to');
    });
});

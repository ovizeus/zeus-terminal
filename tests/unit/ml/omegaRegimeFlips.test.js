'use strict';
// [2026-11-04] OMEGA citea `regime` din JSON-ul UNEI SINGURE decizii, deci
// putea spune "TREND" dar niciodata "regimul a basculat de 88 de ori azi pe
// BNB". `regime_history` tine TRANZITIILE (prev_regime -> regime) si e viu.
//
// ⚠️ `created_at` e TEXT datetime, NU `ts` INTEGER ms. A treia data cand dau in
// capcana asta pe tabele din Zeus; interogarea pe `ts` nu arunca zgomotos, doar
// intoarce gol -- si "gol" se citeste ca "fara date".
const C = require('../../../server/services/ml/_voice/omegaContext');

describe('formatRegimeFlips', () => {
    it('spune cate flipuri si cat de agitat e cel mai agitat simbol', () => {
        const s = C.formatRegimeFlips({
            total: 500, symbols: 7,
            byRegime: [{ regime: 'TREND', n: 207 }, { regime: 'BREAKOUT', n: 183 }],
            busiest: { symbol: 'BNBUSDT', n: 88 },
        });
        expect(s).toContain('500');
        expect(s).toContain('BNBUSDT');
        expect(s).toContain('88');
        expect(s).toMatch(/trend/i);
    });

    it('traduce agitatia in TIMP — un numar brut nu spune nimic', () => {
        // 88 flipuri in 24h = la fiecare ~16 minute. Asta e informatia.
        const s = C.formatRegimeFlips({
            total: 500, symbols: 7, byRegime: [], busiest: { symbol: 'BNBUSDT', n: 88 },
        });
        expect(s).toMatch(/every ~?1[0-9]\s?min|~16 ?min/i);
    });

    it('un singur flip nu se randeaza ca o frecventa', () => {
        const s = C.formatRegimeFlips({
            total: 1, symbols: 1, byRegime: [], busiest: { symbol: 'BTCUSDT', n: 1 },
        });
        expect(s).not.toMatch(/every/i);
    });

    it('gol se spune ca gol', () => {
        expect(C.formatRegimeFlips({ total: 0, symbols: 0, byRegime: [], busiest: null }))
            .toMatch(/no regime changes|nothing/i);
    });

    it('un ELEMENT stricat din lista nu se randeaza — nu doar lista intreaga', () => {
        // Probele treceau doar `byRegime: null`, deci filtrul pe elemente nu era
        // niciodata pus la treaba. Un rand cu regim null randat ar da "null x".
        const s = C.formatRegimeFlips({
            total: 10, symbols: 2,
            byRegime: [{ regime: null, n: 'x' }, { regime: 'TREND', n: 5 }, { regime: 'RANGE', n: null }],
            busiest: null,
        });
        expect(s).toContain('trend 5');
        expect(s).not.toMatch(/null|undefined|NaN/);
        expect(s).not.toContain('range');
    });

    it('nu arunca si nu scrie null/NaN pe intrari stricate', () => {
        for (const v of [null, undefined, {}, { total: 'x' }, { total: 5, byRegime: null, busiest: {} }]) {
            const out = C.formatRegimeFlips(v);
            expect(typeof out).toBe('string');
            expect(out).not.toMatch(/undefined|null|NaN/);
        }
    });
});

describe('gatherRegimeFlips', () => {
    it('REGRESIE: filtreaza pe `created_at`, nu pe `ts`', () => {
        // Pe `ts` interogarea intoarce gol in liniste, si golul pare lipsa de date.
        const sqls = [];
        const db = { prepare(sql) { sqls.push(sql); return { get: () => ({ total: 1, symbols: 1 }), all: () => [] }; } };
        C.gatherRegimeFlips(db, 1);
        const all = sqls.join(' ');
        expect(all).toContain('created_at');
        expect(all).not.toMatch(/\bts\s*>=/);
    });

    it('nu arunca pe baza cazuta', () => {
        const broken = { prepare() { throw new Error('nope'); } };
        const got = C.gatherRegimeFlips(broken, 1);
        expect(got.total).toBe(0);
        expect(got.busiest).toBeNull();
    });
});

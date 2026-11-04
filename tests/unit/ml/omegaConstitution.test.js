'use strict';
// [2026-11-04] Constitutia R1, in fata lui OMEGA.
//
// Pe 1 noiembrie el a intrebat de ce are LONG si SHORT deschise simultan.
// Regula care interzice exact asta exista si se masoara din 18 mai:
// NO_OPPOSITE_ENTRY_ON_OPEN, severitate `hard`, 35.805 incalcari scrise.
// OMEGA n-avea nicio referinta la ea in niciunul din cele 12 fisiere ale lui,
// deci a raspuns pe langa o intrebare la care avea datele in casa.
//
// Ce se testeaza aici e ADEVARUL pe care-l spune, nu doar forma: o constitutie
// in mod `advisory` NU a oprit nimic, si asta trebuie sa se citeasca explicit.
// Lectia e de la `influenceStatus`, unde "ACTIVE" insemna "n-a rulat niciodata".
const C = require('../../../server/services/ml/_voice/omegaContext');

const NOW = 1800000000000;

function fakeDb(rows, ever) {
    return {
        prepare(sql) {
            return {
                all: () => (/GROUP BY/.test(sql) ? rows : []),
                get: () => ({ n: ever }),
            };
        },
    };
}

describe('gatherConstitution', () => {
    it('aduce incalcarile pe principiu, plus totalul istoric', () => {
        const rows = [
            { principle_id: 'NO_OPPOSITE_ENTRY_ON_OPEN', principle_name: 'No opposite-side entry while same-symbol open', severity: 'hard', n: 65 },
        ];
        const got = C.gatherConstitution(fakeDb(rows, 35805), 1, NOW, 'advisory');
        expect(got.rows).toHaveLength(1);
        expect(got.rows[0].n).toBe(65);
        expect(got.totalEver).toBe(35805);
        expect(got.mode).toBe('advisory');
    });

    it('nu arunca si nu inventeaza cand baza cade', () => {
        const broken = { prepare() { throw new Error('nope'); } };
        const got = C.gatherConstitution(broken, 1, NOW, 'advisory');
        expect(got.rows).toEqual([]);
        expect(got.totalEver).toBeNull();
    });

    it('modul necunoscut nu devine `blocking` din neglijenta', () => {
        // Doar sirul exact 'blocking' blochează (enforcementEngine.shouldBlock).
        for (const m of [undefined, null, '', 'BLOCKING', 'blocking ', 'advisory', 'nonsens']) {
            const got = C.gatherConstitution(fakeDb([], 0), 1, NOW, m);
            if (m === 'advisory') expect(got.mode).toBe('advisory');
            else if (m === 'blocking') expect(got.mode).toBe('blocking');
            else expect(got.mode).toBe('advisory');
        }
        expect(C.gatherConstitution(fakeDb([], 0), 1, NOW, 'blocking').mode).toBe('blocking');
    });
});

describe('formatConstitution', () => {
    const one = {
        rows: [{ principle_id: 'NO_OPPOSITE_ENTRY_ON_OPEN', principle_name: 'No opposite-side entry while same-symbol open', severity: 'hard', n: 65 }],
        totalEver: 35805,
        mode: 'advisory',
    };

    it('spune EXPLICIT ca nu s-a blocat nimic, cand modul e advisory', () => {
        const s = C.formatConstitution(one);
        expect(s).toMatch(/advisory/i);
        expect(s).toMatch(/nothing was blocked|did not block/i);
        expect(s).toContain('65');
    });

    it('cand modul e blocking, NU mai spune ca n-a blocat nimic', () => {
        const s = C.formatConstitution({ ...one, mode: 'blocking' });
        expect(s).toMatch(/blocking/i);
        expect(s).not.toMatch(/nothing was blocked|did not block/i);
    });

    it('numeste regula pe limba omului, nu cu id-ul din baza', () => {
        const s = C.formatConstitution(one);
        expect(s).toMatch(/opposite/i);
        expect(s).not.toContain('NO_OPPOSITE_ENTRY_ON_OPEN');
    });

    it('spune si cate au fost in total, ca 65 azi sa nu para tot', () => {
        expect(C.formatConstitution(one)).toContain('35805');
    });

    it('zero incalcari se spune ca zero, nu se tace', () => {
        const s = C.formatConstitution({ rows: [], totalEver: 35805, mode: 'advisory' });
        expect(s).toMatch(/no breaches|none/i);
        expect(s).toMatch(/24h/);
    });

    it('lipsa de date nu se randeaza ca 0 incalcari', () => {
        const s = C.formatConstitution({ rows: [], totalEver: null, mode: 'advisory' });
        expect(s).not.toContain('null');
        expect(s).not.toMatch(/\b0 ever\b/);
    });

    it('nu arunca pe intrari stricate', () => {
        for (const v of [null, undefined, {}, { rows: null }, { rows: [null] }]) {
            expect(() => C.formatConstitution(v)).not.toThrow();
        }
    });

    it('severitatea `hard` se vede — o regula hard lasata advisory e contradictia', () => {
        expect(C.formatConstitution(one)).toMatch(/hard/i);
    });
});

'use strict';
// [2026-11-04] Bandit-ul nu putea invata geometria, si nu din vina datelor.
//
// `buildGeomRows` simuleaza toate presetele pe aceeasi urma, cu baza = PnL-ul
// REALIZAT, identica pentru toate. Designul e corect: baza comuna se anuleaza la
// scadere, deci advantage(A) - advantage(B) = sim(A) - sim(B).
//
// DAR bandit-ul consuma `win = advantage > 0`. Fata de o baza comuna pe care
// TOATE presetele o bat (masurat: 142 din 146, pe fiecare brat), `win` iese 1
// pentru toate — si exact diferentele pe care se baza designul sunt aruncate de
// codificarea binara. De-aia toate cinci stateau la 0,966 identic.
//
// Semnalul adevarat, masurat arm-vs-arm pe aceeasi pozitie: `fast` bate `def`,
// `swing` si `atr` cu 146 din 146, si `tp` cu 142 din 146.
//
// Reparatia: recompensa devine RELATIVA — pe o urma, bratul cu cel mai mare PnL
// simulat castiga, celelalte pierd. Asa bandit-ul clasifica geometrii.
const geom = require('../../../server/services/dslGeomShadow');

const PRESETS = { fast: {}, tp: {}, def: {}, atr: {}, swing: {} };
const META = { side: 'LONG', entry: 100, originalSL: 99 };
const PRICES = [100, 101, 102];

function simStub(map) {
    return (preset) => {
        const name = Object.keys(PRESETS).find((k) => PRESETS[k] === preset);
        return { pnlPct: map[name] };
    };
}

describe('recompensa relativa', () => {
    it('bratul cu cel mai mare PnL simulat castiga, restul pierd', () => {
        const rows = geom.buildGeomRows({
            presets: PRESETS, meta: META, prices: PRICES, realizedPnlPct: 1.0,
            simulate: simStub({ fast: 1.5, tp: 1.4, def: 1.2, atr: 1.1, swing: 1.1 }),
        });
        const byArm = Object.fromEntries(rows.map((r) => [r.arm, r]));
        expect(byArm.fast.relWin).toBe(1);
        for (const a of ['tp', 'def', 'atr', 'swing']) expect(byArm[a].relWin).toBe(0);
    });

    it('REGRESIE: cand toate bat baza, relWin NU e 1 pentru toate', () => {
        // Asta era bugul: `win = advantage > 0` dadea 1 peste tot.
        const rows = geom.buildGeomRows({
            presets: PRESETS, meta: META, prices: PRICES, realizedPnlPct: 0.1,
            simulate: simStub({ fast: 1.5, tp: 1.4, def: 1.2, atr: 1.1, swing: 1.1 }),
        });
        expect(rows.every((r) => r.advantage > 0)).toBe(true);   // toate bat baza
        expect(rows.filter((r) => r.relWin === 1)).toHaveLength(1); // dar un singur castigator
    });

    it('cand toate PIERD fata de baza, tot exista un castigator RELATIV', () => {
        // Geometria cea mai putin rea e tot informatie.
        const rows = geom.buildGeomRows({
            presets: PRESETS, meta: META, prices: PRICES, realizedPnlPct: 5.0,
            simulate: simStub({ fast: 1.5, tp: 1.4, def: 1.2, atr: 1.1, swing: 1.1 }),
        });
        expect(rows.every((r) => r.advantage < 0)).toBe(true);
        const w = rows.filter((r) => r.relWin === 1);
        expect(w).toHaveLength(1);
        expect(w[0].arm).toBe('fast');
    });

    it('la egalitate perfecta nimeni nu castiga — altfel ordinea cheilor decide', () => {
        // Cu presete largi care nu se activeaza, egalitatea e frecventa. Daca
        // primul din obiect ar lua punctul, bandit-ul ar invata ordinea cheilor.
        const rows = geom.buildGeomRows({
            presets: PRESETS, meta: META, prices: PRICES, realizedPnlPct: 1.0,
            simulate: simStub({ fast: 1.2, tp: 1.2, def: 1.2, atr: 1.2, swing: 1.2 }),
        });
        expect(rows.filter((r) => r.relWin === 1)).toHaveLength(0);
    });

    it('un singur brat valid nu produce un clasament', () => {
        const rows = geom.buildGeomRows({
            presets: { fast: {} }, meta: META, prices: PRICES, realizedPnlPct: 1.0,
            simulate: () => ({ pnlPct: 1.5 }),
        });
        expect(rows).toHaveLength(1);
        expect(rows[0].relWin).toBe(0);
    });

    it('pastreaza advantage si baselinePnlPct neatinse — masuratoarea veche rămâne', () => {
        // Atentie: `simStub` cauta numele in PRESETS-ul de modul, deci presetele
        // trimise aici TREBUIE sa fie aceleasi obiecte. Altfel randurile se sar
        // in liniste si testul cade pentru un motiv care n-are legatura.
        const rows = geom.buildGeomRows({
            presets: { fast: PRESETS.fast, def: PRESETS.def },
            meta: META, prices: PRICES, realizedPnlPct: 1.0,
            simulate: simStub({ fast: 1.5, def: 1.2 }),
        });
        const f = rows.find((r) => r.arm === 'fast');
        expect(f.baselinePnlPct).toBe(1.0);
        expect(f.advantage).toBeCloseTo(0.5, 10);
        expect(f.simPnlPct).toBe(1.5);
    });

    it('un preset care crapa nu strica clasamentul celorlalte', () => {
        const P = { fast: { id: 'fast' }, rau: { id: 'rau' }, def: { id: 'def' } };
        const rows = geom.buildGeomRows({
            presets: P, meta: META, prices: PRICES, realizedPnlPct: 1.0,
            simulate: (p) => {
                if (p.id === 'rau') throw new Error('crap');
                return { pnlPct: p.id === 'fast' ? 1.5 : 1.2 };
            },
        });
        expect(rows.map((r) => r.arm).sort()).toEqual(['def', 'fast']);
        expect(rows.find((r) => r.arm === 'fast').relWin).toBe(1);
        expect(rows.find((r) => r.arm === 'def').relWin).toBe(0);
    });
});

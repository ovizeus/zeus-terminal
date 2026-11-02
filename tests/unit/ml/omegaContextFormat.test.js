'use strict';
// [2026-11-02] Forma in care OMEGA primeste adevarul despre Zeus.
//
// Interogarile se schimba cu schema; FORMA e ce ajunge in fata modelului si e
// ce decide daca raspunsul e coerent sau "tranga langa". De-aia e testata.
const C = require('../../../server/services/ml/_voice/omegaContext');

const NOW = 1800000000000;

describe('fmtAge', () => {
    it('secunde, minute, ore', () => {
        expect(C.fmtAge(45000)).toBe('45s');
        expect(C.fmtAge(120000)).toBe('2m');
        expect(C.fmtAge(7200000)).toBe('2h');
    });
    it('ce nu e numar nu devine 0 — Number(null) e 0 si trece de isFinite', () => {
        for (const v of [null, undefined, NaN, '60000', {}]) expect(C.fmtAge(v)).toBe('?');
        expect(C.fmtAge(-5)).toBe('?');
    });
});

describe('fmtMoney', () => {
    it('semnul e informatie, nu decor', () => {
        expect(C.fmtMoney(12.4)).toBe('+12.40');
        expect(C.fmtMoney(-9.8)).toBe('-9.80');
        expect(C.fmtMoney(0)).toBe('+0.00');
    });
    it('lipsa se spune, nu se inventeaza un zero', () => {
        for (const v of [null, undefined, NaN, '5']) expect(C.fmtMoney(v)).toBe('n/a');
    });
});

describe('formatDecisions — deciziile REALE ale creierului', () => {
    const rows = [
        { symbol: 'BNBUSDT', dir: 'SHORT', conf: 74, tier: 'MEDIUM', action: 'blocked_reflection', ts: NOW - 4000 },
        { symbol: 'LINKUSDT', dir: 'SHORT', conf: 58, tier: 'NO_TRADE', action: 'no_trade', ts: NOW - 64000 },
    ];

    it('REGRESIE: fiecare rand spune ce a vrut SI ce l-a oprit', () => {
        const out = C.formatDecisions(rows, NOW);
        // Inainte blocul venea din ml_influence_audit si arata asa pentru toate
        // cele 20.160 de randuri ale unei zile: "conf0 skipped". Inutil.
        expect(out).toContain('BNB SHORT conf74 medium blocked_reflection (4s)');
        expect(out).toContain('LINK SHORT conf58 no_trade no_trade (1m)');
        expect(out).not.toContain('skipped');
    });

    it('fara decizii spune asta, nu tace', () => {
        expect(C.formatDecisions([], NOW)).toBe('none in the last 5min.');
        expect(C.formatDecisions(null, NOW)).toBe('none in the last 5min.');
    });

    it('taie la sase — promptul are buget, nu e un jurnal', () => {
        const many = Array.from({ length: 20 }, (_, i) => ({ symbol: 'BTCUSDT', dir: 'LONG', conf: i, tier: 'SMALL', action: 'no_trade', ts: NOW }));
        expect(C.formatDecisions(many, NOW).split(' | ')).toHaveLength(C.MAX_DECISIONS);
    });

    it('campuri lipsa nu rup randul', () => {
        const out = C.formatDecisions([{ symbol: null, dir: null, conf: null, tier: null, action: null, ts: null }], NOW);
        expect(out).toContain('?');
        expect(out).not.toContain('undefined');
        expect(out).not.toContain('NaN');
    });
});

describe('formatBlocked — de ce NU a intrat', () => {
    it('REGRESIE: motivul si de cate ori, pe intelesul operatorului', () => {
        const out = C.formatBlocked([
            { reason: 'MIXED_DIRECTION_SAME_MODE', n: 180 },
            { reason: 'OPPOSITE_SIDE_SAME_MODE', n: 18 },
            { reason: 'MAX_POSITIONS', n: 2 },
        ]);
        expect(out).toBe('mixed-direction ×180, opposite-side ×18, max-positions ×2');
    });
    it('nimic blocat se spune explicit', () => {
        expect(C.formatBlocked([])).toBe('nothing blocked in the last 24h.');
    });
});

describe('formatAccount — cum sta operatorul', () => {
    it('balanta, ziua, rata de castig, seria', () => {
        expect(C.formatAccount({ mode: 'demo', balance: 25755.54, dailyPnl: -9.8, closedCount: 100, wins: 38, lossStreak: 2 }))
            .toBe('demo balance $25755.54 · today -9.80 · 100 closed, 38% win · loss streak 2.');
    });

    it('REGRESIE: nu scrie 0% castig cand nu exista nicio tranzactie', () => {
        // Un procent dintr-un numitor zero suna ca o masuratoare si e o minciuna.
        const out = C.formatAccount({ mode: 'demo', balance: 10000, closedCount: 0, wins: 0 });
        expect(out).not.toContain('%');
        expect(out).toContain('0 closed');
    });

    it('seria de castig are prioritate cand exista', () => {
        expect(C.formatAccount({ balance: 1, winStreak: 3, lossStreak: 0 })).toContain('win streak 3');
    });

    it('fara date spune n/a', () => {
        expect(C.formatAccount(null)).toBe('n/a.');
        expect(C.formatAccount({})).toBe('n/a.');
    });
});

describe('formatThoughts — propriile lui ganduri', () => {
    it('REGRESIE: isi vede gandurile din THE VOICE', () => {
        // Fara ele raspundea "Nu am un mesaj anterior de la echipa" despre un
        // gand pe care tocmai il emisese el insusi.
        const out = C.formatThoughts([{ text: 'skipping SHORT LINKUSDT on demo', ts: NOW - 120000 }], NOW);
        expect(out).toBe('2m ago: skipping SHORT LINKUSDT on demo');
    });
    it('textul lung se scurteaza, nu umple promptul', () => {
        const out = C.formatThoughts([{ text: 'x'.repeat(400), ts: NOW }], NOW);
        expect(out.length).toBeLessThan(140);
        expect(out.endsWith('…')).toBe(true);
    });
    it('fara ganduri spune asta', () => {
        expect(C.formatThoughts([], NOW)).toBe('nothing said recently.');
    });
});

describe('formatCloses', () => {
    it('ultimele inchideri cu PnL si motiv', () => {
        expect(C.formatCloses([{ symbol: 'BTCUSDT', side: 'LONG', pnl: 12.4, reason: 'DSL_PL' }]))
            .toBe('BTC LONG +12.40 DSL_PL');
    });
    it('fara inchideri spune asta', () => {
        expect(C.formatCloses([])).toBe('none yet.');
    });
});

describe('formatLiquidations — unde s-au ars banii', () => {
    it('REGRESIE: Zeus tine 30 de zile de lichidari, OMEGA nu le vedea deloc', () => {
        expect(C.formatLiquidations([
            { symbol: 'XAUUSDT', n: 151, usd: 828_300_000 },
            { symbol: 'BTCUSDT', n: 1961, usd: 492_100_000 },
        ])).toBe('XAU $828.3M (151), BTC $492.1M (1961)');
    });
    it('miliardele se scriu ca miliarde, nu ca 7470.0M', () => {
        expect(C.formatLiquidations([{ symbol: 'BTCUSDT', n: 2, usd: 7_470_000_000 }])).toContain('$7.5B');
    });
    it('fara date spune asta, nu inventeaza zero', () => {
        expect(C.formatLiquidations([])).toBe('no liquidation data.');
        expect(C.formatLiquidations(null)).toBe('no liquidation data.');
    });
});

describe('gatherLiquidations — "cele mai mari" inseamna bani, nu bucati', () => {
    it('REGRESIE: reasaza dupa dolari, fiindca liqStore sorteaza dupa numar', () => {
        // Date reale din 2026-11-02: ETH avea mai multe evenimente, BTC de sase
        // ori mai multi dolari. Promptul scrie "biggest first" — trebuie sa fie.
        const fake = { symbols: () => ([
            { symbol: 'ETHUSDT', n: 2305, usd: 86_700_000 },
            { symbol: 'BTCUSDT', n: 1995, usd: 508_300_000 },
            { symbol: 'AKEUSDT', n: 1082, usd: 100_000 },
        ]) };
        const out = C.gatherLiquidations(fake);
        expect(out.map(r => r.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'AKEUSDT']);
    });

    it('cere mai multe decat arata, altfel reasezarea n-ar avea ce muta', () => {
        let askedLimit = null;
        C.gatherLiquidations({ symbols: (o) => { askedLimit = o.limit; return []; } });
        expect(askedLimit).toBeGreaterThan(5);
    });

    it('nu arunca daca liqStore lipseste sau crapa', () => {
        expect(C.gatherLiquidations(null)).toEqual([]);
        expect(C.gatherLiquidations({ symbols: () => { throw new Error('x'); } })).toEqual([]);
    });
});

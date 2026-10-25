'use strict';
// tests/unit/liq-gate-normalize.test.js
//
// [LIQ-GATE 2026-10-25] Gate.io e singura dintre cele trei burse propuse care
// are canal PUBLIC de lichidari pe toate simbolurile — `futures.public_liquidates`
// cu `!all`. Masurat: 12 lichidari in 50 de secunde, 6 simboluri, adica de
// ordinul a 16x cat aduceau Bybit + OKX la un loc.
//
// Hyperliquid a respins explicit toate cele trei variante de abonare la
// lichidari; Bitget accepta canalul si nu livreaza nimic (0 mesaje in 40 s pe
// 8 simboluri). Pe amandoua le-am lasat afara: o conexiune care produce zero
// e exact ce avem deja cu Binance.
//
// ⚠️ AICI SE NASC CIFRELE FANTOMA, si de asta fisierul asta exista:
//
// `size` de la Gate e in CONTRACTE, nu in monede, iar multiplicatorul difera
// salbatic de la contract la contract:
//
//     BTC_USDT  -> 0.0001   (1 contract = 0,0001 BTC)
//     BLUR_USDT -> 1
//     2Z_USDT   -> 100
//
// Fara multiplicator, o lichidare de 1000 de contracte pe BTC s-ar socoti ca
// 1000 BTC (~80 de milioane) in loc de 0,1 BTC (~8 mii). De 10.000 de ori mai
// mare. Aia e FIX clasa „multi-billion-dollar phantom clusters" pentru care
// modelul sintetic a fost scos din Zeus. Deci: multiplicator necunoscut =
// evenimentul se ARUNCA, nu se ghiceste.
//
// SEMNUL, cu dovada nu cu presupunere: in `liq_orders` se vede
// `order_size: "-160"` cu `order_price` 80027 SUB `fill_price` 80267 — un
// ordin de VANZARE pus sub piata ca sa se execute sigur, adica iesirea
// fortata a unui LONG. Deci size negativ = SELL = long lichidat, aceeasi
// conventie canonica cu Binance si Bybit.

const gate = require('../../server/services/liqGate');

describe('Gate.io — simbolul', () => {
    test('contractul devine simbol canonic', () => {
        expect(gate.toSymbol('BTC_USDT')).toBe('BTCUSDT');
        expect(gate.toSymbol('PEPE_USDT')).toBe('PEPEUSDT');
        expect(gate.toSymbol('1000SHIB_USDT')).toBe('1000SHIBUSDT');
    });

    test('ce nu arata a contract nu devine simbol', () => {
        for (const bad of [null, undefined, '', 42, 'BTC', {}]) {
            expect(gate.toSymbol(bad)).toBe(null);
        }
    });
});

describe('Gate.io — multiplicatorul, acolo unde se nasc cifrele fantoma', () => {
    beforeEach(() => gate._setMultipliersForTest({ BTC_USDT: 0.0001, BLUR_USDT: 1, '2Z_USDT': 100 }));

    test('BTC: 160 de contracte NU inseamna 160 BTC', () => {
        const e = gate.normalize({ contract: 'BTC_USDT', price: '80267.5', size: -160, time: 1792964953110 });
        // 160 × 0,0001 = 0,016 BTC × 80267,5 = 1.284,28 $
        expect(e.q).toBeCloseTo(0.016, 6);
        expect(e.vol).toBeCloseTo(1284.28, 2);
        expect(e.vol).toBeLessThan(2000);       // NU 12,8 milioane
    });

    test('multiplicator 1 si multiplicator 100 dau rezultate diferite', () => {
        const a = gate.normalize({ contract: 'BLUR_USDT', price: '1', size: -10, time: Date.now() });
        const b = gate.normalize({ contract: '2Z_USDT', price: '1', size: -10, time: Date.now() });
        expect(a.vol).toBeCloseTo(10, 6);
        expect(b.vol).toBeCloseTo(1000, 6);
    });

    test('MULTIPLICATOR NECUNOSCUT: evenimentul se ARUNCA, nu se ghiceste cu 1', () => {
        // Un contract listat azi, pe care inca nu-l avem in harta. A presupune
        // multiplicatorul 1 ar putea umfla cifra de 100 de ori, in liniste.
        expect(gate.normalize({ contract: 'NOUCONTRACT_USDT', price: '5', size: -10, time: Date.now() })).toBe(null);
    });
});

describe('Gate.io — semnul, cu dovada', () => {
    beforeEach(() => gate._setMultipliersForTest({ BTC_USDT: 0.0001 }));

    test('size NEGATIV = vanzare fortata = LONG lichidat', () => {
        const e = gate.normalize({ contract: 'BTC_USDT', price: '80000', size: -100, time: Date.now() });
        expect(e.side).toBe('SELL');
        expect(e.isLong).toBe(true);
    });

    test('size POZITIV = cumparare fortata = SHORT lichidat', () => {
        const e = gate.normalize({ contract: 'BTC_USDT', price: '80000', size: 100, time: Date.now() });
        expect(e.side).toBe('BUY');
        expect(e.isLong).toBe(false);
    });

    test('marimea e mereu pozitiva — semnul e informatie despre PARTE, nu despre cantitate', () => {
        const a = gate.normalize({ contract: 'BTC_USDT', price: '80000', size: -100, time: Date.now() });
        const b = gate.normalize({ contract: 'BTC_USDT', price: '80000', size: 100, time: Date.now() });
        expect(a.q).toBeGreaterThan(0);
        expect(b.q).toBeGreaterThan(0);
        expect(a.vol).toBeCloseTo(b.vol, 6);
    });
});

describe('Gate.io — ce NU intra in baza', () => {
    beforeEach(() => gate._setMultipliersForTest({ BTC_USDT: 0.0001 }));

    test('date stricate dau null, nu aruncă', () => {
        const bad = [
            null, undefined, {}, { contract: 'BTC_USDT' },
            { contract: 'BTC_USDT', price: '0', size: -1, time: 1 },
            { contract: 'BTC_USDT', price: 'abc', size: -1, time: 1 },
            { contract: 'BTC_USDT', price: '80000', size: 0, time: 1 },
            { contract: 'BTC_USDT', price: '-80000', size: -1, time: 1 },
        ];
        for (const b of bad) {
            expect(() => gate.normalize(b)).not.toThrow();
            expect(gate.normalize(b)).toBe(null);
        }
    });

    test('forma iesirii e EXACT cea pe care o asteapta restul lantului', () => {
        const e = gate.normalize({ contract: 'BTC_USDT', price: '80000', size: -100, time: 1792964953110 });
        expect(Object.keys(e).sort()).toEqual(
            ['exchange', 'isLong', 'p', 'q', 'side', 'symbol', 'time', 'vol'].sort());
        expect(e.exchange).toBe('gate');
        expect(e.symbol).toBe('BTCUSDT');
        expect(typeof e.time).toBe('number');
    });

    test('timpul in SECUNDE se converteste in milisecunde', () => {
        // `liq_orders` da secunde, fluxul WS da milisecunde. Daca le amestecam,
        // evenimentele din REST ar cadea in 1970 si ar disparea din fereastra.
        const e = gate.normalize({ contract: 'BTC_USDT', price: '80000', size: -100, time: 1792964953 });
        expect(e.time).toBeGreaterThan(1.7e12);
    });
});

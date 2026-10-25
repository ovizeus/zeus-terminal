'use strict';
// ══════════════════════════════════════════════════════════════════
// Gate.io — lichidări publice, pe toate simbolurile
// ══════════════════════════════════════════════════════════════════
//
// [LIQ-GATE 2026-10-25] Dintre cele trei burse propuse operatorului, Gate e
// singura cu canal PUBLIC de lichidări pe toate simbolurile:
// `futures.public_liquidates` cu payload `!all`. Măsurat la probă: 12
// lichidări în 50 de secunde, 6 simboluri — de ordinul a 16× cât aduceau
// Bybit + OKX împreună.
//
// Hyperliquid a respins explicit toate variantele de abonare la lichidări.
// Bitget acceptă canalul `liquidation` şi nu livrează nimic (0 mesaje în 40 s,
// pe 8 simboluri), iar `liquidation-orders` dă „Param error". Pe amândouă
// le-am lăsat afară: o conexiune care produce zero e exact ce avem deja cu
// Binance, adică zgomot cu aparenţă de acoperire.
//
// ⚠️ UNDE SE NASC CIFRELE FANTOMĂ
//
// `size` e în CONTRACTE, nu în monede, iar multiplicatorul diferă sălbatic:
//
//     BTC_USDT  → 0.0001        BLUR_USDT → 1        2Z_USDT → 100
//
// Fără multiplicator, 1000 de contracte pe BTC s-ar socoti 1000 BTC (~80 de
// milioane) în loc de 0,1 BTC (~8 mii). **De 10.000 de ori mai mult.** Aia e
// fix clasa „multi-billion-dollar phantom clusters" pentru care modelul
// sintetic a fost scos din Zeus. Deci multiplicator necunoscut ⇒ evenimentul
// se ARUNCĂ. Nu se ghiceşte cu 1.
//
// SEMNUL, cu dovadă nu cu presupunere: în `liq_orders` se vede
// `order_size: "-160"` cu `order_price` 80027 SUB `fill_price` 80267 — un
// ordin de VÂNZARE pus sub piaţă ca să se execute sigur, adică ieşirea forţată
// a unui LONG. Deci size negativ = SELL = long lichidat, aceeaşi convenţie
// canonică cu Binance şi Bybit.

const CONTRACTS_URL = 'https://api.gateio.ws/api/v4/futures/usdt/contracts';
const REFRESH_MS = 6 * 3600 * 1000;   // multiplicatorii se schimbă rar; contracte noi apar zilnic

let _mult = Object.create(null);
let _loadedAt = 0;

/** `BTC_USDT` → `BTCUSDT`. Orice altceva → null. */
function toSymbol(contract) {
    if (typeof contract !== 'string') return null;
    const c = contract.trim().toUpperCase();
    if (!/^[A-Z0-9]+_[A-Z0-9]+$/.test(c)) return null;
    return c.replace('_', '');
}

/**
 * Normalizează un eveniment Gate la forma canonică a lui liqFeedAggregator.
 * Întoarce null pentru orice nu poate fi calculat CORECT — inclusiv când
 * multiplicatorul lipseşte. Mai bine un eveniment pierdut decât o cifră falsă.
 */
function normalize(raw) {
    try {
        if (!raw || typeof raw !== 'object') return null;
        const symbol = toSymbol(raw.contract);
        if (!symbol) return null;

        const mult = _mult[String(raw.contract).trim().toUpperCase()];
        if (!Number.isFinite(mult) || mult <= 0) return null;   // fără multiplicator nu inventăm

        const price = Number(raw.price);
        if (!Number.isFinite(price) || price <= 0) return null;

        const sz = Number(raw.size);
        if (!Number.isFinite(sz) || sz === 0) return null;

        // Negativ = vânzare forţată = LONG lichidat (vezi nota de sus).
        const side = sz < 0 ? 'SELL' : 'BUY';
        const q = Math.abs(sz) * mult;
        const vol = q * price;
        if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(vol) || vol <= 0) return null;

        // `liq_orders` dă SECUNDE, fluxul WS dă milisecunde. Amestecate, cele
        // din REST ar cădea în 1970 şi ar dispărea din orice fereastră.
        let time = Number(raw.time);
        if (!Number.isFinite(time) || time <= 0) time = Date.now();
        else if (time < 1e12) time = time * 1000;

        return { exchange: 'gate', symbol, side, isLong: side === 'SELL', p: price, q, vol, time };
    } catch (_) {
        return null;
    }
}

/** Câte contracte cunoaştem — ca apelantul să poată spune dacă e gata. */
function multiplierCount() { return Object.keys(_mult).length; }
function loadedAt() { return _loadedAt; }

/**
 * Aduce multiplicatorii. Nu aruncă niciodată: dacă pică, păstrăm harta veche
 * (mai bună decât nimic) şi reîncercăm mai târziu.
 */
async function loadMultipliers(fetchImpl) {
    try {
        const f = fetchImpl || globalThis.fetch;
        if (typeof f !== 'function') return 0;
        const r = await f(CONTRACTS_URL);
        if (!r || !r.ok) return 0;
        const list = await r.json();
        if (!Array.isArray(list) || !list.length) return 0;
        const next = Object.create(null);
        for (const c of list) {
            const name = c && typeof c.name === 'string' ? c.name.trim().toUpperCase() : '';
            const m = Number(c && c.quanto_multiplier);
            if (name && Number.isFinite(m) && m > 0) next[name] = m;
        }
        if (!Object.keys(next).length) return 0;
        _mult = next;
        _loadedAt = Date.now();
        return Object.keys(_mult).length;
    } catch (_) {
        return 0;
    }
}

function needsRefresh() { return !_loadedAt || (Date.now() - _loadedAt) > REFRESH_MS; }

function _setMultipliersForTest(map) {
    _mult = Object.create(null);
    for (const k in map) _mult[k.toUpperCase()] = map[k];
    _loadedAt = Date.now();
}

module.exports = {
    toSymbol, normalize, loadMultipliers, needsRefresh,
    multiplierCount, loadedAt, _setMultipliersForTest, CONTRACTS_URL,
};

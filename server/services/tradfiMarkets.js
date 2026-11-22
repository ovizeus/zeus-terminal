'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// MARKETS — piete traditionale (aur, petrol, indici, actiuni), DOAR informare
// ═══════════════════════════════════════════════════════════════════════════
// [2026-11-21] Cerut de operator: „o rubrica gen stock … aur nvidia argint tesla petrol, top 100,
// de informare … daca poti face in timp real tot fa".
//
// SURSA: Gate.io futures (USDT). Are un catalog oficial pe categorii (`contract_type`: stocks /
// indices / commodities / metals / forex) — 456 actiuni, 18 indici, 12 metale. Toate preturile vin
// intr-o SINGURA cerere (`/futures/usdt/tickers`), deci timp real fara risc de limite.
// Pretul afisat = `index_price` (urmareste activul REAL); `last` doar daca indexul lipseste.
// Stooq (varianta initiala, intarziata 15 min) are acum un zid anti-bot — nu-l ocolim.
//
// Telefonul nu intreaba niciodata bursa: serverul aduce preturile la 3 s DOAR cat timp cineva
// s-a uitat in ultimul minut, si lumanarile zilnice (grafic 7 zile + corelatia cu BTC) o data la 6 h.

const GATE = 'https://api.gateio.ws/api/v4/futures/usdt';
const TICK_MS = 3000;
const IDLE_MS = 60_000;              // fara cereri un minut → nu mai intreaba Gate
const CANDLE_TTL_MS = 6 * 3600_000;
const CANDLE_GAP_MS = 400;           // ritm la reimprospatarea lumanarilor (~100 cereri in ~40 s)
const CORR_DAYS = 30;

// group: metals | energy | indices | forex | stocks | crypto ; market: orarul folosit pentru OPEN/CLOSED
const CATALOG = [
    // ── metale ──
    ['XAU', 'Gold', 'metals', 'cmdty'], ['XAG', 'Silver', 'metals', 'cmdty'], ['XPT', 'Platinum', 'metals', 'cmdty'],
    ['XPD', 'Palladium', 'metals', 'cmdty'], ['XCU', 'Copper', 'metals', 'cmdty'], ['XNI', 'Nickel', 'metals', 'cmdty'],
    ['XAL', 'Aluminium', 'metals', 'cmdty'],
    // ── energie ──
    ['CL', 'WTI Crude Oil', 'energy', 'cmdty'], ['BZ', 'Brent Crude Oil', 'energy', 'cmdty'], ['NG', 'Natural Gas', 'energy', 'cmdty'],
    // ── indici ──
    ['SPX500', 'S&P 500', 'indices', 'us'], ['NAS100', 'Nasdaq 100', 'indices', 'us'], ['US30', 'Dow Jones', 'indices', 'us'],
    ['US2000', 'Russell 2000', 'indices', 'us'], ['GER40', 'DAX 40', 'indices', 'de'], ['UK100', 'FTSE 100', 'indices', 'uk'],
    ['JPN225', 'Nikkei 225', 'indices', 'jp'], ['HK50', 'Hang Seng', 'indices', 'hk'], ['AUS200', 'ASX 200', 'indices', 'au'],
    ['KR200', 'KOSPI 200', 'indices', 'kr'],
    // ── valute + obligatiuni ──
    ['EURUSD', 'EUR / USD', 'forex', 'fx'], ['GBPUSD', 'GBP / USD', 'forex', 'fx'],
    ['TLT', 'US 20Y+ Treasury ETF', 'forex', 'us'],
    // ── actiuni (cele mai mari dupa capitalizare + cunoscute) ──
    ['NVDA', 'Nvidia'], ['AAPL', 'Apple'], ['MSFT', 'Microsoft'], ['GOOGL', 'Alphabet'], ['AMZN', 'Amazon'],
    ['META', 'Meta'], ['AVGO', 'Broadcom'], ['TSLA', 'Tesla'], ['BRKB', 'Berkshire Hathaway'], ['TSM', 'TSMC'],
    ['LLY', 'Eli Lilly'], ['JPM', 'JPMorgan'], ['V', 'Visa'], ['WMT', 'Walmart'], ['ORCL', 'Oracle'],
    ['XOM', 'Exxon Mobil'], ['NFLX', 'Netflix'], ['COST', 'Costco'], ['JNJ', 'Johnson & Johnson'], ['HD', 'Home Depot'],
    ['PG', 'Procter & Gamble'], ['UNH', 'UnitedHealth'], ['BAC', 'Bank of America'], ['ABBV', 'AbbVie'], ['KO', 'Coca-Cola'],
    ['AMD', 'AMD'], ['PLTR', 'Palantir'], ['CRM', 'Salesforce'], ['ASML', 'ASML'], ['CSCO', 'Cisco'],
    ['MCD', "McDonald's"], ['IBM', 'IBM'], ['GE', 'GE Aerospace'], ['MRK', 'Merck'], ['WFC', 'Wells Fargo'],
    ['MS', 'Morgan Stanley'], ['GS', 'Goldman Sachs'], ['AXP', 'American Express'], ['TMUS', 'T-Mobile US'], ['PEP', 'PepsiCo'],
    ['LIN', 'Linde'], ['NOW', 'ServiceNow'], ['ISRG', 'Intuitive Surgical'], ['INTU', 'Intuit'], ['QCOM', 'Qualcomm'],
    ['UBER', 'Uber'], ['ADBE', 'Adobe'], ['TXN', 'Texas Instruments'], ['BKNG', 'Booking'], ['AMAT', 'Applied Materials'],
    ['MU', 'Micron'], ['LRCX', 'Lam Research'], ['KLAC', 'KLA'], ['INTC', 'Intel'], ['DIS', 'Disney'],
    ['CAT', 'Caterpillar'], ['BA', 'Boeing'], ['NKE', 'Nike'], ['SBUX', 'Starbucks'], ['PYPL', 'PayPal'],
    ['SHOP', 'Shopify'], ['SPOT', 'Spotify'], ['ARM', 'Arm Holdings'], ['SMCI', 'Super Micro'], ['DELL', 'Dell'],
    ['ANET', 'Arista Networks'], ['BABA', 'Alibaba'], ['PDD', 'PDD Holdings'], ['SONY', 'Sony'], ['TM', 'Toyota'],
    ['NVO', 'Novo Nordisk'], ['LMT', 'Lockheed Martin'], ['RKLB', 'Rocket Lab'],
    // ── legate de crypto ──
    ['MSTR', 'Strategy (MicroStrategy)', 'crypto', 'us'], ['COIN', 'Coinbase', 'crypto', 'us'], ['HOOD', 'Robinhood', 'crypto', 'us'],
    ['IBIT', 'iShares Bitcoin ETF', 'crypto', 'us'], ['CRCL', 'Circle', 'crypto', 'us'], ['MARA', 'MARA Holdings', 'crypto', 'us'],
    ['CLSK', 'CleanSpark', 'crypto', 'us'], ['IREN', 'IREN', 'crypto', 'us'], ['GLXY', 'Galaxy Digital', 'crypto', 'us'],
    // ── [2026-11-22] adaugate la cererea operatorului („ce se uita traderii din lume") ──
    // volatilitate (pretul = nivelul indicelui; ~27 = VIX-style, ~56 = volatilitatea implicita BTC)
    ['VOLX', 'Volatility Index (VIX-style)', 'indices', 'us'], ['BVOL', 'Bitcoin Implied Volatility', 'indices', '24h'],
    ['EVOL', 'Ether Implied Volatility', 'indices', '24h'], ['GVZ', 'Gold Volatility (GVZ)', 'indices', 'us'],
    // ETF-urile pe care le urmaresc traderii
    ['SPY', 'SPDR S&P 500 ETF', 'indices', 'us'], ['QQQ', 'Invesco Nasdaq 100 ETF', 'indices', 'us'],
    ['SMH', 'VanEck Semiconductor ETF', 'indices', 'us'],
    // aur tokenizat (se tranzactioneaza non-stop, volum mare)
    ['XAUT', 'Tether Gold (XAUT)', 'crypto', '24h'], ['PAXG', 'PAX Gold (PAXG)', 'crypto', '24h'],
    ['BMNR', 'BitMine Immersion', 'crypto', 'us'],
    // actiuni americane foarte urmarite acum
    ['SNDK', 'SanDisk'], ['WDC', 'Western Digital'], ['MRVL', 'Marvell'], ['NBIS', 'Nebius'], ['CRWV', 'CoreWeave'],
    ['APP', 'AppLovin'], ['ASTS', 'AST SpaceMobile'], ['HIMS', 'Hims & Hers'], ['SOFI', 'SoFi'], ['RDDT', 'Reddit'],
    ['PANW', 'Palo Alto Networks'], ['NET', 'Cloudflare'], ['SNOW', 'Snowflake'], ['VRT', 'Vertiv'], ['GEV', 'GE Vernova'],
    ['CEG', 'Constellation Energy'], ['OKLO', 'Oklo'], ['SMR', 'NuScale Power'], ['IONQ', 'IonQ'], ['MELI', 'MercadoLibre'],
].map(([sym, name, group = 'stocks', market = 'us']) => ({ sym, name, group, market, contract: sym + '_USDT' }));

// ── orarul burselor (fara sarbatori legale — o zi de sarbatoare apare OPEN) ──
const SESS = {
    us: { tz: 'America/New_York', days: [1, 2, 3, 4, 5], open: [570, 960] },        // 9:30–16:00
    de: { tz: 'Europe/Berlin', days: [1, 2, 3, 4, 5], open: [540, 1050] },          // 9:00–17:30
    uk: { tz: 'Europe/London', days: [1, 2, 3, 4, 5], open: [480, 990] },           // 8:00–16:30
    jp: { tz: 'Asia/Tokyo', days: [1, 2, 3, 4, 5], open: [540, 930] },              // 9:00–15:30
    hk: { tz: 'Asia/Hong_Kong', days: [1, 2, 3, 4, 5], open: [570, 960] },          // 9:30–16:00
    au: { tz: 'Australia/Sydney', days: [1, 2, 3, 4, 5], open: [600, 960] },        // 10:00–16:00
    kr: { tz: 'Asia/Seoul', days: [1, 2, 3, 4, 5], open: [540, 930] },              // 9:00–15:30
};
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function localParts(tz, now) {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    const p = Object.fromEntries(f.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
    return { wd: WD[p.weekday], min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
/** Bursa e deschisa acum? PURA (now injectabil). Marfuri / valute: duminica 18:00 – vineri 17:00 ET, pauza 17–18. */
function isOpen(market, now = Date.now()) {
    if (market === '24h') return true;   // [2026-11-22] aur tokenizat, volatilitatea crypto: non-stop
    if (market === 'cmdty' || market === 'fx') {
        const { wd, min } = localParts('America/New_York', now);
        if (wd === 6) return false;
        if (wd === 0) return min >= 1080;
        if (wd === 5) return min < 1020;
        return !(min >= 1020 && min < 1080);
    }
    const s = SESS[market]; if (!s) return false;
    const { wd, min } = localParts(s.tz, now);
    return s.days.includes(wd) && min >= s.open[0] && min < s.open[1];
}

/** Corelatia Pearson a randamentelor zilnice (log), pe zilele comune. PURA. null daca < 15 zile. */
function corrDaily(a, b, days = CORR_DAYS) {
    const mb = new Map(b.map((k) => [k.t, k.c]));
    const pairs = [];
    for (let i = 1; i < a.length; i++) {
        const t = a[i].t, tp = a[i - 1].t;
        if (!mb.has(t) || !mb.has(tp)) continue;
        const ra = Math.log(a[i].c / a[i - 1].c), rb = Math.log(mb.get(t) / mb.get(tp));
        if (Number.isFinite(ra) && Number.isFinite(rb)) pairs.push([ra, rb]);
    }
    const p = pairs.slice(-days);
    if (p.length < 15) return null;
    const n = p.length, mx = p.reduce((s, x) => s + x[0], 0) / n, my = p.reduce((s, x) => s + x[1], 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (const [x, y] of p) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
    if (!(sxx > 0) || !(syy > 0)) return null;
    return Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
}

// ── stare ──
const _tick = new Map();        // contract -> ticker Gate
const _candles = new Map();     // contract -> [{t,c}] zilnice
let _tickAt = 0, _tickErr = null, _lastDemand = 0, _timer = null, _candleRun = null, _candleAt = 0;
let _available = null;          // Set de contracte in trading pe Gate

async function _get(url, fetchImpl) {
    const f = fetchImpl || fetch;
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 8000);
    try {
        const r = await f(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error('http_' + r.status);
        return await r.json();
    } finally { clearTimeout(to); }
}

async function refreshTickers(fetchImpl) {
    try {
        const arr = await _get(GATE + '/tickers', fetchImpl);
        if (!Array.isArray(arr)) throw new Error('bad_shape');
        for (const x of arr) if (x && x.contract) _tick.set(x.contract, x);
        _available = new Set(arr.map((x) => x && x.contract).filter(Boolean));
        _tickAt = Date.now(); _tickErr = null;
    } catch (e) { _tickErr = String(e && e.message || e); }
}

async function refreshCandles(fetchImpl, gapMs = CANDLE_GAP_MS) {
    if (_candleRun) return _candleRun;
    _candleRun = (async () => {
        const list = ['BTC_USDT', ...CATALOG.map((c) => c.contract).filter((c) => !_available || _available.has(c))];
        for (const c of list) {
            try {
                const arr = await _get(`${GATE}/candlesticks?contract=${encodeURIComponent(c)}&interval=1d&limit=61`, fetchImpl);
                if (Array.isArray(arr)) _candles.set(c, arr.map((k) => ({ t: Number(k.t), c: Number(k.c) })).filter((k) => k.t > 0 && k.c > 0));
            } catch (_) { /* pastram ce aveam */ }
            if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
        }
        _candleAt = Date.now();
    })().finally(() => { _candleRun = null; });
    return _candleRun;
}

function _loop() {
    if (Date.now() - _lastDemand > IDLE_MS) { _timer = null; return; }   // nimeni nu se uita → oprit
    refreshTickers().finally(() => { _timer = setTimeout(_loop, TICK_MS); if (_timer.unref) _timer.unref(); });
    if (Date.now() - _candleAt > CANDLE_TTL_MS && !_candleRun) refreshCandles().catch(() => {});
}
/** Cineva cere datele → porneste bucla daca era oprita. */
function touch() {
    _lastDemand = Date.now();
    if (!_timer) _loop();
}

function _num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
/** Instantaneul trimis aplicatiei. PURA fata de stare (now injectabil). */
function snapshot(now = Date.now()) {
    const btc = _candles.get('BTC_USDT') || [];
    const items = [];
    for (const c of CATALOG) {
        const t = _tick.get(c.contract);
        if (!t) continue;
        const price = _num(t.index_price) > 0 ? _num(t.index_price) : _num(t.last);
        if (!(price > 0)) continue;
        const k = _candles.get(c.contract) || [];
        const spark = k.slice(-7).map((x) => x.c);
        if (spark.length) spark[spark.length - 1] = price;           // ultima bara = acum
        const c30 = k.length > 30 ? k[k.length - 31].c : null;
        items.push({
            sym: c.sym, name: c.name, group: c.group, market: c.market,
            price, chg24: _num(t.change_percentage),
            high24: _num(t.high_24h), low24: _num(t.low_24h), vol24: _num(t.volume_24h_quote),
            chg30: c30 > 0 ? ((price - c30) / c30) * 100 : null,
            spark, corrBtc: k.length ? corrDaily(k, btc) : null,
            open: isOpen(c.market, now),
        });
    }
    return {
        ok: true, asOf: _tickAt || null, source: 'Gate.io futures (index price tracks the underlying)',
        stale: !_tickAt || now - _tickAt > 30_000, error: _tickErr, candlesAt: _candleAt || null,
        sessions: { us: isOpen('us', now), cmdty: isOpen('cmdty', now), fx: isOpen('fx', now), de: isOpen('de', now), jp: isOpen('jp', now) },
        items,
    };
}

function _resetForTest() { _tick.clear(); _candles.clear(); _tickAt = 0; _tickErr = null; _candleAt = 0; _available = null; _lastDemand = 0; if (_timer) { clearTimeout(_timer); _timer = null; } }

module.exports = { CATALOG, isOpen, corrDaily, refreshTickers, refreshCandles, touch, snapshot, _resetForTest };

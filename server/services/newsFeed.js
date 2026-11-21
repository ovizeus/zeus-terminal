'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// MARKET NEWS — stirile care misca piata + reactia MASURATA + calendarul economic
// ═══════════════════════════════════════════════════════════════════════════
// [2026-11-21] Cerut de operator: „o casuta cu news … toate stirile principale care influenteaza piata,
// bursa, crypto … sa faca corelatie intre ele … surse gratuite … calendar economic … sa fim blindati".
//
// SURSE (verificate de pe server 21 nov; cele care refuza robotii — CoinDesk, CNBC, FXStreet, BLS — NU se ocolesc):
//   piete: Bloomberg Markets, FT Markets, MarketWatch (3), Investing.com · marfuri: OilPrice, Kitco
//   crypto: Cointelegraph, The Block, Decrypt, Bitcoin Magazine, CryptoSlate, Bitcoin.com
//   oficiale: Fed (comunicate + discursuri), ECB, SEC · calendar: ForexFactory (JSON public saptamanal)
// Afisam DOAR titlul, sursa, ora si linkul (nu copiem articolele).
//
// CORELATIA = reactia MASURATA, nu ghicita: fiecare stire primeste etichete (ce active atinge), iar pentru
// fiecare eticheta masuram miscarea pretului la +15 si +60 de minute de la publicare, din lumanarile de 1 minut
// ale Gate (aceeasi sursa ca GLOBAL MARKETS). Formularea pe ecran e „s-a miscat DUPA", nu „din cauza".
// Aceeasi stire din mai multe surse = un singur grup; impactul creste cu numarul surselor si cu reactia.

const crypto = require('crypto');

const GATE = 'https://api.gateio.ws/api/v4/futures/usdt';
const UA = 'Mozilla/5.0 (compatible; ZeusTerminal/1.0; +https://zeus-terminal.com)';
const FEED_MS = 3 * 60_000;
const CAL_MS = 30 * 60_000;            // ForexFactory cere menajament: max ~2 cereri / 5 min
const PRICE_MS = 60_000;
const KEEP_MS = 48 * 3600_000;
const BRIEF_MS = 30 * 60_000;
const BRIEF_MAX_DAY = 60;              // Groq gratuit: 1000 cereri/zi, OMEGA are prioritate

const FEEDS = [
    { id: 'bloomberg', name: 'Bloomberg', url: 'https://feeds.bloomberg.com/markets/news.rss', cat: 'markets' },
    { id: 'ft', name: 'Financial Times', url: 'https://www.ft.com/markets?format=rss', cat: 'markets' },
    { id: 'mw', name: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', cat: 'markets' },
    { id: 'mwrt', name: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines', cat: 'markets' },
    { id: 'mwp', name: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_marketpulse', cat: 'markets' },
    { id: 'investing', name: 'Investing.com', url: 'https://www.investing.com/rss/news.rss', cat: 'markets' },
    { id: 'oilprice', name: 'OilPrice', url: 'https://oilprice.com/rss/main', cat: 'commodities' },
    { id: 'kitco', name: 'Kitco', url: 'https://www.kitco.com/news/rss', cat: 'commodities' },
    { id: 'ct', name: 'Cointelegraph', url: 'https://cointelegraph.com/rss', cat: 'crypto' },
    { id: 'theblock', name: 'The Block', url: 'https://www.theblock.co/rss.xml', cat: 'crypto' },
    { id: 'decrypt', name: 'Decrypt', url: 'https://decrypt.co/feed', cat: 'crypto' },
    { id: 'btcmag', name: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/feed', cat: 'crypto' },
    { id: 'cryptoslate', name: 'CryptoSlate', url: 'https://www.cryptoslate.com/feed/', cat: 'crypto' },
    { id: 'btccom', name: 'Bitcoin.com', url: 'https://news.bitcoin.com/feed/', cat: 'crypto' },
    { id: 'fed', name: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml', cat: 'macro', official: true },
    { id: 'fedsp', name: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/speeches.xml', cat: 'macro', official: true },
    { id: 'ecb', name: 'ECB', url: 'https://www.ecb.europa.eu/rss/press.html', cat: 'macro', official: true },
    { id: 'sec', name: 'SEC', url: 'https://www.sec.gov/news/pressreleases.rss', cat: 'macro', official: true },
];
const CAL_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

// ── etichete: cuvinte → activ + contractul Gate cu care masuram reactia ──
// (\b la capete; ordinea conteaza doar pentru afisare)
const TAGS = [
    { tag: 'BTC', re: /\b(bitcoin|btc)\b/i, px: 'BTC_USDT', cat: 'crypto' },
    { tag: 'ETH', re: /\b(ethereum|ether|eth)\b/i, px: 'ETH_USDT', cat: 'crypto' },
    { tag: 'SOL', re: /\b(solana)\b/i, px: 'SOL_USDT', cat: 'crypto' },
    { tag: 'XRP', re: /\b(xrp|ripple)\b/i, px: 'XRP_USDT', cat: 'crypto' },
    { tag: 'CRYPTO', re: /\b(crypto|cryptocurrenc\w*|stablecoins?|altcoins?|defi|etfs? flows?)\b/i, px: 'BTC_USDT', cat: 'crypto' },
    { tag: 'FED', re: /\b(fed|fomc|powell|federal reserve|rate cuts?|rate hikes?|interest rates?)\b/i, px: 'SPX500_USDT', cat: 'macro' },
    { tag: 'INFLATION', re: /\b(cpi|inflation|pce|consumer prices?)\b/i, px: 'SPX500_USDT', cat: 'macro' },
    { tag: 'JOBS', re: /\b(jobs report|payrolls?|nonfarm|unemployment|jobless claims)\b/i, px: 'SPX500_USDT', cat: 'macro' },
    { tag: 'ECB', re: /\b(ecb|lagarde|eurozone)\b/i, px: 'EURUSD_USDT', cat: 'macro' },
    { tag: 'DOLLAR', re: /\b(dollar|dxy|greenback|treasur(y|ies)|bond yields?|yields)\b/i, px: 'EURUSD_USDT', cat: 'macro' },
    { tag: 'TARIFFS', re: /\b(tariffs?|trade war|sanctions?)\b/i, px: 'SPX500_USDT', cat: 'macro' },
    { tag: 'STOCKS', re: /\b(s&p( 500)?|stocks?|wall street|equities|nasdaq|dow jones|the dow)\b/i, px: 'SPX500_USDT', cat: 'stocks' },
    { tag: 'GOLD', re: /\b(gold|bullion)\b/i, px: 'XAU_USDT', cat: 'commodities' },
    { tag: 'SILVER', re: /\b(silver)\b/i, px: 'XAG_USDT', cat: 'commodities' },
    { tag: 'OIL', re: /\b(oil|crude|opec\+?|brent|wti)\b/i, px: 'CL_USDT', cat: 'commodities' },
    { tag: 'GAS', re: /\b(natural gas|lng)\b/i, px: 'NG_USDT', cat: 'commodities' },
    { tag: 'NVDA', re: /\b(nvidia)\b/i, px: 'NVDA_USDT', cat: 'stocks' },
    { tag: 'TSLA', re: /\b(tesla|musk)\b/i, px: 'TSLA_USDT', cat: 'stocks' },
    { tag: 'AAPL', re: /\b(apple)\b/i, px: 'AAPL_USDT', cat: 'stocks' },
    { tag: 'MSFT', re: /\b(microsoft)\b/i, px: 'MSFT_USDT', cat: 'stocks' },
    { tag: 'AMZN', re: /\b(amazon)\b/i, px: 'AMZN_USDT', cat: 'stocks' },
    { tag: 'GOOGL', re: /\b(alphabet|google)\b/i, px: 'GOOGL_USDT', cat: 'stocks' },
    { tag: 'META', re: /\b(meta platforms|facebook|zuckerberg)\b/i, px: 'META_USDT', cat: 'stocks' },
    { tag: 'MSTR', re: /\b(microstrategy|saylor)\b/i, px: 'MSTR_USDT', cat: 'stocks' },
    { tag: 'COIN', re: /\b(coinbase)\b/i, px: 'COIN_USDT', cat: 'stocks' },
];
// pentru evenimentele din calendar: ce masuram dupa moneda tarii
const CAL_PX = { USD: ['SPX500_USDT', 'BTC_USDT', 'XAU_USDT'], EUR: ['EURUSD_USDT', 'GER40_USDT'], GBP: ['GBPUSD_USDT', 'UK100_USDT'],
    JPY: ['JPN225_USDT'], CNY: ['HK50_USDT'], AUD: ['AUS200_USDT'], ALL: ['SPX500_USDT', 'BTC_USDT'] };

// ── RSS / Atom (PUR) ──
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
function decode(s) {
    return String(s || '')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&([a-z0-9#]+);/gi, (m, n) => (ENT[n] != null ? ENT[n] : m))
        .replace(/\s+/g, ' ').trim();
}
function _tag(block, name) {
    const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
    return m ? m[1] : null;
}
/** Extrage {title, url, ts} din RSS 2.0 sau Atom. PURA. */
function parseFeed(xml) {
    const out = [];
    const blocks = String(xml || '').match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
    for (const b of blocks) {
        const title = decode(_tag(b, 'title'));
        let url = decode(_tag(b, 'link'));
        if (!url) { const m = b.match(/<link[^>]*href="([^"]+)"/i); url = m ? m[1] : ''; }
        if (!url) url = decode(_tag(b, 'guid'));
        const d = _tag(b, 'pubDate') || _tag(b, 'published') || _tag(b, 'updated') || _tag(b, 'dc:date');
        const ts = d ? Date.parse(decode(d)) : NaN;
        if (title && /^https?:\/\//i.test(url) && Number.isFinite(ts)) out.push({ title, url, ts });
    }
    return out;
}
function tagsOf(title) {
    const t = [];
    for (const x of TAGS) if (x.re.test(title) && !t.find((y) => y.px === x.px && y.tag === x.tag)) t.push(x);
    return t.slice(0, 4);
}
const STOP = new Set('the a an of to in on for and or as at by with from is are be its it this that after over amid new says said says will may could than more into up down out vs'.split(' '));
function _words(title) { return new Set(String(title).toLowerCase().replace(/[^a-z0-9$%. ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w))); }
/** Asemanarea a doua titluri (Jaccard pe cuvinte semnificative). PURA. */
function similar(a, b) {
    const A = _words(a), B = _words(b);
    if (!A.size || !B.size) return 0;
    let n = 0; for (const w of A) if (B.has(w)) n++;
    return n / (A.size + B.size - n);
}

// ── stare ──
const _items = new Map();      // id -> {id,title,url,ts,source,feed,cat,official,tags:[tag],px:[contract]}
const _clusters = [];          // {id, ts, items:[id], title, url, tags, cat, official}
const _react = new Map();      // `${px}|${minuteTs}` -> {p0,p15,p60}
const _queue = [];             // reactii de masurat
let _cal = [], _calAt = 0, _calErr = null;
const _feedState = new Map();  // feed.id -> {ok, at, n, err}
let _prices = new Map(), _pricesAt = 0;
let _brief = null, _briefCount = 0, _briefDay = '', _briefErr = null;
const _alerted = new Set();
let _timers = [];

async function _fetchText(url, fetchImpl) {
    const f = fetchImpl || fetch;
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 12_000);
    try {
        const r = await f(url, { signal: ctl.signal, headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, application/json, text/xml, */*' } });
        if (!r.ok) throw new Error('http_' + r.status);
        return await r.text();
    } finally { clearTimeout(to); }
}

function _addItem(feed, it, now) {
    if (now - it.ts > KEEP_MS || it.ts > now + 10 * 60_000) return null;
    const id = crypto.createHash('sha1').update(it.url).digest('base64url').slice(0, 14);
    if (_items.has(id)) return null;
    const tg = tagsOf(it.title);
    const item = { id, title: it.title.slice(0, 240), url: it.url, ts: Math.min(it.ts, now), source: feed.name, feed: feed.id,
        cat: feed.official ? 'macro' : (tg[0] && tg[0].cat) || feed.cat, official: !!feed.official, tags: tg.map((x) => x.tag), px: [...new Set(tg.map((x) => x.px))].slice(0, 3) };
    _items.set(id, item);
    // grupare: aceeasi poveste in 6 ore din alta sursa
    let cl = null;
    for (const c of _clusters) {
        if (Math.abs(c.ts - item.ts) > 6 * 3600_000) continue;
        const sim = similar(c.title, item.title);
        // aceeasi poveste: titluri foarte asemanatoare, SAU aceeasi eticheta principala in 2 ore si cuvinte comune
        const sameTag = item.tags[0] && c.tags[0] === item.tags[0] && Math.abs(c.ts - item.ts) <= 2 * 3600_000;
        if (sim >= 0.5 || (sameTag && sim >= 0.25)) { cl = c; break; }
    }
    if (cl) {
        cl.items.push(id);
        if (item.ts < cl.ts) { cl.ts = item.ts; }
        cl.official = cl.official || item.official;
        for (const t of item.tags) if (!cl.tags.includes(t)) cl.tags.push(t);
        for (const p of item.px) if (!cl.px.includes(p) && cl.px.length < 3) cl.px.push(p);
    } else {
        cl = { id, ts: item.ts, items: [id], title: item.title, url: item.url, tags: [...item.tags], px: [...item.px], cat: item.cat, official: item.official, firstSeen: now };
        _clusters.push(cl);
    }
    return item;
}

async function refreshFeeds(fetchImpl, now = Date.now()) {
    const added = [];
    for (const f of FEEDS) {
        try {
            const xml = await _fetchText(f.url, fetchImpl);
            const arr = parseFeed(xml);
            let n = 0;
            for (const it of arr) { const x = _addItem(f, it, now); if (x) { n++; added.push(x); } }
            _feedState.set(f.id, { ok: true, at: now, n: arr.length, err: null });
        } catch (e) { _feedState.set(f.id, { ok: false, at: now, n: 0, err: String(e && e.message || e) }); }
    }
    // curatenie
    for (const [id, it] of _items) if (now - it.ts > KEEP_MS) _items.delete(id);
    for (let i = _clusters.length - 1; i >= 0; i--) if (now - _clusters[i].ts > KEEP_MS) _clusters.splice(i, 1);
    // de masurat: fiecare grup × contractele lui
    for (const c of _clusters) for (const px of c.px) _queueReaction(px, c.ts);
    return added;
}

async function refreshCalendar(fetchImpl, now = Date.now()) {
    try {
        const arr = JSON.parse(await _fetchText(CAL_URL, fetchImpl));
        if (!Array.isArray(arr)) throw new Error('bad_shape');
        _cal = arr.map((e) => ({
            id: crypto.createHash('sha1').update(`${e.title}|${e.country}|${e.date}`).digest('base64url').slice(0, 12),
            title: String(e.title || '').slice(0, 120), country: String(e.country || ''), ts: Date.parse(e.date),
            impact: String(e.impact || ''), forecast: e.forecast || '', previous: e.previous || '', actual: e.actual || '',
        })).filter((e) => Number.isFinite(e.ts) && e.title && e.impact !== 'Holiday').sort((a, b) => a.ts - b.ts);
        _calAt = now; _calErr = null;
        for (const e of _cal) if (e.impact === 'High' && e.ts < now) for (const px of (CAL_PX[e.country] || CAL_PX.ALL)) _queueReaction(px, e.ts);
    } catch (e) { _calErr = String(e && e.message || e); }
}

// ── reactia masurata (lumanari de 1 minut Gate) ──
function _minute(ts) { return Math.floor(ts / 60_000) * 60_000; }
function _queueReaction(px, ts) {
    const k = `${px}|${_minute(ts)}`;
    const r = _react.get(k);
    if (r && r.p60 != null) return;
    if (!_queue.includes(k)) _queue.push(k);
}
/** Din lumanarile de 1 minut: pretul la publicare si la +15 / +60 min. PURA. */
function reactionFrom(candles, ts) {
    const m0 = _minute(ts) / 1000;
    const k = (candles || []).map((x) => ({ t: Number(x.t), o: Number(x.o), c: Number(x.c) })).filter((x) => x.t > 0 && x.c > 0).sort((a, b) => a.t - b.t);
    const at = (t) => { let best = null; for (const x of k) { if (x.t <= t) best = x; else break; } return best; };
    const first = k.find((x) => x.t >= m0);
    if (!first) return null;
    const p0 = first.o > 0 ? first.o : first.c;
    const c15 = at(m0 + 15 * 60), c60 = at(m0 + 60 * 60);
    const last = k[k.length - 1];
    return {
        p0,
        p15: c15 && last.t >= m0 + 15 * 60 ? c15.c : null,
        p60: c60 && last.t >= m0 + 60 * 60 ? c60.c : null,
    };
}
async function drainReactions(fetchImpl, max = 25, now = Date.now()) {
    let done = 0;
    while (_queue.length && done < max) {
        const k = _queue.shift();
        const [px, mStr] = k.split('|'); const m = Number(mStr);
        if (now - m < 2 * 60_000) { _queue.push(k); break; }          // prea proaspata
        try {
            const from = Math.floor(m / 1000) - 60, to = Math.min(Math.floor(now / 1000), Math.floor(m / 1000) + 3660);
            const txt = await _fetchText(`${GATE}/candlesticks?contract=${encodeURIComponent(px)}&interval=1m&from=${from}&to=${to}`, fetchImpl);
            const r = reactionFrom(JSON.parse(txt), m);
            if (r) _react.set(k, r);
            if (!r || r.p60 == null) { if (now - m < 3 * 3600_000) _queue.push(k); }   // revine mai tarziu
        } catch (_) { if (now - m < 3 * 3600_000) _queue.push(k); }
        done++;
        await new Promise((res) => setTimeout(res, fetchImpl ? 0 : 300));
    }
    for (const kk of _react.keys()) if (now - Number(kk.split('|')[1]) > KEEP_MS) _react.delete(kk);
    return done;
}
async function refreshPrices(fetchImpl, now = Date.now()) {
    try {
        const arr = JSON.parse(await _fetchText(`${GATE}/tickers`, fetchImpl));
        const m = new Map();
        for (const x of arr) { const p = Number(x.index_price) > 0 ? Number(x.index_price) : Number(x.last); if (p > 0) m.set(x.contract, p); }
        _prices = m; _pricesAt = now;
    } catch (_) { /* pastram ultimele */ }
}

const pct = (a, b) => (a > 0 && b > 0 ? ((b - a) / a) * 100 : null);
function _moves(pxList, ts) {
    return pxList.map((px) => {
        const r = _react.get(`${px}|${_minute(ts)}`);
        const now = _prices.get(px);
        return { px: px.replace('_USDT', ''), m15: r ? pct(r.p0, r.p15) : null, m60: r ? pct(r.p0, r.p60) : null, since: r ? pct(r.p0, now) : null };
    });
}
/** Impactul unui grup: surse distincte + oficial + reactia masurata (plafonata). PURA. */
function impactOf(nSources, official, moves) {
    const mx = Math.max(0, ...moves.map((m) => Math.abs(m.m60 ?? m.m15 ?? 0)));
    return nSources + (official ? 2 : 0) + Math.min(5, mx / 0.5);
}

// ── rezumatul AI (OMEGA / Groq gratuit, cu plafon) ──
/** Doar propozitii INTREGI (un raspuns taiat de limita de tokeni nu ajunge pe ecran rupt). PURA. */
function wholeSentences(text, max = 600) {
    const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
    const m = t.match(/^[\s\S]*[.!?](?=\s|$)/);
    return m ? m[0].trim() : null;
}
async function refreshBrief(llm, now = Date.now()) {
    const day = new Date(now).toISOString().slice(0, 10);
    if (day !== _briefDay) { _briefDay = day; _briefCount = 0; }
    if (!llm || typeof llm.available !== 'function' || !llm.available()) { _briefErr = 'unavailable'; return; }
    if (_briefCount >= BRIEF_MAX_DAY) { _briefErr = 'daily_cap'; return; }
    const top = snapshot(now).top.slice(0, 4);
    if (top.length < 2) return;
    const key = top.map((t) => t.id).join(',');
    if (_brief && _brief.key === key) return;
    // [2026-11-21] sensul SCRIS in cuvinte: cu „3.63%" fara semn, modelul a luat directia din titlu („falls")
    // si a scris „dropped 3.63%" cand BTC CRESCUSE 3,63%.
    const say = (m) => {
        const v = m.m60 != null ? m.m60 : m.m15; const w = m.m60 != null ? 'within 1 hour' : 'within 15 minutes';
        if (v == null) return null;
        return `${m.px} ${v > 0 ? 'ROSE' : v < 0 ? 'FELL' : 'was flat'} ${Math.abs(v).toFixed(2)}% ${w}`;
    };
    const lines = top.map((t, i) => { const mv = t.moves.map(say).filter(Boolean); return `${i + 1}. Headline: "${t.title}" (${t.sources.join(', ')})` + (mv.length ? `. Measured after publication: ${mv.join('; ')}.` : '. No measured move yet.'); });
    _briefCount++;
    try {
        const r = await llm.chat({
            messages: [
                { role: 'system', content: 'You are a sober institutional markets editor. Write 2-3 short sentences in plain English summarizing what is moving markets, using ONLY the headlines and the measured moves given. Report every measured move EXACTLY as given, keeping its direction (ROSE / FELL) and number, even when it contradicts the headline. Never invent numbers, causes or facts. Say "after", never "because". No advice.' },
                { role: 'user', content: lines.join('\n') },
            ],
            maxTokens: 900, temperature: 0.3, timeoutMs: 25_000,
        });
        const text = r && (r.text || r.content || (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content));
        const clean = wholeSentences(text);
        if (r && r.ok !== false && clean) { _brief = { key, text: clean, at: now }; _briefErr = null; }
        else _briefErr = (r && r.error) ? String(r.error).slice(0, 60) : 'no_text';
    } catch (e) { _briefErr = String(e && e.message || e).slice(0, 60); }
}

// ── alerte ──
// La prima verificare dupa pornire stirile deja existente sunt marcate „anuntate" (altfel fiecare restart
// ar retrimite notificarile din ultima ora). Calendarul NU — un eveniment peste 10 min se anunta oricum.
let _primed = false;
function alertsDue(now = Date.now()) {
    const out = [];
    const priming = !_primed; _primed = true;
    for (const e of _cal) {
        if (e.impact !== 'High') continue;
        const k = 'cal|' + e.id;
        if (e.ts - now <= 15 * 60_000 && e.ts - now > 0 && !_alerted.has(k)) { _alerted.add(k); out.push({ kind: 'calendar', title: `${e.country} ${e.title} in ${Math.round((e.ts - now) / 60_000)} min`, body: `High impact · forecast ${e.forecast || '—'} · previous ${e.previous || '—'}` }); }
    }
    for (const c of _clusters) {
        const k = 'news|' + c.id;
        if (_alerted.has(k) || now - c.ts > 60 * 60_000) continue;
        const srcs = new Set(c.items.map((id) => (_items.get(id) || {}).source).filter(Boolean));
        if ((c.official && (c.firstSeen || 0) > now - 10 * 60_000 && now - c.ts < 30 * 60_000) || (srcs.size >= 3 && now - c.ts < 45 * 60_000)) {
            _alerted.add(k);
            if (priming) continue;
            out.push({ kind: 'news', title: c.official ? 'Official: ' + [...srcs][0] : `Breaking · ${srcs.size} sources`, body: c.title });
        }
    }
    return out;
}

// ── instantaneul trimis aplicatiei ──
function snapshot(now = Date.now()) {
    const clusters = _clusters.map((c) => {
        const its = c.items.map((id) => _items.get(id)).filter(Boolean);
        const sources = [...new Set(its.map((i) => i.source))];
        const moves = _moves(c.px, c.ts);
        return {
            id: c.id, ts: c.ts, title: c.title, url: c.url, cat: c.cat, official: c.official, tags: c.tags.slice(0, 4),
            sources, links: its.slice(0, 5).map((i) => ({ source: i.source, url: i.url })), moves, impact: impactOf(sources.length, c.official, moves),
        };
    }).sort((a, b) => b.ts - a.ts);
    // topul: cel mai mare impact in 6 ore, dar O SINGURA stire pe poveste (aceeasi eticheta principala in 3 ore)
    const top = [];
    for (const c of clusters.filter((x) => now - x.ts < 6 * 3600_000).sort((a, b) => b.impact - a.impact || b.ts - a.ts)) {
        if (top.some((t) => t.tags[0] && t.tags[0] === c.tags[0] && Math.abs(t.ts - c.ts) < 3 * 3600_000)) continue;
        top.push(c); if (top.length >= 5) break;
    }
    const cal = _cal.filter((e) => e.ts > now - 36 * 3600_000 && e.ts < now + 7 * 86400_000 && e.impact !== 'Low' || (e.impact === 'Low' && e.ts > now && e.ts < now + 86400_000))
        .map((e) => ({ ...e, moves: e.ts < now && e.impact === 'High' ? _moves(CAL_PX[e.country] || CAL_PX.ALL, e.ts) : [] }));
    const feeds = FEEDS.map((f) => ({ id: f.id, name: f.name, ok: (_feedState.get(f.id) || {}).ok ?? null }));
    return {
        ok: true, asOf: now, pricesAt: _pricesAt || null, items: clusters.slice(0, 160), top, calendar: cal,
        brief: _brief ? { text: _brief.text, at: _brief.at } : null, briefStatus: _brief ? 'ok' : (_briefErr || 'pending'),
        calendarNote: _cal.some((e) => e.ts > now) ? null : 'The economic calendar for next week is published on Sunday.',
        sources: { total: FEEDS.length, ok: feeds.filter((f) => f.ok).length, list: feeds }, calendarAt: _calAt || null, calendarError: _calErr,
    };
}

// ── preferinte (alerte) ──
let _db = null;
function _getDb() { if (!_db) _db = require('./database').db; return _db; }
const PREFS = new Set(['off', 'app', 'app_tg']);
function getPrefs(uid) {
    try { const r = _getDb().prepare('SELECT alerts FROM news_prefs WHERE user_id = ?').get(uid); return { alerts: r && PREFS.has(r.alerts) ? r.alerts : 'app' }; }
    catch (_) { return { alerts: 'app' }; }
}
function setPrefs(uid, alerts) {
    if (!PREFS.has(alerts)) return false;
    _getDb().prepare('INSERT INTO news_prefs (user_id, alerts, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET alerts = excluded.alerts, updated_at = excluded.updated_at').run(uid, alerts, Date.now());
    return true;
}
function _sendAlerts(list) {
    if (!list.length) return;
    const bc = global.__zeusWsBroadcastAll;
    for (const a of list) { if (typeof bc === 'function') { try { bc({ type: 'news.alert', data: a }); } catch (_) { /* */ } } }
    try {
        const tg = require('./telegram');
        const rows = _getDb().prepare("SELECT user_id FROM news_prefs WHERE alerts = 'app_tg'").all();
        for (const r of rows) for (const a of list) { try { tg.sendToUser(r.user_id, `📰 ${a.title}\n${a.body}`); } catch (_) { /* */ } }
    } catch (_) { /* fara telegram */ }
}

function start() {
    if (_timers.length) return;
    const every = (fn, ms, first) => { const t = setInterval(() => { Promise.resolve().then(fn).catch(() => {}); }, ms); if (t.unref) t.unref(); _timers.push(t); setTimeout(() => Promise.resolve().then(fn).catch(() => {}), first); };
    every(() => refreshFeeds(), FEED_MS, 5_000);
    every(() => refreshCalendar(), CAL_MS, 8_000);
    every(() => refreshPrices(), PRICE_MS, 12_000);
    every(() => drainReactions(), 60_000, 40_000);
    every(() => _sendAlerts(alertsDue()), 60_000, 90_000);
    every(() => { let llm = null; try { llm = require('./ml/_voice/llmClient'); } catch (_) { /* */ } return refreshBrief(llm); }, BRIEF_MS, 120_000);
}
function stop() { for (const t of _timers) clearInterval(t); _timers = []; }
function _resetForTest() { _items.clear(); _clusters.length = 0; _react.clear(); _queue.length = 0; _cal = []; _calAt = 0; _calErr = null; _feedState.clear(); _prices = new Map(); _brief = null; _briefCount = 0; _briefErr = null; _alerted.clear(); _primed = true; }
function _setReactionForTest(px, ts, r) { _react.set(`${px}|${_minute(ts)}`, r); }
function _setPricesForTest(m) { _prices = new Map(Object.entries(m)); }

module.exports = {
    FEEDS, TAGS, parseFeed, decode, tagsOf, similar, reactionFrom, impactOf, wholeSentences,
    refreshFeeds, refreshCalendar, refreshPrices, drainReactions, refreshBrief, alertsDue, snapshot,
    getPrefs, setPrefs, start, stop, _resetForTest, _setReactionForTest, _setPricesForTest,
};

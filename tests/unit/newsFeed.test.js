'use strict';
// [2026-11-21] MARKET NEWS (services/newsFeed.js): fluxuri, etichete, grupare, reactia MASURATA,
// calendar, rezumat AI cu plafon, alerte, preferinte.
const fs = require('fs');
const os = require('os');
const path = require('path');

let news, db;
beforeAll(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-news-'));
    process.env.ZEUS_DB_PATH = path.join(tmp, 'test.db');
    db = require('../../server/services/database').db;
    news = require('../../server/services/newsFeed');
});
beforeEach(() => news._resetForTest());

const RSS = (items) => `<?xml version="1.0"?><rss><channel><title>x</title>${items.map((i) =>
    `<item><title><![CDATA[${i.t}]]></title><link>${i.u}</link><pubDate>${new Date(i.ts).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
const fakeFetch = (byUrl) => async (url) => {
    const body = typeof byUrl === 'function' ? byUrl(url) : byUrl[url];
    if (body == null) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
};

describe('cititorul RSS / Atom', () => {
    test('RSS 2.0 cu CDATA si entitati', () => {
        const out = news.parseFeed(RSS([{ t: 'Gold &amp; silver jump', u: 'https://x.com/a', ts: Date.UTC(2026, 10, 20, 10) }]));
        expect(out).toEqual([{ title: 'Gold & silver jump', url: 'https://x.com/a', ts: Date.UTC(2026, 10, 20, 10) }]);
    });
    test('Atom cu link href si updated', () => {
        const xml = '<feed><entry><title>Fed holds rates</title><link href="https://fed.gov/p1"/><updated>2026-11-20T18:00:00Z</updated></entry></feed>';
        expect(news.parseFeed(xml)[0]).toMatchObject({ title: 'Fed holds rates', url: 'https://fed.gov/p1' });
    });
    test('fara data sau fara link valid = ignorat (nu inventam ora)', () => {
        expect(news.parseFeed('<rss><item><title>x</title><link>https://a.b</link></item></rss>')).toEqual([]);
        expect(news.parseFeed('<rss><item><title>x</title><link>javascript:1</link><pubDate>Fri, 20 Nov 2026 10:00:00 GMT</pubDate></item></rss>')).toEqual([]);
    });
});

describe('etichete si grupare', () => {
    test('etichetele: activul + contractul cu care masuram', () => {
        expect(news.tagsOf('Bitcoin falls as Fed signals fewer rate cuts').map((t) => t.tag)).toEqual(['BTC', 'FED']);
        expect(news.tagsOf('Oil jumps after OPEC+ cut').map((t) => t.px)).toEqual(['CL_USDT']);
        expect(news.tagsOf('Local bakery opens')).toEqual([]);
    });
    test('aceeasi poveste din doua surse = un grup; poveste diferita = alt grup', async () => {
        const now = Date.UTC(2026, 10, 21, 12);
        const f = news.FEEDS;
        const map = {};
        map[f[0].url] = RSS([{ t: 'Fed holds interest rates steady, signals patience', u: 'https://a/1', ts: now - 30 * 60_000 }]);
        map[f[1].url] = RSS([{ t: 'Fed holds rates steady and signals patience on cuts', u: 'https://b/1', ts: now - 20 * 60_000 },
            { t: 'Nvidia beats earnings estimates', u: 'https://b/2', ts: now - 10 * 60_000 }]);
        await news.refreshFeeds(fakeFetch(map), now);
        const s = news.snapshot(now);
        const fed = s.items.find((c) => c.tags.includes('FED'));
        expect(fed.sources.length).toBe(2);
        expect(s.items.length).toBe(2);
    });
    test('o sursa care pica nu opreste restul si e raportata', async () => {
        const now = Date.UTC(2026, 10, 21, 12);
        const map = {}; map[news.FEEDS[2].url] = RSS([{ t: 'Gold climbs to record', u: 'https://c/1', ts: now - 60_000 }]);
        await news.refreshFeeds(fakeFetch(map), now);
        const s = news.snapshot(now);
        expect(s.items.length).toBe(1);
        expect(s.sources.ok).toBe(1);
        expect(s.sources.total).toBe(news.FEEDS.length);
    });
});

describe('reactia MASURATA (lumanari de 1 minut)', () => {
    const t0 = Date.UTC(2026, 10, 21, 10, 0) / 1000;
    const candles = Array.from({ length: 70 }, (_, i) => ({ t: t0 + i * 60, o: 100 + i * 0.1, c: 100 + (i + 1) * 0.1 }));
    test('pret la publicare, +15 si +60 min', () => {
        const r = news.reactionFrom(candles, t0 * 1000 + 20_000);
        expect(r.p0).toBeCloseTo(100, 6);
        expect(r.p15).toBeCloseTo(101.6, 6);   // lumanarea de la minutul 15 se inchide la 100 + 16*0.1
        expect(r.p60).toBeCloseTo(106.1, 6);
    });
    test('ora nu a trecut inca → null, nu o cifra ghicita', () => {
        const r = news.reactionFrom(candles.slice(0, 20), t0 * 1000);
        expect(r.p15).not.toBeNull();
        expect(r.p60).toBeNull();
    });
    test('impactul: surse + oficial + reactia (plafonata)', () => {
        expect(news.impactOf(1, false, [])).toBe(1);
        expect(news.impactOf(3, true, [{ m60: 1.0 }])).toBe(3 + 2 + 2);
        expect(news.impactOf(1, false, [{ m60: -20 }])).toBe(1 + 5);
    });
});

describe('rezumatul AI', () => {
    test('doar propozitii intregi (raspuns taiat = fara fraza rupta)', () => {
        expect(news.wholeSentences('BTC ROSE 3.63% within 1 hour. After the Hong Kong headline, BTC')).toBe('BTC ROSE 3.63% within 1 hour.');
        expect(news.wholeSentences('no ending')).toBeNull();
    });
    async function seed(now) {
        const map = {};
        map[news.FEEDS[0].url] = RSS([{ t: 'Bitcoin falls to its lowest in two years', u: 'https://a/1', ts: now - 90 * 60_000 },
            { t: 'Oil jumps after OPEC+ cut', u: 'https://a/2', ts: now - 80 * 60_000 }]);
        await news.refreshFeeds(fakeFetch(map), now);
        news._setReactionForTest('BTC_USDT', now - 90 * 60_000, { p0: 100, p15: 99, p60: 103.63 });
    }
    test('sensul miscarii ajunge SCRIS la model (ROSE / FELL), nu doar cifra', async () => {
        const now = Date.UTC(2026, 10, 21, 12);
        await seed(now);
        let sent = null;
        const llm = { available: () => true, chat: async (p) => { sent = p; return { ok: true, text: 'Bitcoin ROSE 3.63% within 1 hour after the headline.' }; } };
        await news.refreshBrief(llm, now);
        expect(sent.messages[1].content).toMatch(/BTC ROSE 3\.63% within 1 hour/);
        expect(news.snapshot(now).brief.text).toMatch(/ROSE 3\.63%/);
    });
    test('AI indisponibil = „unavailable", fara text inventat', async () => {
        const now = Date.UTC(2026, 10, 21, 12);
        await seed(now);
        await news.refreshBrief({ available: () => false }, now);
        const s = news.snapshot(now);
        expect(s.brief).toBeNull();
        expect(s.briefStatus).toBe('unavailable');
    });
    test('plafonul zilnic protejeaza OMEGA (max 60 / zi)', async () => {
        const now = Date.UTC(2026, 10, 21, 12);
        await seed(now);
        let calls = 0;
        const llm = { available: () => true, chat: async () => { calls++; return { ok: false, error: 'http_429' }; } };
        for (let i = 0; i < 80; i++) await news.refreshBrief(llm, now);
        expect(calls).toBe(60);
        expect(news.snapshot(now).briefStatus).toBe('daily_cap');
    });
});

describe('calendar si alerte', () => {
    test('eveniment High in 15 min → o singura alerta; Low → niciuna', async () => {
        const now = Date.UTC(2026, 10, 23, 13, 20);
        const cal = [
            { title: 'CPI m/m', country: 'USD', date: new Date(now + 10 * 60_000).toISOString(), impact: 'High', forecast: '0.3%', previous: '0.2%' },
            { title: 'Tiny index', country: 'NZD', date: new Date(now + 5 * 60_000).toISOString(), impact: 'Low', forecast: '', previous: '' },
        ];
        await news.refreshCalendar(fakeFetch(() => cal), now);
        const a = news.alertsDue(now);
        expect(a).toHaveLength(1);
        expect(a[0].title).toMatch(/USD CPI m\/m in 10 min/);
        expect(news.alertsDue(now)).toHaveLength(0);
    });
    test('stire din 3 surse in 45 min → alerta „Breaking"', async () => {
        const now = Date.UTC(2026, 10, 21, 12);
        const map = {};
        news.FEEDS.slice(0, 3).forEach((f, i) => { map[f.url] = RSS([{ t: 'Bitcoin ETF sees record outflows as Bitcoin slides' + (i ? ' again' : ''), u: `https://s${i}/1`, ts: now - (20 - i) * 60_000 }]); });
        await news.refreshFeeds(fakeFetch(map), now);
        const a = news.alertsDue(now);
        expect(a.some((x) => x.kind === 'news' && /3 sources/.test(x.title))).toBe(true);
    });
    test('saptamana viitoare nepublicata → mesaj cinstit, nu lista goala muta', async () => {
        const now = Date.UTC(2026, 10, 21, 12);
        await news.refreshCalendar(fakeFetch(() => [{ title: 'Old', country: 'USD', date: new Date(now - 86400_000).toISOString(), impact: 'High' }]), now);
        expect(news.snapshot(now).calendarNote).toMatch(/published on Sunday/);
    });
});

describe('preferintele de alerta', () => {
    test('implicit „app"; se salveaza; valoare necunoscuta refuzata', () => {
        expect(news.getPrefs(7).alerts).toBe('app');
        expect(news.setPrefs(7, 'app_tg')).toBe(true);
        expect(news.getPrefs(7).alerts).toBe('app_tg');
        expect(news.setPrefs(7, 'spam')).toBe(false);
        expect(news.getPrefs(7).alerts).toBe('app_tg');
    });
});

describe('alerte dupa restart', () => {
    test('prima verificare dupa pornire NU retrimite stirile deja existente; calendarul da', async () => {
        jest.resetModules();
        const fresh = require('../../server/services/newsFeed');
        const now = Date.UTC(2026, 10, 21, 12);
        const map = {};
        fresh.FEEDS.slice(0, 3).forEach((f, i) => { map[f.url] = RSS([{ t: 'Bitcoin ETF sees record outflows as Bitcoin slides' + (i ? ' again' : ''), u: `https://r${i}/1`, ts: now - (20 - i) * 60_000 }]); });
        await fresh.refreshFeeds(fakeFetch(map), now);
        await fresh.refreshCalendar(fakeFetch(() => [{ title: 'NFP', country: 'USD', date: new Date(now + 8 * 60_000).toISOString(), impact: 'High' }]), now);
        const a = fresh.alertsDue(now);
        expect(a.map((x) => x.kind)).toEqual(['calendar']);
        expect(fresh.alertsDue(now + 60_000)).toEqual([]);
    });
});

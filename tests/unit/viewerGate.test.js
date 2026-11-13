'use strict';
// [BETA-GATE 2026-11-13] Conturile noi vad doar chart, date de piata si
// lichidari. Poarta e pe server si e „interzis daca nu e pe lista".
const fs = require('fs');
const path = require('path');
const { classify, featureOf, createViewerGate, VIEWER_ALLOW, MESSAGE } = require('../../server/middleware/viewerGate');
const { levelOfUser } = require('../../server/services/accessLevel');

const ROOT = path.resolve(__dirname, '../..');

describe('levelOfUser — cade inchis', () => {
    test('adminul e mereu full, orice ar scrie in coloana', () => {
        expect(levelOfUser({ role: 'admin', access_level: 'viewer' })).toBe('full');
        expect(levelOfUser({ role: 'admin' })).toBe('full');
    });
    test('un user e full DOAR cu valoarea exacta', () => {
        expect(levelOfUser({ role: 'user', access_level: 'full' })).toBe('full');
        for (const v of ['viewer', '', null, undefined, 'FULL', 'Full', 'admin', 1, true]) {
            expect(levelOfUser({ role: 'user', access_level: v })).toBe('viewer');
        }
    });
    test('cont inexistent sau gunoi = viewer', () => {
        expect(levelOfUser(null)).toBe('viewer');
        expect(levelOfUser(undefined)).toBe('viewer');
        expect(levelOfUser('x')).toBe('viewer');
    });
});

describe('classify — ce are voie un viewer', () => {
    test('chart, date de piata si lichidari: permise', () => {
        for (const p of ['/api/market/klines', '/api/market/liq-panel', '/api/market/liq-map',
            '/api/market/liq-predict', '/api/market/bookmap', '/api/market/depth', '/api/liq/recent',
            '/api/market/symbol/BTCUSDT', '/api/fng']) {
            expect(classify('GET', p)).toMatchObject({ gated: true, allowed: true });
        }
    });

    test('⛔ tot ce e ACTIVITATE e refuzat, cu numele functiei', () => {
        const cases = [
            ['POST', '/api/at/toggle', 'autotrade'], ['POST', '/api/at/mode', 'autotrade'],
            ['GET', '/api/at/state', 'autotrade'], ['POST', '/api/at/demo/add-funds', 'autotrade'],
            ['POST', '/api/tc/sync', 'autotrade'], ['POST', '/api/panic', 'autotrade'],
            ['POST', '/api/order/place', 'trading'], ['POST', '/api/order/cancel', 'trading'],
            ['GET', '/api/positions', 'trading'], ['GET', '/api/balance', 'trading'],
            ['POST', '/api/leverage', 'trading'], ['POST', '/api/manual/protection', 'trading'],
            ['POST', '/api/exchange/save', 'trading'], ['POST', '/api/exchange/switch', 'trading'],
            ['POST', '/api/ares/fund', 'ares'], ['POST', '/api/user/ares', 'ares'], ['POST', '/api/ares/real-optin', 'ares'],
            ['POST', '/api/dsl/toggle', 'dsl'], ['GET', '/api/dsldrive/state', 'dsl'],
            ['GET', '/api/brain/dashboard', 'brain'], ['POST', '/api/brain/parity/client', 'brain'],
            ['POST', '/api/omega/chat', 'omega'], ['POST', '/api/omega/chat-stream', 'omega'], ['GET', '/api/omega/tts', 'omega'],
            ['POST', '/api/ring5/live-optin', 'omega'],
            ['GET', '/api/journal', 'journal'], ['GET', '/api/performance', 'journal'],
            ['POST', '/api/byoi/draft', 'byoi'], ['POST', '/api/byoi/submit/3', 'byoi'],
            ['GET', '/api/leaderboard', 'leaderboard'], ['GET', '/api/profile/5', 'leaderboard'],
        ];
        for (const [m, p, f] of cases) {
            expect([m, p, classify(m, p)]).toEqual([m, p, { gated: true, allowed: false, feature: f }]);
        }
    });

    test('⛔ metoda conteaza: citirea permisa nu deschide si scrierea', () => {
        expect(classify('GET', '/api/support/thread').allowed).toBe(true);
        expect(classify('POST', '/api/support/thread').allowed).toBe(false);
        expect(classify('DELETE', '/api/market/klines').allowed).toBe(false);
        expect(classify('POST', '/api/market/liq-panel').allowed).toBe(false);
    });

    test('⛔ o ruta noua, necunoscuta, e refuzata — chiar sub un prefix „prietenos"', () => {
        expect(classify('GET', '/api/market/ceva-nou').allowed).toBe(false);
        expect(classify('GET', '/api/market/cache/stats').allowed).toBe(false);
        expect(classify('GET', '/api/orice').allowed).toBe(false);
        expect(classify('GET', '/api/orice').feature).toBe('beta');
        expect(classify('GET', '/api/market/symbol/BTCUSDT/extra').allowed).toBe(false);
    });

    test('⛔ ocolisuri de cale nu trec', () => {
        expect(classify('GET', '/api/market/../at/state').allowed).toBe(false);
        expect(classify('GET', '/api//market/klines').allowed).toBe(false);
        expect(classify('GET', '/api/market/%2e%2e/at/state').allowed).toBe(false);
        expect(classify('get', '/api/market/klines/').allowed).toBe(true);     // bara de la capat si litere mici: aceeasi ruta
        expect(classify('GET', '/api/market/klines?symbol=BTCUSDT').allowed).toBe(true);
        expect(classify('HEAD', '/api/market/klines').allowed).toBe(true);
    });

    test('ce nu e sub /api nu e treaba portii', () => {
        expect(classify('GET', '/app/index.html')).toEqual({ gated: false, allowed: true, feature: null });
        expect(classify('POST', '/auth/logout').gated).toBe(false);
    });

    test('featureOf nu confunda prefixe vecine', () => {
        expect(featureOf('/api/user/ares')).toBe('ares');
        expect(featureOf('/api/user/telegram/test')).toBe('alerts');
        expect(featureOf('/api/atlas')).toBe('beta');           // nu e /api/at/
    });
});

describe('viewerGate — middleware', () => {
    const run = (level, method, url, user = { id: 7 }) => {
        const gate = createViewerGate({ levelOf: () => level });
        const [p] = url.split('?');
        const req = { method, path: p, baseUrl: '', user };
        const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
        let nexted = false;
        gate(req, res, () => { nexted = true; });
        return { nexted, res, req };
    };

    test('viewer la o ruta blocata: 403 beta_locked cu mesajul de beta', () => {
        const r = run('viewer', 'POST', '/api/at/toggle');
        expect(r.nexted).toBe(false);
        expect(r.res.code).toBe(403);
        expect(r.res.body).toEqual({ error: 'beta_locked', feature: 'autotrade', message: MESSAGE });
    });
    test('viewer la o ruta permisa trece', () => {
        expect(run('viewer', 'GET', '/api/market/liq-panel').nexted).toBe(true);
    });
    test('full trece peste tot, neschimbat', () => {
        expect(run('full', 'POST', '/api/at/toggle').nexted).toBe(true);
        expect(run('full', 'POST', '/api/order/place').nexted).toBe(true);
    });
    test('fara utilizator nu hotaraste poarta (rute publice / sessionAuth)', () => {
        expect(run('viewer', 'POST', '/api/client-error', null).nexted).toBe(true);
    });
    test('⛔ daca aflarea nivelului arunca, contul e tratat ca viewer', () => {
        const gate = createViewerGate({ levelOf: () => { throw new Error('db down'); } });
        const res = { code: 200, status(c) { this.code = c; return this; }, json() { return this; } };
        let nexted = false;
        gate({ method: 'POST', path: '/api/order/place', baseUrl: '', user: { id: 7 } }, res, () => { nexted = true; });
        expect(nexted).toBe(false);
        expect(res.code).toBe(403);
    });
    test('calea se citeste COMPLET si intr-un router montat', () => {
        const gate = createViewerGate({ levelOf: () => 'viewer' });
        const res = { code: 200, status(c) { this.code = c; return this; }, json() { return this; } };
        let nexted = false;
        gate({ method: 'POST', path: '/toggle', baseUrl: '/api/at', user: { id: 7 } }, res, () => { nexted = true; });
        expect(nexted).toBe(false);
    });
    test('mesajul nu promite nicio data', () => {
        expect(MESSAGE).not.toMatch(/\d{4}|soon|next week|tomorrow/i);
    });
});

// ── Inventarul rutelor REALE ale serverului ────────────────────────────────
// Citeste montarile din server.js si rutele din server/routes. Daca cineva
// adauga o ruta care devine permisa viewerilor, sau scoate una de pe lista,
// testul pica pana cand lista de aici e schimbata cu buna stiinta.
function inventory() {
    const MOUNTS = {
        marketProxy: '/api/market', market: '/api/market', srvPos: '/api/srv-pos', sync: '/api/sync',
        userContext: '/api/sync', profile: '/api/profile', leaderboard: '/api/leaderboard',
        referral: '/api/referral', appVersion: '/api/app', journal: '/api/journal',
        brainParity: '/api/brain/parity', omega: '/api/omega', doctor: '/api/omega/doctor',
        ring5: '/api/ring5', dslDrive: '/api/dsldrive', indicators: '/api/indicators',
        admin: '/api/admin', support: '/api/support', byoi: '/api/byoi', health: '/api/health',
        trading: '/api', exchange: '/api/exchange',
    };
    const out = [];
    const RE = /\.(get|post|put|delete|patch)\(\s*'([^']+)'/g;
    for (const [file, prefix] of Object.entries(MOUNTS)) {
        const src = fs.readFileSync(path.join(ROOT, 'server/routes', file + '.js'), 'utf8');
        let m;
        const re = new RegExp('router' + RE.source, 'g');
        while ((m = re.exec(src))) out.push(m[1].toUpperCase() + ' ' + (prefix + (m[2] === '/' ? '' : m[2])));
    }
    const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    let m;
    const re = new RegExp('app' + RE.source, 'g');
    while ((m = re.exec(srv))) if (m[2].startsWith('/api')) out.push(m[1].toUpperCase() + ' ' + m[2]);
    return [...new Set(out)];
}

describe('⛔ inventarul rutelor — nimic nu devine vizibil viewerilor din greseala', () => {
    const routes = inventory();
    const concrete = (r) => r.replace(/:[A-Za-z_]+/g, 'x1');

    test('inventarul chiar gaseste rutele (nu e un test care trece pe gol)', () => {
        expect(routes.length).toBeGreaterThan(200);
        expect(routes).toContain('POST /api/order/place');
        expect(routes).toContain('POST /api/at/toggle');
        expect(routes).toContain('GET /api/market/liq-panel');
    });

    test('fiecare montare din server.js e cunoscuta inventarului', () => {
        const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
        const used = [...srv.matchAll(/app\.use\(\s*'(\/api[^']*)'\s*,\s*(?:require\('\.\/server\/routes\/(\w+)'\)|(\w+))/g)]
            .map((x) => x[1]);
        const known = ['/api', '/api/market', '/api/srv-pos', '/api/sync', '/api/profile', '/api/leaderboard',
            '/api/referral', '/api/app', '/api/journal', '/api/brain/parity', '/api/omega', '/api/omega/doctor',
            '/api/ring5', '/api/dsldrive', '/api/indicators', '/api/admin', '/api/support', '/api/byoi',
            '/api/health', '/api/exchange'];
        for (const u of used) expect(known).toContain(u);
    });

    test('multimea rutelor permise e EXACT cea hotarata', () => {
        const allowed = routes.filter((r) => {
            const sp = r.indexOf(' ');
            return classify(r.slice(0, sp), concrete(r.slice(sp + 1))).allowed;
        }).sort();
        expect(allowed).toEqual([
            'GET /api/byoi/config', 'GET /api/byoi/indicators', 'GET /api/fng',
            'GET /api/indicators/usage', 'GET /api/liq/recent',
            'GET /api/market/bookmap', 'GET /api/market/depth', 'GET /api/market/funding',
            'GET /api/market/klines', 'GET /api/market/liq-map', 'GET /api/market/liq-panel',
            'GET /api/market/liq-predict', 'GET /api/market/markprice', 'GET /api/market/oi',
            'GET /api/market/sentiment', 'GET /api/market/spot/klines', 'GET /api/market/symbol/:symbol',
            'GET /api/market/ticker', 'GET /api/market/ticker/all', 'GET /api/market/ticker24hr',
            'GET /api/market/time', 'GET /api/market/top', 'GET /api/market/topLongShort',
            'GET /api/profile', 'GET /api/referral', 'GET /api/sd/symbols',
            'GET /api/support/thread', 'GET /api/support/unread',
            'GET /api/sync/state', 'GET /api/sync/user-context', 'GET /api/user/settings',
            'GET /api/version', 'GET /api/ws/health',
            'POST /api/app/version', 'POST /api/client-error', 'POST /api/indicators/active',
            'POST /api/profile', 'POST /api/support/send', 'POST /api/sync/state',
            'POST /api/sync/user-context', 'POST /api/user/settings',
        ].sort());
    });

    test('fiecare intrare de pe lista e o ruta care chiar exista (fara intrari moarte)', () => {
        for (const a of VIEWER_ALLOW) expect(routes).toContain(a);
    });

    test('⛔ nicio ruta care SCRIE in afara contului propriu nu e permisa', () => {
        const writes = routes.filter((r) => !r.startsWith('GET '))
            .filter((r) => { const sp = r.indexOf(' '); return classify(r.slice(0, sp), concrete(r.slice(sp + 1))).allowed; });
        expect(writes.sort()).toEqual(['POST /api/app/version', 'POST /api/client-error', 'POST /api/indicators/active',
            'POST /api/profile', 'POST /api/support/send', 'POST /api/sync/state', 'POST /api/sync/user-context',
            'POST /api/user/settings'].sort());
    });
});

describe('⛔ poarta e montata unde trebuie', () => {
    const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const at = (needle) => srv.indexOf(needle);

    test('imediat dupa sessionAuth', () => {
        const auth = at('app.use(createSessionAuth(');
        const gate = at(".createViewerGate()");
        expect(auth).toBeGreaterThan(0);
        expect(gate).toBeGreaterThan(auth);
        // nimic montat intre ele
        expect(srv.slice(auth, gate)).not.toMatch(/app\.(get|post|put|delete|patch)\(\s*'\/api/);
        expect((srv.slice(auth, gate).match(/app\.use\(/g) || []).length).toBe(2);   // sessionAuth + poarta
    });

    test('inaintea oricarei rute de activitate', () => {
        const gate = at(".createViewerGate()");
        for (const needle of ["app.use('/api', tradingRoutes)", "app.use('/api/exchange'", "app.use('/api/omega'",
            "app.use('/api/dsldrive'", "app.use('/api/journal'", "app.use('/api/sync'", "'/api/at/toggle'",
            "'/api/tc/sync'", "'/api/at/mode'", "'/api/panic'", "'/api/dsl/toggle'"]) {
            expect([needle, at(needle) > gate]).toEqual([needle, true]);
        }
    });

    test('ce e montat DEASUPRA portii e doar ce e public cu buna stiinta', () => {
        const before = srv.slice(0, at(".createViewerGate()"));
        const uses = [...before.matchAll(/app\.use\(\s*'(\/api[^']*)'/g)].map((m) => m[1]);
        expect(uses.sort()).toEqual(['/api', '/api/market', '/api/srv-pos'].sort());
        const direct = [...before.matchAll(/app\.(get|post|put|delete|patch)\(\s*'(\/api[^']*)'/g)].map((m) => m[2]);
        for (const d of direct) expect(d).toMatch(/^\/api\/(ws\/health|userdatastream\/health|health.*|version|client-error)$/);
    });
});

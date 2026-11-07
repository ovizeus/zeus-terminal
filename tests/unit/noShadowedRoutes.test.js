'use strict';

/**
 * [2026-11-07] No path may be mounted twice.
 *
 * Found by accident: /api/market/klines, /funding and /oi each had two
 * handlers. marketProxy mounts at server.js:170 and market at 1307, Express
 * matches in mount order, and marketProxy answers on every branch without ever
 * calling next() — so three handlers in market.js had never once executed.
 *
 * Nothing broke, which is the problem: a shadowed route is a change someone
 * made, tested in isolation, and shipped into a file that never runs. This
 * fails the moment a second handler appears on a path, so the next one is
 * caught by the suite rather than by someone wondering why their fix did
 * nothing.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function mountedRouters() {
    const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const mounts = [];
    const direct = /app\.use\('(\/[^']*)',\s*require\('\.\/server\/routes\/([a-zA-Z0-9_]+)'\)\)/g;
    for (let m; (m = direct.exec(srv));) mounts.push({ pos: m.index, prefix: m[1], file: `server/routes/${m[2]}.js` });
    const viaVar = /app\.use\('(\/[^']*)',\s*([a-zA-Z0-9_]+Routes)\)/g;
    for (let m; (m = viaVar.exec(srv));) {
        const decl = new RegExp(`const ${m[2]} = require\\('\\./server/routes/([a-zA-Z0-9_]+)'\\)`).exec(srv);
        if (decl) mounts.push({ pos: m.index, prefix: m[1], file: `server/routes/${decl[1]}.js` });
    }
    return mounts.sort((a, b) => a.pos - b.pos);
}

function routesOf(file) {
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) return [];
    const src = fs.readFileSync(full, 'utf8');
    const out = [];
    const re = /router\.(get|post|put|delete|patch)\('([^']*)'/g;
    for (let m; (m = re.exec(src));) out.push({ verb: m[1].toUpperCase(), sub: m[2] });
    return out;
}

describe('route mounting', () => {
    it('finds the mounted routers at all — a silent zero would make this test useless', () => {
        expect(mountedRouters().length).toBeGreaterThan(5);
    });

    it('no verb+path is handled by two routers', () => {
        const seen = new Map();
        const clashes = [];
        for (const mount of mountedRouters()) {
            for (const r of routesOf(mount.file)) {
                const key = `${r.verb} ${(mount.prefix.replace(/\/$/, '')) + r.sub}`;
                if (seen.has(key)) {
                    clashes.push(`${key} — wins: ${seen.get(key)}, shadowed: ${mount.file}`);
                } else {
                    seen.set(key, mount.file);
                }
            }
        }
        // the message carries the whole list, so a failure is actionable
        expect(clashes).toEqual([]);
    });

    it('the three that were shadowed are really gone from market.js', () => {
        const subs = routesOf('server/routes/market.js').map((r) => r.sub);
        for (const dead of ['/klines', '/funding', '/oi']) expect(subs).not.toContain(dead);
        // and the live ones are untouched
        for (const live of ['/liq-map', '/liq-predict', '/bookmap', '/depth']) expect(subs).toContain(live);
    });

    it('marketProxy still serves the three, so nothing was lost', () => {
        const subs = routesOf('server/routes/marketProxy.js').map((r) => r.sub);
        for (const kept of ['/klines', '/funding', '/oi']) expect(subs).toContain(kept);
    });
});

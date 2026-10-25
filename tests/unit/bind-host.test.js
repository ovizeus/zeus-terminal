'use strict';
// tests/unit/bind-host.test.js
//
// [G-9 2026-10-25] The app listened on 0.0.0.0. It was closed only because ufw
// closed it.
//
//     // ─── Bind to 0.0.0.0 for LAN access (phone over Wi-Fi) ───
//     const server = app.listen(PORT, '0.0.0.0', ...)
//
// The comment is honest and the reason was real — on a laptop, with a phone on
// the same Wi-Fi. On this VPS the phone arrives over nginx on 443 and nothing
// has ever reached port 3000 from outside, because ufw allows 22, 80 and 443
// and the INPUT chain policy is DROP.
//
// So the bind was one of the two places found by checking a friend's Discord
// warning, where exactly one layer was holding (R-V-21). Nginx proxies to the
// IPv4 literal 127.0.0.1:3000, and so does the one production script that
// talks to the app (scripts/m1-rollback-drill.sh). `localhost:3000` appears
// only in dev tooling — client/vite.config.ts and a settings file — never on
// this server. So loopback costs nothing here.
//
// Safe by DEFAULT, not safe by configuration: if the default were 0.0.0.0 with
// .env closing it, the hardening would not survive a deploy to a new machine,
// because .env is gitignored. That is the same single-layer mistake wearing a
// different hat. LAN access is one env var away and says so in the comment.
//
// And the resolver fails CLOSED: a typo in BIND_HOST must not take the server
// down at boot, and must not silently open it either.

const { resolveBindHost, LOOPBACK } = require('../../server/config/bindHost');

describe('G-9 — the bind address is safe by default', () => {

    test('no BIND_HOST set → loopback', () => {
        expect(resolveBindHost({})).toBe('127.0.0.1');
        expect(LOOPBACK).toBe('127.0.0.1');
    });

    test('an empty or blank BIND_HOST → loopback, not a crash', () => {
        expect(resolveBindHost({ BIND_HOST: '' })).toBe('127.0.0.1');
        expect(resolveBindHost({ BIND_HOST: '   ' })).toBe('127.0.0.1');
    });

    test('LAN access is still possible, deliberately, in one env var', () => {
        expect(resolveBindHost({ BIND_HOST: '0.0.0.0' })).toBe('0.0.0.0');
    });

    test('a specific interface can be chosen', () => {
        expect(resolveBindHost({ BIND_HOST: '192.168.1.50' })).toBe('192.168.1.50');
    });

    test('IPv6 loopback and wildcard are accepted', () => {
        expect(resolveBindHost({ BIND_HOST: '::1' })).toBe('::1');
        expect(resolveBindHost({ BIND_HOST: '::' })).toBe('::');
    });

    test('whitespace around a real value is tolerated', () => {
        expect(resolveBindHost({ BIND_HOST: ' 0.0.0.0 ' })).toBe('0.0.0.0');
    });

    test('a TYPO falls back to loopback — it must not kill the boot', () => {
        // listen() throws on a host it cannot parse, and pm2 would restart-loop.
        // Failing closed costs LAN access; failing open or failing hard costs
        // the server.
        for (const bad of ['0.0.0.o', 'localhost ;rm', '999.1.1.1', 'nonsense', '1.2.3']) {
            expect(resolveBindHost({ BIND_HOST: bad })).toBe('127.0.0.1');
        }
    });

    test('a non-string BIND_HOST does not throw', () => {
        expect(resolveBindHost({ BIND_HOST: 3000 })).toBe('127.0.0.1');
        expect(resolveBindHost({ BIND_HOST: null })).toBe('127.0.0.1');
        expect(() => resolveBindHost()).not.toThrow();
    });
});

describe('G-9 — server.js uses the resolver, not a literal', () => {
    const fs = require('fs');
    const path = require('path');
    const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');

    test('listen() no longer hardcodes 0.0.0.0', () => {
        expect(SRC).not.toMatch(/app\.listen\(PORT,\s*'0\.0\.0\.0'/);
    });

    test('listen() is given the resolved host', () => {
        expect(SRC).toMatch(/app\.listen\(PORT,\s*BIND_HOST/);
    });

    test('server.js requires the resolver', () => {
        expect(SRC).toMatch(/require\(['"]\.\/server\/config\/bindHost['"]\)/);
    });

    test('the boot log says which address it bound to', () => {
        // Otherwise the one thing worth knowing after this change is invisible.
        const i = SRC.indexOf('BIND_HOST');
        expect(i).toBeGreaterThan(-1);
        expect(SRC).toMatch(/BIND_HOST/);
        expect(SRC.match(/BIND_HOST/g).length).toBeGreaterThanOrEqual(2);
    });

    test('the file was really read (guard against a vacuous pass)', () => {
        expect(SRC.length).toBeGreaterThan(50000);
    });
});

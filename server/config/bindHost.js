'use strict';
// ══════════════════════════════════════════════════════════════════
// Which address the HTTP server listens on
// ══════════════════════════════════════════════════════════════════
//
// [G-9 2026-10-25] server.js used to say:
//
//     // ─── Bind to 0.0.0.0 for LAN access (phone over Wi-Fi) ───
//     const server = app.listen(PORT, '0.0.0.0', ...)
//
// The comment was honest and the reason was real — on a laptop, with a phone
// on the same Wi-Fi. On the VPS the phone arrives over nginx on 443, and
// nothing has ever reached port 3000 from outside: ufw allows 22, 80 and 443,
// and the INPUT chain policy is DROP.
//
// Which is exactly the problem. The port was closed by ONE layer, and the day
// ufw is stopped or flushed the app is on the internet with no TLS and none of
// the security headers, which live in nginx. R-V-21: a thing is safe only if
// it holds WITHOUT the layer covering it.
//
// Default loopback, LAN by opt-in — and that way round on purpose. If the
// default stayed 0.0.0.0 and .env closed it, the hardening would not survive a
// deploy to a new machine, because .env is gitignored. That is the same
// single-layer mistake wearing a different hat.
//
// Verified before changing it: nginx proxies to the IPv4 literal
// 127.0.0.1:3000 (three locations), and so does the only production script
// that talks to the app (scripts/m1-rollback-drill.sh). `localhost:3000`
// appears solely in dev tooling (client/vite.config.ts and a settings file),
// so the IPv6-vs-IPv4 trap that `localhost` sets has nothing to catch here.

const LOOPBACK = '127.0.0.1';

// Dotted quad with every octet in range, or the two IPv6 literals worth having.
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6_OK = new Set(['::', '::1']);

/**
 * Resolve the listen address. Fails CLOSED: anything unparseable becomes
 * loopback rather than reaching listen(), which throws on a host it cannot
 * parse — and a throw here is a pm2 restart loop, i.e. the server is down.
 * Failing closed costs LAN access; failing open or failing hard costs Zeus.
 *
 * @param {object} env - process.env, injectable so it can be tested
 * @returns {string} the host to pass to app.listen
 */
function resolveBindHost(env) {
    const e = env || {};
    const raw = typeof e.BIND_HOST === 'string' ? e.BIND_HOST.trim() : '';
    if (!raw) return LOOPBACK;
    if (IPV4.test(raw) || IPV6_OK.has(raw)) return raw;
    try {
        console.warn(`[BIND] BIND_HOST="${raw}" is not an address I can parse — falling back to ${LOOPBACK}`);
    } catch (_) { /* never block boot on a log */ }
    return LOOPBACK;
}

module.exports = { resolveBindHost, LOOPBACK };

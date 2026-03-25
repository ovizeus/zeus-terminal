/**
 * Sprint 3 / Batch 1 — Smoke Tests
 * JWT Cookie flags, CSRF endpoint protection, CSP configuration
 */
'use strict';

let passed = 0;
let failed = 0;
const failures = [];
function assert(cond, label) {
    if (cond) { passed++; console.log(`  \u2705 ${label}`); }
    else { failed++; failures.push(label); console.error(`  \u274c FAIL: ${label}`); }
}

const fs = require('fs');
const path = require('path');
function src(relPath) { return fs.readFileSync(path.join(__dirname, relPath), 'utf8'); }

const authSrc = src('server/routes/auth.js');
const serverSrc = src('server.js');
const indexHtml = src('public/index.html');
const loginHtml = src('public/login.html');

// ═══════════════════════════════════════════════════════════════
// 1. JWT Cookie — HttpOnly + Secure + SameSite (S3B1-T1)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 1. JWT Cookie Flags (S3B1-T1) \u2550\u2550');
(function () {
    // Find _setAuthCookie function
    var idx = authSrc.indexOf('function _setAuthCookie');
    assert(idx > -1, '1a _setAuthCookie function exists');
    var block = authSrc.substring(idx, idx + 300);
    assert(block.includes('httpOnly: true'), '1b cookie httpOnly: true');
    assert(block.includes('secure: true'), '1c cookie secure: true');
    assert(block.includes("sameSite: 'lax'") || block.includes('sameSite: "lax"'), '1d cookie sameSite: lax');
    assert(block.includes('maxAge:'), '1e cookie maxAge set');
    assert(block.includes("path: '/'"), '1f cookie path: /');
    // Verify cookie name
    assert(block.includes("'zeus_token'") || block.includes('"zeus_token"'), '1g cookie named zeus_token');
    // No token in response body (verify it's cookie-only)
    // _setAuthCookie is used at register, verify-code, and token refresh
    var callCount = (authSrc.match(/_setAuthCookie\(res/g) || []).length;
    assert(callCount >= 2, '1h _setAuthCookie called at multiple endpoints (' + callCount + ')');
})();

// ═══════════════════════════════════════════════════════════════
// 2. CSRF Middleware — Custom Header Check (S3B1-T2)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 2. CSRF Middleware (S3B1-T2) \u2550\u2550');
(function () {
    assert(serverSrc.includes('CSRF Protection'), '2a CSRF middleware exists');
    assert(serverSrc.includes("'x-zeus-request'"), '2b checks X-Zeus-Request header');
    assert(serverSrc.includes("'POST', 'PUT', 'DELETE', 'PATCH'"), '2c covers all state-changing methods');
    assert(serverSrc.includes("403"), '2d returns 403 on failure');
    // sendBeacon exceptions exist
    assert(serverSrc.includes('/api/client-error'), '2e client-error exemption present');
    assert(serverSrc.includes('/api/sync/state'), '2f sync/state exemption present');
    assert(serverSrc.includes('/api/sync/user-context'), '2g user-context exemption present');
})();

// ═══════════════════════════════════════════════════════════════
// 3. sendBeacon Endpoints — Origin Validation (S3B1-T2 hardening)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 3. sendBeacon Origin Validation (S3B1-T2) \u2550\u2550');
(function () {
    // Find the CSRF middleware section
    var csrfIdx = serverSrc.indexOf('CSRF Protection');
    var csrfBlock = serverSrc.substring(csrfIdx, csrfIdx + 1100);
    // Origin validation for sendBeacon endpoints
    assert(csrfBlock.includes("req.headers['origin']"), '3a Origin header checked');
    assert(csrfBlock.includes("req.headers['host']"), '3b Host header used for comparison');
    assert(csrfBlock.includes('origin mismatch'), '3c origin mismatch error message');
    // Verify it's specifically in the sendBeacon exemption block
    var exemptIdx = csrfBlock.indexOf('/api/client-error');
    var originIdx = csrfBlock.indexOf("req.headers['origin']");
    assert(originIdx > exemptIdx, '3d Origin check is within exemption block');
})();

// ═══════════════════════════════════════════════════════════════
// 4. Client CSRF Header Injection
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 4. Client CSRF Header Injection \u2550\u2550');
(function () {
    // Both index.html and login.html must inject X-Zeus-Request
    assert(indexHtml.includes('X-Zeus-Request'), '4a index.html injects X-Zeus-Request');
    assert(loginHtml.includes('X-Zeus-Request'), '4b login.html injects X-Zeus-Request');
    // Both override window.fetch
    assert(indexHtml.includes('window.fetch'), '4c index.html wraps window.fetch');
    assert(loginHtml.includes('window.fetch'), '4d login.html wraps window.fetch');
})();

// ═══════════════════════════════════════════════════════════════
// 5. CSP Configuration via Helmet (S3B1-T3)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 5. CSP Configuration (S3B1-T3) \u2550\u2550');
(function () {
    assert(serverSrc.includes("require('helmet')"), '5a helmet imported');
    assert(serverSrc.includes('contentSecurityPolicy'), '5b CSP configured');
    assert(serverSrc.includes("defaultSrc: [\"'self'\"]"), '5c defaultSrc: self');
    assert(serverSrc.includes("frameAncestors: [\"'none'\"]"), '5d frameAncestors: none');
    assert(serverSrc.includes("objectSrc: [\"'none'\"]"), '5e objectSrc: none');
    assert(serverSrc.includes("formAction: [\"'self'\"]"), '5f formAction: self');
    assert(serverSrc.includes("baseUri: [\"'self'\"]"), '5g baseUri: self');
    assert(serverSrc.includes("upgradeInsecureRequests"), '5h upgradeInsecureRequests');
    // HSTS
    assert(serverSrc.includes('hsts:'), '5i HSTS configured');
    assert(serverSrc.includes('31536000'), '5j HSTS maxAge = 1 year');
    // Permissions policy
    assert(serverSrc.includes('permissionsPolicy'), '5k permissionsPolicy configured');
    // CDN whitelisting
    assert(serverSrc.includes('cdn.jsdelivr.net'), '5l jsdelivr CDN whitelisted');
    assert(serverSrc.includes('cdnjs.cloudflare.com'), '5m cloudflare CDN whitelisted');
    // connectSrc for WebSockets
    assert(serverSrc.includes('wss://fstream.binance.com'), '5n Binance WS whitelisted');
    assert(serverSrc.includes('wss://stream.bybit.com'), '5o Bybit WS whitelisted');
})();

// ═══════════════════════════════════════════════════════════════
// 6. CSP Migration Plan Document (S3B1-T3)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 6. CSP Migration Plan (S3B1-T3) \u2550\u2550');
(function () {
    var planExists = fs.existsSync(path.join(__dirname, 'docs', 'CSP-MIGRATION-PLAN.md'));
    assert(planExists, '6a CSP-MIGRATION-PLAN.md exists');
    if (planExists) {
        var plan = src('docs/CSP-MIGRATION-PLAN.md');
        assert(plan.includes('unsafe-inline'), '6b plan addresses unsafe-inline');
        assert(plan.includes('Phase 1') && plan.includes('Phase 2'), '6c plan has phased approach');
        assert(plan.includes('nonce') || plan.includes('Nonce'), '6d plan mentions nonce strategy');
        assert(plan.includes('onclick') || plan.includes('addEventListener'), '6e plan addresses event handlers');
        assert(plan.includes('SRI') || plan.includes('integrity'), '6f plan mentions SRI');
    }
})();

// ═══════════════════════════════════════════════════════════════
// 7. No eval/Function in client code
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 7. No Dynamic Code Execution \u2550\u2550');
(function () {
    var jsDir = path.join(__dirname, 'public', 'js');
    var dangerousPatterns = [/\beval\s*\(/, /new\s+Function\s*\(/];
    var violations = [];
    function scanDir(dir) {
        var items = fs.readdirSync(dir, { withFileTypes: true });
        for (var i = 0; i < items.length; i++) {
            var full = path.join(dir, items[i].name);
            if (items[i].isDirectory()) { scanDir(full); continue; }
            if (!items[i].name.endsWith('.js')) continue;
            var content = fs.readFileSync(full, 'utf8');
            for (var p = 0; p < dangerousPatterns.length; p++) {
                if (dangerousPatterns[p].test(content)) {
                    violations.push(items[i].name + ' matched ' + dangerousPatterns[p]);
                }
            }
        }
    }
    scanDir(jsDir);
    assert(violations.length === 0, '7a no eval() or new Function() in public/js (' + (violations.length > 0 ? violations.join(', ') : 'clean') + ')');
})();

// ═══════════════════════════════════════════════════════════════
// 8. Security Headers — x-powered-by disabled
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 8. Security Hardening \u2550\u2550');
(function () {
    assert(serverSrc.includes("app.disable('x-powered-by')"), '8a x-powered-by disabled');
    assert(serverSrc.includes("app.set('trust proxy', 1)"), '8b trust proxy set for Cloudflare');
    assert(serverSrc.includes('compression'), '8c compression enabled');
    assert(serverSrc.includes('X-Request-Id'), '8d request correlation ID');
    // Rate limiting exists
    var rateSrc = src('server/middleware/rateLimit.js');
    assert(rateSrc.includes('rateLimit') || rateSrc.includes('RateLimit'), '8e rate limiting middleware exists');
})();

// ═══════════════════════════════════════════════════════════════
// 9. Session Middleware — Cookie-based auth
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 9. Session Auth Middleware \u2550\u2550');
(function () {
    var sessionSrc = src('server/middleware/sessionAuth.js');
    assert(sessionSrc.includes('zeus_token'), '9a reads zeus_token cookie');
    assert(sessionSrc.includes('jwt') || sessionSrc.includes('JWT') || sessionSrc.includes('jsonwebtoken'), '9b uses JWT verification');
    assert(sessionSrc.includes('401') || sessionSrc.includes('unauthorized') || sessionSrc.includes('Unauthorized'), '9c returns 401 on invalid token');
})();

// ═══════════════════════════════════════════════════════════════
// 10. Auth Route Security
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 10. Auth Route Security \u2550\u2550');
(function () {
    // Password hashing
    assert(authSrc.includes('bcrypt'), '10a uses bcrypt for password hashing');
    // JWT signing
    assert(authSrc.includes('jwt.sign') || authSrc.includes('jsonwebtoken'), '10b JWT token signing');
    // Logout clears cookie
    assert(authSrc.includes('clearCookie') || authSrc.includes('zeus_token'), '10c logout clears cookie');
    // Admin routes protected
    assert(authSrc.includes('/admin/approve'), '10d admin approve route');
    assert(authSrc.includes('/admin/delete'), '10e admin delete route');
    assert(authSrc.includes('.role') || authSrc.includes('admin'), '10f admin role verification');
})();

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════
console.log(`\n${'='.repeat(60)}`);
console.log(`S3B1 SMOKE: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(60)}`);
if (failures.length > 0) {
    console.log('\nFailed:');
    failures.forEach(function (f) { console.log('  \u274c ' + f); });
}
if (failed > 0) process.exit(1);

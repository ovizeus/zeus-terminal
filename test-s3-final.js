/**
 * Sprint 3 — Final Verification
 * Cross-cutting integration checks across S3B1 + S3B2 + S3B3
 * Validates no regressions between batches, security posture coherence,
 * and untouched file guards.
 */
'use strict';

let passed = 0;
let failed = 0;
const failures = [];
function assert(cond, label) {
    if (cond) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; failures.push(label); console.error(`  ❌ FAIL: ${label}`); }
}

const fs = require('fs');
const path = require('path');
function src(relPath) { return fs.readFileSync(path.join(__dirname, relPath), 'utf8'); }

const serverSrc = src('server.js');
const authSrc = src('server/routes/auth.js');
const tradingSrc = src('server/routes/trading.js');
const indexHtml = src('public/index.html');
const loginHtml = src('public/login.html');
const liveApiSrc = src('public/js/trading/liveApi.js');
const encSrc = src('server/services/encryption.js');
const loggerSrc = src('server/services/logger.js');
const sessionSrc = src('server/middleware/sessionAuth.js');
const rateSrc = src('server/middleware/rateLimit.js');
const serverATSrc = src('server/services/serverAT.js');

// ═══════════════════════════════════════════════════════════════
// 1. S3B1→B2 Regression: JWT still intact after SRI changes
// ═══════════════════════════════════════════════════════════════
console.log('\n══ 1. JWT Cookie (S3B1 → regression after S3B2/B3) ══');
(function () {
    var idx = authSrc.indexOf('function _setAuthCookie');
    assert(idx > -1, '1a _setAuthCookie exists');
    var block = authSrc.substring(idx, idx + 300);
    assert(block.includes('httpOnly: true'), '1b httpOnly preserved');
    assert(block.includes('secure: true'), '1c secure preserved');
    assert(block.includes("sameSite: 'lax'") || block.includes('sameSite: "lax"'), '1d sameSite preserved');
    // Session middleware still reads cookie
    assert(sessionSrc.includes('zeus_token'), '1e sessionAuth reads zeus_token');
    assert(sessionSrc.includes('jwt') || sessionSrc.includes('jsonwebtoken'), '1f JWT verification in session');
})();

// ═══════════════════════════════════════════════════════════════
// 2. S3B1→B3 Regression: CSRF still intact after password changes
// ═══════════════════════════════════════════════════════════════
console.log('\n══ 2. CSRF Middleware (S3B1 → regression after S3B3) ══');
(function () {
    assert(serverSrc.includes('CSRF Protection'), '2a CSRF block present');
    assert(serverSrc.includes("'x-zeus-request'"), '2b X-Zeus-Request check');
    assert(serverSrc.includes("req.headers['origin']"), '2c Origin validation for sendBeacon');
    assert(indexHtml.includes('X-Zeus-Request'), '2d index.html CSRF header');
    assert(loginHtml.includes('X-Zeus-Request'), '2e login.html CSRF header');
    // CSRF block covers all methods
    assert(serverSrc.includes("'POST', 'PUT', 'DELETE', 'PATCH'"), '2f all state-changing methods covered');
})();

// ═══════════════════════════════════════════════════════════════
// 3. S3B1→B2 Regression: CSP + Helmet still intact after SRI
// ═══════════════════════════════════════════════════════════════
console.log('\n══ 3. CSP/Helmet (S3B1 → regression after S3B2) ══');
(function () {
    assert(serverSrc.includes("require('helmet')"), '3a helmet imported');
    assert(serverSrc.includes('contentSecurityPolicy'), '3b CSP configured');
    assert(serverSrc.includes("defaultSrc: [\"'self'\"]"), '3c defaultSrc: self');
    assert(serverSrc.includes("frameAncestors: [\"'none'\"]"), '3d frameAncestors: none');
    assert(serverSrc.includes('cdn.jsdelivr.net'), '3e jsdelivr CDN whitelisted');
    assert(serverSrc.includes('cdnjs.cloudflare.com'), '3f cloudflare CDN whitelisted');
    assert(serverSrc.includes('wss://fstream.binance.com'), '3g Binance WS whitelist');
    assert(serverSrc.includes('wss://stream.bybit.com'), '3h Bybit WS whitelist');
})();

// ═══════════════════════════════════════════════════════════════
// 4. SRI + Idempotency (S3B2) intact after S3B3 password changes
// ═══════════════════════════════════════════════════════════════
console.log('\n══ 4. SRI + Idempotency (S3B2 → regression after S3B3) ══');
(function () {
    // SRI on primary CDN
    var jsDelivrIdx = indexHtml.indexOf('cdn.jsdelivr.net/npm/lightweight-charts');
    var tagStart = indexHtml.lastIndexOf('<script', jsDelivrIdx);
    var tag = indexHtml.substring(tagStart, indexHtml.indexOf('</script>', jsDelivrIdx));
    assert(tag.includes('integrity="sha384-'), '4a jsdelivr SRI preserved');
    assert(tag.includes('crossorigin="anonymous"'), '4b jsdelivr crossorigin preserved');
    // SRI on dynamic fallbacks
    var lwcFn = indexHtml.substring(indexHtml.indexOf('function loadLWC2'));
    lwcFn = lwcFn.substring(0, lwcFn.indexOf('</script>'));
    assert(lwcFn.includes("s.integrity = 'sha384-"), '4c unpkg SRI preserved');
    assert(lwcFn.includes("s2.integrity = 'sha384-"), '4d cdnjs SRI preserved');
    // Idempotency key
    assert(liveApiSrc.includes('crypto.randomUUID'), '4e randomUUID preserved');
    assert(liveApiSrc.includes('crypto.getRandomValues'), '4f getRandomValues fallback preserved');
    // Server-side idempotency cache
    assert(tradingSrc.includes('_idempotencyCache'), '4g server idempotency cache');
    assert(tradingSrc.includes('409') || tradingSrc.includes('Conflict'), '4h 409 duplicate response');
})();

// ═══════════════════════════════════════════════════════════════
// 5. Password Policy coherence: client + server match
// ═══════════════════════════════════════════════════════════════
console.log('\n══ 5. Password Policy Coherence (S3B3 cross-check) ══');
(function () {
    // Server-side policy
    assert(authSrc.includes('function _validatePassword('), '5a server _validatePassword exists');
    var fnIdx = authSrc.indexOf('function _validatePassword(');
    var fnBlock = authSrc.substring(fnIdx, fnIdx + 300);
    assert(fnBlock.includes('.length < 8'), '5b server: 8-char minimum');
    assert(fnBlock.includes('[a-zA-Z]'), '5c server: letter required');
    assert(fnBlock.includes('\\d'), '5d server: digit required');
    // Client-side policy must match
    assert(loginHtml.includes('password.length < 8'), '5e client: 8-char minimum');
    assert(loginHtml.includes('[a-zA-Z]'), '5f client: letter required');
    assert(loginHtml.includes('\\d'), '5g client: digit required');
    // Old weak policy absent
    assert(!loginHtml.includes('password.length < 6'), '5h old 6-char removed from client');
    // All 3 endpoints use shared validator
    var regBlock = authSrc.substring(authSrc.indexOf("'/register'"), authSrc.indexOf("'/register'") + 600);
    assert(regBlock.includes('_validatePassword'), '5i register uses validator');
    var cpBlock = authSrc.substring(authSrc.indexOf("'/change-password/confirm'"), authSrc.indexOf("'/change-password/confirm'") + 1000);
    assert(cpBlock.includes('_validatePassword'), '5j change-password uses validator');
    var fpBlock = authSrc.substring(authSrc.indexOf("'/forgot-password/confirm'"), authSrc.indexOf("'/forgot-password/confirm'") + 1000);
    assert(fpBlock.includes('_validatePassword'), '5k forgot-password uses validator');
})();

// ═══════════════════════════════════════════════════════════════
// 6. Encryption coherence: Telegram + credential store
// ═══════════════════════════════════════════════════════════════
console.log('\n══ 6. Encryption Coherence ══');
(function () {
    assert(encSrc.includes('aes-256-gcm') || encSrc.includes('createCipher'), '6a AES encryption in encryption.js');
    assert(tradingSrc.includes('encrypt('), '6b trading routes encrypt Telegram tokens');
    // Credential store uses encryption
    var credSrc = src('server/services/credentialStore.js');
    assert(credSrc.includes('encrypt') || credSrc.includes('decrypt'), '6c credentialStore uses encryption');
    // No plaintext secrets stored
    assert(tradingSrc.includes('telegram_bot_token_enc') || tradingSrc.includes('tokenEnc'), '6d encrypted token field name');
})();

// ═══════════════════════════════════════════════════════════════
// 7. 2FA + Rate Limiting coherence
// ═══════════════════════════════════════════════════════════════
console.log('\n══ 7. 2FA + Rate Limiting ══');
(function () {
    assert(authSrc.includes('crypto.randomInt'), '7a 2FA uses crypto.randomInt');
    assert(authSrc.includes('timingSafeEqual'), '7b timing-safe comparison');
    assert(authSrc.includes('MAX_ATTEMPTS'), '7c max attempts defined');
    assert(authSrc.includes('_checkLoginRate'), '7d login rate limiter');
    assert(authSrc.includes('LOGIN_MAX'), '7e login max attempts');
    assert(authSrc.includes('LOGIN_WINDOW'), '7f login window');
    // Global rate limiting
    assert(rateSrc.includes('429') || rateSrc.includes('Too many'), '7g global rate limit 429');
})();

// ═══════════════════════════════════════════════════════════════
// 8. AT Log pruning: disk + memory still intact
// ═══════════════════════════════════════════════════════════════
console.log('\n══ 8. AT Log Pruning ══');
(function () {
    assert(loggerSrc.includes('MAX_LOG_SIZE') || loggerSrc.includes('5 * 1024 * 1024'), '8a disk max log size');
    assert(loggerSrc.includes('_rotate') || loggerSrc.includes('rotate'), '8b disk rotation');
    assert(serverATSrc.includes('MAX_LOG'), '8c memory ring buffer constant');
    assert(serverATSrc.includes('.splice(0,'), '8d ring buffer splice');
})();

// ═══════════════════════════════════════════════════════════════
// 9. No eval/Function in client code (regression)
// ═══════════════════════════════════════════════════════════════
console.log('\n══ 9. No Dynamic Code Execution (regression) ══');
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
                if (dangerousPatterns[p].test(content)) violations.push(items[i].name);
            }
        }
    }
    scanDir(jsDir);
    assert(violations.length === 0, '9a no eval()/new Function() (' + (violations.length > 0 ? violations.join(', ') : 'clean') + ')');
})();

// ═══════════════════════════════════════════════════════════════
// 10. No secrets in client code (regression)
// ═══════════════════════════════════════════════════════════════
console.log('\n══ 10. No Secrets in Client Code (regression) ══');
(function () {
    var envSecretPattern = /process\.env\.(JWT_SECRET|SMTP_PASS|TELEGRAM_BOT_TOKEN|ENCRYPTION_KEY)/;
    var jsDir = path.join(__dirname, 'public', 'js');
    var violations = [];
    function scanDir(dir) {
        var items = fs.readdirSync(dir, { withFileTypes: true });
        for (var i = 0; i < items.length; i++) {
            var full = path.join(dir, items[i].name);
            if (items[i].isDirectory()) { scanDir(full); continue; }
            if (!items[i].name.endsWith('.js')) continue;
            var content = fs.readFileSync(full, 'utf8');
            if (envSecretPattern.test(content)) violations.push(items[i].name);
        }
    }
    scanDir(jsDir);
    assert(violations.length === 0, '10a no process.env secrets in client JS (' + (violations.length > 0 ? violations.join(', ') : 'clean') + ')');
})();

// ═══════════════════════════════════════════════════════════════
// 11. Sprint 2 regression guards
// ═══════════════════════════════════════════════════════════════
console.log('\n══ 11. Sprint 2 Regression Guards ══');
(function () {
    var stateSrc = src('public/js/core/state.js');
    var bootSrc = src('public/js/core/bootstrap.js');
    var forecastSrc = src('public/js/brain/forecast.js');
    var mdSrc = src('public/js/data/marketData.js');
    // Regime reset (S2B1)
    assert(forecastSrc.includes('function resetForecast()'), '11a resetForecast() exists');
    assert(mdSrc.includes('resetForecast'), '11b setSymbol calls resetForecast');
    // Dirty flags (S2B2)
    assert(stateSrc.includes('let _dirty = false;'), '11c dirty flag');
    assert(stateSrc.includes('function markDirty()'), '11d markDirty()');
    // Freshness guards (S2B2)
    assert(bootSrc.includes('!(ZState.isMerging && ZState.isMerging())'), '11e visibility isMerging gate');
    assert(stateSrc.includes('let _merging = false'), '11f _merging flag');
})();

// ═══════════════════════════════════════════════════════════════
// 12. Sprint 1 regression guards
// ═══════════════════════════════════════════════════════════════
console.log('\n══ 12. Sprint 1 Regression Guards ══');
(function () {
    var stateSrc = src('public/js/core/state.js');
    assert(stateSrc.includes('_modeConfirmed'), '12a AT mode ambiguity guard');
    var satSrc = src('server/services/serverAT.js');
    assert(satSrc.includes('SL_RETRY_DELAYS'), '12b SL retry delays');
    var confSrc = src('public/js/brain/confluence.js');
    assert(confSrc.includes('oiStale'), '12c OI stale guard');
    var reconSrc = src('server/services/reconciliation.js');
    assert(reconSrc.includes('_comparePositions') || reconSrc.includes('comparePositions'), '12d reconciliation');
})();

// ═══════════════════════════════════════════════════════════════
// 13. CSP Migration Plan document
// ═══════════════════════════════════════════════════════════════
console.log('\n══ 13. Documentation ══');
(function () {
    assert(fs.existsSync(path.join(__dirname, 'docs', 'CSP-MIGRATION-PLAN.md')), '13a CSP migration plan exists');
    var p05 = fs.existsSync(path.join(__dirname, 'docs', 'P0.5-interface-contracts.md'));
    assert(p05, '13b P0.5 interface contracts exists');
})();

// ═══════════════════════════════════════════════════════════════
// 14. Untouched files: No Sprint 3 markers in wrong places
// ═══════════════════════════════════════════════════════════════
console.log('\n══ 14. Untouched File Guards ══');
(function () {
    var stateSrc = src('public/js/core/state.js');
    assert(!stateSrc.includes('[S3B'), '14a state.js has no S3 batch markers');
    var bootSrc = src('public/js/core/bootstrap.js');
    assert(!bootSrc.includes('[S3B'), '14b bootstrap.js has no S3 batch markers');
    var dslSrc = src('public/js/trading/dsl.js');
    assert(!dslSrc.includes('[S3B'), '14c dsl.js has no S3 batch markers');
    var mainCss = src('public/css/main.css');
    assert(!mainCss.includes('[S3B'), '14d main.css has no S3 batch markers');
})();

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════
console.log(`\n${'='.repeat(60)}`);
console.log(`SPRINT 3 — FINAL VERIFICATION: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(60)}`);
if (failures.length > 0) {
    console.log('\nFailed:');
    failures.forEach(function (f) { console.log('  ❌ ' + f); });
}
if (failed > 0) process.exit(1);

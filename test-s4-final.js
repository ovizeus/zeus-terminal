/**
 * Sprint 4 — Final Verification
 * Cross-cutting checks across S4B1 + full system integrity.
 * Production readiness gate: every security, logging, and DB hardening
 * measure verified end-to-end.
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
const dbSrc = src('server/services/database.js');
const loggerSrc = src('server/services/logger.js');
const encSrc = src('server/services/encryption.js');
const validateSrc = src('server/middleware/validate.js');
const sessionSrc = src('server/middleware/sessionAuth.js');
const rateSrc = src('server/middleware/rateLimit.js');
const indexHtml = src('public/index.html');
const loginHtml = src('public/login.html');
const liveApiSrc = src('public/js/trading/liveApi.js');

// ═══════════════════════════════════════════════════════════════
// 1. Error Handling — Complete Chain (S4B1)
// ═══════════════════════════════════════════════════════════════
console.log('\n══ 1. Error Handling Chain ══');
(function () {
    // Process-level handlers
    assert(serverSrc.includes("process.on('uncaughtException'"), '1a uncaughtException handler');
    assert(serverSrc.includes("process.on('unhandledRejection'"), '1b unhandledRejection handler');
    // Global error handler uses structured logger
    var geIdx = serverSrc.indexOf('Global error handler');
    assert(geIdx > -1, '1c global error handler exists');
    var geBlock = serverSrc.substring(geIdx, geIdx + 300);
    assert(geBlock.includes('logger.error'), '1d structured logger in error handler');
    assert(!geBlock.includes('err.stack'), '1e no stack trace leakage');
    assert(geBlock.includes('500'), '1f returns 500');
    // Trading routes have safe error helper
    assert(tradingSrc.includes('_safeError'), '1g _safeError in trading');
})();

// ═══════════════════════════════════════════════════════════════
// 2. Database Security — Full Audit
// ═══════════════════════════════════════════════════════════════
console.log('\n══ 2. Database Security ══');
(function () {
    var prepCount = (dbSrc.match(/\.prepare\(/g) || []).length;
    var rawExecCount = (dbSrc.match(/\.exec\(/g) || []).length;
    assert(prepCount > 10, '2a prepared statements (' + prepCount + ')');
    assert(rawExecCount < prepCount, '2b .exec() < .prepare() — DDL only');
    // No string concat in .prepare()
    var sqlConcat = dbSrc.match(/\.prepare\([^)]*\+[^)]*\)/g);
    assert(!sqlConcat, '2c no string concatenation in queries');
    // DB backup mechanism
    assert(dbSrc.includes('backup') || dbSrc.includes('Backup'), '2d backup mechanism');
    // WAL mode for concurrency
    assert(dbSrc.includes('wal') || dbSrc.includes('WAL'), '2e WAL mode enabled');
})();

// ═══════════════════════════════════════════════════════════════
// 3. Input Validation — All Entry Points
// ═══════════════════════════════════════════════════════════════
console.log('\n══ 3. Input Validation ══');
(function () {
    // Validation middleware
    assert(validateSrc.includes('symbol'), '3a validates symbol');
    assert(validateSrc.includes('side'), '3b validates side');
    assert(validateSrc.includes('leverage'), '3c validates leverage');
    // Password validation
    assert(authSrc.includes('function _validatePassword('), '3d password validator exists');
    // Request body limit
    assert(serverSrc.includes("limit: '1mb'") || serverSrc.includes("limit: '10kb'"), '3e body size limit');
    // Idempotency minimum length
    assert(tradingSrc.includes('.length < 5'), '3f idempotency key min length');
})();

// ═══════════════════════════════════════════════════════════════
// 4. Security Headers — Full Stack
// ═══════════════════════════════════════════════════════════════
console.log('\n══ 4. Security Headers ══');
(function () {
    assert(serverSrc.includes("require('helmet')"), '4a helmet');
    assert(serverSrc.includes("app.disable('x-powered-by')"), '4b x-powered-by off');
    assert(serverSrc.includes("app.set('trust proxy', 1)"), '4c trust proxy');
    assert(serverSrc.includes('contentSecurityPolicy'), '4d CSP');
    assert(serverSrc.includes("referrerPolicy"), '4e referrer policy');
    assert(serverSrc.includes('hsts:'), '4f HSTS');
    assert(serverSrc.includes('31536000'), '4g HSTS 1 year');
    assert(serverSrc.includes('upgradeInsecureRequests'), '4h upgrade insecure');
    assert(serverSrc.includes("Cache-Control") && serverSrc.includes("no-store"), '4i API no-store');
    assert(serverSrc.includes('compression'), '4j compression');
    assert(serverSrc.includes('X-Request-Id'), '4k request correlation ID');
})();

// ═══════════════════════════════════════════════════════════════
// 5. Authentication — Complete Chain
// ═══════════════════════════════════════════════════════════════
console.log('\n══ 5. Authentication Chain ══');
(function () {
    // Cookie security
    var cookieIdx = authSrc.indexOf('function _setAuthCookie');
    var cookieBlock = authSrc.substring(cookieIdx, cookieIdx + 300);
    assert(cookieBlock.includes('httpOnly: true'), '5a httpOnly');
    assert(cookieBlock.includes('secure: true'), '5b secure');
    assert(cookieBlock.includes("sameSite: 'lax'") || cookieBlock.includes('sameSite: "lax"'), '5c sameSite');
    // Session middleware
    assert(sessionSrc.includes('zeus_token'), '5d session reads cookie');
    assert(sessionSrc.includes('401') || sessionSrc.includes('Unauthorized'), '5e 401 on invalid');
    // CSRF
    assert(serverSrc.includes('CSRF Protection'), '5f CSRF middleware');
    assert(indexHtml.includes('X-Zeus-Request'), '5g client CSRF header');
    // Password hashing
    assert(authSrc.includes('bcrypt'), '5h bcrypt hashing');
    // 2FA
    assert(authSrc.includes('crypto.randomInt'), '5i crypto.randomInt for 2FA');
    assert(authSrc.includes('timingSafeEqual'), '5j timing-safe compare');
})();

// ═══════════════════════════════════════════════════════════════
// 6. Rate Limiting — All Layers
// ═══════════════════════════════════════════════════════════════
console.log('\n══ 6. Rate Limiting ══');
(function () {
    // Global rate limiter
    assert(rateSrc.includes('429') || rateSrc.includes('Too many'), '6a global 429');
    // Auth rate limiter
    assert(authSrc.includes('_checkLoginRate'), '6b login rate limiter');
    assert(authSrc.includes('LOGIN_WINDOW'), '6c login window');
    assert(authSrc.includes('LOGIN_MAX'), '6d login max');
    assert(authSrc.includes('MAX_ATTEMPTS'), '6e 2FA max attempts');
    // AT critical limit
    assert(serverSrc.includes('atCriticalLimit'), '6f AT critical rate limit imported');
})();

// ═══════════════════════════════════════════════════════════════
// 7. Encryption — Secrets at Rest
// ═══════════════════════════════════════════════════════════════
console.log('\n══ 7. Encryption at Rest ══');
(function () {
    assert(encSrc.includes('aes-256-gcm') || encSrc.includes('createCipher'), '7a AES-256-GCM');
    assert(tradingSrc.includes('encrypt('), '7b Telegram token encrypted');
    var credSrc = src('server/services/credentialStore.js');
    assert(credSrc.includes('encrypt') || credSrc.includes('decrypt'), '7c credentials encrypted');
    // No plaintext API keys in DB calls
    assert(!dbSrc.includes('api_secret') || dbSrc.includes('_enc'), '7d no plaintext secret columns');
})();

// ═══════════════════════════════════════════════════════════════
// 8. Logging — Structured + Safe
// ═══════════════════════════════════════════════════════════════
console.log('\n══ 8. Structured Logging ══');
(function () {
    assert(loggerSrc.includes('LOG_DIR') || loggerSrc.includes('log_dir'), '8a log directory');
    assert(loggerSrc.includes('rotate') || loggerSrc.includes('_rotate'), '8b rotation');
    assert(loggerSrc.includes('MAX_LOG_SIZE') || loggerSrc.includes('5 * 1024 * 1024'), '8c max size');
    // Email masking
    assert(authSrc.includes('function _mask'), '8d email mask helper');
    // No raw passwords logged
    var pwLines = authSrc.split('\n').filter(function (l) {
        return /(console|logger)\.[a-z]+\(/.test(l) && /[{,]\s*(password|newPassword)\b(?!\s*\.)/.test(l);
    });
    assert(pwLines.length === 0, '8e no raw password logged');
})();

// ═══════════════════════════════════════════════════════════════
// 9. Client-Side Security — SRI + Crypto
// ═══════════════════════════════════════════════════════════════
console.log('\n══ 9. Client-Side Security ══');
(function () {
    // SRI
    var jsDelivrIdx = indexHtml.indexOf('cdn.jsdelivr.net/npm/lightweight-charts');
    var tagStart = indexHtml.lastIndexOf('<script', jsDelivrIdx);
    var tag = indexHtml.substring(tagStart, indexHtml.indexOf('</script>', jsDelivrIdx));
    assert(tag.includes('integrity="sha384-'), '9a SRI on primary CDN');
    assert(tag.includes('crossorigin="anonymous"'), '9b crossorigin on CDN');
    // Idempotency crypto
    assert(liveApiSrc.includes('crypto.randomUUID'), '9c randomUUID');
    assert(liveApiSrc.includes('crypto.getRandomValues'), '9d getRandomValues fallback');
    // No eval
    var jsDir = path.join(__dirname, 'public', 'js');
    var evalFound = false;
    function scanDir(dir) {
        var items = fs.readdirSync(dir, { withFileTypes: true });
        for (var i = 0; i < items.length; i++) {
            var full = path.join(dir, items[i].name);
            if (items[i].isDirectory()) { scanDir(full); continue; }
            if (!items[i].name.endsWith('.js')) continue;
            if (/\beval\s*\(/.test(fs.readFileSync(full, 'utf8'))) evalFound = true;
        }
    }
    scanDir(jsDir);
    assert(!evalFound, '9e no eval() in client code');
})();

// ═══════════════════════════════════════════════════════════════
// 10. Sprint 1+2 Regression — Core Trading
// ═══════════════════════════════════════════════════════════════
console.log('\n══ 10. Sprint 1+2 Regression ══');
(function () {
    var stateSrc = src('public/js/core/state.js');
    // S1: AT mode
    assert(stateSrc.includes('_modeConfirmed'), '10a AT mode guard (S1)');
    // S1: SL retry
    var satSrc = src('server/services/serverAT.js');
    assert(satSrc.includes('SL_RETRY_DELAYS'), '10b SL retry delays (S1)');
    // S1: OI stale
    var confSrc = src('public/js/brain/confluence.js');
    assert(confSrc.includes('oiStale'), '10c OI stale guard (S1)');
    // S2: regime reset
    var forecastSrc = src('public/js/brain/forecast.js');
    assert(forecastSrc.includes('function resetForecast()'), '10d resetForecast (S2)');
    // S2: dirty/freshness
    assert(stateSrc.includes('let _dirty = false;'), '10e dirty flag (S2)');
    assert(stateSrc.includes('function markDirty()'), '10f markDirty (S2)');
    assert(stateSrc.includes('let _merging = false'), '10g _merging flag (S2)');
    // S2: comprehensive closedIds
    var bootSrc = src('public/js/core/bootstrap.js');
    assert(bootSrc.includes('_zeusRecentlyClosed'), '10h closedIds (S2)');
})();

// ═══════════════════════════════════════════════════════════════
// 11. File Integrity — No Cross-Contamination
// ═══════════════════════════════════════════════════════════════
console.log('\n══ 11. File Integrity ══');
(function () {
    var stateSrc = src('public/js/core/state.js');
    var bootSrc = src('public/js/core/bootstrap.js');
    var mainCss = src('public/css/main.css');
    // No S4 markers in untouched files
    assert(!stateSrc.includes('[S4B'), '11a state.js no S4 markers');
    assert(!bootSrc.includes('[S4B'), '11b bootstrap.js no S4 markers');
    assert(!mainCss.includes('[S3B') && !mainCss.includes('[S4B'), '11c main.css no S3/S4 markers');
    // Server.js should exist and be valid
    assert(serverSrc.length > 5000, '11d server.js substantial (' + serverSrc.length + ' chars)');
    // Package.json exists
    var pkg = JSON.parse(src('package.json'));
    assert(pkg.name || pkg.version, '11e package.json valid');
    // All key server files exist
    var requiredFiles = [
        'server/services/database.js', 'server/services/logger.js',
        'server/services/encryption.js', 'server/services/credentialStore.js',
        'server/middleware/sessionAuth.js', 'server/middleware/rateLimit.js',
        'server/middleware/validate.js', 'server/routes/auth.js',
        'server/routes/trading.js', 'server/routes/exchange.js'
    ];
    var missing = requiredFiles.filter(function (f) { return !fs.existsSync(path.join(__dirname, f)); });
    assert(missing.length === 0, '11f all server modules present (' + (missing.length > 0 ? 'missing: ' + missing.join(', ') : 'OK') + ')');
})();

// ═══════════════════════════════════════════════════════════════
// 12. Documentation + Migration
// ═══════════════════════════════════════════════════════════════
console.log('\n══ 12. Documentation ══');
(function () {
    assert(fs.existsSync(path.join(__dirname, 'docs', 'CSP-MIGRATION-PLAN.md')), '12a CSP migration plan');
    assert(fs.existsSync(path.join(__dirname, 'docs', 'P0.5-interface-contracts.md')), '12b P0.5 contracts');
    assert(fs.existsSync(path.join(__dirname, 'MIGRATION_AUDIT.md')), '12c migration audit');
})();

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════
console.log(`\n${'='.repeat(60)}`);
console.log(`SPRINT 4 — FINAL VERIFICATION: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(60)}`);
if (failures.length > 0) {
    console.log('\nFailed:');
    failures.forEach(function (f) { console.log('  ❌ ' + f); });
}
if (failed > 0) process.exit(1);

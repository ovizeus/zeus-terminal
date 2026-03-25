/**
 * Sprint 4 / Batch 1 — Smoke Tests
 * Cleanup, logs, hardening, error handling, DB security
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

const serverSrc = src('server.js');
const dbSrc = src('server/services/database.js');
const loggerSrc = src('server/services/logger.js');
const validateSrc = src('server/middleware/validate.js');
const tradingSrc = src('server/routes/trading.js');
const authSrc = src('server/routes/auth.js');

// ═══════════════════════════════════════════════════════════════
// 1. Process Error Handlers (S4B1)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 1. Process Error Handlers \u2550\u2550');
(function () {
    assert(serverSrc.includes("process.on('uncaughtException'"), '1a uncaughtException handler');
    assert(serverSrc.includes("process.on('unhandledRejection'"), '1b unhandledRejection handler');
    // uncaught should exit
    var ueIdx = serverSrc.indexOf("process.on('uncaughtException'");
    var ueBlock = serverSrc.substring(ueIdx, ueIdx + 400);
    assert(ueBlock.includes('process.exit(1)'), '1c uncaughtException calls process.exit');
    assert(ueBlock.includes('logger.error'), '1d uncaughtException uses structured logger');
    // unhandled should log but NOT exit
    var urIdx = serverSrc.indexOf("process.on('unhandledRejection'");
    var urBlock = serverSrc.substring(urIdx, urIdx + 300);
    assert(urBlock.includes('logger.warn'), '1e unhandledRejection uses structured logger');
    assert(!urBlock.includes('process.exit'), '1f unhandledRejection does NOT exit process');
})();

// ═══════════════════════════════════════════════════════════════
// 2. Global Error Handler (S4B1)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 2. Global Error Handler \u2550\u2550');
(function () {
    assert(serverSrc.includes("'Internal server error'"), '2a generic error message to client');
    // Should NOT leak error details
    var geIdx = serverSrc.indexOf('Global error handler');
    var geBlock = serverSrc.substring(geIdx, geIdx + 300);
    assert(!geBlock.includes('err.stack'), '2b does not leak stack trace');
    assert(geBlock.includes('logger.error'), '2c uses structured logger');
    assert(geBlock.includes('500'), '2d returns 500 status');
})();

// ═══════════════════════════════════════════════════════════════
// 3. API Cache-Control Headers
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 3. API Cache-Control \u2550\u2550');
(function () {
    assert(serverSrc.includes("Cache-Control") && serverSrc.includes("no-store"), '3a API responses no-store');
    assert(serverSrc.includes('server.setTimeout'), '3b server timeout configured');
})();

// ═══════════════════════════════════════════════════════════════
// 4. Database Security — Parameterized Queries (S4B1)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 4. Database Security \u2550\u2550');
(function () {
    assert(dbSrc.includes('.prepare('), '4a uses prepared statements');
    // Count prepared vs raw execute
    var prepCount = (dbSrc.match(/\.prepare\(/g) || []).length;
    var rawExecCount = (dbSrc.match(/\.exec\(/g) || []).length;
    assert(prepCount > 10, '4b many prepared statements (' + prepCount + ')');
    // .exec() is used for schema DDL, not data queries
    assert(rawExecCount < prepCount, '4c .exec() count (' + rawExecCount + ') < .prepare() count (' + prepCount + ') — DDL only');
    // No string concatenation in queries
    var sqlConcat = dbSrc.match(/\.prepare\([^)]*\+[^)]*\)/g);
    assert(!sqlConcat, '4d no string concatenation in prepared statements');
    // DB backup exists
    assert(dbSrc.includes('backup') || dbSrc.includes('Backup'), '4e database backup mechanism');
})();

// ═══════════════════════════════════════════════════════════════
// 5. Input Validation Middleware (S4B1)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 5. Input Validation \u2550\u2550');
(function () {
    assert(validateSrc.includes('symbol'), '5a validates symbol');
    assert(validateSrc.includes('A-Z') || validateSrc.includes('a-zA-Z'), '5b symbol alphanumeric validation');
    assert(validateSrc.includes('side'), '5c validates side');
    assert(validateSrc.includes("'BUY'") || validateSrc.includes('"BUY"'), '5d side enum BUY/SELL');
    assert(validateSrc.includes('quantity') || validateSrc.includes('parseFloat'), '5e validates numeric fields');
    assert(validateSrc.includes('leverage'), '5f validates leverage');
})();

// ═══════════════════════════════════════════════════════════════
// 6. Trading Route — Safe Error Return (S4B1)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 6. Trading Route Safety \u2550\u2550');
(function () {
    assert(tradingSrc.includes('_safeError'), '6a _safeError helper exists');
    var seIdx = tradingSrc.indexOf('function _safeError');
    if (seIdx > -1) {
        var seBlock = tradingSrc.substring(seIdx, seIdx + 300);
        assert(seBlock.includes("'Internal server error'"), '6b falls back to generic message');
        assert(seBlock.includes('err.status'), '6c checks error status code');
    }
    // Request body limit
    assert(serverSrc.includes("limit: '1mb'") || serverSrc.includes("limit: '10kb'"), '6d request body size limit');
})();

// ═══════════════════════════════════════════════════════════════
// 7. Structured Logging (S4B1)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 7. Structured Logging \u2550\u2550');
(function () {
    assert(loggerSrc.includes('function info') || loggerSrc.includes('info:') || loggerSrc.includes('exports.info'), '7a logger.info exists');
    assert(loggerSrc.includes('function warn') || loggerSrc.includes('warn:') || loggerSrc.includes('exports.warn'), '7b logger.warn exists');
    assert(loggerSrc.includes('function error') || loggerSrc.includes('error:') || loggerSrc.includes('exports.error'), '7c logger.error exists');
    assert(loggerSrc.includes('LOG_DIR') || loggerSrc.includes('log_dir'), '7d log directory configured');
    // Rotation
    assert(loggerSrc.includes('rotate') || loggerSrc.includes('_rotate'), '7e log rotation exists');
})();

// ═══════════════════════════════════════════════════════════════
// 8. Email Mask — Sensitive Data Protection (S4B1)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 8. Sensitive Data Protection \u2550\u2550');
(function () {
    assert(authSrc.includes('function _mask'), '8a _mask helper for email');
    // 2FA code NOT logged
    assert(!authSrc.includes('console.log') || !authSrc.match(/console\.log.*code/i), '8b 2FA code not logged to console');
    // Passwords never logged
    // Check no line logs a raw password VARIABLE (password, newPassword) as a value parameter
    // Event description strings like 'Password changed' or 'Forgot password code sent' are safe
    var pwLines = authSrc.split('\n').filter(function (l) {
        // Only flag lines that pass password/newPassword as a log parameter value
        return /(console|logger)\.[a-z]+\(/.test(l) && /[{,]\s*(password|newPassword)\b(?!\s*\.)/.test(l);
    });
    assert(pwLines.length === 0, '8c raw password never logged (' + (pwLines.length > 0 ? pwLines[0].trim() : 'clean') + ')');
})();

// ═══════════════════════════════════════════════════════════════
// 9. Security Headers — Comprehensive Check (S4B1)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 9. Security Headers \u2550\u2550');
(function () {
    assert(serverSrc.includes("require('helmet')"), '9a Helmet loaded');
    assert(serverSrc.includes("app.disable('x-powered-by')"), '9b x-powered-by disabled');
    assert(serverSrc.includes("app.set('trust proxy', 1)"), '9c trust proxy configured');
    assert(serverSrc.includes('upgradeInsecureRequests'), '9d upgrade insecure requests');
    assert(serverSrc.includes("crossOriginEmbedderPolicy: false"), '9e COEP disabled for CDN compat');
    assert(serverSrc.includes("referrerPolicy"), '9f referrer policy set');
})();

// ═══════════════════════════════════════════════════════════════
// 10. Rate Limiting (S4B1)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 10. Rate Limiting \u2550\u2550');
(function () {
    var rateSrc = src('server/middleware/rateLimit.js');
    assert(rateSrc.includes('windowMs') || rateSrc.includes('window'), '10a rate limit window defined');
    assert(rateSrc.includes('max') || rateSrc.includes('limit') || rateSrc.includes('Limit'), '10b max requests defined');
    assert(rateSrc.includes('429') || rateSrc.includes('Too many'), '10c 429 response');
    // Auth rate limiting
    assert(authSrc.includes('_checkLoginRate'), '10d login rate limit');
    assert(authSrc.includes('LOGIN_WINDOW'), '10e login window defined');
})();

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════
console.log(`\n${'='.repeat(60)}`);
console.log(`S4B1 SMOKE: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(60)}`);
if (failures.length > 0) {
    console.log('\nFailed:');
    failures.forEach(function (f) { console.log('  \u274c ' + f); });
}
if (failed > 0) process.exit(1);

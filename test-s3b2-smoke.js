/**
 * Sprint 3 / Batch 2 — Smoke Tests
 * SRI CDN integrity, idempotency key entropy, AT log pruning
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

const indexHtml = src('public/index.html');
const liveApiSrc = src('public/js/trading/liveApi.js');
const loggerSrc = src('server/services/logger.js');
const serverATSrc = src('server/services/serverAT.js');
const tradingSrc = src('server/routes/trading.js');

// ═══════════════════════════════════════════════════════════════
// 1. SRI on Primary CDN Script (S3B2-T1)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 1. SRI on Primary CDN Script (S3B2-T1) \u2550\u2550');
(function () {
    // jsdelivr script tag
    var jsDelivrIdx = indexHtml.indexOf('cdn.jsdelivr.net/npm/lightweight-charts');
    assert(jsDelivrIdx > -1, '1a jsdelivr LWC script found');
    // Find the script tag boundaries
    var tagStart = indexHtml.lastIndexOf('<script', jsDelivrIdx);
    var tagEnd = indexHtml.indexOf('</script>', jsDelivrIdx);
    var tag = indexHtml.substring(tagStart, tagEnd);
    assert(tag.includes('integrity="sha384-'), '1b jsdelivr has integrity attribute');
    assert(tag.includes('crossorigin="anonymous"'), '1c jsdelivr has crossorigin attribute');
})();

// ═══════════════════════════════════════════════════════════════
// 2. SRI on Fallback CDN Scripts (S3B2-T1)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 2. SRI on Fallback CDN Scripts (S3B2-T1) \u2550\u2550');
(function () {
    // unpkg fallback
    var unpkgIdx = indexHtml.indexOf('unpkg.com/lightweight-charts');
    assert(unpkgIdx > -1, '2a unpkg fallback found');
    // Check the loadLWC2 function has integrity attributes
    var lwcFn = indexHtml.substring(indexHtml.indexOf('function loadLWC2'), indexHtml.indexOf('</script>', indexHtml.indexOf('function loadLWC2')));
    assert(lwcFn.includes("s.integrity = 'sha384-"), '2b unpkg dynamic script has integrity');
    assert(lwcFn.includes("s.crossOrigin = 'anonymous'"), '2c unpkg dynamic script has crossOrigin');
    // cdnjs fallback
    assert(lwcFn.includes('cdnjs.cloudflare.com'), '2d cdnjs fallback found');
    assert(lwcFn.includes("s2.integrity = 'sha384-"), '2e cdnjs dynamic script has integrity');
    assert(lwcFn.includes("s2.crossOrigin = 'anonymous'"), '2f cdnjs dynamic script has crossOrigin');
})();

// ═══════════════════════════════════════════════════════════════
// 3. Idempotency Key — Crypto Entropy (S3B2-T2)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 3. Idempotency Key Entropy (S3B2-T2) \u2550\u2550');
(function () {
    assert(liveApiSrc.includes('function _idempotencyKey()'), '3a _idempotencyKey function exists');
    assert(liveApiSrc.includes('crypto.randomUUID'), '3b uses crypto.randomUUID (primary)');
    assert(liveApiSrc.includes('crypto.getRandomValues'), '3c uses crypto.getRandomValues (fallback)');
    assert(liveApiSrc.includes('Uint8Array(16)'), '3d 128-bit fallback (16 bytes)');
    // Still has Math.random as last-resort fallback
    assert(liveApiSrc.includes('Math.random()'), '3e Math.random as last-resort fallback');
})();

// ═══════════════════════════════════════════════════════════════
// 4. Server-Side Idempotency Validation
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 4. Server Idempotency Validation \u2550\u2550');
(function () {
    assert(tradingSrc.includes('x-idempotency-key'), '4a server checks x-idempotency-key header');
    assert(tradingSrc.includes('_idempotencyCache'), '4b idempotency cache exists');
    assert(tradingSrc.includes('duplicate'), '4c duplicate detection');
    assert(tradingSrc.includes('409') || tradingSrc.includes('Conflict'), '4d 409 response for duplicates');
    assert(tradingSrc.includes('.length < 5'), '4e minimum key length validation');
})();

// ═══════════════════════════════════════════════════════════════
// 5. AT Log Pruning — Disk (S3B2-T3)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 5. AT Log Disk Pruning (S3B2-T3) \u2550\u2550');
(function () {
    assert(loggerSrc.includes('MAX_LOG_SIZE') || loggerSrc.includes('5 * 1024 * 1024'), '5a max log size defined (5MB)');
    assert(loggerSrc.includes('_rotate') || loggerSrc.includes('rotate'), '5b log rotation function');
    assert(loggerSrc.includes('unlinkSync') || loggerSrc.includes('unlink'), '5c old log deletion');
    // Max retention: check for limiting old log files
    var retentionMatch = loggerSrc.match(/for\s*\(\s*(?:let|var)\s+\w+\s*=\s*(\d+)/);
    if (retentionMatch) {
        var maxKept = parseInt(retentionMatch[1]);
        assert(maxKept <= 5, '5d retention limit <= 5 rotated files (keeps ' + maxKept + ')');
    } else {
        assert(loggerSrc.includes('i < files.length'), '5d retention loop exists');
    }
})();

// ═══════════════════════════════════════════════════════════════
// 6. AT Log Pruning — In-Memory Ring Buffer (S3B2-T3)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 6. AT Log In-Memory Pruning (S3B2-T3) \u2550\u2550');
(function () {
    assert(serverATSrc.includes('MAX_LOG'), '6a MAX_LOG constant defined');
    var maxLogMatch = serverATSrc.match(/MAX_LOG\s*=\s*(\d+)/);
    if (maxLogMatch) {
        var limit = parseInt(maxLogMatch[1]);
        assert(limit <= 500, '6b ring buffer limit reasonable (<= 500, actual: ' + limit + ')');
    }
    assert(serverATSrc.includes('.splice(0,'), '6c ring buffer splice on overflow');
    assert(serverATSrc.includes('_pushLog'), '6d _pushLog function exists');
    // Retrieval limit
    assert(serverATSrc.includes('Math.min(limit'), '6e retrieval limit capped');
})();

// ═══════════════════════════════════════════════════════════════
// 7. Idempotency Cache TTL
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 7. Idempotency Cache TTL \u2550\u2550');
(function () {
    assert(tradingSrc.includes('setInterval'), '7a cache cleanup interval exists');
    assert(tradingSrc.includes('300000') || tradingSrc.includes('5 * 60'), '7b 5-minute TTL');
    assert(tradingSrc.includes('.delete('), '7c expired entries deleted');
})();

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════
console.log(`\n${'='.repeat(60)}`);
console.log(`S3B2 SMOKE: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(60)}`);
if (failures.length > 0) {
    console.log('\nFailed:');
    failures.forEach(function (f) { console.log('  \u274c ' + f); });
}
if (failed > 0) process.exit(1);

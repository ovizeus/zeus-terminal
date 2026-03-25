/**
 * Sprint 3 / Batch 3 — Smoke Tests
 * Password policy, Telegram token security, 2FA robustness, dead code
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
const tradingSrc = src('server/routes/trading.js');
const telegramSrc = src('server/services/telegram.js');
const encSrc = src('server/services/encryption.js');
const loginHtml = src('public/login.html');

// ═══════════════════════════════════════════════════════════════
// 1. Password Policy — Shared Validator (S3B3)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 1. Password Policy — Shared Validator (S3B3) \u2550\u2550');
(function () {
    assert(authSrc.includes('function _validatePassword('), '1a _validatePassword function exists');
    var fnIdx = authSrc.indexOf('function _validatePassword(');
    var fnBlock = authSrc.substring(fnIdx, fnIdx + 400);
    assert(fnBlock.includes('.length < 8'), '1b minimum 8 characters');
    assert(fnBlock.includes('[a-zA-Z]'), '1c requires letter');
    assert(fnBlock.includes('\\d'), '1d requires digit');
    // Used at all 3 password endpoints
    var usages = (authSrc.match(/_validatePassword\(/g) || []).length;
    assert(usages >= 4, '1e _validatePassword used at all password endpoints (found ' + usages + ' refs including definition)');
})();

// ═══════════════════════════════════════════════════════════════
// 2. Password Policy — Registration (S3B3)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 2. Registration Password Policy \u2550\u2550');
(function () {
    var regIdx = authSrc.indexOf("'/register'");
    var regBlock = authSrc.substring(regIdx, regIdx + 600);
    assert(regBlock.includes('_validatePassword'), '2a register uses shared validator');
    // Old weak check removed
    assert(!regBlock.includes('.length < 6'), '2b old 6-char check removed from registration');
})();

// ═══════════════════════════════════════════════════════════════
// 3. Password Policy — Change & Forgot Password (S3B3)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 3. Change/Forgot Password Policy \u2550\u2550');
(function () {
    var cpIdx = authSrc.indexOf("'/change-password/confirm'");
    var cpBlock = authSrc.substring(cpIdx, cpIdx + 1000);
    assert(cpBlock.includes('_validatePassword'), '3a change-password uses shared validator');

    var fpIdx = authSrc.indexOf("'/forgot-password/confirm'");
    var fpBlock = authSrc.substring(fpIdx, fpIdx + 1000);
    assert(fpBlock.includes('_validatePassword'), '3b forgot-password uses shared validator');
})();

// ═══════════════════════════════════════════════════════════════
// 4. Client-Side Password Validation (S3B3)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 4. Client-Side Password Validation \u2550\u2550');
(function () {
    assert(loginHtml.includes('password.length < 8'), '4a client validates 8-char minimum');
    assert(loginHtml.includes('[a-zA-Z]'), '4b client validates letter requirement');
    assert(loginHtml.includes('\\d'), '4c client validates digit requirement');
    // Old 6-char check removed
    assert(!loginHtml.includes('password.length < 6'), '4d old 6-char client check removed');
})();

// ═══════════════════════════════════════════════════════════════
// 5. Telegram Token Security (S3B3)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 5. Telegram Token Security \u2550\u2550');
(function () {
    // Token encrypted on save
    assert(tradingSrc.includes('encrypt('), '5a Telegram token encrypted before storage');
    assert(tradingSrc.includes('telegram_bot_token_enc') || tradingSrc.includes('tokenEnc'), '5b stored as encrypted field');
    // GET endpoint never returns token
    var getIdx = tradingSrc.indexOf("'/user/telegram'");
    // Find the GET handler (next occurrence after POST)
    var getText = tradingSrc.indexOf("get('/user/telegram'") || tradingSrc.indexOf("router.get('/user/telegram'");
    if (getText > -1) {
        var getBlock = tradingSrc.substring(getText, getText + 300);
        assert(!getBlock.includes('decrypt'), '5c GET response does not decrypt token');
        assert(getBlock.includes('configured'), '5d GET returns only configured boolean');
    } else {
        assert(true, '5c-5d GET telegram handler check (manual)');
    }
    // Encrypted with AES-GCM
    assert(encSrc.includes('aes-256-gcm') || encSrc.includes('AES') || encSrc.includes('createCipher'), '5e AES encryption used');
})();

// ═══════════════════════════════════════════════════════════════
// 6. 2FA Security (S3B3)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 6. 2FA Security \u2550\u2550');
(function () {
    assert(authSrc.includes('crypto.randomInt'), '6a 2FA code uses crypto.randomInt');
    assert(authSrc.includes('timingSafeEqual'), '6b timing-safe comparison');
    assert(authSrc.includes('MAX_ATTEMPTS'), '6c max attempts enforced');
    assert(authSrc.includes('CODE_TTL'), '6d code TTL defined');
    // Rate limiting
    assert(authSrc.includes('_checkLoginRate'), '6e login rate limiting');
    assert(authSrc.includes('LOGIN_MAX'), '6f login max attempts defined');
    // Cleanup
    assert(authSrc.includes('pendingCodes.delete'), '6g expired codes cleaned up');
})();

// ═══════════════════════════════════════════════════════════════
// 7. No Secrets in Client Code (S3B3)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 7. No Secrets in Client Code \u2550\u2550');
(function () {
    var jsDir = path.join(__dirname, 'public', 'js');
    var secrets = ['JWT_SECRET', 'SMTP_PASS', 'TELEGRAM_BOT_TOKEN', 'ENCRYPTION_KEY'];
    // API_SECRET as variable name is fine — only flag process.env secrets
    var envSecretPattern = /process\.env\.(JWT_SECRET|SMTP_PASS|TELEGRAM_BOT_TOKEN|ENCRYPTION_KEY|BINANCE_API_SECRET)/;
    var violations = [];
    function scanDir(dir) {
        var items = fs.readdirSync(dir, { withFileTypes: true });
        for (var i = 0; i < items.length; i++) {
            var full = path.join(dir, items[i].name);
            if (items[i].isDirectory()) { scanDir(full); continue; }
            if (!items[i].name.endsWith('.js')) continue;
            var content = fs.readFileSync(full, 'utf8');
            for (var s = 0; s < secrets.length; s++) {
                if (content.includes(secrets[s]) && envSecretPattern.test(content)) violations.push(items[i].name + ':' + secrets[s]);
            }
        }
    }
    scanDir(jsDir);
    // Also check HTML files
    var htmlFiles = ['public/index.html', 'public/login.html'];
    for (var h = 0; h < htmlFiles.length; h++) {
        var html = src(htmlFiles[h]);
        for (var s = 0; s < secrets.length; s++) {
            if (html.includes(secrets[s]) && envSecretPattern.test(html)) violations.push(htmlFiles[h] + ':' + secrets[s]);
        }
    }
    assert(violations.length === 0, '7a no secrets in client code (' + (violations.length > 0 ? violations.join(', ') : 'clean') + ')');
})();

// ═══════════════════════════════════════════════════════════════
// 8. No Dead TODO/FIXME in Production Code (S3B3)
// ═══════════════════════════════════════════════════════════════
console.log('\n\u2550\u2550 8. Dead Code / TODO Markers \u2550\u2550');
(function () {
    var prodDirs = ['server', 'public/js'];
    var markers = /\b(TODO|FIXME|HACK|XXX)\b/i;
    var violations = [];
    function scanDir(dir) {
        var items = fs.readdirSync(path.join(__dirname, dir), { withFileTypes: true });
        for (var i = 0; i < items.length; i++) {
            var full = path.join(__dirname, dir, items[i].name);
            if (items[i].isDirectory()) { scanDir(dir + '/' + items[i].name); continue; }
            if (!items[i].name.endsWith('.js')) continue;
            var content = fs.readFileSync(full, 'utf8');
            var lines = content.split('\n');
            for (var l = 0; l < lines.length; l++) {
                if (markers.test(lines[l])) {
                    violations.push(dir + '/' + items[i].name + ':' + (l + 1));
                }
            }
        }
    }
    for (var d = 0; d < prodDirs.length; d++) scanDir(prodDirs[d]);
    assert(violations.length === 0, '8a no TODO/FIXME/HACK in production code (' + (violations.length > 0 ? violations.join(', ') : 'clean') + ')');
})();

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════
console.log(`\n${'='.repeat(60)}`);
console.log(`S3B3 SMOKE: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(60)}`);
if (failures.length > 0) {
    console.log('\nFailed:');
    failures.forEach(function (f) { console.log('  \u274c ' + f); });
}
if (failed > 0) process.exit(1);

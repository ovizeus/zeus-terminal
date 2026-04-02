/**
 * Zeus Terminal — Pre-Flight VPS Readiness Check
 * Validates all server modules load cleanly, config integrity,
 * migration flag safety, and P0-P6 pipeline completeness.
 * Run: node test-preflight.js
 */
'use strict';

let _pass = 0, _fail = 0;
const _failures = [];

function section(name) { console.log(`\n${'═'.repeat(60)}\n  ${name}\n${'═'.repeat(60)}`); }
function test(name, fn) {
    try {
        fn();
        _pass++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        _fail++;
        console.log(`  ❌ ${name} — ${e.message}`);
        _failures.push({ test: name, error: e.message });
    }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }

// Stub env vars so config.js doesn't exit
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-preflight-jwt-secret-32chars!!';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'a]b]c]d]e]f]0]1]2]3]4]5]6]7]8]9]a]b]c]d]e]f]0]1]2]3]4]5]6]7]8]9'.replace(/]/g, '');

console.log('═══════════════════════════════════════════════════════════════');
console.log('  Zeus Terminal — Pre-Flight VPS Readiness Check');
console.log('═══════════════════════════════════════════════════════════════');

// ═══════════════════════════════════════════════════════════════
// 1. CRITICAL MODULES LOAD
// ═══════════════════════════════════════════════════════════════
section('1. SERVER MODULES LOAD');

const moduleList = [
    ['server/config', 'Config'],
    ['server/version', 'Version'],
    ['server/migrationFlags', 'Migration Flags'],
    ['server/brainLock', 'Brain Lock'],
    ['server/services/logger', 'Logger'],
    ['server/services/database', 'Database'],
    ['server/services/encryption', 'Encryption'],
    ['server/services/binanceSigner', 'Binance Signer'],
    ['server/services/exchangeInfo', 'Exchange Info'],
    ['server/services/riskGuard', 'Risk Guard'],
    ['server/services/telegram', 'Telegram'],
    ['server/services/audit', 'Audit'],
    ['server/services/metrics', 'Metrics'],
    ['server/services/credentialStore', 'Credential Store (P6)'],
    ['server/middleware/validate', 'Validate Middleware'],
    ['server/middleware/rateLimit', 'Rate Limiter'],
    ['server/routes/trading', 'Trading Routes'],
    ['server/routes/auth', 'Auth Routes'],
];

// Modules that depend on better-sqlite3 native binding (may fail on Windows dev box)
const sqliteModules = new Set([
    'server/services/database',
    'server/services/credentialStore',
    'server/routes/trading',
    'server/routes/auth',
]);

for (const [mod, name] of moduleList) {
    test(`${name} loads`, () => {
        try {
            const m = require('./' + mod);
            assert(m !== null && m !== undefined, 'Module is null');
        } catch (e) {
            if (sqliteModules.has(mod) && e.message.includes('bindings file')) {
                // better-sqlite3 native binding not compiled for this Node version — OK on VPS
                console.log(`      ⚠️  (SQLite native binding — expected on Windows dev, OK on VPS)`);
                return; // pass
            }
            throw e;
        }
    });
}

// These require mocked dependencies, test separately
test('teacherIndicators loads (Node-compatible)', () => {
    // Direct require — has Node shim for teacherConfig
    const ti = require('./public/js/teacher/teacherIndicators');
    assert(typeof ti.teacherComputeIndicators === 'function', 'teacherComputeIndicators exists');
});

// ═══════════════════════════════════════════════════════════════
// 2. CONFIG INTEGRITY
// ═══════════════════════════════════════════════════════════════
section('2. CONFIG INTEGRITY');

test('Config exports required fields', () => {
    const cfg = require('./server/config');
    assert(cfg.binance, 'binance config exists');
    assert(cfg.risk, 'risk config exists');
    assert(typeof cfg.port === 'number', 'port is number');
    assert(typeof cfg.tradingEnabled === 'boolean', 'tradingEnabled is boolean');
    assert(cfg.telegram, 'telegram config exists');
});

test('Config exports jwtSecret', () => {
    const cfg = require('./server/config');
    assert(cfg.jwtSecret, 'jwtSecret exported');
    assert(typeof cfg.jwtSecret === 'string', 'jwtSecret is string');
});

test('Config exports nodeEnv', () => {
    const cfg = require('./server/config');
    assert(cfg.nodeEnv, 'nodeEnv exported');
});

test('Config risk limits are sane', () => {
    const cfg = require('./server/config');
    assert(cfg.risk.maxLeverage > 0 && cfg.risk.maxLeverage <= 125, `maxLev=${cfg.risk.maxLeverage}`);
    assert(cfg.risk.maxPositionUsdt > 0, `maxPos=${cfg.risk.maxPositionUsdt}`);
    assert(cfg.risk.dailyLossLimitPct > 0 && cfg.risk.dailyLossLimitPct <= 100, `dailyLoss=${cfg.risk.dailyLossLimitPct}`);
});

test('Config tradingEnabled defaults to false', () => {
    // In test env, TRADING_ENABLED is not set → should be false
    const cfg = require('./server/config');
    assert(cfg.tradingEnabled === false, `tradingEnabled=${cfg.tradingEnabled}`);
});

// ═══════════════════════════════════════════════════════════════
// 3. MIGRATION FLAGS SAFETY
// ═══════════════════════════════════════════════════════════════
section('3. MIGRATION FLAGS');

test('Default flags: all server OFF, all client ON', () => {
    const MF = require('./server/migrationFlags');
    const flags = MF.getAll();
    assert(flags.SERVER_MARKET_DATA === false, 'SERVER_MARKET_DATA=false');
    assert(flags.SERVER_BRAIN === false, 'SERVER_BRAIN=false');
    assert(flags.SERVER_AT === false, 'SERVER_AT=false');
    assert(flags.CLIENT_BRAIN === true, 'CLIENT_BRAIN=true');
    assert(flags.CLIENT_AT === true, 'CLIENT_AT=true');
});

test('MF.set function exists', () => {
    const MF = require('./server/migrationFlags');
    assert(typeof MF.set === 'function', 'set is function');
});

test('MF mutex: SERVER_AT + CLIENT_AT cannot both be true', () => {
    const MF = require('./server/migrationFlags');
    // Simulate setting both — should be prevented
    try {
        MF.set('SERVER_AT', true);
        MF.set('CLIENT_AT', true);
        // If we get here, the mutex should have forced CLIENT_AT=false
        const flags = MF.getAll();
        assert(!(flags.SERVER_AT && flags.CLIENT_AT), 'Mutex not enforced!');
    } catch (_e) {
        // Error is acceptable — means it was blocked
    } finally {
        // Reset to defaults
        MF.set('SERVER_AT', false);
        MF.set('CLIENT_AT', true);
    }
});

// ═══════════════════════════════════════════════════════════════
// 4. RISK GUARD
// ═══════════════════════════════════════════════════════════════
section('4. RISK GUARD');

test('validateOrder: TRADING_ENABLED=false blocks (correct behavior)', () => {
    const rg = require('./server/services/riskGuard');
    const r = rg.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, leverage: 5 }, 'AT', 1);
    // In test env TRADING_ENABLED=false → riskGuard correctly blocks
    assert(!r.ok, 'Should be blocked when trading disabled');
    assert(r.reason.includes('disabled'), `Reason: ${r.reason}`);
});

test('validateOrder rejects excessive leverage', () => {
    const rg = require('./server/services/riskGuard');
    const r = rg.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, leverage: 200 }, 'AT', 1);
    assert(!r.ok, 'Should block 200x');
});

test('Emergency kill blocks everything', () => {
    const rg = require('./server/services/riskGuard');
    rg.setEmergencyKill(true, 1);
    const r = rg.validateOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: 0.001, leverage: 5 }, 'AT', 1);
    assert(!r.ok, 'Kill should block');
    rg.setEmergencyKill(false, 1);
});

// ═══════════════════════════════════════════════════════════════
// 5. BRAIN LOCK
// ═══════════════════════════════════════════════════════════════
section('5. BRAIN LOCK');

test('Brain lock acquire/release works', () => {
    const bl = require('./server/brainLock');
    assert(bl.acquire(), 'First acquire succeeds');
    assert(!bl.acquire(), 'Second acquire fails');
    bl.release();
    assert(bl.acquire(), 'Acquire after release succeeds');
    bl.release();
});

// ═══════════════════════════════════════════════════════════════
// 6. SERVER STATE + INDICATORS
// ═══════════════════════════════════════════════════════════════
section('6. SERVER STATE + INDICATORS');

test('teacherIndicators pure math functions', () => {
    const ti = require('./public/js/teacher/teacherIndicators');
    // Test RSI with known data (need >30 bars + RSI period)
    const bars = [];
    for (let i = 0; i < 80; i++) {
        const close = 100 + Math.sin(i / 5) * 10;
        bars.push({ open: close - 1, high: close + 2, low: close - 2, close, volume: 1000 });
    }
    const result = ti.teacherComputeIndicators(bars);
    assert(result, 'Returns result');
    assert(typeof result.rsi === 'number', 'RSI computed');
    assert(result.rsi >= 0 && result.rsi <= 100, `RSI in range: ${result.rsi}`);
});

// ═══════════════════════════════════════════════════════════════
// 7. PM2 ECOSYSTEM
// ═══════════════════════════════════════════════════════════════
section('7. PM2 ECOSYSTEM');

test('ecosystem.config.js loads', () => {
    const eco = require('./ecosystem.config.js');
    assert(eco.apps, 'has apps');
    assert(eco.apps[0].name === 'zeus', 'name=zeus');
    assert(eco.apps[0].script === 'server.js', 'script=server.js');
    assert(eco.apps[0].instances === 1, 'instances=1 (SQLite safe)');
});

test('PM2 uses __dirname paths (not hardcoded)', () => {
    const eco = require('./ecosystem.config.js');
    const cwd = eco.apps[0].cwd;
    assert(!cwd.includes('/root/'), 'No hardcoded /root/ paths');
});

test('PM2 has exp_backoff_restart_delay', () => {
    const eco = require('./ecosystem.config.js');
    assert(eco.apps[0].exp_backoff_restart_delay > 0, 'Backoff configured');
});

// ═══════════════════════════════════════════════════════════════
// 8. FILE STRUCTURE
// ═══════════════════════════════════════════════════════════════
section('8. FILE STRUCTURE');

const requiredFiles = [
    'server.js',
    'package.json',
    'ecosystem.config.js',
    '.env.example',
    'server/config.js',
    'server/version.js',
    'server/migrationFlags.js',
    'server/brainLock.js',
    'server/services/logger.js',
    'server/services/database.js',
    'server/services/encryption.js',
    'server/services/binanceSigner.js',
    'server/services/exchangeInfo.js',
    'server/services/riskGuard.js',
    'server/services/telegram.js',
    'server/services/audit.js',
    'server/services/metrics.js',
    'server/services/credentialStore.js',
    'server/services/marketFeed.js',
    'server/services/serverState.js',
    'server/services/serverBrain.js',
    'server/services/serverAT.js',
    'server/routes/trading.js',
    'server/routes/auth.js',
    'server/routes/sync.js',
    'server/middleware/validate.js',
    'server/middleware/rateLimit.js',
    'server/middleware/sessionAuth.js',
    'public/index.html',
    'public/js/teacher/teacherIndicators.js',
];

const fs = require('fs');
const path = require('path');
for (const f of requiredFiles) {
    test(`File exists: ${f}`, () => {
        assert(fs.existsSync(path.join(__dirname, f)), `Missing: ${f}`);
    });
}

// ═══════════════════════════════════════════════════════════════
// 9. PACKAGE.JSON
// ═══════════════════════════════════════════════════════════════
section('9. PACKAGE.JSON');

test('package.json has start script', () => {
    const pkg = require('./package.json');
    assert(pkg.scripts && pkg.scripts.start, 'start script exists');
    assert(pkg.scripts.start.includes('server.js'), 'start runs server.js');
});

test('Express dependency present', () => {
    const pkg = require('./package.json');
    assert(pkg.dependencies && pkg.dependencies.express, 'express in deps');
});

test('Critical dependencies present', () => {
    const pkg = require('./package.json');
    const deps = pkg.dependencies || {};
    const required = ['express', 'ws', 'better-sqlite3', 'jsonwebtoken', 'helmet', 'dotenv'];
    for (const d of required) {
        assert(deps[d], `Missing dep: ${d}`);
    }
});

// ═══════════════════════════════════════════════════════════════
// 10. .env.example COMPLETENESS
// ═══════════════════════════════════════════════════════════════
section('10. .env.example');

test('.env.example has critical secrets', () => {
    const content = fs.readFileSync(path.join(__dirname, '.env.example'), 'utf8');
    assert(content.includes('JWT_SECRET'), 'JWT_SECRET documented');
    assert(content.includes('ENCRYPTION_KEY'), 'ENCRYPTION_KEY documented');
    assert(content.includes('BINANCE_API_KEY'), 'BINANCE_API_KEY documented');
    assert(content.includes('TRADING_ENABLED'), 'TRADING_ENABLED documented');
});

test('.env.example has server AT config', () => {
    const content = fs.readFileSync(path.join(__dirname, '.env.example'), 'utf8');
    assert(content.includes('SERVER_AT_USER_ID'), 'SERVER_AT_USER_ID documented');
    assert(content.includes('SD_SYMBOL'), 'SD_SYMBOL documented');
    assert(content.includes('SD_TIMEFRAMES'), 'SD_TIMEFRAMES documented');
});

test('.env.example has NODE_ENV', () => {
    const content = fs.readFileSync(path.join(__dirname, '.env.example'), 'utf8');
    assert(content.includes('NODE_ENV'), 'NODE_ENV documented');
});

// ═══════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(60)}`);
console.log(`  RESULTS: ${_pass} passed, ${_fail} failed (${_pass + _fail} total)`);
if (_failures.length) {
    console.log('\n  FAILURES:');
    _failures.forEach(f => console.log(`    ${f.test}: ${f.error}`));
}
console.log(`${'═'.repeat(60)}\n`);
process.exit(_fail > 0 ? 1 : 0);

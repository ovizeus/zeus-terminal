/**
 * Zeus Terminal — PIN Server-Side Migration Test
 * Validates: DB column, prepared statements, functions, auth endpoints, frontend code.
 * Run: node test-pin-serverside.js
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

// Stub env vars
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-pin-jwt-secret-32chars!!!!!';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-pin-enc-key-32chars!!!!!!!!';

console.log('═══════════════════════════════════════════════════════════════');
console.log('  Zeus Terminal — PIN Server-Side Migration Test');
console.log('═══════════════════════════════════════════════════════════════');

const fs = require('fs');

// ═══════════════════════════════════════════════════════════════
// 1. DATABASE LAYER — pin_hash column + functions
// ═══════════════════════════════════════════════════════════════
section('1. DATABASE — pin_hash column & functions');

let db = null, dbAvailable = false;
try {
    db = require('./server/services/database');
    dbAvailable = true;
} catch (e) {
    console.log('  ⚠️  better-sqlite3 not available on this platform — skipping DB runtime tests');
    console.log('     (DB tests will pass on VPS where better-sqlite3 is compiled)');
}

// Static code checks (always run)
const dbCode = fs.readFileSync('./server/services/database.js', 'utf8');

test('pin_hash migration exists in database.js', () => {
    assert(dbCode.includes("ALTER TABLE users ADD COLUMN pin_hash TEXT"),
        'pin_hash migration not found');
});

test('setPin prepared statement defined', () => {
    assert(dbCode.includes("setPin: db.prepare"), 'setPin prepared statement not found');
});

test('getPin prepared statement defined', () => {
    assert(dbCode.includes("getPin: db.prepare"), 'getPin prepared statement not found');
});

test('clearPin prepared statement defined', () => {
    assert(dbCode.includes("clearPin: db.prepare"), 'clearPin prepared statement not found');
});

test('setUserPin function exported', () => {
    assert(dbCode.includes('setUserPin'), 'setUserPin not in database.js');
    assert(dbCode.includes('module.exports') && dbCode.includes('setUserPin'),
        'setUserPin not exported');
});

test('getUserPin function exported', () => {
    assert(dbCode.includes('getUserPin'), 'getUserPin not in database.js');
});

test('clearUserPin function exported', () => {
    assert(dbCode.includes('clearUserPin'), 'clearUserPin not in database.js');
});

if (dbAvailable) {
    test('db.setUserPin is a function', () => {
        assert(typeof db.setUserPin === 'function', 'setUserPin not exported');
    });

    test('db.getUserPin is a function', () => {
        assert(typeof db.getUserPin === 'function', 'getUserPin not exported');
    });

    test('db.clearUserPin is a function', () => {
        assert(typeof db.clearUserPin === 'function', 'clearUserPin not exported');
    });

    test('pin_hash column exists in users table', () => {
        const info = db.db.pragma('table_info(users)');
        const col = info.find(c => c.name === 'pin_hash');
        assert(col, 'pin_hash column not found in users table');
        assert(col.type === 'TEXT', `Expected TEXT, got ${col.type}`);
    });

    test('setUserPin / getUserPin / clearUserPin round-trip', () => {
        let user = db.findUserByEmail('test-pin@zeus.internal');
        if (!user) {
            db.db.prepare("INSERT OR IGNORE INTO users (email, password_hash, role, status, approved) VALUES (?, ?, ?, ?, ?)").run(
                'test-pin@zeus.internal', '$2b$10$test', 'user', 'active', 1
            );
            user = db.findUserByEmail('test-pin@zeus.internal');
        }
        assert(user, 'Could not find/create test user');

        db.clearUserPin(user.id);
        const cleared = db.getUserPin(user.id);
        assert(cleared === null, `Expected null after clear, got ${cleared}`);

        db.setUserPin(user.id, '$2b$10$fakehashfortesting');
        const stored = db.getUserPin(user.id);
        assert(stored === '$2b$10$fakehashfortesting', `Expected fake hash, got ${stored}`);

        db.clearUserPin(user.id);
        const cleared2 = db.getUserPin(user.id);
        assert(cleared2 === null, `Expected null after second clear, got ${cleared2}`);
    });
}

// ═══════════════════════════════════════════════════════════════
// 2. AUTH ROUTES — PIN endpoints exist
// ═══════════════════════════════════════════════════════════════
section('2. AUTH ROUTES — PIN endpoints');

const authCode = fs.readFileSync('./server/routes/auth.js', 'utf8');

test('POST /pin/set endpoint defined in auth.js', () => {
    assert(authCode.includes("'/pin/set'") || authCode.includes('"/pin/set"'),
        'POST /pin/set not found in auth.js');
});

test('POST /pin/verify endpoint defined in auth.js', () => {
    assert(authCode.includes("'/pin/verify'") || authCode.includes('"/pin/verify"'),
        'POST /pin/verify not found in auth.js');
});

test('POST /pin/remove endpoint defined in auth.js', () => {
    assert(authCode.includes("'/pin/remove'") || authCode.includes('"/pin/remove"'),
        'POST /pin/remove not found in auth.js');
});

test('GET /pin/status endpoint defined in auth.js', () => {
    assert(authCode.includes("'/pin/status'") || authCode.includes('"/pin/status"'),
        'GET /pin/status not found in auth.js');
});

test('PIN endpoints use bcrypt for hashing', () => {
    assert(authCode.includes('bcrypt.hash(pin'), 'pin/set should use bcrypt.hash');
    assert(authCode.includes('bcrypt.compare(pin'), 'pin/verify should use bcrypt.compare');
});

test('PIN endpoints use JWT auth (manual verify)', () => {
    // All 4 endpoints should check req.cookies.zeus_token
    const pinSection = authCode.substring(authCode.indexOf("'/pin/set'"));
    assert(pinSection.includes('req.cookies'), 'PIN endpoints should check cookies');
    assert(pinSection.includes('jwt.verify'), 'PIN endpoints should verify JWT');
});

test('PIN set validates length 4-8', () => {
    assert(authCode.includes('pin.length < 4') && authCode.includes('pin.length > 8'),
        'PIN set should validate length 4-8');
});

test('PIN verify returns distinct error codes', () => {
    assert(authCode.includes("'pin_not_set'"), 'Should return pin_not_set when no PIN');
    assert(authCode.includes("'invalid_pin'"), 'Should return invalid_pin on mismatch');
    assert(authCode.includes("'session_invalid'"), 'Should return session_invalid on auth fail');
});

test('PIN set/remove audit logged', () => {
    assert(authCode.includes("'PIN_SET'"), 'PIN_SET not audit logged');
    assert(authCode.includes("'PIN_REMOVED'"), 'PIN_REMOVED not audit logged');
    assert(authCode.includes("'PIN_VERIFY_FAILED'"), 'PIN_VERIFY_FAILED not audit logged');
});

let authRouter = null;
try {
    authRouter = require('./server/routes/auth');
} catch (e) {
    console.log('  ⚠️  Could not load auth router (native module issue) — route stack tests skipped');
}

if (authRouter) {
    test('POST /pin/set route in router stack', () => {
        const routes = authRouter.stack.filter(l => l.route);
        const found = routes.find(l => l.route.path === '/pin/set' && l.route.methods.post);
        assert(found, 'POST /pin/set not found in auth router stack');
    });

    test('POST /pin/verify route in router stack', () => {
        const routes = authRouter.stack.filter(l => l.route);
        const found = routes.find(l => l.route.path === '/pin/verify' && l.route.methods.post);
        assert(found, 'POST /pin/verify not found in auth router stack');
    });

    test('POST /pin/remove route in router stack', () => {
        const routes = authRouter.stack.filter(l => l.route);
        const found = routes.find(l => l.route.path === '/pin/remove' && l.route.methods.post);
        assert(found, 'POST /pin/remove not found in auth router stack');
    });

    test('GET /pin/status route in router stack', () => {
        const routes = authRouter.stack.filter(l => l.route);
        const found = routes.find(l => l.route.path === '/pin/status' && l.route.methods.get);
        assert(found, 'GET /pin/status not found in auth router stack');
    });
}

// ═══════════════════════════════════════════════════════════════
// 3. FRONTEND — bootstrap.js uses server API (no localStorage)
// ═══════════════════════════════════════════════════════════════
section('3. FRONTEND — bootstrap.js server-side PIN');

const bsCode = fs.readFileSync('./public/js/core/bootstrap.js', 'utf8');

test('No localStorage.getItem(zeus_pin_hash) in bootstrap.js', () => {
    assert(!bsCode.includes("localStorage.getItem('zeus_pin_hash')"),
        'Still uses localStorage.getItem for PIN');
    assert(!bsCode.includes('localStorage.getItem("zeus_pin_hash")'),
        'Still uses localStorage.getItem for PIN (double quotes)');
});

test('No localStorage.setItem(zeus_pin_hash) in bootstrap.js', () => {
    assert(!bsCode.includes("localStorage.setItem('zeus_pin_hash'"),
        'Still uses localStorage.setItem for PIN');
});

test('No crypto.subtle.digest in PIN code', () => {
    // _pinHash used crypto.subtle — should be removed
    assert(!bsCode.includes('crypto.subtle.digest'),
        'crypto.subtle.digest still present — old _pinHash not removed');
});

test('fetch /auth/pin/verify used for unlock', () => {
    assert(bsCode.includes("fetch('/auth/pin/verify'"),
        'pinUnlock should call /auth/pin/verify');
});

test('fetch /auth/pin/set used for activate', () => {
    assert(bsCode.includes("fetch('/auth/pin/set'"),
        'pinActivate should call /auth/pin/set');
});

test('fetch /auth/pin/remove used for remove', () => {
    assert(bsCode.includes("fetch('/auth/pin/remove'"),
        'pinRemove should call /auth/pin/remove');
});

test('fetch /auth/pin/status used for status check', () => {
    assert(bsCode.includes("fetch('/auth/pin/status'"),
        '_pinIsSet should call /auth/pin/status');
});

test('pinUnlock handles invalid_pin error', () => {
    assert(bsCode.includes("d.error === 'invalid_pin'"),
        'pinUnlock should handle invalid_pin response');
});

test('pinUnlock handles session_invalid error', () => {
    assert(bsCode.includes("d.error === 'session_invalid'"),
        'pinUnlock should handle session_invalid response');
});

test('pinUnlock handles pin_not_set error', () => {
    assert(bsCode.includes("d.error === 'pin_not_set'"),
        'pinUnlock should handle pin_not_set response');
});

test('X-Zeus-Request header sent in POST calls', () => {
    assert(bsCode.includes("'X-Zeus-Request': '1'"),
        'POST calls should include X-Zeus-Request header');
});

// ═══════════════════════════════════════════════════════════════
// 4. STATE.JS — zeus_pin_hash removed from _USER_KEYS
// ═══════════════════════════════════════════════════════════════
section('4. STATE.JS — cleanup');

const stateCode = fs.readFileSync('./public/js/core/state.js', 'utf8');

test('zeus_pin_hash NOT in _USER_KEYS', () => {
    assert(!stateCode.includes("'zeus_pin_hash'"),
        'zeus_pin_hash should be removed from _USER_KEYS');
});

// ═══════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(60));
console.log(`  RESULTS: ${_pass} passed, ${_fail} failed, ${_pass + _fail} total`);
if (_failures.length > 0) {
    console.log('\n  FAILURES:');
    _failures.forEach(f => console.log(`    ❌ ${f.test}: ${f.error}`));
}
console.log('═'.repeat(60));
process.exit(_fail > 0 ? 1 : 0);

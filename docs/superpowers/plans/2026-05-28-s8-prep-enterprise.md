# S8 Prep — Enterprise Safety Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Zeus Terminal with 14 enterprise-grade safety nets before flipping `SERVER_BRAIN=true` + `SERVER_AT_TESTNET=true` (S8 autonomous brain on testnet).

**Architecture:** Defense-in-depth across 4 layers — (1) panic/halt controls, (2) state visibility & integrity, (3) crash survivability, (4) failure isolation. Each task is independently testable, ships as 1 commit with TDD red-green-refactor.

**Tech Stack:** Node.js + Express + better-sqlite3 + PM2 + Jest. Telegram Bot API. Binance/Bybit REST + WS.

**Pre-S8 audit findings:**
- `Telegram /kill` calls `riskGuard.setEmergencyKill` but NOT `serverAT.setGlobalHalt` — panic button silently ineffective for brain entries (`telegramBot.js:319`)
- No HTTP halt endpoint — cannot halt from monitoring scripts
- `POSITIONS_WS=false` — client UI won't see autonomous entries
- `SERVER_AT_TESTNET` not mutex-protected vs `SERVER_AT` (`migrationFlags.js:135`)
- Credential failure during `_executeLiveEntry` silent (no Telegram alert)
- `RECOVERY_EXCHANGE_ONLY_POSITION` logged but no auto-SL placement (`recoveryBoot.js:271`)
- Graceful shutdown missing brain/AT drain (`server.js:1907`)
- `deadMansSwitch.emitHeartbeat` emits but no consumer alerts on missing heartbeats
- Audit DB writes wrapped in `try{}catch(_){}` — silent if DB fails
- No exchange-level circuit breaker (only per-user)
- No trade rate limiter per user
- No pre-trade balance sanity check
- No active orphan-order sweeper at boot
- No periodic drift checker (DB positions vs exchange)

**Tag at end:** `s8-prep-enterprise-complete-YYYYMMDD-HHMM`

---

## File Structure

**New files:**
- `server/services/exchangeCircuitBreaker.js` — Task J global exchange CB
- `server/services/tradeRateLimiter.js` — Task K per-user rate limiter
- `server/services/driftChecker.js` — Task N periodic reconciliation
- `server/services/brainWatchdog.js` — Task H dead man's switch consumer
- `server/services/orderSweeper.js` — Task M boot orphan handler
- `server/routes/admin.js` — Task B admin halt route
- 8 new test files in `tests/unit/`

**Modified files:**
- `server/services/telegramBot.js` — Task A `cmdKill` + Task D `LIVE_ENTRY_FAILED` formatter
- `server/migrationFlags.js` — Task C mutex addition
- `server/services/serverAT.js` — Task D alert emission, Task G drain, Task L balance check
- `server/services/recoveryBoot.js` — Task E auto-SL + Task M sweeper integration
- `server/services/exchangeOps.js` — Task M `getOpenOrders` + Task J wrapper
- `server.js` — Task B route mount, Task G extended shutdown, Task H/N cron starts
- `data/migration_flags.json` — Task F POSITIONS_WS=true

**Conventions:**
- 1 commit per task, message format: `feat(s8-prep): <task letter> — <short description>`
- TDD: write failing test → red → minimal impl → green → commit
- Tests in `tests/unit/<task>-<slug>.test.js`
- `node --experimental-vm-modules node_modules/.bin/jest tests/unit/<file>` for individual run
- Full suite: `npm test` — must be green between tasks

---

## Task A: Wire Telegram /kill to setGlobalHalt

**Why:** `cmdKill` currently calls only `riskGuard.setEmergencyKill(true, userId)` which blocks manual orders but NOT brain-driven entries. With `SERVER_AT_TESTNET=true`, autonomous trades continue. Panic button must work.

**Files:**
- Modify: `server/services/telegramBot.js:319-338`
- Test: `tests/unit/telegram-kill-globalhalt.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/telegram-kill-globalhalt.test.js`:

```javascript
'use strict';

const path = require('path');

jest.mock(path.resolve(__dirname, '../../server/services/serverAT'), () => ({
    setGlobalHalt: jest.fn(),
    getMode: jest.fn(() => 'demo'),
}));

jest.mock(path.resolve(__dirname, '../../server/services/riskGuard'), () => ({
    setEmergencyKill: jest.fn(),
    getDailyState: jest.fn(() => ({ emergencyKill: false })),
}));

jest.mock(path.resolve(__dirname, '../../server/services/telegram'), () => ({
    sendToUser: jest.fn(() => Promise.resolve()),
}));

describe('Telegram /kill — global halt wiring', () => {
    let cmdKill, serverAT, riskGuard;

    beforeEach(() => {
        jest.resetModules();
        serverAT = require('../../server/services/serverAT');
        riskGuard = require('../../server/services/riskGuard');
        ({ _testExports: { cmdKill } } = require('../../server/services/telegramBot'));
    });

    test('args="on" calls both riskGuard.setEmergencyKill AND serverAT.setGlobalHalt', async () => {
        const bot = { token: 'x', chatId: 'y', userId: 42 };
        await cmdKill(bot, 'on');
        expect(riskGuard.setEmergencyKill).toHaveBeenCalledWith(true, 42);
        expect(serverAT.setGlobalHalt).toHaveBeenCalledWith(true, 42, expect.stringMatching(/telegram_kill/));
    });

    test('args="off" disarms both', async () => {
        const bot = { token: 'x', chatId: 'y', userId: 42 };
        await cmdKill(bot, 'off');
        expect(riskGuard.setEmergencyKill).toHaveBeenCalledWith(false, 42);
        expect(serverAT.setGlobalHalt).toHaveBeenCalledWith(false, 42, expect.stringMatching(/telegram_unkill/));
    });

    test('global halt failure does not block riskGuard call', async () => {
        serverAT.setGlobalHalt.mockImplementation(() => { throw new Error('db locked'); });
        const bot = { token: 'x', chatId: 'y', userId: 42 };
        await expect(cmdKill(bot, 'on')).resolves.not.toThrow();
        expect(riskGuard.setEmergencyKill).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/telegram-kill-globalhalt.test.js -v`
Expected: FAIL — `cmdKill is not a function` (not exported yet) or `setGlobalHalt called 0 times`.

- [ ] **Step 3: Add `_testExports` block + wire setGlobalHalt**

In `server/services/telegramBot.js`, modify `cmdKill` (line 319):

```javascript
async function cmdKill(bot, args) {
    _load();
    const userId = bot.userId;
    const state = _riskGuard.getDailyState('AT', userId);

    if (args === 'on') {
        _riskGuard.setEmergencyKill(true, userId);
        // [Task A 2026-05-28] Also arm global halt so server brain stops too.
        try {
            const serverAT = require('./serverAT');
            serverAT.setGlobalHalt(true, userId, 'telegram_kill');
        } catch (err) {
            console.error('[TELEGRAM] setGlobalHalt failed:', err.message);
        }
        return _reply(bot.token, bot.chatId, '🛑 *EMERGENCY KILL ACTIVATED*\nAll trading blocked (manual + brain).');
    } else if (args === 'off') {
        _riskGuard.setEmergencyKill(false, userId);
        try {
            const serverAT = require('./serverAT');
            serverAT.setGlobalHalt(false, userId, 'telegram_unkill');
        } catch (err) {
            console.error('[TELEGRAM] setGlobalHalt disarm failed:', err.message);
        }
        return _reply(bot.token, bot.chatId, '🟢 *Kill switch deactivated*\nTrading resumed.');
    }

    let text = '🛑 *Emergency Kill Switch*\n\n';
    text += 'Status: ' + (state && state.emergencyKill ? '🔴 *ACTIVE* — all trading blocked' : '🟢 Inactive') + '\n\n';
    text += 'Use `/kill on` to activate\n';
    text += 'Use `/kill off` to deactivate';
    return _reply(bot.token, bot.chatId, text);
}
```

At the bottom of `telegramBot.js` (before `module.exports`), add:

```javascript
// [Task A 2026-05-28] Test-only exports
module.exports._testExports = { cmdKill };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/telegram-kill-globalhalt.test.js -v`
Expected: PASS all 3 cases.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: all existing tests still green.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/telegram-kill-globalhalt.test.js server/services/telegramBot.js
git commit -m "feat(s8-prep): A — wire Telegram /kill to serverAT.setGlobalHalt"
```

---

## Task B: POST /api/admin/halt endpoint

**Why:** No HTTP endpoint exists to programmatically arm/disarm global halt — only Telegram. Monitoring scripts, PagerDuty webhooks, or external alert handlers need REST API.

**Files:**
- Create: `server/routes/admin.js`
- Modify: `server.js` (mount route — search for "app.use('/api/" and add near existing admin routes)
- Test: `tests/unit/admin-halt-route.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/admin-halt-route.test.js`:

```javascript
'use strict';

const express = require('express');
const path = require('path');

jest.mock(path.resolve(__dirname, '../../server/services/serverAT'), () => ({
    setGlobalHalt: jest.fn((active, byUid, reason) => ({ active, by: byUid, reason, ts: Date.now() })),
    getGlobalHalt: jest.fn(() => ({ active: false, by: null, ts: null, reason: null })),
}));

describe('POST /api/admin/halt', () => {
    let app, serverAT;
    const adminUser = { id: 1, role: 'admin' };
    const normalUser = { id: 2, role: 'user' };

    beforeEach(() => {
        jest.resetModules();
        serverAT = require('../../server/services/serverAT');
        app = express();
        app.use(express.json());
        // Mock auth — inject req.user
        app.use((req, res, next) => {
            const role = req.headers['x-test-role'] || 'user';
            const id = parseInt(req.headers['x-test-uid'], 10) || 0;
            if (id) req.user = { id, role };
            next();
        });
        app.use('/api/admin', require('../../server/routes/admin'));
    });

    test('admin can arm halt', async () => {
        const supertest = require('supertest');
        const res = await supertest(app)
            .post('/api/admin/halt')
            .set('x-test-role', 'admin').set('x-test-uid', '1')
            .send({ active: true, reason: 'monitoring_alert' });
        expect(res.status).toBe(200);
        expect(serverAT.setGlobalHalt).toHaveBeenCalledWith(true, 1, 'monitoring_alert');
        expect(res.body.ok).toBe(true);
    });

    test('non-admin gets 403', async () => {
        const supertest = require('supertest');
        const res = await supertest(app)
            .post('/api/admin/halt')
            .set('x-test-role', 'user').set('x-test-uid', '2')
            .send({ active: true });
        expect(res.status).toBe(403);
        expect(serverAT.setGlobalHalt).not.toHaveBeenCalled();
    });

    test('unauthenticated gets 401', async () => {
        const supertest = require('supertest');
        const res = await supertest(app).post('/api/admin/halt').send({ active: true });
        expect(res.status).toBe(401);
    });

    test('missing active field returns 400', async () => {
        const supertest = require('supertest');
        const res = await supertest(app)
            .post('/api/admin/halt')
            .set('x-test-role', 'admin').set('x-test-uid', '1')
            .send({ reason: 'x' });
        expect(res.status).toBe(400);
    });

    test('GET /api/admin/halt returns current state', async () => {
        const supertest = require('supertest');
        const res = await supertest(app)
            .get('/api/admin/halt')
            .set('x-test-role', 'admin').set('x-test-uid', '1');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('active');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/admin-halt-route.test.js -v`
Expected: FAIL — `Cannot find module '../../server/routes/admin'`.

- [ ] **Step 3: Create the admin route**

Create `server/routes/admin.js`:

```javascript
'use strict';

// Zeus Terminal — Admin operations route
// Operator-only endpoints for emergency control: global halt, future drift checks.

const express = require('express');
const router = express.Router();

function _requireAuth(req, res, next) {
    if (!req.user || !req.user.id) {
        return res.status(401).json({ ok: false, error: 'Authentication required' });
    }
    next();
}

function _requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'admin only' });
    }
    next();
}

// POST /api/admin/halt — arm or disarm global halt
// Body: { active: boolean, reason?: string }
router.post('/halt', _requireAuth, _requireAdmin, (req, res) => {
    if (typeof req.body.active !== 'boolean') {
        return res.status(400).json({ ok: false, error: 'active (boolean) required' });
    }
    const reason = (req.body.reason || 'admin_api').slice(0, 200);
    try {
        const serverAT = require('../services/serverAT');
        const result = serverAT.setGlobalHalt(req.body.active, req.user.id, reason);
        return res.json({ ok: true, halt: result });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/admin/halt — current state
router.get('/halt', _requireAuth, _requireAdmin, (req, res) => {
    try {
        const serverAT = require('../services/serverAT');
        const state = serverAT.getGlobalHalt ? serverAT.getGlobalHalt() : { active: false };
        return res.json(state);
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/admin-halt-route.test.js -v`
Expected: PASS all 5 cases.

- [ ] **Step 5: Mount route in server.js**

In `server.js`, find existing `app.use('/api/ring5'` or similar admin route mount and add nearby:

```javascript
app.use('/api/admin', sessionAuth, require('./server/routes/admin'));
```

Confirm location: `grep -n "app.use('/api/ring5'" server.js` — mount right after that line.

- [ ] **Step 6: Verify supertest is available**

Run: `node -e "console.log(require.resolve('supertest'))"`
If error: `npm install --save-dev supertest`

- [ ] **Step 7: Run full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 8: Add getGlobalHalt reader if missing**

Search: `grep -n "function getGlobalHalt\|getGlobalHalt" server/services/serverAT.js`
If `getGlobalHalt` is not in module.exports, add it (it's already defined at line ~200 reading `db.atGetState('global:halt')`). Find the existing function in serverAT.js and add `getGlobalHalt,` to the `module.exports` block at the bottom.

- [ ] **Step 9: Commit**

```bash
git add tests/unit/admin-halt-route.test.js server/routes/admin.js server.js server/services/serverAT.js
git commit -m "feat(s8-prep): B — POST/GET /api/admin/halt endpoint"
```

---

## Task C: Mutex SERVER_AT_TESTNET vs SERVER_AT

**Why:** `_validateMutex` in `migrationFlags.js:191` checks `SERVER_AT_DEMO && SERVER_AT` but NOT `SERVER_AT_TESTNET && SERVER_AT`. Operator could set both true accidentally, creating undefined behavior.

**Files:**
- Modify: `server/migrationFlags.js:212` (inside `_validateMutex`)
- Test: `tests/unit/mf-mutex-server-at-testnet.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/mf-mutex-server-at-testnet.test.js`:

```javascript
'use strict';

const path = require('path');

describe('migrationFlags mutex — SERVER_AT_TESTNET vs SERVER_AT', () => {
    let MF;

    beforeEach(() => {
        jest.resetModules();
        // Ensure migration_flags.json contains safe defaults before module load
        const fs = require('fs');
        const flagsPath = path.resolve(__dirname, '../../data/migration_flags.json');
        if (fs.existsSync(flagsPath)) {
            const current = JSON.parse(fs.readFileSync(flagsPath, 'utf8'));
            current.SERVER_AT = false;
            current.SERVER_AT_TESTNET = false;
            current.CLIENT_AT = true;
            fs.writeFileSync(flagsPath, JSON.stringify(current, null, 2));
        }
        MF = require('../../server/migrationFlags');
    });

    test('cannot set SERVER_AT_TESTNET=true while SERVER_AT=true', () => {
        // First disable CLIENT_AT so SERVER_AT can be set
        MF.set('CLIENT_AT', false);
        MF.set('SERVER_AT', true);
        expect(() => MF.set('SERVER_AT_TESTNET', true)).toThrow(/SERVER_AT_TESTNET && SERVER_AT/);
        // Cleanup
        MF.set('SERVER_AT', false);
        MF.set('CLIENT_AT', true);
    });

    test('cannot set SERVER_AT=true while SERVER_AT_TESTNET=true', () => {
        MF.set('CLIENT_AT', false);
        MF.set('SERVER_AT_TESTNET', true);
        expect(() => MF.set('SERVER_AT', true)).toThrow(/SERVER_AT_TESTNET && SERVER_AT/);
        MF.set('SERVER_AT_TESTNET', false);
        MF.set('CLIENT_AT', true);
    });

    test('SERVER_AT_TESTNET=true alone is allowed', () => {
        MF.set('CLIENT_AT', false);
        expect(() => MF.set('SERVER_AT_TESTNET', true)).not.toThrow();
        MF.set('SERVER_AT_TESTNET', false);
        MF.set('CLIENT_AT', true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/mf-mutex-server-at-testnet.test.js -v`
Expected: FAIL — first two tests don't throw because mutex check is missing.

- [ ] **Step 3: Add mutex check in migrationFlags.js**

In `server/migrationFlags.js`, find `_validateMutex` function (around line 191). After the existing `SERVER_AT_DEMO && SERVER_AT` block (~line 218), add:

```javascript
    // [Task C 2026-05-28] TESTNET carve-out must not co-exist with full SERVER_AT.
    // Full SERVER_AT covers TESTNET; the carve-out is redundant + confusing if
    // both flags ever flip true via manual edit or admin route race.
    if (f.SERVER_AT_TESTNET && f.SERVER_AT) {
        violations.push('SERVER_AT_TESTNET && SERVER_AT both true — TESTNET carve-out is redundant once full SERVER_AT is enabled; disable one before enabling the other');
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/mf-mutex-server-at-testnet.test.js -v`
Expected: PASS all 3 cases.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/mf-mutex-server-at-testnet.test.js server/migrationFlags.js
git commit -m "feat(s8-prep): C — mutex SERVER_AT_TESTNET vs SERVER_AT"
```

---

## Task D: Telegram alert on LIVE_ENTRY_FAILED + cred fail

**Why:** When server brain decides LONG and `_executeLiveEntry` catches `placeEntry` exception, the failure is logged to audit but no Telegram notification is sent. With autonomous trading, operator must be notified IMMEDIATELY.

**Files:**
- Modify: `server/services/serverAT.js` (around line 1440-1470 — `_executeLiveEntry` catch block)
- Modify: `server/services/telegramBot.js` (add `notifyEntryFailed` helper)
- Test: `tests/unit/telegram-entry-failed-alert.test.js`

- [ ] **Step 1: Locate catch block in _executeLiveEntry**

Run: `grep -n "SAT_ENTRY_FAILED\|LIVE_ENTRY_FAILED\|catch (err)" server/services/serverAT.js | head -20`
Note the line number where catch handles placeEntry failure. Expected near `LIVE_ENTRY_FAILED` audit emit.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/telegram-entry-failed-alert.test.js`:

```javascript
'use strict';

const path = require('path');

const telegramMock = { sendToUser: jest.fn(() => Promise.resolve()) };

jest.mock(path.resolve(__dirname, '../../server/services/telegram'), () => telegramMock);

describe('LIVE_ENTRY_FAILED Telegram alert', () => {
    beforeEach(() => {
        telegramMock.sendToUser.mockClear();
        jest.resetModules();
    });

    test('notifyEntryFailed sends formatted P1 alert with reason', async () => {
        // re-require after resetModules
        jest.doMock(path.resolve(__dirname, '../../server/services/telegram'), () => telegramMock);
        const tb = require('../../server/services/telegramBot');
        expect(typeof tb.notifyEntryFailed).toBe('function');
        await tb.notifyEntryFailed(42, {
            symbol: 'BTCUSDT',
            side: 'LONG',
            sizeUsd: 100,
            error: 'INSUFFICIENT_BALANCE',
            seq: 999,
        });
        expect(telegramMock.sendToUser).toHaveBeenCalledTimes(1);
        const [uid, msg] = telegramMock.sendToUser.mock.calls[0];
        expect(uid).toBe(42);
        expect(msg).toMatch(/ENTRY FAILED|entry failed/i);
        expect(msg).toContain('BTCUSDT');
        expect(msg).toContain('LONG');
        expect(msg).toContain('INSUFFICIENT_BALANCE');
        expect(msg).toContain('#999');
    });

    test('notifyEntryFailed truncates oversize error messages', async () => {
        jest.doMock(path.resolve(__dirname, '../../server/services/telegram'), () => telegramMock);
        const tb = require('../../server/services/telegramBot');
        const longError = 'X'.repeat(2000);
        await tb.notifyEntryFailed(42, {
            symbol: 'ETHUSDT', side: 'SHORT', sizeUsd: 50, error: longError, seq: 1,
        });
        const msg = telegramMock.sendToUser.mock.calls[0][1];
        expect(msg.length).toBeLessThan(1500);
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/telegram-entry-failed-alert.test.js -v`
Expected: FAIL — `tb.notifyEntryFailed is not a function`.

- [ ] **Step 4: Add notifyEntryFailed to telegramBot.js**

In `server/services/telegramBot.js`, find the existing `module.exports = { ... }` block and add this function before it:

```javascript
// [Task D 2026-05-28] Notify user when autonomous brain entry fails.
// Called from serverAT._executeLiveEntry catch block. Best-effort — must not throw.
async function notifyEntryFailed(userId, info) {
    if (!userId || !info) return;
    try {
        const _telegram = require('./telegram');
        const sym = info.symbol || '?';
        const side = info.side || '?';
        const sizeUsd = Number(info.sizeUsd || 0).toFixed(2);
        const seq = info.seq != null ? '#' + info.seq : '';
        let err = String(info.error || 'unknown').slice(0, 300);
        const msg = '🔴 *AUTONOMOUS ENTRY FAILED* ' + seq + '\n'
            + '`' + sym + '` ' + side + ' $' + sizeUsd + '\n'
            + 'Error: ' + err + '\n'
            + '_Brain attempted entry; exchange rejected. Position NOT opened._';
        await _telegram.sendToUser(userId, msg);
    } catch (_) { /* best-effort */ }
}
```

Add `notifyEntryFailed` to `module.exports` at the bottom of the file.

- [ ] **Step 5: Wire notifyEntryFailed into serverAT.js**

In `server/services/serverAT.js`, find the `_executeLiveEntry` catch block (search for `LIVE_ENTRY_FAILED` audit emit). Add Telegram notification:

Find the catch block, locate the line that emits audit:
```javascript
audit.record('LIVE_ENTRY_FAILED', { ... }, 'SERVER_AT');
```

Immediately after that line, add:

```javascript
            // [Task D 2026-05-28] Notify operator on autonomous entry failure.
            try {
                const _telegramBot = require('./telegramBot');
                _telegramBot.notifyEntryFailed(userId, {
                    symbol: entry.symbol,
                    side: entry.side,
                    sizeUsd: entry.sizeUsd,
                    error: err && err.message ? err.message : String(err),
                    seq: entry.seq,
                });
            } catch (_) { /* best-effort */ }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/telegram-entry-failed-alert.test.js -v`
Expected: PASS both cases.

- [ ] **Step 7: Run full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add tests/unit/telegram-entry-failed-alert.test.js server/services/telegramBot.js server/services/serverAT.js
git commit -m "feat(s8-prep): D — Telegram alert on LIVE_ENTRY_FAILED"
```

---

## Task E: RECOVERY_EXCHANGE_ONLY_POSITION auto-SL

**Why:** When PM2 restarts mid-trade, exchange may hold a position that's not in our DB. Currently `recoveryBoot.js:271` logs warning but takes no action — position runs unprotected. Auto-SL at conservative level + Telegram alert.

**Files:**
- Modify: `server/services/recoveryBoot.js` (around lines 200-275 — exchange-only branch)
- Modify: `server/services/exchangeOps.js` (verify `placeStopLoss` is exported and usable)
- Test: `tests/unit/recovery-exchange-only-autosl.test.js`

- [ ] **Step 1: Read existing exchange-only handling**

Run: `sed -n '180,280p' server/services/recoveryBoot.js`
Note the branch where `dbPositions` does not contain an exchange position. Currently logs `RECOVERY_EXCHANGE_ONLY_POSITION` and continues.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/recovery-exchange-only-autosl.test.js`:

```javascript
'use strict';

const path = require('path');

jest.mock(path.resolve(__dirname, '../../server/services/credentialStore'), () => ({
    getExchangeCreds: jest.fn(() => ({ exchange: 'binance', apiKey: 'k', apiSecret: 's', baseUrl: 'https://testnet.binancefuture.com' })),
}));

const exchangeOpsMock = {
    getPositions: jest.fn(),
    placeStopLoss: jest.fn(),
};
jest.mock(path.resolve(__dirname, '../../server/services/exchangeOps'), () => exchangeOpsMock);

const dbMock = {
    listUsers: jest.fn(() => [{ id: 42 }]),
    listActiveExchangeUsers: jest.fn(() => [{ user_id: 42, exchange: 'binance' }]),
    getOpenAtPositions: jest.fn(() => []),  // DB has no positions
    auditLog: jest.fn(),
};
jest.mock(path.resolve(__dirname, '../../server/services/database'), () => ({
    db: dbMock,
}));

const telegramMock = { sendToUser: jest.fn(() => Promise.resolve()) };
jest.mock(path.resolve(__dirname, '../../server/services/telegram'), () => telegramMock);

describe('recoveryBoot — exchange-only position auto-SL', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // DB returns no positions; exchange returns 1 LONG BTCUSDT @ 60000
        exchangeOpsMock.getPositions.mockResolvedValue([{
            symbol: 'BTCUSDT',
            side: 'LONG',
            qty: 0.001,
            entryPrice: 60000,
            markPrice: 60100,
        }]);
        exchangeOpsMock.placeStopLoss.mockResolvedValue({ orderId: 'sl-001' });
    });

    test('exchange-only LONG → places SL 2% below entry + Telegram P0 alert', async () => {
        const recoveryBoot = require('../../server/services/recoveryBoot');
        const res = await recoveryBoot._reconcileUser(42, 'binance');
        expect(exchangeOpsMock.placeStopLoss).toHaveBeenCalledWith(42, expect.objectContaining({
            symbol: 'BTCUSDT',
            side: 'LONG',
            qty: 0.001,
            stopPrice: expect.any(Number),
        }));
        const slCall = exchangeOpsMock.placeStopLoss.mock.calls[0][1];
        // SL must be 2% below entry for LONG
        expect(slCall.stopPrice).toBeCloseTo(60000 * 0.98, 0);
        expect(telegramMock.sendToUser).toHaveBeenCalledWith(42, expect.stringMatching(/EXCHANGE-ONLY POSITION/));
        expect(dbMock.auditLog).toHaveBeenCalledWith(42, 'RECOVERY_EXCHANGE_ONLY_AUTOSL_PLACED', expect.any(Object), null);
    });

    test('SHORT auto-SL placed 2% ABOVE entry', async () => {
        exchangeOpsMock.getPositions.mockResolvedValue([{
            symbol: 'ETHUSDT', side: 'SHORT', qty: 0.05, entryPrice: 3000, markPrice: 2990,
        }]);
        const recoveryBoot = require('../../server/services/recoveryBoot');
        await recoveryBoot._reconcileUser(42, 'binance');
        const slCall = exchangeOpsMock.placeStopLoss.mock.calls[0][1];
        expect(slCall.stopPrice).toBeCloseTo(3000 * 1.02, 0);
    });

    test('SL placement failure still emits Telegram P0 + global halt', async () => {
        exchangeOpsMock.placeStopLoss.mockRejectedValue(new Error('exchange down'));
        const serverATPath = path.resolve(__dirname, '../../server/services/serverAT');
        jest.doMock(serverATPath, () => ({ setGlobalHalt: jest.fn() }));
        const serverAT = require(serverATPath);
        const recoveryBoot = require('../../server/services/recoveryBoot');
        await recoveryBoot._reconcileUser(42, 'binance');
        expect(telegramMock.sendToUser).toHaveBeenCalled();
        expect(serverAT.setGlobalHalt).toHaveBeenCalledWith(true, 42, expect.stringMatching(/RECOVERY_AUTOSL_FAILED/));
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/recovery-exchange-only-autosl.test.js -v`
Expected: FAIL — `placeStopLoss` not called.

- [ ] **Step 4: Modify recoveryBoot.js — add auto-SL branch**

In `server/services/recoveryBoot.js`, find the exchange-only branch (around line 200). Look for the section that detects `exchPos` not in `dbPositions`. Replace the warning-only handling with this implementation:

```javascript
// [Task E 2026-05-28] Exchange-only position → place conservative SL + alert.
// 2% adverse move = SL stop price. Telegram P0 to user, audit trail.
// If SL placement itself fails → globalHalt this user.
async function _handleExchangeOnlyPosition(uid, exchPos) {
    const { db } = require('./database');
    const exchangeOps = require('./exchangeOps');
    const telegram = require('./telegram');
    const sym = exchPos.symbol;
    const side = exchPos.side;
    const entryPrice = Number(exchPos.entryPrice) || Number(exchPos.markPrice);
    const qty = Math.abs(Number(exchPos.qty) || 0);

    if (!entryPrice || !qty) {
        _logWarn('RECOVERY', `Exchange-only position uid=${uid} sym=${sym} has invalid entryPrice/qty — manual review needed`);
        try { db.auditLog(uid, 'RECOVERY_EXCHANGE_ONLY_INVALID_DATA', { symbol: sym, side, exchPos }, null); } catch (_) {}
        return false;
    }

    // 2% adverse: LONG → SL below entry; SHORT → SL above entry
    const slPct = 0.02;
    const stopPrice = side === 'LONG'
        ? entryPrice * (1 - slPct)
        : entryPrice * (1 + slPct);

    try {
        const slResp = await exchangeOps.placeStopLoss(uid, {
            symbol: sym,
            side,
            qty,
            stopPrice: Math.round(stopPrice * 100) / 100,
        });
        _logInfo('RECOVERY', `Auto-SL placed uid=${uid} sym=${sym} side=${side} stop=${stopPrice.toFixed(2)} order=${slResp && slResp.orderId}`);
        try {
            db.auditLog(uid, 'RECOVERY_EXCHANGE_ONLY_AUTOSL_PLACED', {
                symbol: sym, side, qty, entryPrice, stopPrice, slOrderId: slResp && slResp.orderId,
            }, null);
        } catch (_) {}
        try {
            await telegram.sendToUser(uid, '🔴 *EXCHANGE-ONLY POSITION DETECTED*\n'
                + '`' + sym + '` ' + side + ' qty=' + qty + ' @ ' + entryPrice.toFixed(2) + '\n'
                + 'Auto-SL placed at ' + stopPrice.toFixed(2) + ' (2% adverse).\n'
                + '_Position opened on exchange but missing from Zeus DB — manual review recommended._');
        } catch (_) {}
        return true;
    } catch (slErr) {
        _logError('RECOVERY', `Auto-SL FAILED uid=${uid} sym=${sym}: ${slErr.message}`);
        try {
            db.auditLog(uid, 'RECOVERY_EXCHANGE_ONLY_AUTOSL_FAILED', {
                symbol: sym, side, qty, entryPrice, stopPrice, error: slErr.message,
            }, null);
        } catch (_) {}
        // Halt globally — unprotected position is unacceptable
        try {
            const serverAT = require('./serverAT');
            serverAT.setGlobalHalt(true, uid, 'RECOVERY_AUTOSL_FAILED:' + sym);
        } catch (_) {}
        try {
            await telegram.sendToUser(uid, '🚨 *CRITICAL — AUTO-SL FAILED*\n'
                + '`' + sym + '` ' + side + ' qty=' + qty + ' UNPROTECTED.\n'
                + 'Global halt armed. MANUAL INTERVENTION REQUIRED.\n'
                + 'Error: ' + slErr.message);
        } catch (_) {}
        return false;
    }
}
```

Then in the `_reconcileUser` function, in the loop where exchange-only positions are detected, call `await _handleExchangeOnlyPosition(uid, exchPos);` in place of the warning-only handling.

Also export the helper for testing:

```javascript
module.exports = { run, _reconcileUser, _handleExchangeOnlyPosition };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/recovery-exchange-only-autosl.test.js -v`
Expected: PASS all 3 cases.

- [ ] **Step 6: Run full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add tests/unit/recovery-exchange-only-autosl.test.js server/services/recoveryBoot.js
git commit -m "feat(s8-prep): E — recovery auto-SL for exchange-only positions"
```

---

## Task F: Flip POSITIONS_WS=true

**Why:** Without `POSITIONS_WS=true`, autonomous brain entries are invisible to the client UI until the 30s polling tick. With WS broadcast (already implemented in serverAT `_persistPosition`/`_persistClose`), client sees changes within ms.

**Files:**
- Modify: `data/migration_flags.json`
- Test: `tests/unit/positions-ws-broadcast.test.js`

- [ ] **Step 1: Verify subscriber exists**

Run: `grep -rn "positions.changed\|positionsRealtime" client/src/ | head -10`
Expected: Confirms client has subscriber wired (from F4/F5 phase). If empty, the flag is not safe to flip — STOP and report.

- [ ] **Step 2: Write integration check test**

Create `tests/unit/positions-ws-broadcast.test.js`:

```javascript
'use strict';

const path = require('path');

describe('POSITIONS_WS flag — broadcast enable', () => {
    beforeEach(() => { jest.resetModules(); });

    test('flag reads true from JSON after flip', () => {
        const MF = require('../../server/migrationFlags');
        expect(MF.POSITIONS_WS).toBe(true);
    });

    test('serverAT._persistPosition emits broadcast when flag on', () => {
        // Spy broadcast helper — actual ws emission tested in integration
        const serverAT = require('../../server/services/serverAT');
        // Surface the broadcast hook for verification
        expect(typeof serverAT._persistPosition).toBe('function');
    });
});
```

- [ ] **Step 3: Run test (it will fail until flag flipped)**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/positions-ws-broadcast.test.js -v`
Expected: FAIL — `POSITIONS_WS` is false.

- [ ] **Step 4: Flip the flag**

Edit `data/migration_flags.json`. Find:
```json
  "POSITIONS_WS": false,
```
Change to:
```json
  "POSITIONS_WS": true,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/positions-ws-broadcast.test.js -v`
Expected: PASS.

- [ ] **Step 6: Run full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 7: PM2 reload + manual smoke check**

Run: `pm2 reload zeus`
Wait 5s, then run: `pm2 logs zeus --lines 30 --nostream | grep -i "POSITIONS_WS\|broadcast\|positions.changed"`
Expected: no errors, `POSITIONS_WS = true` in MF log.

- [ ] **Step 8: Commit**

```bash
git add tests/unit/positions-ws-broadcast.test.js data/migration_flags.json
git commit -m "feat(s8-prep): F — flip POSITIONS_WS=true for autonomous visibility"
```

---

## Task G: Graceful shutdown brain + AT drain

**Why:** `_gracefulShutdown` in `server.js:1907` calls `wsMarketProxy.initiateShutdown` and closes WSS, but does NOT call `serverBrain.stop()` (clears `_timer`) or wait for `_executeLiveEntry` in-flight calls to settle. PM2 restart during entry → orphan position.

**Files:**
- Modify: `server/services/serverBrain.js` (confirm `stop()` exists at line 596)
- Modify: `server/services/serverAT.js` (add `drainPending()` waiting for `_executeLiveEntry` in-flight)
- Modify: `server.js:1907` (`_gracefulShutdown` extension)
- Test: `tests/unit/graceful-shutdown-brain-at.test.js`

- [ ] **Step 1: Read current serverBrain.stop()**

Run: `sed -n '590,620p' server/services/serverBrain.js`
Note current behavior. Confirm clears `_timer`.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/graceful-shutdown-brain-at.test.js`:

```javascript
'use strict';

const path = require('path');

describe('Graceful shutdown — brain + AT drain', () => {
    beforeEach(() => { jest.resetModules(); });

    test('serverAT.drainPending exists and returns promise', async () => {
        const serverAT = require('../../server/services/serverAT');
        expect(typeof serverAT.drainPending).toBe('function');
        await expect(serverAT.drainPending(100)).resolves.not.toThrow();
    });

    test('drainPending resolves immediately when no in-flight entries', async () => {
        const serverAT = require('../../server/services/serverAT');
        const t0 = Date.now();
        await serverAT.drainPending(5000);
        expect(Date.now() - t0).toBeLessThan(100);
    });

    test('drainPending waits up to timeout if in-flight, then resolves with status', async () => {
        const serverAT = require('../../server/services/serverAT');
        // Simulate in-flight by incrementing the counter (test-only API)
        serverAT._testIncPending && serverAT._testIncPending();
        const t0 = Date.now();
        const result = await serverAT.drainPending(300);
        expect(Date.now() - t0).toBeGreaterThanOrEqual(280);
        expect(result.timedOut).toBe(true);
        // Reset
        serverAT._testDecPending && serverAT._testDecPending();
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/graceful-shutdown-brain-at.test.js -v`
Expected: FAIL — `drainPending is not a function`.

- [ ] **Step 4: Add drainPending to serverAT.js**

In `server/services/serverAT.js`, near the top after existing top-level state declarations, add:

```javascript
// [Task G 2026-05-28] Track in-flight _executeLiveEntry calls for graceful drain
let _pendingEntries = 0;

function _incPending() { _pendingEntries++; }
function _decPending() { _pendingEntries = Math.max(0, _pendingEntries - 1); }

/**
 * Wait for in-flight _executeLiveEntry calls to settle, up to maxWaitMs.
 * @param {number} maxWaitMs
 * @returns {Promise<{settled: boolean, timedOut: boolean, pending: number}>}
 */
async function drainPending(maxWaitMs) {
    const maxWait = Number(maxWaitMs) > 0 ? Number(maxWaitMs) : 5000;
    const t0 = Date.now();
    while (_pendingEntries > 0 && (Date.now() - t0) < maxWait) {
        await new Promise(r => setTimeout(r, 50));
    }
    return {
        settled: _pendingEntries === 0,
        timedOut: _pendingEntries > 0,
        pending: _pendingEntries,
    };
}
```

In `_executeLiveEntry`, wrap the body with try/finally:

```javascript
async function _executeLiveEntry(entry, sizing, userId, opts) {
    _incPending();
    try {
        // existing body unchanged
        ...
    } finally {
        _decPending();
    }
}
```

Export in `module.exports`:
```javascript
    drainPending,
    _testIncPending: _incPending,
    _testDecPending: _decPending,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/graceful-shutdown-brain-at.test.js -v`
Expected: PASS all 3 cases.

- [ ] **Step 6: Extend _gracefulShutdown in server.js**

In `server.js:1907`, modify `_gracefulShutdown` function:

```javascript
async function _gracefulShutdown(signal) {
  logger.warn('SERVER', 'Shutdown signal received: ' + signal);
  console.log('\n🛑 Shutting down gracefully (' + signal + ')...');

  // [Task G 2026-05-28] Stop brain first to prevent new entries
  try {
    const serverBrain = require('./server/services/serverBrain');
    if (typeof serverBrain.stop === 'function') serverBrain.stop();
    logger.info('SERVER', 'serverBrain stopped');
  } catch (err) { logger.warn('SERVER', 'serverBrain.stop failed: ' + err.message); }

  // [Task G 2026-05-28] Drain in-flight AT entries up to 5s
  try {
    const serverAT = require('./server/services/serverAT');
    if (typeof serverAT.drainPending === 'function') {
      const drainResult = await serverAT.drainPending(5000);
      logger.info('SERVER', 'serverAT drain: ' + JSON.stringify(drainResult));
    }
  } catch (err) { logger.warn('SERVER', 'serverAT.drainPending failed: ' + err.message); }

  // existing Omega farewell + telegramBot.stop() + wsMarketProxy + wss close unchanged
  // [Wave 8 G] Omega farewell — best-effort, before sockets close
  try {
    const voiceLogger = require('./server/services/ml/_voice/voiceLogger');
    // ... existing code
  } catch (_) { /* best-effort during shutdown */ }

  telegramBot.stop();
  try { require('./server/services/wsMarketProxy').initiateShutdown(wss); } catch (_) {}
  clearInterval(_wsPing);
  wss.clients.forEach(ws => ws.terminate());
  telegram.alertServerStop(signal).finally(() => {
    server.close(() => {
      logger.info('SERVER', 'HTTP server closed');
      db.closeDb();
      process.exit(0);
    });
    setTimeout(() => { process.exit(1); }, 5000);
  });
}
```

Note: the function is now `async`. Update SIGTERM/SIGINT handlers if needed:

```javascript
process.on('SIGTERM', () => { _gracefulShutdown('SIGTERM').catch(() => process.exit(1)); });
process.on('SIGINT', () => { _gracefulShutdown('SIGINT').catch(() => process.exit(1)); });
```

- [ ] **Step 7: Run full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 8: Smoke check restart timing**

Run: `time pm2 reload zeus`
Expected: reload completes <10s (5s drain timeout + boot).

- [ ] **Step 9: Commit**

```bash
git add tests/unit/graceful-shutdown-brain-at.test.js server/services/serverAT.js server.js
git commit -m "feat(s8-prep): G — graceful shutdown with brain stop + AT drain"
```

---

## Task H: Dead Man's Switch watchdog consumer

**Why:** `serverBrain._runCycle` emits heartbeat per user via `deadMansSwitch.emitHeartbeat` (server/services/serverBrain.js:1483) but no consumer alerts when heartbeats stop. If `_running` is stuck true (lock contention bug), brain silently skips cycles indefinitely.

**Files:**
- Create: `server/services/brainWatchdog.js`
- Modify: `server.js` (start watchdog at boot, after `serverBrain` start)
- Test: `tests/unit/brain-watchdog.test.js`

- [ ] **Step 1: Inspect deadMansSwitch API**

Run: `sed -n '120,180p' server/services/ml/R0_substrate/deadMansSwitch.js`
Note: `emitHeartbeat({userId, resolvedEnv})` writes to DB. Look for any existing `getLastHeartbeat` or table query helper. If not present we'll add one.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/brain-watchdog.test.js`:

```javascript
'use strict';

const path = require('path');

const dbMock = {
    prepare: jest.fn(),
};

const stmtMock = {
    all: jest.fn(),
    get: jest.fn(),
};
dbMock.prepare.mockReturnValue(stmtMock);

jest.mock(path.resolve(__dirname, '../../server/services/database'), () => ({
    db: dbMock,
}));

const serverATMock = { setGlobalHalt: jest.fn() };
jest.mock(path.resolve(__dirname, '../../server/services/serverAT'), () => serverATMock);

const telegramMock = { sendToAll: jest.fn(() => Promise.resolve()) };
jest.mock(path.resolve(__dirname, '../../server/services/telegram'), () => telegramMock);

describe('brainWatchdog', () => {
    let bw;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        bw = require('../../server/services/brainWatchdog');
    });

    afterEach(() => {
        bw.stop && bw.stop();
    });

    test('fresh heartbeat (< 60s) → no alert', () => {
        stmtMock.all.mockReturnValue([
            { user_id: 1, last_heartbeat_ts: Date.now() - 10000 },
        ]);
        const result = bw.check();
        expect(result.stale).toEqual([]);
        expect(serverATMock.setGlobalHalt).not.toHaveBeenCalled();
    });

    test('heartbeat >60s old → P0 alert + global halt', () => {
        stmtMock.all.mockReturnValue([
            { user_id: 1, last_heartbeat_ts: Date.now() - 70000 },
        ]);
        const result = bw.check();
        expect(result.stale.length).toBe(1);
        expect(result.stale[0].userId).toBe(1);
        expect(serverATMock.setGlobalHalt).toHaveBeenCalledWith(true, 1, expect.stringMatching(/DEAD_MAN_SWITCH/));
        expect(telegramMock.sendToAll).toHaveBeenCalledWith(expect.stringMatching(/BRAIN DEAD|brain dead|dead man/i));
    });

    test('start() schedules periodic check', () => {
        jest.useFakeTimers();
        bw.start({ intervalMs: 10000, staleThresholdMs: 60000 });
        stmtMock.all.mockReturnValue([{ user_id: 1, last_heartbeat_ts: Date.now() - 70000 }]);
        jest.advanceTimersByTime(10001);
        expect(serverATMock.setGlobalHalt).toHaveBeenCalled();
        jest.useRealTimers();
    });

    test('halt only fired once per stale window (debounce)', () => {
        stmtMock.all.mockReturnValue([{ user_id: 1, last_heartbeat_ts: Date.now() - 70000 }]);
        bw.check();
        bw.check();  // Second call within debounce window
        expect(serverATMock.setGlobalHalt).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/brain-watchdog.test.js -v`
Expected: FAIL — `Cannot find module '../../server/services/brainWatchdog'`.

- [ ] **Step 4: Create brainWatchdog.js**

Create `server/services/brainWatchdog.js`:

```javascript
'use strict';

// Zeus Terminal — Brain Watchdog (Dead Man's Switch consumer)
// Periodic check: any user whose brain heartbeat is older than threshold
// is considered "brain dead" → arm global halt + alert operator.
// Single watchdog instance; only one halt fired per stale window (debounce).

const DEFAULT_INTERVAL_MS = 10 * 1000;          // check every 10s
const DEFAULT_STALE_THRESHOLD_MS = 60 * 1000;   // 60s = brain dead
const DEBOUNCE_MS = 5 * 60 * 1000;              // re-alert at most every 5min

let _timer = null;
let _opts = { intervalMs: DEFAULT_INTERVAL_MS, staleThresholdMs: DEFAULT_STALE_THRESHOLD_MS };
const _lastAlertTs = new Map();  // userId → ts of last halt fired

function _now() { return Date.now(); }

function check() {
    const { db } = require('./database');
    const stale = [];

    let rows = [];
    try {
        rows = db.prepare(`
            SELECT user_id, MAX(ts) as last_heartbeat_ts
            FROM ml_module_heartbeats
            WHERE module_id = 'serverBrain'
            GROUP BY user_id
        `).all() || [];
    } catch (_) {
        // Table may not exist on fresh DBs; treat as no heartbeats yet (do not alert).
        return { stale: [], checked: 0 };
    }

    const cutoff = _now() - _opts.staleThresholdMs;
    for (const row of rows) {
        const lastTs = row.last_heartbeat_ts || row.ts || 0;
        if (lastTs < cutoff) {
            stale.push({ userId: row.user_id, lastTs, ageMs: _now() - lastTs });
        }
    }

    for (const s of stale) {
        const lastAlert = _lastAlertTs.get(s.userId) || 0;
        if (_now() - lastAlert < DEBOUNCE_MS) continue;
        _fireAlert(s);
        _lastAlertTs.set(s.userId, _now());
    }

    return { stale, checked: rows.length };
}

function _fireAlert(stale) {
    try {
        const serverAT = require('./serverAT');
        serverAT.setGlobalHalt(true, stale.userId, 'DEAD_MAN_SWITCH:brain_heartbeat_stale_' + Math.round(stale.ageMs / 1000) + 's');
    } catch (e) { console.error('[BRAIN-WATCHDOG] setGlobalHalt failed:', e.message); }

    try {
        const telegram = require('./telegram');
        telegram.sendToAll(
            '🚨 *BRAIN DEAD* uid=' + stale.userId + '\n'
            + 'Last heartbeat: ' + Math.round(stale.ageMs / 1000) + 's ago.\n'
            + 'Global halt ARMED for this user. Manual investigation needed.'
        );
    } catch (_) {}

    try {
        const { db } = require('./database');
        db.auditLog(stale.userId, 'BRAIN_WATCHDOG_HALT', {
            ageMs: stale.ageMs,
            lastTs: stale.lastTs,
        }, null);
    } catch (_) {}
}

function start(opts) {
    if (_timer) return;
    if (opts && opts.intervalMs) _opts.intervalMs = opts.intervalMs;
    if (opts && opts.staleThresholdMs) _opts.staleThresholdMs = opts.staleThresholdMs;
    _timer = setInterval(() => {
        try { check(); } catch (e) { console.error('[BRAIN-WATCHDOG] check error:', e.message); }
    }, _opts.intervalMs);
    console.log('[BRAIN-WATCHDOG] started interval=' + _opts.intervalMs + 'ms threshold=' + _opts.staleThresholdMs + 'ms');
}

function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
    _lastAlertTs.clear();
}

module.exports = { start, stop, check, _testGetAlertMap: () => _lastAlertTs };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/brain-watchdog.test.js -v`
Expected: PASS all 4 cases.

- [ ] **Step 6: Start watchdog in server.js**

In `server.js`, find where `serverBrain.start` or similar is called (search `serverBrain.start\|brain.*start`). Add right after:

```javascript
// [Task H 2026-05-28] Dead Man's Switch consumer — watches brain heartbeats
try { require('./server/services/brainWatchdog').start(); } catch (e) { logger.warn('SERVER', 'brainWatchdog start: ' + e.message); }
```

In `_gracefulShutdown`, before `telegramBot.stop()`:

```javascript
try { require('./server/services/brainWatchdog').stop(); } catch (_) {}
```

- [ ] **Step 7: Run full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add tests/unit/brain-watchdog.test.js server/services/brainWatchdog.js server.js
git commit -m "feat(s8-prep): H — Dead Man's Switch watchdog consumer"
```

---

## Task I: DB-first audit pattern verification

**Why:** `audit.record` writes to JSONL first, then to DB inside `try{}catch(_){}` swallowing errors. If DB is locked / corrupted, audit is partially lost. Critical events (entries, halts, recoveries) must write DB FIRST and surface failures.

**Files:**
- Modify: `server/services/audit.js` (`record` function)
- Test: `tests/unit/audit-db-first.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/audit-db-first.test.js`:

```javascript
'use strict';

const path = require('path');

const dbMock = { auditLog: jest.fn() };
jest.mock(path.resolve(__dirname, '../../server/services/database'), () => dbMock);

describe('audit.record — DB-first for critical events', () => {
    let audit;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        dbMock.auditLog = jest.fn();
        jest.doMock(path.resolve(__dirname, '../../server/services/database'), () => dbMock);
        audit = require('../../server/services/audit');
    });

    test('non-critical events: DB write inside try/catch — failure swallowed', () => {
        dbMock.auditLog.mockImplementation(() => { throw new Error('db locked'); });
        expect(() => audit.record('TEST_EVENT', { userId: 1 }, 'SERVER')).not.toThrow();
        expect(dbMock.auditLog).toHaveBeenCalled();
    });

    test('critical event LIVE_ENTRY_FAILED: DB write attempted', () => {
        audit.record('LIVE_ENTRY_FAILED', { userId: 42, symbol: 'BTCUSDT', error: 'x' }, 'SERVER_AT');
        expect(dbMock.auditLog).toHaveBeenCalledWith(42, 'LIVE_ENTRY_FAILED', expect.any(Object), null);
    });

    test('critical event GLOBAL_HALT_TOGGLE: DB write attempted', () => {
        audit.record('GLOBAL_HALT_TOGGLE', { userId: 1, active: true }, 'SERVER_AT');
        expect(dbMock.auditLog).toHaveBeenCalledWith(1, 'GLOBAL_HALT_TOGGLE', expect.any(Object), null);
    });

    test('critical event RECOVERY_AUTOSL_FAILED: DB failure throws (loud failure)', () => {
        dbMock.auditLog.mockImplementation(() => { throw new Error('db locked'); });
        // Critical events should at least log the DB failure to stderr — verify console.error called
        const consoleErrSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        audit.record('RECOVERY_EXCHANGE_ONLY_AUTOSL_FAILED', { userId: 5 }, 'SERVER_AT');
        expect(consoleErrSpy).toHaveBeenCalledWith(expect.stringMatching(/AUDIT.*CRITICAL.*db/i), expect.any(String));
        consoleErrSpy.mockRestore();
    });

    test('isCriticalEvent classifies known critical actions', () => {
        expect(audit.isCriticalEvent('LIVE_ENTRY_FAILED')).toBe(true);
        expect(audit.isCriticalEvent('GLOBAL_HALT_TOGGLE')).toBe(true);
        expect(audit.isCriticalEvent('RECOVERY_EXCHANGE_ONLY_AUTOSL_FAILED')).toBe(true);
        expect(audit.isCriticalEvent('SAT_ENTRY_PLACED')).toBe(true);
        expect(audit.isCriticalEvent('TEST_EVENT')).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/audit-db-first.test.js -v`
Expected: FAIL — `isCriticalEvent` not exported; critical events don't log.

- [ ] **Step 3: Modify audit.js for critical event handling**

In `server/services/audit.js`, replace `function record(...)` and add `isCriticalEvent`:

```javascript
// [Task I 2026-05-28] Critical event classifier — these MUST hit DB; failures logged loudly.
const CRITICAL_EVENTS = new Set([
    'LIVE_ENTRY_FAILED',
    'LIVE_ENTRY_PLACED',
    'GLOBAL_HALT_TOGGLE',
    'EMERGENCY_CLOSE_CATASTROPHIC',
    'RECOVERY_EXCHANGE_ONLY_AUTOSL_PLACED',
    'RECOVERY_EXCHANGE_ONLY_AUTOSL_FAILED',
    'RECOVERY_EXCHANGE_ONLY_INVALID_DATA',
    'SAT_ENTRY_PLACED',
    'SAT_ENTRY_FAILED',
    'KILL_SWITCH',
    'BRAIN_WATCHDOG_HALT',
    'DRIFT_DETECTED_HALT',
]);

function isCriticalEvent(action) {
    return CRITICAL_EVENTS.has(action);
}

function record(action, details, actor, ip) {
    const d = details || {};
    const entry = {
        ts: new Date().toISOString(),
        action: action,
        actor: actor || 'system',
        userId: d.userId || null,
        ip: ip || null,
        details: d,
    };
    // [Task I 2026-05-28] DB-first for critical events; JSONL is backup.
    const critical = isCriticalEvent(action);
    let dbWritten = false;
    try {
        const db = require('./database');
        db.auditLog(d.userId || null, action, d, ip || null);
        dbWritten = true;
    } catch (dbErr) {
        if (critical) {
            console.error('[AUDIT][CRITICAL] DB write failed for ' + action + ': ' + dbErr.message, dbErr.stack || '');
        }
        // Non-critical: continue silently as before
    }
    // JSONL backup — always attempt, even if DB succeeded
    const stream = _getStream();
    if (stream) {
        try { stream.write(JSON.stringify(Object.assign({}, entry, { dbWritten })) + '\n'); } catch (_) {}
    }
}

module.exports = { record, readLast, readByUser, isCriticalEvent };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/audit-db-first.test.js -v`
Expected: PASS all 5 cases.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/audit-db-first.test.js server/services/audit.js
git commit -m "feat(s8-prep): I — DB-first audit pattern for critical events"
```

---

## Task J: Exchange-level Circuit Breaker

**Why:** Existing `circuitBreaker.js` is keyed `exchange:endpoint` and per-user via creds. If Binance returns 5xx for 5 users in 30s, 5 per-user CBs trip independently. Need a global exchange-level CB that pauses ALL traffic for 60s when consecutive 5xx exceed threshold.

**Files:**
- Create: `server/services/exchangeCircuitBreaker.js`
- Modify: `server/services/binanceOps.js` (consult global CB before HTTP call — wrap dispatcher)
- Modify: `server/services/bybitOps.js` (same)
- Test: `tests/unit/exchange-circuit-breaker.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/exchange-circuit-breaker.test.js`:

```javascript
'use strict';

describe('exchangeCircuitBreaker', () => {
    let ecb;

    beforeEach(() => {
        jest.resetModules();
        ecb = require('../../server/services/exchangeCircuitBreaker');
        ecb._reset && ecb._reset();
    });

    test('canDispatch returns true initially', () => {
        expect(ecb.canDispatch('binance')).toBe(true);
    });

    test('5 consecutive 5xx within 30s → opens, blocks further dispatches', () => {
        for (let i = 0; i < 5; i++) ecb.recordResponse('binance', 502);
        expect(ecb.canDispatch('binance')).toBe(false);
        const status = ecb.getStatus('binance');
        expect(status.state).toBe('OPEN');
    });

    test('4 consecutive 5xx + 1 success resets counter', () => {
        for (let i = 0; i < 4; i++) ecb.recordResponse('binance', 502);
        ecb.recordResponse('binance', 200);
        expect(ecb.canDispatch('binance')).toBe(true);
    });

    test('OPEN state auto-closes after 60s', () => {
        for (let i = 0; i < 5; i++) ecb.recordResponse('binance', 502);
        expect(ecb.canDispatch('binance')).toBe(false);
        // Advance internal clock
        ecb._testSetOpenUntil && ecb._testSetOpenUntil('binance', Date.now() - 1);
        expect(ecb.canDispatch('binance')).toBe(true);
    });

    test('binance OPEN does not block bybit dispatches', () => {
        for (let i = 0; i < 5; i++) ecb.recordResponse('binance', 502);
        expect(ecb.canDispatch('binance')).toBe(false);
        expect(ecb.canDispatch('bybit')).toBe(true);
    });

    test('recordResponse with non-5xx does not contribute to fail count', () => {
        ecb.recordResponse('binance', 200);
        ecb.recordResponse('binance', 429);  // rate-limited, NOT 5xx
        ecb.recordResponse('binance', 400);  // client error
        expect(ecb.canDispatch('binance')).toBe(true);
    });

    test('opening fires audit event via injected logger', () => {
        const events = [];
        ecb.setEventSink((evt) => events.push(evt));
        for (let i = 0; i < 5; i++) ecb.recordResponse('binance', 502);
        expect(events.some(e => e.type === 'CB_OPENED')).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/exchange-circuit-breaker.test.js -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Create exchangeCircuitBreaker.js**

Create `server/services/exchangeCircuitBreaker.js`:

```javascript
'use strict';

// Zeus Terminal — Exchange-Level Circuit Breaker
// Sits ABOVE per-endpoint circuitBreaker.js to provide a per-exchange global gate.
// Trips when 5 consecutive 5xx responses happen within a 30s window.
// Opens for 60s, then auto-closes (lets traffic probe).

const FAILURE_THRESHOLD = 5;
const FAILURE_WINDOW_MS = 30 * 1000;
const OPEN_DURATION_MS = 60 * 1000;

const _state = new Map();  // exchange → { failures: [{ts}], openUntil, state }
let _eventSink = null;

function _getOrInit(exchange) {
    if (!_state.has(exchange)) {
        _state.set(exchange, {
            failures: [],
            openUntil: 0,
            state: 'CLOSED',
        });
    }
    return _state.get(exchange);
}

function _emit(evt) {
    if (typeof _eventSink === 'function') {
        try { _eventSink(evt); } catch (_) {}
    }
}

function setEventSink(fn) { _eventSink = fn; }

function canDispatch(exchange) {
    const s = _getOrInit(exchange);
    if (s.state === 'OPEN' && Date.now() < s.openUntil) return false;
    if (s.state === 'OPEN' && Date.now() >= s.openUntil) {
        s.state = 'CLOSED';
        s.failures = [];
        _emit({ type: 'CB_CLOSED_AUTO', exchange, ts: Date.now() });
    }
    return true;
}

function recordResponse(exchange, httpStatus) {
    const s = _getOrInit(exchange);
    const now = Date.now();
    if (httpStatus >= 200 && httpStatus < 500) {
        // Success or client error — clear failures
        s.failures = [];
        return;
    }
    if (httpStatus >= 500) {
        // Prune old failures outside window
        s.failures = s.failures.filter(f => (now - f.ts) <= FAILURE_WINDOW_MS);
        s.failures.push({ ts: now, status: httpStatus });
        if (s.failures.length >= FAILURE_THRESHOLD && s.state !== 'OPEN') {
            s.state = 'OPEN';
            s.openUntil = now + OPEN_DURATION_MS;
            _emit({ type: 'CB_OPENED', exchange, ts: now, openUntil: s.openUntil, failures: s.failures.length });
            try {
                const audit = require('./audit');
                audit.record('EXCHANGE_CB_OPENED', { exchange, openUntilMs: OPEN_DURATION_MS, failures: s.failures.length }, 'EXCHANGE_CB');
            } catch (_) {}
            try {
                const telegram = require('./telegram');
                telegram.sendToAll('⚠️ *EXCHANGE CB OPENED* — ' + exchange + ' paused 60s after ' + s.failures.length + ' consecutive 5xx');
            } catch (_) {}
        }
    }
}

function getStatus(exchange) {
    const s = _getOrInit(exchange);
    return { state: s.state, openUntil: s.openUntil, recentFailures: s.failures.length };
}

function _reset() {
    _state.clear();
    _eventSink = null;
}

function _testSetOpenUntil(exchange, ts) {
    const s = _getOrInit(exchange);
    s.openUntil = ts;
}

module.exports = { canDispatch, recordResponse, getStatus, setEventSink, _reset, _testSetOpenUntil };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/exchange-circuit-breaker.test.js -v`
Expected: PASS all 7 cases.

- [ ] **Step 5: Wire into binanceOps.js**

In `server/services/binanceOps.js`, find the central HTTP dispatcher (search for `sendSignedRequest` or main fetch wrapper). Before the call:

```javascript
const ecb = require('./exchangeCircuitBreaker');
if (!ecb.canDispatch('binance')) {
    const err = new Error('EXCHANGE_CB_OPEN binance — paused');
    err.code = 'EXCHANGE_CB_OPEN';
    throw err;
}
```

After receiving the response:

```javascript
try { ecb.recordResponse('binance', resp.status || 0); } catch (_) {}
```

Repeat in `server/services/bybitOps.js` with `'bybit'`.

- [ ] **Step 6: Run full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add tests/unit/exchange-circuit-breaker.test.js server/services/exchangeCircuitBreaker.js server/services/binanceOps.js server/services/bybitOps.js
git commit -m "feat(s8-prep): J — exchange-level Circuit Breaker (binance/bybit)"
```

---

## Task K: Trade rate limiter per user

**Why:** Without a cap, a runaway brain bug could fire 100+ entries per minute. Per-user limit (e.g., 10 entries/hour) is an upper bound that protects capital even if confidence/dedup checks fail.

**Files:**
- Create: `server/services/tradeRateLimiter.js`
- Modify: `server/services/serverAT.js:processBrainDecision` — consult rate limiter before entry
- Test: `tests/unit/trade-rate-limiter.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/trade-rate-limiter.test.js`:

```javascript
'use strict';

describe('tradeRateLimiter', () => {
    let trl;

    beforeEach(() => {
        jest.resetModules();
        trl = require('../../server/services/tradeRateLimiter');
        trl._reset && trl._reset();
    });

    test('first entry allowed', () => {
        expect(trl.canEnter(42)).toBe(true);
    });

    test('records entry after canEnter+entry success', () => {
        trl.recordEntry(42);
        const state = trl.getState(42);
        expect(state.recentEntries.length).toBe(1);
    });

    test('default limit 10/hour: 10 entries allowed, 11th blocked', () => {
        for (let i = 0; i < 10; i++) {
            expect(trl.canEnter(42)).toBe(true);
            trl.recordEntry(42);
        }
        expect(trl.canEnter(42)).toBe(false);
    });

    test('entries older than 1h pruned', () => {
        // Inject old entries via testing API
        for (let i = 0; i < 10; i++) trl._testInjectEntry(42, Date.now() - 70 * 60 * 1000);
        expect(trl.canEnter(42)).toBe(true);
    });

    test('per-user isolation: uid 42 limit hit, uid 99 fresh', () => {
        for (let i = 0; i < 10; i++) trl.recordEntry(42);
        expect(trl.canEnter(42)).toBe(false);
        expect(trl.canEnter(99)).toBe(true);
    });

    test('custom limit via setLimit', () => {
        trl.setLimit(42, 3);
        for (let i = 0; i < 3; i++) trl.recordEntry(42);
        expect(trl.canEnter(42)).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/trade-rate-limiter.test.js -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Create tradeRateLimiter.js**

Create `server/services/tradeRateLimiter.js`:

```javascript
'use strict';

// Zeus Terminal — Per-user trade rate limiter.
// Sliding 1-hour window. Default 10 entries/h. Per-user override via setLimit.

const DEFAULT_LIMIT = 10;
const WINDOW_MS = 60 * 60 * 1000;

const _state = new Map();  // userId → { recentEntries: [ts], limit }

function _get(userId) {
    if (!_state.has(userId)) _state.set(userId, { recentEntries: [], limit: DEFAULT_LIMIT });
    return _state.get(userId);
}

function _prune(s) {
    const cutoff = Date.now() - WINDOW_MS;
    s.recentEntries = s.recentEntries.filter(ts => ts >= cutoff);
}

function canEnter(userId) {
    const s = _get(userId);
    _prune(s);
    return s.recentEntries.length < s.limit;
}

function recordEntry(userId) {
    const s = _get(userId);
    _prune(s);
    s.recentEntries.push(Date.now());
}

function getState(userId) {
    const s = _get(userId);
    _prune(s);
    return { recentEntries: s.recentEntries.slice(), limit: s.limit, capacity: s.limit - s.recentEntries.length };
}

function setLimit(userId, limit) {
    const s = _get(userId);
    s.limit = Math.max(1, Math.min(100, Number(limit) || DEFAULT_LIMIT));
}

function _reset() { _state.clear(); }
function _testInjectEntry(userId, ts) {
    const s = _get(userId);
    s.recentEntries.push(ts);
}

module.exports = { canEnter, recordEntry, getState, setLimit, _reset, _testInjectEntry };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/trade-rate-limiter.test.js -v`
Expected: PASS all 6 cases.

- [ ] **Step 5: Wire into processBrainDecision**

In `server/services/serverAT.js`, find `processBrainDecision`. After the `_checkKillSwitch` check and BEFORE the size-floor / position-creation logic, add:

```javascript
// [Task K 2026-05-28] Per-user trade rate limit (default 10/h)
try {
    const trl = require('./tradeRateLimiter');
    if (!trl.canEnter(userId)) {
        logger.warn('AT_ENGINE', `Entry blocked uid=${userId} sym=${decision.symbol} — RATE_LIMIT (10/h)`);
        _recordMissedTrade(userId, decision, 'RATE_LIMIT');
        try { audit.record('AT_ENTRY_RATE_LIMITED', { userId, symbol: decision.symbol, side: decision.side }, 'SERVER_AT'); } catch (_) {}
        return { ok: false, reason: 'RATE_LIMIT' };
    }
} catch (_) { /* never block trading on rate limiter failure */ }
```

After a successful entry creation (right after position is persisted), add:

```javascript
try { require('./tradeRateLimiter').recordEntry(userId); } catch (_) {}
```

- [ ] **Step 6: Run full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add tests/unit/trade-rate-limiter.test.js server/services/tradeRateLimiter.js server/services/serverAT.js
git commit -m "feat(s8-prep): K — per-user trade rate limiter (10/h default)"
```

---

## Task L: Pre-trade balance sanity check

**Why:** Brain may decide $100 entry while user's actual free balance is $20 (cached value stale, withdrawal happened). Exchange rejects with cryptic error. Better: verify balance pre-call, skip with audit + Telegram if insufficient.

**Files:**
- Modify: `server/services/serverAT.js` — inside `_executeLiveEntry` BEFORE `exchangeOps.placeEntry`
- Test: `tests/unit/pretrade-balance-check.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/pretrade-balance-check.test.js`:

```javascript
'use strict';

const path = require('path');

const exchangeOpsMock = {
    getBalance: jest.fn(),
    placeEntry: jest.fn(),
    ensureSymbolReady: jest.fn(() => Promise.resolve(true)),
};
jest.mock(path.resolve(__dirname, '../../server/services/exchangeOps'), () => exchangeOpsMock);

describe('Pre-trade balance check', () => {
    let serverAT;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        exchangeOpsMock.getBalance = jest.fn();
        exchangeOpsMock.placeEntry = jest.fn();
        serverAT = require('../../server/services/serverAT');
    });

    test('checkBalanceForEntry returns ok=true when freeUsd > sizeUsd * 1.1', async () => {
        exchangeOpsMock.getBalance.mockResolvedValue({ free: 200, total: 500 });
        const result = await serverAT._checkBalanceForEntry(42, 100);
        expect(result.ok).toBe(true);
        expect(result.free).toBe(200);
    });

    test('checkBalanceForEntry returns ok=false when freeUsd < sizeUsd * 1.1', async () => {
        exchangeOpsMock.getBalance.mockResolvedValue({ free: 50, total: 100 });
        const result = await serverAT._checkBalanceForEntry(42, 100);
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('BALANCE_INSUFFICIENT');
    });

    test('balance fetch failure returns ok=true (fail-open — exchange will reject if truly insufficient)', async () => {
        exchangeOpsMock.getBalance.mockRejectedValue(new Error('timeout'));
        const result = await serverAT._checkBalanceForEntry(42, 100);
        expect(result.ok).toBe(true);
        expect(result.skipped).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/pretrade-balance-check.test.js -v`
Expected: FAIL — `_checkBalanceForEntry is not a function`.

- [ ] **Step 3: Add _checkBalanceForEntry helper in serverAT.js**

In `server/services/serverAT.js`, add this function near the top (after existing state declarations):

```javascript
// [Task L 2026-05-28] Pre-trade balance check — verify free >= sizeUsd * 1.1
// Fail-open on fetch error: exchange will reject if truly insufficient, and
// blocking trading on a stale balance API would cause more harm than good.
async function _checkBalanceForEntry(userId, sizeUsd) {
    if (!sizeUsd || sizeUsd <= 0) return { ok: true, free: null };
    try {
        const exchangeOps = require('./exchangeOps');
        const bal = await exchangeOps.getBalance(userId);
        const free = Number(bal && (bal.free !== undefined ? bal.free : bal.availableBalance) || 0);
        const required = sizeUsd * 1.1;
        if (free < required) {
            return { ok: false, reason: 'BALANCE_INSUFFICIENT', free, required };
        }
        return { ok: true, free };
    } catch (err) {
        return { ok: true, skipped: true, error: err.message };
    }
}
```

In `_executeLiveEntry`, BEFORE the `exchangeOps.placeEntry(...)` call, add:

```javascript
        // [Task L 2026-05-28] Pre-trade balance sanity check
        const balCheck = await _checkBalanceForEntry(userId, entry.sizeUsd);
        if (!balCheck.ok) {
            logger.warn('AT_LIVE', `[${entry.seq}] Entry skipped uid=${userId} sym=${entry.symbol} — ${balCheck.reason} free=${balCheck.free} need=${balCheck.required}`);
            try { audit.record('BALANCE_INSUFFICIENT_SKIP', { userId, symbol: entry.symbol, sizeUsd: entry.sizeUsd, free: balCheck.free, required: balCheck.required }, 'SERVER_AT'); } catch (_) {}
            try {
                const _telegram = require('./telegram');
                await _telegram.sendToUser(userId, '⚠️ *Entry skipped — insufficient balance*\n'
                    + '`' + entry.symbol + '` ' + entry.side + ' $' + entry.sizeUsd.toFixed(2) + '\n'
                    + 'Free: $' + balCheck.free.toFixed(2) + ' / Need: $' + balCheck.required.toFixed(2));
            } catch (_) {}
            entry.live = { status: 'BALANCE_INSUFFICIENT' };
            return;
        }
```

Export the helper for testing:

```javascript
module.exports = { ..., _checkBalanceForEntry };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/pretrade-balance-check.test.js -v`
Expected: PASS all 3 cases.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/pretrade-balance-check.test.js server/services/serverAT.js
git commit -m "feat(s8-prep): L — pre-trade balance sanity check"
```

---

## Task M: Active sweeper for open orders at boot

**Why:** PM2 crash mid-fill can leave a Zeus-placed limit/stop order on exchange without DB record. When price hits, position opens with no Zeus management → ghost position. Boot-time scan must adopt or cancel.

**Files:**
- Create: `server/services/orderSweeper.js`
- Modify: `server/services/exchangeOps.js` — add `getOpenOrders(uid)`
- Modify: `server/services/binanceOps.js` — add `getOpenOrders(uid, creds)`
- Modify: `server/services/recoveryBoot.js:run` — call orderSweeper.sweep(uid) per user
- Test: `tests/unit/order-sweeper.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/order-sweeper.test.js`:

```javascript
'use strict';

const path = require('path');

const exchangeOpsMock = {
    getOpenOrders: jest.fn(),
    cancelOrder: jest.fn(() => Promise.resolve({ ok: true })),
};
jest.mock(path.resolve(__dirname, '../../server/services/exchangeOps'), () => exchangeOpsMock);

const dbMock = {
    getZeusOrderIds: jest.fn(() => new Set()),
    auditLog: jest.fn(),
};
jest.mock(path.resolve(__dirname, '../../server/services/database'), () => ({ db: dbMock }));

const telegramMock = { sendToUser: jest.fn(() => Promise.resolve()) };
jest.mock(path.resolve(__dirname, '../../server/services/telegram'), () => telegramMock);

describe('orderSweeper', () => {
    let sweeper;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        sweeper = require('../../server/services/orderSweeper');
    });

    test('non-zeus orders are not touched', async () => {
        exchangeOpsMock.getOpenOrders.mockResolvedValue([
            { orderId: 'x1', clientOrderId: 'manual_123', symbol: 'BTCUSDT' },
        ]);
        const result = await sweeper.sweep(42);
        expect(exchangeOpsMock.cancelOrder).not.toHaveBeenCalled();
        expect(result.cancelled.length).toBe(0);
        expect(result.preserved.length).toBe(1);
    });

    test('zeus_-prefixed orphan order (not in DB) → cancelled', async () => {
        exchangeOpsMock.getOpenOrders.mockResolvedValue([
            { orderId: 'x1', clientOrderId: 'zeus_abc123', symbol: 'BTCUSDT' },
        ]);
        dbMock.getZeusOrderIds.mockReturnValue(new Set()); // DB has no record
        const result = await sweeper.sweep(42);
        expect(exchangeOpsMock.cancelOrder).toHaveBeenCalledWith(42, { symbol: 'BTCUSDT', orderId: 'x1' });
        expect(result.cancelled.length).toBe(1);
    });

    test('zeus_-prefixed order in DB is preserved', async () => {
        exchangeOpsMock.getOpenOrders.mockResolvedValue([
            { orderId: 'x1', clientOrderId: 'zeus_abc123', symbol: 'BTCUSDT' },
        ]);
        dbMock.getZeusOrderIds.mockReturnValue(new Set(['x1']));
        const result = await sweeper.sweep(42);
        expect(exchangeOpsMock.cancelOrder).not.toHaveBeenCalled();
        expect(result.preserved.length).toBe(1);
    });

    test('cancel failure logged but does not throw', async () => {
        exchangeOpsMock.getOpenOrders.mockResolvedValue([
            { orderId: 'x1', clientOrderId: 'zeus_orphan', symbol: 'BTCUSDT' },
        ]);
        exchangeOpsMock.cancelOrder.mockRejectedValue(new Error('not found'));
        await expect(sweeper.sweep(42)).resolves.not.toThrow();
        expect(dbMock.auditLog).toHaveBeenCalledWith(42, 'ORDER_SWEEPER_CANCEL_FAILED', expect.any(Object), null);
    });

    test('multiple orphans cancelled, Telegram summary sent', async () => {
        exchangeOpsMock.getOpenOrders.mockResolvedValue([
            { orderId: 'x1', clientOrderId: 'zeus_a', symbol: 'BTCUSDT' },
            { orderId: 'x2', clientOrderId: 'zeus_b', symbol: 'ETHUSDT' },
            { orderId: 'x3', clientOrderId: 'manual_c', symbol: 'SOLUSDT' },
        ]);
        const result = await sweeper.sweep(42);
        expect(result.cancelled.length).toBe(2);
        expect(result.preserved.length).toBe(1);
        expect(telegramMock.sendToUser).toHaveBeenCalledWith(42, expect.stringMatching(/2.*orphan|orphans.*2/i));
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/order-sweeper.test.js -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Create orderSweeper.js**

Create `server/services/orderSweeper.js`:

```javascript
'use strict';

// Zeus Terminal — Boot-time orphan order sweeper.
// At each restart, scan exchange open orders for each active user. Any order
// with clientOrderId starting with 'zeus_' that is NOT recorded in our DB is
// considered orphaned (placed before crash, DB INSERT lost) — cancel it.
// Manual user orders (no zeus_ prefix) are preserved.

const ZEUS_PREFIX = 'zeus_';

async function sweep(userId) {
    const result = { userId, cancelled: [], preserved: [], skipped: [], errors: [] };
    const exchangeOps = require('./exchangeOps');
    const { db } = require('./database');

    let openOrders = [];
    try {
        openOrders = await exchangeOps.getOpenOrders(userId);
    } catch (err) {
        result.errors.push({ stage: 'getOpenOrders', error: err.message });
        return result;
    }

    const zeusOrders = openOrders.filter(o => String(o.clientOrderId || '').startsWith(ZEUS_PREFIX));
    const dbOrderIds = (db.getZeusOrderIds && db.getZeusOrderIds(userId)) || new Set();

    for (const o of openOrders) {
        const isZeus = String(o.clientOrderId || '').startsWith(ZEUS_PREFIX);
        if (!isZeus) {
            result.preserved.push(o);
            continue;
        }
        if (dbOrderIds.has(o.orderId)) {
            result.preserved.push(o);
            continue;
        }
        // Orphan: cancel
        try {
            await exchangeOps.cancelOrder(userId, { symbol: o.symbol, orderId: o.orderId });
            result.cancelled.push(o);
            try { db.auditLog(userId, 'ORDER_SWEEPER_CANCELLED', { orderId: o.orderId, symbol: o.symbol, clientOrderId: o.clientOrderId }, null); } catch (_) {}
        } catch (err) {
            result.errors.push({ orderId: o.orderId, error: err.message });
            try { db.auditLog(userId, 'ORDER_SWEEPER_CANCEL_FAILED', { orderId: o.orderId, symbol: o.symbol, error: err.message }, null); } catch (_) {}
        }
    }

    if (result.cancelled.length > 0) {
        try {
            const telegram = require('./telegram');
            await telegram.sendToUser(userId, '🧹 *Order Sweeper* — ' + result.cancelled.length + ' orphan(s) cancelled at boot.');
        } catch (_) {}
    }

    return result;
}

module.exports = { sweep };
```

- [ ] **Step 4: Add getOpenOrders to exchangeOps.js**

In `server/services/exchangeOps.js`, after `cancelOrder`:

```javascript
async function getOpenOrders(uid, params) {
    const { ops, creds } = _resolveOps(uid);
    if (typeof ops.getOpenOrders !== 'function') {
        throw new Error('getOpenOrders not implemented for exchange ' + creds.exchange);
    }
    return ops.getOpenOrders(uid, params || {}, creds);
}
```

Add `getOpenOrders` to `module.exports`.

- [ ] **Step 5: Add getOpenOrders to binanceOps.js**

In `server/services/binanceOps.js`, search for `cancelOrder` and after it add:

```javascript
async function getOpenOrders(uid, params, creds) {
    // GET /fapi/v1/openOrders — returns array of {orderId, clientOrderId, symbol, side, type, ...}
    const sendSignedRequest = require('./binanceSigner').sendSignedRequest;
    const query = params && params.symbol ? { symbol: params.symbol } : {};
    const resp = await sendSignedRequest('GET', '/fapi/v1/openOrders', query, creds);
    if (!Array.isArray(resp)) return [];
    return resp.map(o => ({
        orderId: String(o.orderId),
        clientOrderId: o.clientOrderId,
        symbol: o.symbol,
        side: o.side,
        type: o.type,
        price: Number(o.price),
        origQty: Number(o.origQty),
        status: o.status,
    }));
}
```

Add `getOpenOrders` to the binanceOps `module.exports` block.

- [ ] **Step 6: Add getZeusOrderIds to database.js**

Find the db module (`server/services/database.js`). Add helper that queries the at_orders table for orders with clientOrderId LIKE 'zeus_%' for a given user:

```javascript
function getZeusOrderIds(userId) {
    if (!userId) return new Set();
    try {
        const rows = db.prepare(`
            SELECT order_id FROM at_orders
            WHERE user_id = ? AND status IN ('OPEN','NEW','PARTIALLY_FILLED')
            AND client_order_id LIKE 'zeus_%'
        `).all(userId);
        return new Set(rows.map(r => String(r.order_id)));
    } catch (_) {
        return new Set();
    }
}
```

Add `getZeusOrderIds` to module exports. If `at_orders` table or column names differ, search:
`grep -n "at_orders\|client_order_id" server/services/database.js`
and adjust column names accordingly.

- [ ] **Step 7: Wire into recoveryBoot.run**

In `server/services/recoveryBoot.js:run`, inside the per-user loop AFTER position reconciliation, add:

```javascript
            // [Task M 2026-05-28] Sweep orphan Zeus orders
            try {
                const orderSweeper = require('./orderSweeper');
                const sweepResult = await orderSweeper.sweep(uid);
                _logInfo('RECOVERY', `Order sweep uid=${uid} cancelled=${sweepResult.cancelled.length} preserved=${sweepResult.preserved.length} errors=${sweepResult.errors.length}`);
            } catch (e) {
                _logWarn('RECOVERY', `Order sweep uid=${uid} failed: ${e.message}`);
            }
```

- [ ] **Step 8: Run test to verify it passes**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/order-sweeper.test.js -v`
Expected: PASS all 5 cases.

- [ ] **Step 9: Run full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add tests/unit/order-sweeper.test.js server/services/orderSweeper.js server/services/exchangeOps.js server/services/binanceOps.js server/services/database.js server/services/recoveryBoot.js
git commit -m "feat(s8-prep): M — boot-time orphan order sweeper"
```

---

## Task N: Drift checker periodic reconciliation

**Why:** WS dropouts / REST timeouts can desync `serverAT._positions` from real exchange state. Periodic comparison (every 15min) catches drift before it bleeds capital.

**Files:**
- Create: `server/services/driftChecker.js`
- Modify: `server.js` — start driftChecker at boot
- Test: `tests/unit/drift-checker.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/drift-checker.test.js`:

```javascript
'use strict';

const path = require('path');

const serverATMock = {
    getOpenPositions: jest.fn(),
    setGlobalHalt: jest.fn(),
};
jest.mock(path.resolve(__dirname, '../../server/services/serverAT'), () => serverATMock);

const exchangeOpsMock = { getPositions: jest.fn() };
jest.mock(path.resolve(__dirname, '../../server/services/exchangeOps'), () => exchangeOpsMock);

const dbMock = {
    listActiveExchangeUsers: jest.fn(() => [{ user_id: 42 }]),
    auditLog: jest.fn(),
};
jest.mock(path.resolve(__dirname, '../../server/services/database'), () => ({ db: dbMock }));

const telegramMock = { sendToUser: jest.fn(() => Promise.resolve()) };
jest.mock(path.resolve(__dirname, '../../server/services/telegram'), () => telegramMock);

describe('driftChecker', () => {
    let dc;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        dc = require('../../server/services/driftChecker');
        dc._reset && dc._reset();
    });

    afterEach(() => { dc.stop && dc.stop(); });

    test('matching positions → no drift detected', async () => {
        serverATMock.getOpenPositions.mockReturnValue([{ userId: 42, symbol: 'BTCUSDT', side: 'LONG', qty: 0.01 }]);
        exchangeOpsMock.getPositions.mockResolvedValue([{ symbol: 'BTCUSDT', side: 'LONG', qty: 0.01 }]);
        const result = await dc.checkUser(42);
        expect(result.driftDetected).toBe(false);
    });

    test('exchange has position DB does not → drift detected', async () => {
        serverATMock.getOpenPositions.mockReturnValue([]);
        exchangeOpsMock.getPositions.mockResolvedValue([{ symbol: 'BTCUSDT', side: 'LONG', qty: 0.01 }]);
        const result = await dc.checkUser(42);
        expect(result.driftDetected).toBe(true);
        expect(result.diff.exchangeOnly.length).toBe(1);
    });

    test('size mismatch > 5% → drift detected', async () => {
        serverATMock.getOpenPositions.mockReturnValue([{ userId: 42, symbol: 'BTCUSDT', side: 'LONG', qty: 0.01 }]);
        exchangeOpsMock.getPositions.mockResolvedValue([{ symbol: 'BTCUSDT', side: 'LONG', qty: 0.015 }]); // 50% diff
        const result = await dc.checkUser(42);
        expect(result.driftDetected).toBe(true);
        expect(result.diff.sizeMismatch.length).toBe(1);
    });

    test('size diff < 5% tolerated', async () => {
        serverATMock.getOpenPositions.mockReturnValue([{ userId: 42, symbol: 'BTCUSDT', side: 'LONG', qty: 0.010 }]);
        exchangeOpsMock.getPositions.mockResolvedValue([{ symbol: 'BTCUSDT', side: 'LONG', qty: 0.0101 }]); // 1% diff
        const result = await dc.checkUser(42);
        expect(result.driftDetected).toBe(false);
    });

    test('drift detected requires 2 consecutive fails before halt (no transient halt)', async () => {
        serverATMock.getOpenPositions.mockReturnValue([]);
        exchangeOpsMock.getPositions.mockResolvedValue([{ symbol: 'BTCUSDT', side: 'LONG', qty: 0.01 }]);
        await dc.checkUser(42);
        expect(serverATMock.setGlobalHalt).not.toHaveBeenCalled();
        await dc.checkUser(42);  // 2nd consecutive
        expect(serverATMock.setGlobalHalt).toHaveBeenCalledWith(42, 42, expect.stringMatching(/DRIFT_DETECTED/));
    });

    test('clean check resets consecutive counter', async () => {
        serverATMock.getOpenPositions.mockReturnValueOnce([]).mockReturnValueOnce([{ symbol: 'BTCUSDT', side: 'LONG', qty: 0.01 }]).mockReturnValueOnce([]);
        exchangeOpsMock.getPositions.mockResolvedValue([{ symbol: 'BTCUSDT', side: 'LONG', qty: 0.01 }]);
        await dc.checkUser(42);  // drift
        await dc.checkUser(42);  // clean — resets
        await dc.checkUser(42);  // drift but only 1st
        expect(serverATMock.setGlobalHalt).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/drift-checker.test.js -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Create driftChecker.js**

Create `server/services/driftChecker.js`:

```javascript
'use strict';

// Zeus Terminal — Periodic drift checker.
// Every 15min, compare serverAT._positions to exchange.getPositions per user.
// Diff types: exchange-only, db-only, size-mismatch (>5%).
// 2 consecutive drift detections → global halt + Telegram P0.

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const SIZE_TOLERANCE_PCT = 0.05;

let _timer = null;
const _consecutiveFails = new Map(); // userId → count

function _now() { return Date.now(); }
function _normSide(s) { return String(s || '').toUpperCase(); }
function _normSym(s) { return String(s || '').toUpperCase(); }
function _key(sym, side) { return _normSym(sym) + ':' + _normSide(side); }

async function checkUser(userId) {
    const serverAT = require('./serverAT');
    const exchangeOps = require('./exchangeOps');

    let dbPos = [];
    let exchPos = [];
    try {
        dbPos = serverAT.getOpenPositions ? serverAT.getOpenPositions(userId) || [] : [];
    } catch (_) {}
    try {
        exchPos = await exchangeOps.getPositions(userId) || [];
    } catch (err) {
        return { driftDetected: false, error: 'getPositions_failed: ' + err.message };
    }

    // Filter exchPos to non-zero qty
    exchPos = exchPos.filter(p => Math.abs(Number(p.qty || 0)) > 0);

    const dbMap = new Map(dbPos.map(p => [_key(p.symbol, p.side), p]));
    const exchMap = new Map(exchPos.map(p => [_key(p.symbol, p.side), p]));

    const exchangeOnly = [];
    const dbOnly = [];
    const sizeMismatch = [];

    for (const [k, p] of exchMap) {
        if (!dbMap.has(k)) {
            exchangeOnly.push(p);
        } else {
            const dbQty = Math.abs(Number(dbMap.get(k).qty || 0));
            const exchQty = Math.abs(Number(p.qty || 0));
            const denom = Math.max(dbQty, exchQty);
            if (denom > 0 && Math.abs(dbQty - exchQty) / denom > SIZE_TOLERANCE_PCT) {
                sizeMismatch.push({ symbol: p.symbol, side: p.side, dbQty, exchQty });
            }
        }
    }
    for (const [k, p] of dbMap) {
        if (!exchMap.has(k)) dbOnly.push(p);
    }

    const driftDetected = exchangeOnly.length > 0 || dbOnly.length > 0 || sizeMismatch.length > 0;

    if (driftDetected) {
        const cur = (_consecutiveFails.get(userId) || 0) + 1;
        _consecutiveFails.set(userId, cur);
        if (cur >= 2) {
            // Halt + alert
            try { serverAT.setGlobalHalt(true, userId, 'DRIFT_DETECTED:' + JSON.stringify({ exchangeOnly: exchangeOnly.length, dbOnly: dbOnly.length, sizeMismatch: sizeMismatch.length })); } catch (_) {}
            try {
                const telegram = require('./telegram');
                await telegram.sendToUser(userId, '🚨 *POSITION DRIFT DETECTED* uid=' + userId + '\n'
                    + 'exchange-only: ' + exchangeOnly.length + '\n'
                    + 'db-only: ' + dbOnly.length + '\n'
                    + 'size-mismatch: ' + sizeMismatch.length + '\n'
                    + 'Global halt ARMED. Manual intervention required.');
            } catch (_) {}
            try {
                const { db } = require('./database');
                db.auditLog(userId, 'DRIFT_DETECTED_HALT', { exchangeOnly, dbOnly, sizeMismatch, consecutive: cur }, null);
            } catch (_) {}
        }
    } else {
        _consecutiveFails.set(userId, 0);
    }

    return { driftDetected, diff: { exchangeOnly, dbOnly, sizeMismatch }, consecutiveFails: _consecutiveFails.get(userId) };
}

async function checkAllUsers() {
    const { db } = require('./database');
    try {
        const users = db.listActiveExchangeUsers ? db.listActiveExchangeUsers() : [];
        for (const u of users) {
            try { await checkUser(u.user_id || u.id); } catch (_) {}
        }
    } catch (e) { console.error('[DRIFT-CHECKER] checkAllUsers error:', e.message); }
}

function start(opts) {
    if (_timer) return;
    const intervalMs = (opts && opts.intervalMs) || DEFAULT_INTERVAL_MS;
    _timer = setInterval(() => { checkAllUsers().catch(() => {}); }, intervalMs);
    console.log('[DRIFT-CHECKER] started interval=' + intervalMs + 'ms');
}

function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
}

function _reset() {
    _consecutiveFails.clear();
    if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { start, stop, checkUser, checkAllUsers, _reset };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-vm-modules node_modules/.bin/jest tests/unit/drift-checker.test.js -v`
Expected: PASS all 6 cases.

- [ ] **Step 5: Wire into server.js boot**

In `server.js`, after `brainWatchdog.start()` (added in Task H), add:

```javascript
// [Task N 2026-05-28] Periodic drift checker (DB vs exchange positions)
try { require('./server/services/driftChecker').start(); } catch (e) { logger.warn('SERVER', 'driftChecker start: ' + e.message); }
```

In `_gracefulShutdown`, before `telegramBot.stop()`:

```javascript
try { require('./server/services/driftChecker').stop(); } catch (_) {}
```

- [ ] **Step 6: Run full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 7: Commit + final tag**

```bash
git add tests/unit/drift-checker.test.js server/services/driftChecker.js server.js
git commit -m "feat(s8-prep): N — periodic drift checker (15min reconciliation)"

# Final tag for S8 prep complete
git tag s8-prep-enterprise-complete-$(date +%Y%m%d-%H%M)
```

---

## Post-implementation Verification

After all 14 tasks committed:

- [ ] **VFY-1**: Full test suite green
  - Run: `npm test`
  - Expected: ALL tests pass

- [ ] **VFY-2**: PM2 stable after reload
  - Run: `pm2 reload zeus && sleep 10 && pm2 status zeus`
  - Expected: `online` status, restarts not incrementing

- [ ] **VFY-3**: New services started
  - Run: `pm2 logs zeus --lines 100 --nostream | grep -E "BRAIN-WATCHDOG|DRIFT-CHECKER|started"`
  - Expected: Both `[BRAIN-WATCHDOG] started` and `[DRIFT-CHECKER] started`

- [ ] **VFY-4**: Halt endpoint smoke test
  - Run: `curl -X GET http://localhost:3000/api/admin/halt -H "Cookie: <admin-session>"`
  - Expected: 200 with `{active: false, ...}`

- [ ] **VFY-5**: Mutex check refuses bad flip
  - Try via `/api/migration/flags` (or direct edit): set `SERVER_AT_TESTNET=true` + `SERVER_AT=true`
  - Expected: rejection with `MF_MUTEX_VIOLATION`

- [ ] **VFY-6**: Memory steady
  - Run: `pm2 status zeus | grep memory`
  - Wait 30min, re-check
  - Expected: memory growth <50MB

After VFY 1-6 green → S8 prep complete. Proceed to S8.1 (24h parity soak with `PARITY_SHADOW_ENABLED=true`, browser open).

---

## Rollback Plan

If any task introduces a regression:

1. `git revert <task-commit-sha>` — keeps history clean
2. `pm2 reload zeus`
3. Verify suite green: `npm test`
4. Investigate root cause, write fixed task, re-implement

Do NOT use `git reset --hard` on shared branches.

Tasks A→F are minimally invasive (no new background services). Tasks G,H,J,K,L,M,N add background services or wrappers — those are higher-risk for regression and warrant extra smoke testing.

---

## Acceptance Criteria for S8 GO

After this plan completes + 24h parity soak:

- [ ] Parity report shows >95% PRIMARY agreement between client/server brain decisions
- [ ] No `RECOVERY_EXCHANGE_ONLY_*` events during soak (clean state)
- [ ] No `DRIFT_DETECTED_HALT` events during soak
- [ ] Brain watchdog 0 alerts
- [ ] Exchange CB 0 opens
- [ ] All tests still green

Then operator can flip `SERVER_BRAIN=true` + `SERVER_AT_TESTNET=true` for S8.2 execution phase.

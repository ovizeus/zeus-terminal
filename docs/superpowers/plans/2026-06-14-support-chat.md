# Live Support Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-to-one live text chat between each user (Settings → SUPPORT) and the single admin/operator, with persisted history, real-time WebSocket delivery, and an unread badge on the admin entry.

**Architecture:** Reuse existing infra end-to-end. New SQLite table `support_messages` (migration in `server/services/database.js`) + query helpers. New Express route `server/routes/support.js` (user + admin endpoints, copying the `_requireAuth`/`_requireAdmin` pattern from `server/routes/admin.js`). Real-time push via the existing `app.locals.wsBroadcastToUser(userId, {type:'support.message', data})`. Client receives via the existing `wsService.subscribe` dispatch in `src/hooks/useServerSync.ts`. New `supportStore` (zustand). User UI = a chat section in the existing SUPPORT tab of `SettingsHubModal.tsx`. Admin UI = real implementation of the already-stubbed `SupportSection` inside the existing `AdminPage`, plus an unread badge on the admin header icon (`Header.tsx`).

**Tech Stack:** Node + Express + `better-sqlite3` (synchronous prepared statements), native `ws`, React + Vite + Zustand, TypeScript. Server tests: jest + supertest (targeted file only). Client tests: vitest. Live verify: Playwright.

**Design refinement vs spec:** The spec described a "new admin modal". The codebase already has an admin page (`AdminPage.tsx`, opened from an admin-only header icon) whose sidebar already lists a `support` section rendered by a stub `SupportSection`. We realize the approved "admin inbox with badge" by filling in that existing section + badging the existing header icon, rather than adding a brand-new modal. Same UX, less surface, follows existing patterns.

**Operational constraints (do not violate):**
- This is a SERVER change → it needs exactly **one `pm2 reload zeus`**, which restarts the brain once. Build + tests are zero-impact (local). **Do the reload ONLY on explicit operator GO**, in a chosen window. Until then, ship nothing live.
- Live VPS runs as user `zeus`. After any root-made change: `chown -R zeus:zeus /opt/zeus-terminal/public/app` and `chown zeus:zeus` every touched source file.
- **NEVER run the full jest suite on the live VPS** (starves brain → GLOBAL_HALT). Run ONLY the targeted support test file with `--runInBand --forceExit`, redirect output to a file. Client: `npx vitest run <file>`.
- UI strings in English. Amethyst accent `#b07cff`, scoped per element id — never touch global `--gold`.
- Commit after each green task. Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Avoid backticks in `-m` bodies (shell substitution).

---

## File Structure

**Create:**
- `server/routes/support.js` — support REST endpoints (user + admin).
- `tests/unit/support-route.test.js` — server route tests.
- `client/src/stores/supportStore.ts` — zustand store for thread + unread counters.
- `client/src/components/modals/SupportChat.tsx` — user chat UI (used inside SUPPORT tab).
- `client/src/components/admin/sections/SupportSection.tsx` — admin inbox UI.
- `client/src/stores/__tests__/supportStore.test.ts` — store unit test.

**Modify:**
- `server/services/database.js` — add migration `051_support_messages` + query helpers + exports.
- `server.js` — mount `app.use('/api/support', require('./server/routes/support'))`.
- `client/src/types/sync.ts` — add `support.message` frame to the `WsMessage` union.
- `client/src/hooks/useServerSync.ts` — dispatch `support.message` into `supportStore`.
- `client/src/components/modals/SettingsHubModal.tsx` — render `<SupportChat/>` in SUPPORT tab.
- `client/src/components/admin/AdminPage.tsx` — import real `SupportSection` (drop stub import).
- `client/src/components/admin/sections/stubs.tsx` — remove the stub `SupportSection` (now real).
- `client/src/components/layout/Header.tsx` — unread badge on the admin icon + seed on mount.
- `client/src/app.css` — amethyst styling for `#supportChat` and `#adminSupport`.

---

## Task 1: DB table + query helpers

**Files:**
- Modify: `server/services/database.js` (migrations block ends near line 9520; module.exports near line 11368)
- Test: `tests/unit/support-db.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/support-db.test.js`:

```javascript
'use strict';

// Task 1 — support_messages DB layer. Uses a throwaway in-memory DB by
// pointing DB_PATH at :memory: BEFORE requiring the module is not supported
// (module opens a file path), so we exercise the exported helpers against the
// real module and clean up our own rows by user id at the end.

const path = require('path');
const dbmod = require(path.resolve(__dirname, '../../server/services/database'));

const U = 999000001; // test user id unlikely to collide

afterAll(() => {
  try { dbmod.db.prepare('DELETE FROM support_messages WHERE user_id = ?').run(U); } catch (_) {}
});

describe('support_messages DB helpers', () => {
  beforeEach(() => {
    dbmod.db.prepare('DELETE FROM support_messages WHERE user_id = ?').run(U);
  });

  test('insert user message: unread by admin, read by user', () => {
    const row = dbmod.insertSupportMessage(U, 'user', 'hello there');
    expect(row.id).toBeGreaterThan(0);
    expect(row.sender).toBe('user');
    expect(row.message).toBe('hello there');
    expect(row.read_by_admin).toBe(0);
    expect(row.read_by_user).toBe(1);
  });

  test('insert admin message: read by admin, unread by user', () => {
    const row = dbmod.insertSupportMessage(U, 'admin', 'hi back');
    expect(row.sender).toBe('admin');
    expect(row.read_by_admin).toBe(1);
    expect(row.read_by_user).toBe(0);
  });

  test('getSupportThread returns rows in id order', () => {
    dbmod.insertSupportMessage(U, 'user', 'first');
    dbmod.insertSupportMessage(U, 'admin', 'second');
    const t = dbmod.getSupportThread(U);
    expect(t.map(r => r.message)).toEqual(['first', 'second']);
  });

  test('unread counts and read-marking', () => {
    dbmod.insertSupportMessage(U, 'user', 'u1');
    dbmod.insertSupportMessage(U, 'user', 'u2');
    dbmod.insertSupportMessage(U, 'admin', 'a1');
    expect(dbmod.getSupportTotalUnreadForAdmin()).toBeGreaterThanOrEqual(2);
    expect(dbmod.getSupportUnreadForUser(U)).toBe(1);

    dbmod.markSupportThreadReadByAdmin(U);
    const inbox = dbmod.getSupportInbox().find(c => c.user_id === U);
    expect(inbox.unread_count).toBe(0);

    dbmod.markSupportThreadReadByUser(U);
    expect(dbmod.getSupportUnreadForUser(U)).toBe(0);
  });

  test('getSupportInbox returns last message + email join', () => {
    dbmod.insertSupportMessage(U, 'user', 'newest msg');
    const inbox = dbmod.getSupportInbox();
    const row = inbox.find(c => c.user_id === U);
    expect(row).toBeTruthy();
    expect(row.last_message).toBe('newest msg');
    expect(row).toHaveProperty('email'); // may be null if user id has no users row
  });

  test('getAdminUserIds returns an array', () => {
    expect(Array.isArray(dbmod.getAdminUserIds())).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/zeus-terminal && npx jest tests/unit/support-db.test.js --runInBand --forceExit > /tmp/support-db.log 2>&1; tail -30 /tmp/support-db.log`
Expected: FAIL — `dbmod.insertSupportMessage is not a function` (table/helpers don't exist yet).

- [ ] **Step 3: Add the migration**

In `server/services/database.js`, after the last `migrate('050_...')` block (the migrations are not strictly ordered by number in the file; just add a new one alongside the others, before `module.exports`):

```javascript
migrate('051_support_messages', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS support_messages (
            id            INTEGER PRIMARY KEY,
            user_id       INTEGER NOT NULL,
            sender        TEXT NOT NULL CHECK(sender IN ('user','admin')),
            message       TEXT NOT NULL,
            read_by_admin INTEGER NOT NULL DEFAULT 0,
            read_by_user  INTEGER NOT NULL DEFAULT 0,
            created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_support_user   ON support_messages(user_id, id);
        CREATE INDEX IF NOT EXISTS idx_support_unread ON support_messages(read_by_admin);
    `);
});
```

- [ ] **Step 4: Add the helper functions**

In `server/services/database.js`, before `module.exports = {`:

```javascript
// ─── Support chat helpers ───
const _supInsert = db.prepare(
    'INSERT INTO support_messages (user_id, sender, message, read_by_admin, read_by_user) VALUES (?, ?, ?, ?, ?)'
);
const _supGetById = db.prepare('SELECT * FROM support_messages WHERE id = ?');
const _supThread = db.prepare('SELECT * FROM support_messages WHERE user_id = ? ORDER BY id ASC');
const _supUnreadUser = db.prepare(
    "SELECT COUNT(*) AS n FROM support_messages WHERE user_id = ? AND sender = 'admin' AND read_by_user = 0"
);
const _supTotalUnreadAdmin = db.prepare(
    "SELECT COUNT(*) AS n FROM support_messages WHERE sender = 'user' AND read_by_admin = 0"
);
const _supMarkAdmin = db.prepare(
    "UPDATE support_messages SET read_by_admin = 1 WHERE user_id = ? AND sender = 'user'"
);
const _supMarkUser = db.prepare(
    "UPDATE support_messages SET read_by_user = 1 WHERE user_id = ? AND sender = 'admin'"
);
const _supInbox = db.prepare(`
    SELECT m.user_id                                   AS user_id,
           u.email                                     AS email,
           (SELECT message FROM support_messages x WHERE x.user_id = m.user_id ORDER BY x.id DESC LIMIT 1) AS last_message,
           (SELECT created_at FROM support_messages x WHERE x.user_id = m.user_id ORDER BY x.id DESC LIMIT 1) AS last_at,
           SUM(CASE WHEN m.sender = 'user' AND m.read_by_admin = 0 THEN 1 ELSE 0 END) AS unread_count
    FROM support_messages m
    LEFT JOIN users u ON u.id = m.user_id
    GROUP BY m.user_id
    ORDER BY last_at DESC
`);
const _supAdminIds = db.prepare("SELECT id FROM users WHERE role = 'admin'");

function insertSupportMessage(userId, sender, message) {
    const readByAdmin = sender === 'admin' ? 1 : 0;
    const readByUser = sender === 'user' ? 1 : 0;
    const info = _supInsert.run(userId, sender, message, readByAdmin, readByUser);
    return _supGetById.get(info.lastInsertRowid);
}
function getSupportThread(userId) { return _supThread.all(userId); }
function getSupportUnreadForUser(userId) { return _supUnreadUser.get(userId).n; }
function getSupportTotalUnreadForAdmin() { return _supTotalUnreadAdmin.get().n; }
function markSupportThreadReadByAdmin(userId) { _supMarkAdmin.run(userId); }
function markSupportThreadReadByUser(userId) { _supMarkUser.run(userId); }
function getSupportInbox() { return _supInbox.all(); }
function getAdminUserIds() { return _supAdminIds.all().map(r => r.id); }
```

Then add these keys inside the `module.exports = { ... }` object (alongside the existing keys):

```javascript
    insertSupportMessage,
    getSupportThread,
    getSupportUnreadForUser,
    getSupportTotalUnreadForAdmin,
    markSupportThreadReadByAdmin,
    markSupportThreadReadByUser,
    getSupportInbox,
    getAdminUserIds,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /opt/zeus-terminal && npx jest tests/unit/support-db.test.js --runInBand --forceExit > /tmp/support-db.log 2>&1; tail -30 /tmp/support-db.log`
Expected: PASS, all 6 tests green.

- [ ] **Step 6: Commit**

```bash
cd /opt/zeus-terminal
chown zeus:zeus server/services/database.js tests/unit/support-db.test.js
git add server/services/database.js tests/unit/support-db.test.js
git -c user.name='zeus' -c user.email='wsov2@protonmail.com' commit -m "feat(support): add support_messages table + DB helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Support REST route (user + admin endpoints)

**Files:**
- Create: `server/routes/support.js`
- Modify: `server.js` (mount near line 1204, next to the other `app.use('/api/...')` lines)
- Test: `tests/unit/support-route.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/support-route.test.js`:

```javascript
'use strict';

// Task 2 — /api/support route. Mocks the database service so no real DB is
// touched, and asserts auth gating, validation, persistence calls, and WS push.

const express = require('supertest');
const supertest = require('supertest');
const realExpress = require('express');
const path = require('path');

const DB = path.resolve(__dirname, '../../server/services/database');

function buildApp(broadcastSpy) {
  jest.resetModules();
  jest.doMock(DB, () => ({
    insertSupportMessage: jest.fn((uid, sender, msg) => ({
      id: 1, user_id: uid, sender, message: msg,
      read_by_admin: sender === 'admin' ? 1 : 0,
      read_by_user: sender === 'user' ? 1 : 0,
      created_at: '2026-06-14 00:00:00',
    })),
    getSupportThread: jest.fn(() => [{ id: 1, user_id: 7, sender: 'user', message: 'hi' }]),
    getSupportUnreadForUser: jest.fn(() => 2),
    getSupportTotalUnreadForAdmin: jest.fn(() => 3),
    markSupportThreadReadByAdmin: jest.fn(),
    markSupportThreadReadByUser: jest.fn(),
    getSupportInbox: jest.fn(() => [{ user_id: 7, email: 'a@b.c', last_message: 'hi', last_at: 't', unread_count: 1 }]),
    getAdminUserIds: jest.fn(() => [1]),
  }));
  const dbmod = require(DB);
  const app = realExpress();
  app.use(realExpress.json());
  app.locals.wsBroadcastToUser = broadcastSpy;
  app.use((req, res, next) => {
    const role = req.headers['x-test-role'];
    const id = parseInt(req.headers['x-test-uid'], 10) || 0;
    if (id) req.user = { id, role: role || 'user' };
    next();
  });
  app.use('/api/support', require(path.resolve(__dirname, '../../server/routes/support')));
  return { app, dbmod };
}

describe('/api/support', () => {
  test('user sends message → persisted + pushed to admin', async () => {
    const broadcast = jest.fn();
    const { app, dbmod } = buildApp(broadcast);
    const res = await supertest(app)
      .post('/api/support/send').set('x-test-uid', '7').set('x-test-role', 'user')
      .send({ message: 'help me' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(dbmod.insertSupportMessage).toHaveBeenCalledWith(7, 'user', 'help me');
    expect(broadcast).toHaveBeenCalledWith(1, expect.objectContaining({ type: 'support.message' }));
  });

  test('empty message → 400', async () => {
    const { app } = buildApp(jest.fn());
    const res = await supertest(app)
      .post('/api/support/send').set('x-test-uid', '7').set('x-test-role', 'user')
      .send({ message: '   ' });
    expect(res.status).toBe(400);
  });

  test('over-length message → 400', async () => {
    const { app } = buildApp(jest.fn());
    const res = await supertest(app)
      .post('/api/support/send').set('x-test-uid', '7').set('x-test-role', 'user')
      .send({ message: 'X'.repeat(2001) });
    expect(res.status).toBe(400);
  });

  test('unauthenticated send → 401', async () => {
    const { app } = buildApp(jest.fn());
    const res = await supertest(app).post('/api/support/send').send({ message: 'hi' });
    expect(res.status).toBe(401);
  });

  test('user GET thread marks read-by-user', async () => {
    const { app, dbmod } = buildApp(jest.fn());
    const res = await supertest(app)
      .get('/api/support/thread').set('x-test-uid', '7').set('x-test-role', 'user');
    expect(res.status).toBe(200);
    expect(dbmod.markSupportThreadReadByUser).toHaveBeenCalledWith(7);
    expect(Array.isArray(res.body.messages)).toBe(true);
  });

  test('non-admin GET inbox → 403', async () => {
    const { app } = buildApp(jest.fn());
    const res = await supertest(app)
      .get('/api/support/inbox').set('x-test-uid', '7').set('x-test-role', 'user');
    expect(res.status).toBe(403);
  });

  test('admin GET inbox → conversations + totalUnread', async () => {
    const { app } = buildApp(jest.fn());
    const res = await supertest(app)
      .get('/api/support/inbox').set('x-test-uid', '1').set('x-test-role', 'admin');
    expect(res.status).toBe(200);
    expect(res.body.totalUnread).toBe(3);
    expect(res.body.conversations.length).toBe(1);
  });

  test('admin reply → persisted as admin + pushed to that user', async () => {
    const broadcast = jest.fn();
    const { app, dbmod } = buildApp(broadcast);
    const res = await supertest(app)
      .post('/api/support/reply/7').set('x-test-uid', '1').set('x-test-role', 'admin')
      .send({ message: 'on it' });
    expect(res.status).toBe(200);
    expect(dbmod.insertSupportMessage).toHaveBeenCalledWith(7, 'admin', 'on it');
    expect(broadcast).toHaveBeenCalledWith(7, expect.objectContaining({ type: 'support.message' }));
  });

  test('admin GET thread/:id marks read-by-admin', async () => {
    const { app, dbmod } = buildApp(jest.fn());
    const res = await supertest(app)
      .get('/api/support/thread/7').set('x-test-uid', '1').set('x-test-role', 'admin');
    expect(res.status).toBe(200);
    expect(dbmod.markSupportThreadReadByAdmin).toHaveBeenCalledWith(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/zeus-terminal && npx jest tests/unit/support-route.test.js --runInBand --forceExit > /tmp/support-route.log 2>&1; tail -30 /tmp/support-route.log`
Expected: FAIL — `Cannot find module '.../server/routes/support'`.

- [ ] **Step 3: Write the route**

Create `server/routes/support.js`:

```javascript
'use strict';

// Zeus Terminal — Support chat route
// One-to-one text chat between each user and the operator (admin).
// Mounted at /api/support after sessionAuth middleware in server.js.
// Realtime delivery via app.locals.wsBroadcastToUser; persistence in DB.

const express = require('express');
const router = express.Router();
const db = require('../services/database');

const MAX_LEN = 2000;

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
function _cleanMessage(raw) {
    if (typeof raw !== 'string') return null;
    const m = raw.trim();
    if (!m || m.length > MAX_LEN) return null;
    return m;
}
function _push(req, userId, row) {
    const fn = req.app && req.app.locals && req.app.locals.wsBroadcastToUser;
    if (typeof fn === 'function') {
        try { fn(userId, { type: 'support.message', data: row }); } catch (_) { /* never block */ }
    }
}

// ── User: send a message ──
router.post('/send', _requireAuth, (req, res) => {
    const message = _cleanMessage(req.body && req.body.message);
    if (!message) return res.status(400).json({ ok: false, error: 'empty or too long' });
    try {
        const row = db.insertSupportMessage(req.user.id, 'user', message);
        // notify every admin in real time
        for (const adminId of db.getAdminUserIds()) _push(req, adminId, row);
        res.json({ ok: true, msg: row });
    } catch (err) {
        res.status(500).json({ ok: false, error: String(err && err.message || err) });
    }
});

// ── User: read own thread (marks admin replies as read) ──
router.get('/thread', _requireAuth, (req, res) => {
    try {
        const messages = db.getSupportThread(req.user.id);
        db.markSupportThreadReadByUser(req.user.id);
        res.json({ ok: true, messages });
    } catch (err) {
        res.status(500).json({ ok: false, error: String(err && err.message || err) });
    }
});

// ── User: unread admin-reply count ──
router.get('/unread', _requireAuth, (req, res) => {
    try { res.json({ ok: true, unread: db.getSupportUnreadForUser(req.user.id) }); }
    catch (err) { res.status(500).json({ ok: false, error: String(err && err.message || err) }); }
});

// ── Admin: inbox (all conversations + total unread) ──
router.get('/inbox', _requireAuth, _requireAdmin, (req, res) => {
    try {
        res.json({ ok: true, conversations: db.getSupportInbox(), totalUnread: db.getSupportTotalUnreadForAdmin() });
    } catch (err) {
        res.status(500).json({ ok: false, error: String(err && err.message || err) });
    }
});

// ── Admin: read one user's thread (marks their messages as read) ──
router.get('/thread/:userId', _requireAuth, _requireAdmin, (req, res) => {
    const uid = parseInt(req.params.userId, 10);
    if (!uid) return res.status(400).json({ ok: false, error: 'bad user id' });
    try {
        const messages = db.getSupportThread(uid);
        db.markSupportThreadReadByAdmin(uid);
        res.json({ ok: true, messages });
    } catch (err) {
        res.status(500).json({ ok: false, error: String(err && err.message || err) });
    }
});

// ── Admin: reply to a user ──
router.post('/reply/:userId', _requireAuth, _requireAdmin, (req, res) => {
    const uid = parseInt(req.params.userId, 10);
    if (!uid) return res.status(400).json({ ok: false, error: 'bad user id' });
    const message = _cleanMessage(req.body && req.body.message);
    if (!message) return res.status(400).json({ ok: false, error: 'empty or too long' });
    try {
        const row = db.insertSupportMessage(uid, 'admin', message);
        _push(req, uid, row);
        res.json({ ok: true, msg: row });
    } catch (err) {
        res.status(500).json({ ok: false, error: String(err && err.message || err) });
    }
});

module.exports = router;
```

- [ ] **Step 4: Mount the route in server.js**

In `server.js`, next to the existing admin mount (line ~1204 `app.use('/api/admin', require('./server/routes/admin'));`), add:

```javascript
app.use('/api/support', require('./server/routes/support'));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /opt/zeus-terminal && npx jest tests/unit/support-route.test.js --runInBand --forceExit > /tmp/support-route.log 2>&1; tail -30 /tmp/support-route.log`
Expected: PASS, all 9 tests green.

- [ ] **Step 6: Commit**

```bash
cd /opt/zeus-terminal
chown zeus:zeus server/routes/support.js server.js tests/unit/support-route.test.js
git add server/routes/support.js server.js tests/unit/support-route.test.js
git -c user.name='zeus' -c user.email='wsov2@protonmail.com' commit -m "feat(support): add /api/support route (user send/thread, admin inbox/reply)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Client support store + WS frame type + dispatch

**Files:**
- Create: `client/src/stores/supportStore.ts`
- Create: `client/src/stores/__tests__/supportStore.test.ts`
- Modify: `client/src/types/sync.ts` (add frame to `WsMessage` union)
- Modify: `client/src/hooks/useServerSync.ts` (dispatch inside `wsService.subscribe`, near line 257)

- [ ] **Step 1: Write the failing store test**

Create `client/src/stores/__tests__/supportStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { useSupportStore } from '../supportStore'

const reset = () => useSupportStore.setState({ thread: [], userUnread: 0, adminUnread: 0 })

describe('supportStore', () => {
  beforeEach(reset)

  it('setThread replaces messages and clears userUnread', () => {
    useSupportStore.getState().setUserUnread(5)
    useSupportStore.getState().setThread([{ id: 1, sender: 'user', message: 'hi', created_at: 't' }])
    expect(useSupportStore.getState().thread.length).toBe(1)
    useSupportStore.getState().clearUserUnread()
    expect(useSupportStore.getState().userUnread).toBe(0)
  })

  it('incoming admin reply appends + bumps userUnread', () => {
    useSupportStore.getState().onIncoming({ id: 2, user_id: 7, sender: 'admin', message: 'hello', created_at: 't' })
    expect(useSupportStore.getState().thread.map(m => m.message)).toEqual(['hello'])
    expect(useSupportStore.getState().userUnread).toBe(1)
    expect(useSupportStore.getState().adminUnread).toBe(0)
  })

  it('incoming user message bumps adminUnread, does not append to user thread', () => {
    useSupportStore.getState().onIncoming({ id: 3, user_id: 7, sender: 'user', message: 'q', created_at: 't' })
    expect(useSupportStore.getState().adminUnread).toBe(1)
    expect(useSupportStore.getState().thread.length).toBe(0)
  })

  it('appendLocal adds an optimistic message', () => {
    useSupportStore.getState().appendLocal({ id: 9, sender: 'user', message: 'mine', created_at: 't' })
    expect(useSupportStore.getState().thread.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/zeus-terminal/client && npx vitest run src/stores/__tests__/supportStore.test.ts 2>&1 | tail -20`
Expected: FAIL — cannot resolve `../supportStore`.

- [ ] **Step 3: Write the store**

Create `client/src/stores/supportStore.ts`:

```typescript
import { create } from 'zustand'

export interface SupportMsg {
  id: number
  user_id?: number
  sender: 'user' | 'admin'
  message: string
  created_at: string
}

interface SupportStore {
  /** The current user's own conversation thread (user view). */
  thread: SupportMsg[]
  /** Unread admin replies for the current user (drives the user-side badge). */
  userUnread: number
  /** Total unread user messages for the admin (drives the admin header badge). */
  adminUnread: number

  setThread: (msgs: SupportMsg[]) => void
  appendLocal: (msg: SupportMsg) => void
  setUserUnread: (n: number) => void
  clearUserUnread: () => void
  setAdminUnread: (n: number) => void
  /** Dispatch a live WS support.message frame. Branches on sender:
   *  admin → this client is a user receiving a reply; user → this client is
   *  the admin receiving a new message (badge only). */
  onIncoming: (data: SupportMsg) => void
}

export const useSupportStore = create<SupportStore>((set, get) => ({
  thread: [],
  userUnread: 0,
  adminUnread: 0,

  setThread: (msgs) => set({ thread: msgs }),
  appendLocal: (msg) => set({ thread: [...get().thread, msg] }),
  setUserUnread: (n) => set({ userUnread: n }),
  clearUserUnread: () => set({ userUnread: 0 }),
  setAdminUnread: (n) => set({ adminUnread: n }),

  onIncoming: (data) => {
    if (data.sender === 'admin') {
      // user receives operator reply
      const exists = get().thread.some((m) => m.id === data.id)
      set({
        thread: exists ? get().thread : [...get().thread, data],
        userUnread: get().userUnread + 1,
      })
    } else {
      // admin receives a new user message → badge only
      set({ adminUnread: get().adminUnread + 1 })
    }
  },
}))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /opt/zeus-terminal/client && npx vitest run src/stores/__tests__/supportStore.test.ts 2>&1 | tail -20`
Expected: PASS, 4 tests green.

- [ ] **Step 5: Add the WS frame type**

In `client/src/types/sync.ts`, find the `WsMessage` union (frames like `{ type: 'at_update' ... }`, `{ type: 'exchange.changed' ... }`, `{ type: 'sync' }`). Add a new member to the union:

```typescript
  | { type: 'support.message'; data: { id: number; user_id?: number; sender: 'user' | 'admin'; message: string; created_at: string } }
```

(If `WsMessage` is a broad `{ type: string; data?: any }` shape rather than a discriminated union, no type change is needed — skip this step and note it.)

- [ ] **Step 6: Dispatch the frame**

In `client/src/hooks/useServerSync.ts`, inside the `wsService.subscribe((msg: WsMessage) => { ... })` callback (right after the `if (msg.type === 'exchange.changed' ...)` block, near line 277), add:

```typescript
      if (msg.type === 'support.message' && msg.data) {
        import('../stores/supportStore').then(({ useSupportStore }) => {
          useSupportStore.getState().onIncoming(msg.data as any)
        }).catch(() => {})
      }
```

- [ ] **Step 7: Typecheck + commit**

Run: `cd /opt/zeus-terminal/client && npx tsc --noEmit 2>&1 | grep -i "supportStore\|sync.ts\|useServerSync" | head; echo "tsc done"`
Expected: no errors referencing these files.

```bash
cd /opt/zeus-terminal
chown zeus:zeus client/src/stores/supportStore.ts client/src/stores/__tests__/supportStore.test.ts client/src/types/sync.ts client/src/hooks/useServerSync.ts
git add client/src/stores/supportStore.ts client/src/stores/__tests__/supportStore.test.ts client/src/types/sync.ts client/src/hooks/useServerSync.ts
git -c user.name='zeus' -c user.email='wsov2@protonmail.com' commit -m "feat(support): client support store + live WS dispatch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: User chat UI in the SUPPORT tab

**Files:**
- Create: `client/src/components/modals/SupportChat.tsx`
- Modify: `client/src/components/modals/SettingsHubModal.tsx` (render `<SupportChat/>` in the `#set-support` body, after the existing CONTACT/Email button block)
- Modify: `client/src/app.css` (amethyst styling for `#supportChat`)

- [ ] **Step 1: Write the component**

Create `client/src/components/modals/SupportChat.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { useSupportStore } from '../../stores/supportStore'

/** Live text chat with the operator. Used inside the Settings SUPPORT tab.
 *  Reuses /api/support REST + the live support.message WS frame (handled in
 *  useServerSync → supportStore). Amethyst-themed via #supportChat in app.css. */
export function SupportChat({ active }: { active: boolean }) {
  const thread = useSupportStore((s) => s.thread)
  const setThread = useSupportStore((s) => s.setThread)
  const appendLocal = useSupportStore((s) => s.appendLocal)
  const clearUserUnread = useSupportStore((s) => s.clearUserUnread)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  // Load thread when the tab becomes active; mark replies read.
  useEffect(() => {
    if (!active) return
    fetch('/api/support/thread', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => { if (j && j.ok) setThread(j.messages || []) })
      .catch(() => {})
    clearUserUnread()
  }, [active, setThread, clearUserUnread])

  // Auto-scroll to newest.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [thread, active])

  const send = async () => {
    const msg = text.trim()
    if (!msg || sending) return
    setSending(true)
    setText('')
    try {
      const r = await fetch('/api/support/send', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      })
      const j = await r.json()
      if (j && j.ok && j.msg) appendLocal(j.msg)
      else setText(msg) // restore on failure
    } catch (_) { setText(msg) }
    setSending(false)
  }

  return (
    <div id="supportChat">
      <div className="msec">LIVE CHAT WITH SUPPORT</div>
      <div className="sc-note">We're not always online — we'll reply as soon as we can.</div>
      <div className="sc-list" ref={listRef}>
        {thread.length === 0 && <div className="sc-empty">No messages yet. Say hello 👋</div>}
        {thread.map((m) => (
          <div key={m.id} className={'sc-bubble ' + (m.sender === 'user' ? 'sc-me' : 'sc-them')}>
            <div className="sc-msg">{m.message}</div>
          </div>
        ))}
      </div>
      <div className="sc-input-row">
        <textarea
          className="sc-input"
          value={text}
          placeholder="Type your message…"
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        />
        <button className="sc-send" disabled={!text.trim() || sending} onClick={send}>Send</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Render it in the SUPPORT tab**

In `client/src/components/modals/SettingsHubModal.tsx`:

Add the import near the other modal imports at the top of the file:

```tsx
import { SupportChat } from './SupportChat'
```

Then inside the `#set-support` body, immediately after the CONTACT `<div className="msec">CONTACT</div>` … Email Support `<a>` block and BEFORE `<div className="msec">REPORT A PROBLEM</div>`, insert:

```tsx
        <SupportChat active={tab === 'support'} />
```

- [ ] **Step 3: Add amethyst styling**

Append to `client/src/components/../app.css` (i.e. `client/src/app.css`):

```css
/* ── Support live chat (Settings SUPPORT tab) ── */
#supportChat { margin: 4px 0 14px; }
#supportChat .sc-note { font-size: 10px; color: #8a7ca8; margin: 2px 0 8px; }
#supportChat .sc-list {
  display: flex; flex-direction: column; gap: 6px;
  max-height: 240px; overflow-y: auto; padding: 8px;
  background: #120c1f; border: 1px solid #b07cff2a; border-radius: 10px;
}
#supportChat .sc-empty { color: #6f6390; font-size: 11px; text-align: center; padding: 18px 0; }
#supportChat .sc-bubble { max-width: 82%; padding: 6px 10px; border-radius: 10px; font-size: 12px; line-height: 1.5; word-break: break-word; }
#supportChat .sc-me { align-self: flex-end; background: linear-gradient(180deg,#6a3df0,#5326c9); color: #f3eaff; }
#supportChat .sc-them { align-self: flex-start; background: #1f1733; color: #d9c7ff; border: 1px solid #b07cff33; }
#supportChat .sc-input-row { display: flex; gap: 6px; margin-top: 8px; }
#supportChat .sc-input {
  flex: 1; resize: none; background: #160f26; color: #e6dbfa;
  border: 1px solid #b07cff3a; border-radius: 8px; padding: 7px 9px; font-size: 12px; font-family: inherit;
}
#supportChat .sc-input:focus { outline: none; border-color: #b07cff88; box-shadow: 0 0 0 2px #b07cff22; }
#supportChat .sc-send {
  align-self: stretch; padding: 0 14px; border-radius: 8px; cursor: pointer;
  background: linear-gradient(180deg,#7a4dff,#5a2fd6); color: #fff; border: none; font-size: 12px; font-weight: 600;
}
#supportChat .sc-send:disabled { opacity: .45; cursor: default; }
```

- [ ] **Step 4: Build to verify it compiles**

Run: `cd /opt/zeus-terminal/client && npm run build > /tmp/sc-build.log 2>&1; echo "exit=$?"; grep -iE "error TS|error during build" /tmp/sc-build.log | head`
Expected: `exit=0`, no errors.

- [ ] **Step 5: chown + commit (NO reload)**

```bash
cd /opt/zeus-terminal
chown -R zeus:zeus public/app
chown zeus:zeus client/src/components/modals/SupportChat.tsx client/src/components/modals/SettingsHubModal.tsx client/src/app.css
git add client/src/components/modals/SupportChat.tsx client/src/components/modals/SettingsHubModal.tsx client/src/app.css public/app
git -c user.name='zeus' -c user.email='wsov2@protonmail.com' commit -m "feat(support): user live-chat UI in Settings SUPPORT tab

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Admin inbox UI + unread badge

**Files:**
- Create: `client/src/components/admin/sections/SupportSection.tsx`
- Modify: `client/src/components/admin/AdminPage.tsx` (import the new `SupportSection` instead of the stub)
- Modify: `client/src/components/admin/sections/stubs.tsx` (remove the stub `SupportSection` export, line ~334)
- Modify: `client/src/components/layout/Header.tsx` (unread badge on admin icon, line ~192; seed badge on mount)
- Modify: `client/src/app.css` (amethyst styling for `#adminSupport`)

- [ ] **Step 1: Write the admin section**

Create `client/src/components/admin/sections/SupportSection.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { useSupportStore } from '../../../stores/supportStore'
import type { SupportMsg } from '../../../stores/supportStore'

interface Convo { user_id: number; email: string | null; last_message: string; last_at: string; unread_count: number }

/** Operator inbox: conversation list (left) + thread & reply (right).
 *  Realtime: a new user message bumps adminUnread (header badge) via WS; this
 *  panel refetches the inbox to refresh the list. Amethyst via #adminSupport. */
export function SupportSection() {
  const [convos, setConvos] = useState<Convo[]>([])
  const [activeUid, setActiveUid] = useState<number | null>(null)
  const [thread, setThread] = useState<SupportMsg[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const adminUnread = useSupportStore((s) => s.adminUnread)
  const setAdminUnread = useSupportStore((s) => s.setAdminUnread)
  const listRef = useRef<HTMLDivElement>(null)

  const loadInbox = () => {
    fetch('/api/support/inbox', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => { if (j && j.ok) { setConvos(j.conversations || []); setAdminUnread(j.totalUnread || 0) } })
      .catch(() => {})
  }

  // Initial + whenever a live message arrives (adminUnread changes).
  useEffect(loadInbox, [adminUnread])

  const openThread = (uid: number) => {
    setActiveUid(uid)
    fetch('/api/support/thread/' + uid, { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => { if (j && j.ok) { setThread(j.messages || []); loadInbox() } })
      .catch(() => {})
  }

  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight }, [thread])

  const reply = async () => {
    const msg = text.trim()
    if (!msg || sending || !activeUid) return
    setSending(true); setText('')
    try {
      const r = await fetch('/api/support/reply/' + activeUid, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      })
      const j = await r.json()
      if (j && j.ok && j.msg) setThread((t) => [...t, j.msg])
      else setText(msg)
    } catch (_) { setText(msg) }
    setSending(false)
  }

  return (
    <div id="adminSupport">
      <div className="as-cols">
        <div className="as-list">
          {convos.length === 0 && <div className="as-empty">No conversations yet.</div>}
          {convos.map((c) => (
            <div key={c.user_id}
                 className={'as-convo' + (c.user_id === activeUid ? ' as-active' : '')}
                 onClick={() => openThread(c.user_id)}>
              <div className="as-email">{c.email || ('user #' + c.user_id)}</div>
              <div className="as-snip">{c.last_message}</div>
              {c.unread_count > 0 && <span className="as-dot">{c.unread_count}</span>}
            </div>
          ))}
        </div>
        <div className="as-thread">
          {activeUid == null && <div className="as-empty">Select a conversation.</div>}
          {activeUid != null && (
            <>
              <div className="as-msgs" ref={listRef}>
                {thread.map((m) => (
                  <div key={m.id} className={'as-bubble ' + (m.sender === 'admin' ? 'as-me' : 'as-them')}>
                    {m.message}
                  </div>
                ))}
              </div>
              <div className="as-input-row">
                <textarea className="as-input" rows={2} value={text}
                          placeholder="Reply…"
                          onChange={(e) => setText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); reply() } }} />
                <button className="as-send" disabled={!text.trim() || sending} onClick={reply}>Send</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Swap the stub for the real section**

In `client/src/components/admin/AdminPage.tsx`, find the import that brings `SupportSection` from `./sections/stubs` and the line `{currentSection === 'support' && <SupportSection />}` (line ~65). Change the import to the new file:

```tsx
import { SupportSection } from './sections/SupportSection'
```

(Remove `SupportSection` from the `./sections/stubs` import list if it was imported from there.)

In `client/src/components/admin/sections/stubs.tsx`, delete the stub `export function SupportSection() { ... }` (starts line ~334) so there is no duplicate export.

- [ ] **Step 3: Badge on the admin header icon**

In `client/src/components/layout/Header.tsx`, the admin icon button is at line ~192 (`style={{ display: role === 'admin' ? undefined : 'none', position: 'relative' }} onClick={() => openModal('adminPage')}`).

Add near the top of the component body (with the other hooks):

```tsx
  const supportUnread = useSupportStore((s) => s.adminUnread)
  const setSupportUnread = useSupportStore((s) => s.setAdminUnread)
```

Import the store at the top of the file:

```tsx
import { useSupportStore } from '../../stores/supportStore'
```

Seed the badge once on mount for admins (place beside the existing `if (role !== 'admin') return` effect around line 45, or add a new effect):

```tsx
  useEffect(() => {
    if (role !== 'admin') return
    fetch('/api/support/inbox', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => { if (j && j.ok) setSupportUnread(j.totalUnread || 0) })
      .catch(() => {})
  }, [role, setSupportUnread])
```

Inside the admin icon button JSX (after the `<svg>`), add the badge:

```tsx
                {supportUnread > 0 && <span className="hdr-support-badge">{supportUnread > 9 ? '9+' : supportUnread}</span>}
```

- [ ] **Step 4: Styling**

Append to `client/src/app.css`:

```css
/* ── Admin support inbox ── */
#adminSupport .as-cols { display: flex; gap: 12px; height: 420px; }
#adminSupport .as-list { width: 230px; flex: none; overflow-y: auto; border: 1px solid #b07cff2a; border-radius: 10px; background: #120c1f; }
#adminSupport .as-convo { position: relative; padding: 9px 11px; border-bottom: 1px solid #ffffff0a; cursor: pointer; }
#adminSupport .as-convo:hover { background: #1c1430; }
#adminSupport .as-active { background: #241a3d; }
#adminSupport .as-email { font-size: 12px; color: #e6dbfa; font-weight: 600; }
#adminSupport .as-snip { font-size: 10px; color: #8a7ca8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
#adminSupport .as-dot { position: absolute; top: 9px; right: 10px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: #ff4d6d; color: #fff; font-size: 10px; line-height: 16px; text-align: center; }
#adminSupport .as-thread { flex: 1; display: flex; flex-direction: column; border: 1px solid #b07cff2a; border-radius: 10px; background: #120c1f; }
#adminSupport .as-msgs { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
#adminSupport .as-bubble { max-width: 80%; padding: 6px 10px; border-radius: 10px; font-size: 12px; line-height: 1.5; word-break: break-word; }
#adminSupport .as-me { align-self: flex-end; background: linear-gradient(180deg,#6a3df0,#5326c9); color: #f3eaff; }
#adminSupport .as-them { align-self: flex-start; background: #1f1733; color: #d9c7ff; border: 1px solid #b07cff33; }
#adminSupport .as-empty { color: #6f6390; font-size: 12px; text-align: center; padding: 26px 10px; margin: auto; }
#adminSupport .as-input-row { display: flex; gap: 6px; padding: 8px; border-top: 1px solid #ffffff0a; }
#adminSupport .as-input { flex: 1; resize: none; background: #160f26; color: #e6dbfa; border: 1px solid #b07cff3a; border-radius: 8px; padding: 7px 9px; font-size: 12px; font-family: inherit; }
#adminSupport .as-input:focus { outline: none; border-color: #b07cff88; }
#adminSupport .as-send { padding: 0 14px; border-radius: 8px; cursor: pointer; background: linear-gradient(180deg,#7a4dff,#5a2fd6); color: #fff; border: none; font-size: 12px; font-weight: 600; }
#adminSupport .as-send:disabled { opacity: .45; cursor: default; }
.hdr-support-badge { position: absolute; top: -4px; right: -4px; min-width: 15px; height: 15px; padding: 0 3px; border-radius: 8px; background: #ff4d6d; color: #fff; font-size: 9px; line-height: 15px; text-align: center; font-weight: 700; }
```

- [ ] **Step 5: Build**

Run: `cd /opt/zeus-terminal/client && npm run build > /tmp/as-build.log 2>&1; echo "exit=$?"; grep -iE "error TS|error during build" /tmp/as-build.log | head`
Expected: `exit=0`, no errors.

- [ ] **Step 6: chown + commit (NO reload)**

```bash
cd /opt/zeus-terminal
chown -R zeus:zeus public/app
chown zeus:zeus client/src/components/admin/sections/SupportSection.tsx client/src/components/admin/AdminPage.tsx client/src/components/admin/sections/stubs.tsx client/src/components/layout/Header.tsx client/src/app.css
git add client/src/components/admin/sections/SupportSection.tsx client/src/components/admin/AdminPage.tsx client/src/components/admin/sections/stubs.tsx client/src/components/layout/Header.tsx client/src/app.css public/app
git -c user.name='zeus' -c user.email='wsov2@protonmail.com' commit -m "feat(support): admin inbox section + unread badge on admin header icon

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Live verification + deploy gate

**Files:** none (verification only). Reload is GATED on operator GO.

- [ ] **Step 1: Re-run both server tests + the store test together (targeted, safe)**

Run:
```bash
cd /opt/zeus-terminal && npx jest tests/unit/support-db.test.js tests/unit/support-route.test.js --runInBand --forceExit > /tmp/sup-server.log 2>&1; tail -15 /tmp/sup-server.log
cd /opt/zeus-terminal/client && npx vitest run src/stores/__tests__/supportStore.test.ts 2>&1 | tail -10
```
Expected: all green.

- [ ] **Step 2: STOP — request operator GO for the one reload**

The route + DB migration are live only after `pm2 reload`. Per the operator's standing rule (protect the brain soak), do NOT reload autonomously. Post a short message: tests green, ready for the single reload — asking for GO and the preferred window.

- [ ] **Step 3: On GO — reload + verify migration applied**

```bash
cd /opt/zeus-terminal && zpm2 reload zeus --update-env   # use the project's pm2 wrapper if present; else: sudo -u zeus pm2 reload zeus
sleep 4
sqlite3 data/zeus.db "SELECT name FROM _migrations WHERE name LIKE '051%';"   # expect: 051_support_messages
sqlite3 data/zeus.db ".tables" | grep support_messages
```
Expected: migration row present, table exists. Confirm brain came back (pm2 logs show normal startup, no GLOBAL_HALT).

- [ ] **Step 4: Playwright end-to-end (after reload)**

Mint an admin JWT and a normal-user JWT (the project's standard mint pattern). As a normal user: open Settings → SUPPORT → type a message → Send; assert the bubble appears (`#supportChat .sc-me`). As admin (separate context, admin JWT): open the admin page → Support section; assert the conversation appears with an unread dot; open it; assert the user's message shows; type a reply → Send. Back as the user: assert the admin reply arrives live (`#supportChat .sc-them` contains the reply text) without reload. Assert the admin header badge (`.hdr-support-badge`) renders for admin and is absent for a non-admin role. Verify amethyst styling on `#supportChat` and `#adminSupport`. Delete any screenshots afterward.

- [ ] **Step 5: Final commit (if any verify-driven tweaks) + push**

```bash
cd /opt/zeus-terminal
git add -A
git -c user.name='zeus' -c user.email='wsov2@protonmail.com' commit -m "test(support): live end-to-end verification of support chat" --allow-empty
git push
```

---

## Self-Review

**Spec coverage:**
- Persisted history → Task 1 (`support_messages` + helpers). ✓
- User send / thread / unread → Task 2 endpoints `/send`, `/thread`, `/unread`. ✓
- Admin inbox / thread / reply with admin guard → Task 2 `/inbox`, `/thread/:id`, `/reply/:id`. ✓
- Real-time both directions → `wsBroadcastToUser` push (Task 2) + client dispatch (Task 3). ✓
- User chat UI in SUPPORT tab, email kept → Task 4 (`SupportChat` added alongside existing Email + categories). ✓
- Admin inbox UI + unread badge → Task 5 (`SupportSection` + `.hdr-support-badge`). ✓
- Offline limitation messaging → Task 4 `sc-note` "We're not always online…". ✓
- Text-only, no uploads → no file input anywhere. ✓
- One reload, on GO; targeted tests only → Task 6 gate. ✓

**Type consistency:** `SupportMsg` (fields `id, user_id?, sender, message, created_at`) defined once in `supportStore.ts` and imported by `SupportChat.tsx` and `SupportSection.tsx`. Store actions referenced consistently: `setThread`, `appendLocal`, `clearUserUnread`, `setAdminUnread`, `onIncoming`. Server row shape (`read_by_admin`/`read_by_user` ints) matches the DB helper and the route mock. WS frame `{type:'support.message', data: row}` identical on server push and client dispatch.

**Placeholder scan:** No TBD/TODO; every code step shows full code; every run step shows the exact command + expected result. The only conditional is Task 3 Step 5 (skip the type-union edit if `WsMessage` is a loose `{type:string;data?:any}`) — explicitly handled, not a placeholder.

**Scope:** Single subsystem (support chat), one implementation plan. No decomposition needed.

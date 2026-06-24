# User Profile — Flip-Header (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each user a self-editable profile (photo, display name, @username, accent colour, tagline) revealed by a 3D-flip of the existing top header — the trading header stays untouched (front), the profile is the back.

**Architecture:** New columns on the `users` table hold the profile. A `/api/profile` route reads (own + public) and writes (validated + whitelisted + username-unique) it. On the client, an avatar helper re-encodes uploads through a canvas (anti-malware), a Zustand `profileStore` loads/saves, the `appConfirm` dialog gains a text-input mode for editing fields, and a `FlipHeader` wraps the current `<Header/>` (front) + a header-styled `<ProfilePanel/>` (back) with a CSS 3D flip plus a luxe gold-neon "wow" sweep.

**Tech Stack:** Node CommonJS + better-sqlite3 (server), React + Vite + Zustand (client), jest + supertest (server tests), vitest (client tests).

**Rules (operator, non-negotiable):** Don't break the app. Header stays exactly the same size — it only flips. Before starting, take a git checkpoint; if anything breaks during a task, **revert immediately** to the last green commit. TDD for logic. Commit per task. Validate `server/version.js` with `node -e` before any reload (no apostrophes in single-quote changelog). Run jest/node as `sudo -u zeus`, never root. If a new need is discovered mid-implementation, **stop and ask the operator** before adding it.

---

## File Structure

**Server (create):**
- `server/routes/profile.js` — GET own profile, GET `/:userId` public profile, POST save.

**Server (modify):**
- `server/services/database.js` — migration (new `users` columns) + prepared statements (`setUserProfile`, `getUserProfileById`, `findUserByUsername`).
- `server/middleware/validate.js` — add `validateProfileBody` + `PROFILE_SHAPE`.
- `server.js` — register `app.use('/api/profile', require('./server/routes/profile'))`.
- `server/version.js` — version bump + changelog at the end.

**Client (create):**
- `client/src/profile/avatar.ts` — `reencodeAvatar(file)`, `initialsAvatar(name, color)`.
- `client/src/profile/validate.ts` — `validateUsername(s)` (mirrors server).
- `client/src/stores/profileStore.ts` — load/save profile.
- `client/src/components/layout/FlipHeader.tsx` — flip container (front=Header, back=ProfilePanel).
- `client/src/components/layout/ProfilePanel.tsx` — the profile "back" panel.

**Client (modify):**
- `client/src/components/common/confirmDialog.ts` + `ConfirmDialog.tsx` — add a `text` input mode.
- `client/src/components/layout/Header.tsx` — make the `.brand` logo a flip trigger (callback prop); show avatar+name instead of the bare email.
- wherever `<Header />` is mounted — render `<FlipHeader />` instead.
- `client/src/app.css` — flip + wow-sweep styles.

---

## Task 1: DB migration + user-profile helpers

**Files:**
- Modify: `server/services/database.js` (migrate block + prepared statements)
- Test: `tests/unit/profile-db.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/profile-db.test.js
const path = require('path');
process.env.ZEUS_DB_PATH = path.join('/tmp', 'zeus-profile-test-' + Date.now() + '.db');
const db = require('../../server/services/database');

test('users table has profile columns after migrate', () => {
  const cols = db.raw().prepare("PRAGMA table_info(users)").all().map(c => c.name);
  expect(cols).toEqual(expect.arrayContaining(['display_name', 'username', 'avatar', 'accent_color', 'tagline']));
});

test('setUserProfile + getUserProfileById round-trip', () => {
  const uid = db.createUser ? db.createUser('p1@test.io', 'hash', 'user') : 1;
  db.setUserProfile(uid, { display_name: 'Ovi', username: 'zeus_ovi', avatar: 'data:image/png;base64,AAA', accent_color: '#f0c040', tagline: 'hi' });
  const p = db.getUserProfileById(uid);
  expect(p.username).toBe('zeus_ovi');
  expect(p.display_name).toBe('Ovi');
});

test('findUserByUsername finds the row (case-insensitive)', () => {
  expect(db.findUserByUsername('ZEUS_OVI')).toBeTruthy();
  expect(db.findUserByUsername('nobody_x')).toBeFalsy();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `sudo -u zeus npx jest tests/unit/profile-db.test.js --forceExit --runInBand`
Expected: FAIL — columns missing / `db.setUserProfile is not a function`.

- [ ] **Step 3: Add the migration**

In `server/services/database.js`, inside the `migrate()` numbered block (follow the existing `ALTER TABLE users ADD COLUMN` pattern, each wrapped so re-runs are safe — copy the surrounding try/guard style already used for `pin_hash`):

```javascript
db.exec("ALTER TABLE users ADD COLUMN display_name TEXT DEFAULT NULL");
db.exec("ALTER TABLE users ADD COLUMN username TEXT DEFAULT NULL");
db.exec("ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT NULL");
db.exec("ALTER TABLE users ADD COLUMN accent_color TEXT DEFAULT NULL");
db.exec("ALTER TABLE users ADD COLUMN tagline TEXT DEFAULT NULL");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL");
```

- [ ] **Step 4: Add prepared statements + exported helpers**

In the prepared-statements object (where `updateEmail` etc. live):

```javascript
setUserProfile: db.prepare("UPDATE users SET display_name=?, username=?, avatar=?, accent_color=?, tagline=?, updated_at=datetime('now') WHERE id=?"),
getUserProfileById: db.prepare("SELECT id, display_name, username, avatar, accent_color, tagline FROM users WHERE id=?"),
findUserByUsername: db.prepare("SELECT id, username FROM users WHERE LOWER(username)=LOWER(?)"),
```

And export wrappers next to the other `db.xxx` exports:

```javascript
setUserProfile: (id, p) => stmts.setUserProfile.run(p.display_name ?? null, p.username ?? null, p.avatar ?? null, p.accent_color ?? null, p.tagline ?? null, id),
getUserProfileById: (id) => stmts.getUserProfileById.get(id) || null,
findUserByUsername: (u) => (u ? stmts.findUserByUsername.get(u) : null) || null,
```

(Match the exact wrapper/closure style already in the file — e.g. how `setUserTelegram` is exposed.)

- [ ] **Step 5: Run tests to verify pass**

Run: `sudo -u zeus npx jest tests/unit/profile-db.test.js --forceExit --runInBand`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add server/services/database.js tests/unit/profile-db.test.js
git commit -m "feat(profile): users table profile columns + db helpers"
```

---

## Task 2: Server profile validator

**Files:**
- Modify: `server/middleware/validate.js`
- Test: `tests/unit/profile-validate.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/profile-validate.test.js
const { validateProfileFields } = require('../../server/middleware/validate');

test('accepts a clean profile', () => {
  const r = validateProfileFields({ display_name: 'Ovi', username: 'zeus_ovi', accent_color: '#f0c040', tagline: 'hi', avatar: 'data:image/png;base64,iVBORw0KGgo=' });
  expect(r.ok).toBe(true);
});
test('rejects bad username chars', () => {
  expect(validateProfileFields({ username: 'ov i!' }).ok).toBe(false);
});
test('rejects oversize avatar', () => {
  const big = 'data:image/png;base64,' + 'A'.repeat(400000);
  expect(validateProfileFields({ avatar: big }).ok).toBe(false);
});
test('rejects non-image avatar data uri', () => {
  expect(validateProfileFields({ avatar: 'data:text/html;base64,AAA' }).ok).toBe(false);
});
test('rejects bad accent color', () => {
  expect(validateProfileFields({ accent_color: 'red; drop table' }).ok).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `sudo -u zeus npx jest tests/unit/profile-validate.test.js --forceExit --runInBand`
Expected: FAIL — `validateProfileFields is not a function`.

- [ ] **Step 3: Implement the validator**

In `server/middleware/validate.js`:

```javascript
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const AVATAR_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const AVATAR_MAX_LEN = 300000; // ~220KB decoded — generous for a 128px image

function validateProfileFields(p) {
  if (!p || typeof p !== 'object') return { ok: false, error: 'invalid body' };
  if (p.display_name != null && (typeof p.display_name !== 'string' || p.display_name.length > 40)) return { ok: false, error: 'display_name' };
  if (p.username != null && p.username !== '' && !USERNAME_RE.test(p.username)) return { ok: false, error: 'username' };
  if (p.accent_color != null && p.accent_color !== '' && !HEX_COLOR_RE.test(p.accent_color)) return { ok: false, error: 'accent_color' };
  if (p.tagline != null && (typeof p.tagline !== 'string' || p.tagline.length > 80)) return { ok: false, error: 'tagline' };
  if (p.avatar != null && p.avatar !== '') {
    if (typeof p.avatar !== 'string' || p.avatar.length > AVATAR_MAX_LEN || !AVATAR_RE.test(p.avatar)) return { ok: false, error: 'avatar' };
  }
  return { ok: true };
}
module.exports.validateProfileFields = validateProfileFields;
```

- [ ] **Step 4: Run to verify pass**

Run: `sudo -u zeus npx jest tests/unit/profile-validate.test.js --forceExit --runInBand`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/middleware/validate.js tests/unit/profile-validate.test.js
git commit -m "feat(profile): server-side profile field validator (anti-oversize, image-only avatar)"
```

---

## Task 3: Server `/api/profile` route

**Files:**
- Create: `server/routes/profile.js`
- Modify: `server.js` (register route)
- Test: `tests/unit/profile-route.test.js`

- [ ] **Step 1: Write the route**

```javascript
// server/routes/profile.js
const express = require('express');
const router = express.Router();
const db = require('../services/database');
const { validateProfileFields } = require('../middleware/validate');
const PUBLIC = ['id', 'display_name', 'username', 'avatar', 'accent_color', 'tagline'];

function pick(row, keys) { const o = {}; if (row) for (const k of keys) o[k] = row[k] ?? null; return o; }

// own full profile
router.get('/', (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'auth' });
  res.json({ ok: true, profile: pick(db.getUserProfileById(req.user.id), PUBLIC) });
});

// public profile of any user — public fields only, never email
router.get('/:userId', (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'auth' });
  const id = parseInt(req.params.userId, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
  res.json({ ok: true, profile: pick(db.getUserProfileById(id), PUBLIC) });
});

// save own profile
router.post('/', (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'auth' });
  const body = (req.body && req.body.profile) || {};
  const v = validateProfileFields(body);
  if (!v.ok) return res.status(400).json({ ok: false, error: 'invalid: ' + v.error });
  // username uniqueness (allow keeping your own)
  if (body.username) {
    const taken = db.findUserByUsername(body.username);
    if (taken && taken.id !== req.user.id) return res.status(409).json({ ok: false, error: 'username_taken' });
  }
  const cur = db.getUserProfileById(req.user.id) || {};
  db.setUserProfile(req.user.id, {
    display_name: body.display_name ?? cur.display_name,
    username: (body.username ?? cur.username) || null,
    avatar: body.avatar ?? cur.avatar,
    accent_color: body.accent_color ?? cur.accent_color,
    tagline: body.tagline ?? cur.tagline,
  });
  res.json({ ok: true, profile: pick(db.getUserProfileById(req.user.id), PUBLIC) });
});

module.exports = router;
```

- [ ] **Step 2: Register the route in `server.js`**

After the other `app.use('/api/...', require(...))` lines (it runs behind the existing session-auth + CSRF middleware, like `/api/sync`):

```javascript
app.use('/api/profile', require('./server/routes/profile'));
```

- [ ] **Step 3: Write the integration test**

```javascript
// tests/unit/profile-route.test.js
const request = require('supertest');
// Build a tiny express app mounting the router with a fake req.user, mirroring how
// admin-flags-protected.test.js stubs auth. (Copy that file's app-bootstrap pattern.)
// Assert: POST {profile:{username:'zeus_ovi',display_name:'Ovi'}} -> 200; GET '/' returns it;
// second user POST same username -> 409; GET '/:id' never returns an email field;
// POST oversize avatar -> 400.
```
(Fill the test body using the exact bootstrap from `tests/unit/admin-flags-protected.test.js` — same supertest + stubbed `req.user` approach.)

- [ ] **Step 4: Run to verify pass**

Run: `sudo -u zeus npx jest tests/unit/profile-route.test.js --forceExit --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/profile.js server.js tests/unit/profile-route.test.js
git commit -m "feat(profile): /api/profile route (own + public read, validated unique save)"
```

---

## Task 4: Client avatar helper (anti-malware re-encode + initials)

**Files:**
- Create: `client/src/profile/avatar.ts`
- Test: `client/src/profile/avatar.test.ts`

- [ ] **Step 1: Write the failing test (vitest)**

```typescript
import { describe, it, expect } from 'vitest'
import { initialsAvatar } from './avatar'
describe('initialsAvatar', () => {
  it('builds an SVG data-uri with the initials', () => {
    const d = initialsAvatar('Ovi Zeus', '#f0c040')
    expect(d).toMatch(/^data:image\/svg\+xml/)
    expect(decodeURIComponent(d)).toContain('OZ')
  })
  it('falls back to ? for empty name', () => {
    expect(decodeURIComponent(initialsAvatar('', '#fff'))).toContain('?')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd client && sudo -u zeus bash -lc 'npx vitest run src/profile/avatar.test.ts'`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// client/src/profile/avatar.ts
export function initialsAvatar(name: string, color: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  const ini = parts.length ? parts.slice(0, 2).map(p => p[0].toUpperCase()).join('') : '?'
  const c = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#888'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><circle cx="64" cy="64" r="64" fill="${c}"/><text x="64" y="82" font-size="52" font-family="monospace" fill="#000" text-anchor="middle" font-weight="700">${ini}</text></svg>`
  return 'data:image/svg+xml,' + encodeURIComponent(svg)
}

// Re-encode an uploaded file through a canvas: square-crop + resize to 128px + re-export
// as a clean PNG. Re-export keeps ONLY pixels, dropping EXIF/metadata/any embedded payload.
export function reencodeAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('not an image'))
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const side = Math.min(img.width, img.height)
      const sx = (img.width - side) / 2, sy = (img.height - side) / 2
      const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128
      const ctx = cv.getContext('2d'); if (!ctx) return reject(new Error('no ctx'))
      ctx.drawImage(img, sx, sy, side, side, 0, 0, 128, 128)
      resolve(cv.toDataURL('image/png'))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')) }
    img.src = url
  })
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd client && sudo -u zeus bash -lc 'npx vitest run src/profile/avatar.test.ts'`
Expected: PASS (2 tests). (`reencodeAvatar` needs a DOM canvas — verified manually/live in Task 9; vitest covers `initialsAvatar`.)

- [ ] **Step 5: Commit**

```bash
git add client/src/profile/avatar.ts client/src/profile/avatar.test.ts
git commit -m "feat(profile): avatar helper — canvas re-encode (anti-malware) + initials fallback"
```

---

## Task 5: Client username validator (mirror of server)

**Files:**
- Create: `client/src/profile/validate.ts`
- Test: `client/src/profile/validate.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { validateUsername } from './validate'
describe('validateUsername', () => {
  it('accepts zeus_ovi', () => expect(validateUsername('zeus_ovi')).toBe(true))
  it('rejects spaces/symbols', () => expect(validateUsername('ov i!')).toBe(false))
  it('rejects too short', () => expect(validateUsername('ab')).toBe(false))
})
```

- [ ] **Step 2: Run, expect FAIL.** `cd client && sudo -u zeus bash -lc 'npx vitest run src/profile/validate.test.ts'`

- [ ] **Step 3: Implement**

```typescript
// client/src/profile/validate.ts
export function validateUsername(s: string): boolean {
  return /^[a-zA-Z0-9_]{3,20}$/.test(s || '')
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** — `git add client/src/profile/validate.ts client/src/profile/validate.test.ts && git commit -m "feat(profile): client username validator"`

---

## Task 6: Add a text-input mode to appConfirm

**Files:**
- Modify: `client/src/components/common/confirmDialog.ts`, `client/src/components/common/ConfirmDialog.tsx`
- Test: `client/src/components/common/confirmDialog.test.ts`

- [ ] **Step 1: Failing test (store-level)**

```typescript
import { describe, it, expect } from 'vitest'
import { useConfirmDialog, appConfirm } from './confirmDialog'
describe('appConfirm text mode', () => {
  it('resolves with the typed text on confirm', async () => {
    const p = appConfirm({ title: 'Name', body: '', text: { label: 'Name', initial: 'Ovi' } })
    useConfirmDialog.getState().settle(true, undefined, 'Ovi2')
    expect(await p).toEqual({ confirmed: true, text: 'Ovi2' })
  })
})
```

- [ ] **Step 2: Run, expect FAIL** (signature mismatch).

- [ ] **Step 3: Extend the store + dialog**

In `confirmDialog.ts`: add `text?: { label: string; placeholder?: string; initial?: string; maxLength?: number }` to `ConfirmReq`; change `_resolve`/`settle`/`open` result type to `{ confirmed: boolean; amount?: number; text?: string }`; `settle(confirmed, amount, text)`.

In `ConfirmDialog.tsx`: when `req.text` is present, render a text `<input id="app-confirm-text">` (default value `req.text.initial`, `maxLength`), and on CONFIRM call `settle(true, undefined, inputEl.value)`.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** — `git add client/src/components/common/confirmDialog.ts client/src/components/common/ConfirmDialog.tsx client/src/components/common/confirmDialog.test.ts && git commit -m "feat(confirm): add text-input mode to appConfirm"`

---

## Task 7: profileStore (load + save)

**Files:**
- Create: `client/src/stores/profileStore.ts`
- Test: `client/src/stores/profileStore.test.ts`

- [ ] **Step 1: Failing test** — mock `rawRequest`; assert `load()` populates `profile`, `save(patch)` POSTs and updates `profile`, a 409 sets `error: 'username_taken'`. (Follow the mock style in an existing `*Store.test.ts`.)

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** — a Zustand store:

```typescript
// client/src/stores/profileStore.ts
import { create } from 'zustand'
import { userApi } from '../services/api' // add profile methods there (rawRequest GET/POST '/api/profile')
export interface Profile { id?: number; display_name?: string|null; username?: string|null; avatar?: string|null; accent_color?: string|null; tagline?: string|null }
interface S { profile: Profile; loaded: boolean; error: string|null; load: () => Promise<void>; save: (p: Partial<Profile>) => Promise<boolean> }
export const useProfileStore = create<S>((set, get) => ({
  profile: {}, loaded: false, error: null,
  load: async () => { try { const r = await userApi.getProfile(); if (r && r.ok) set({ profile: r.profile || {}, loaded: true }) } catch (_) {} },
  save: async (p) => {
    try { const r = await userApi.saveProfile({ ...get().profile, ...p })
      if (r && r.ok) { set({ profile: r.profile, error: null }); return true }
      set({ error: (r && r.error) || 'save_failed' }); return false
    } catch (e: any) { set({ error: String(e?.message || e) }); return false }
  },
}))
```

Add `getProfile`/`saveProfile` to `client/src/services/api.ts` `userApi` using `rawRequest('GET'|'POST', '/api/profile', body)`.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** — `git add client/src/stores/profileStore.ts client/src/services/api.ts client/src/stores/profileStore.test.ts && git commit -m "feat(profile): profileStore + api methods"`

---

## Task 8: FlipHeader container (the 3D flip)

**Files:**
- Create: `client/src/components/layout/FlipHeader.tsx`
- Modify: `client/src/app.css`, the mount site of `<Header/>`, `Header.tsx` (logo callback)

- [ ] **Step 1: Implement the flip container**

```tsx
// client/src/components/layout/FlipHeader.tsx
import { useState } from 'react'
import { Header } from './Header'
import { ProfilePanel } from './ProfilePanel'
export function FlipHeader() {
  const [flipped, setFlipped] = useState(false)
  return (
    <div className={'flip-header' + (flipped ? ' is-flipped' : '')}>
      <div className="flip-face flip-front"><Header onLogoClick={() => setFlipped(true)} /></div>
      <div className="flip-face flip-back"><ProfilePanel onAvatarClick={() => setFlipped(false)} /></div>
    </div>
  )
}
```

- [ ] **Step 2: CSS — same height, 3D flip, wow sweep**

In `client/src/app.css` (keep the header's existing height — measure it; the faces are absolutely stacked):

```css
.flip-header { position: relative; perspective: 1200px; }
.flip-header .flip-face { backface-visibility: hidden; transition: transform .55s cubic-bezier(.4,0,.2,1); }
.flip-header .flip-front { transform: rotateX(0deg); }
.flip-header .flip-back  { position: absolute; inset: 0; transform: rotateX(180deg); }
.flip-header.is-flipped .flip-front { transform: rotateX(-180deg); }
.flip-header.is-flipped .flip-back  { transform: rotateX(0deg); }
/* [wow — operator chose #4 GLASS-SHINE] crystal/glass shimmer sweep during the flip */
.flip-header::after { content:''; position:absolute; inset:0; pointer-events:none; opacity:0; mix-blend-mode:screen;
  background:linear-gradient(115deg, transparent 38%, rgba(255,255,255,.10) 46%, rgba(255,255,255,.55) 50%, rgba(255,255,255,.10) 54%, transparent 62%); }
.flip-header.is-flipping::after { animation: zeusGlassShine .6s ease-out; }
@keyframes zeusGlassShine { 0%{opacity:0; transform:translateX(-70%) skewX(-12deg)} 35%{opacity:1} 100%{opacity:0; transform:translateX(70%) skewX(-12deg)} }
```

(Toggle `is-flipping` for ~600ms in FlipHeader on each flip to fire the sweep.)

- [ ] **Step 3: Header logo → flip trigger**

In `Header.tsx`, accept an optional `onLogoClick?: () => void` prop and put `onClick={onLogoClick}` + `cursor:pointer` on the `.brand` logo (line ~172). Do NOT change anything else in the header.

- [ ] **Step 4: Mount FlipHeader instead of Header** at the header's current mount site (search for `<Header` in `client/src/`). Keep everything else identical.

- [ ] **Step 5: tsc + build**

Run: `cd client && sudo -u zeus bash -lc 'npx tsc --noEmit' && sudo -u zeus bash -lc 'npm run build'`
Expected: 0 errors, `✓ built`.

- [ ] **Step 6: Commit** — `git add -A client/src/components/layout client/src/app.css && git commit -m "feat(profile): FlipHeader 3D-flip container + luxe gold sweep"`

---

## Task 9: ProfilePanel (the editable back)

**Files:**
- Create: `client/src/components/layout/ProfilePanel.tsx`

- [ ] **Step 1: Implement** — header-styled panel using `useProfileStore`, `reencodeAvatar`, `initialsAvatar`, `appConfirm` (text mode), `validateUsername`:
  - Avatar: a hidden `<input type=file accept="image/*">`; on change → `reencodeAvatar(file)` → `save({ avatar })`. When `profile.avatar` empty, show `initialsAvatar(display_name, accent_color)`.
  - Name / @username / tagline: each shown as text; clicking opens `appConfirm({ title:'Display name', body:'', text:{ label:'Name', initial: current } })`; for username also run `validateUsername` before `save`, and surface a `username_taken` error from the store.
  - Accent: a few colour swatches (or `<input type=color>`) → `save({ accent_color })`.
  - The avatar (or a back-arrow) calls `onAvatarClick` to flip back.

- [ ] **Step 2: tsc + build** — `cd client && sudo -u zeus bash -lc 'npx tsc --noEmit' && sudo -u zeus bash -lc 'npm run build'` → 0 errors, built.

- [ ] **Step 3: Commit** — `git add client/src/components/layout/ProfilePanel.tsx && git commit -m "feat(profile): ProfilePanel — inline edit via dialogs, avatar upload"`

---

## Task 10: Show avatar+name on the front header + load on boot

**Files:**
- Modify: `Header.tsx` (replace the bare `#userEmail` span with avatar+display name; keep email as a tooltip/fallback), the boot sequence (call `useProfileStore.getState().load()` once after auth).

- [ ] **Step 1: Implement** — in `Header.tsx`, render a small round avatar (`profile.avatar || initialsAvatar(display_name||email, accent_color)`) + `display_name || email`. Load the profile once on boot (e.g. in the same place `/auth/me` succeeds, call `useProfileStore.getState().load()`).
- [ ] **Step 2: tsc + build** → 0 errors, built.
- [ ] **Step 3: Commit** — `git commit -am "feat(profile): show avatar + display name on the header"`

---

## Task 11: Live verification + deploy

- [ ] **Step 1: Live-verify (Playwright, mobile viewport)** with a minted session:
  - App boots, header unchanged (front).
  - Click `.brand` (Zeus logo) → header flips to ProfilePanel (same size) + gold sweep plays.
  - Set name via dialog → saved; upload a photo → re-encoded, shows; set @username (dup → "taken" message) ; pick accent.
  - Click avatar → flips back; front header now shows avatar + name.
  - Reload (fresh storage) → profile loads from server + displays. Front trading header still fully functional (chart, prices, settings).
- [ ] **Step 2: Bump `server/version.js`** (build +1, no-apostrophe changelog) — validate with `sudo -u zeus node -e "require('./server/version.js')"` BEFORE reload.
- [ ] **Step 3: Deploy** — `chown -R zeus:zeus public/app; pm2 reload zeus --update-env` (chained after a passing validate); health check; `git push`.

---

## The "wow" effect (operator: pick / confirm)

**Operator chose #4 — GLASS-SHINE (crystal/glass shimmer).** Implemented in Task 8 CSS: a translucent
white highlight sweeps diagonally across the bar during the 0.6s flip (`mix-blend-mode: screen`, skewed),
like light catching glass. Elegant, GPU-friendly, zero perf risk. Tunable later if desired.

---

## Backup / safety (every task)

- Before starting: `git rev-parse HEAD` recorded as the green checkpoint; the header mount is wrapped, not rewritten, so the trading header is never at risk.
- If any task breaks the app (tsc red, build fail, or live regression): `git reset --hard <last green commit>` + rebuild — immediate revert, then re-approach.
- Client-only tasks need no server reload; server tasks reload only after `node -e` validation passes.

---

## Out of scope (Phase 2 / 3 — separate plans)

- Phase 2: social surfaces (leaderboard / admin / support avatars, OMEGA greeting by name) via `GET /api/profile/:id`.
- Phase 3: referral system (unique code tied to the invite flow + benefits).

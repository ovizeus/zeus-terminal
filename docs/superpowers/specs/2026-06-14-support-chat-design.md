# Live Support Chat — Design Spec

**Date:** 2026-06-14
**Status:** Approved (operator GO 2026-06-14). Build now; `pm2 reload` only on explicit operator GO.
**Owner:** Zeus Terminal operator (single admin)

## Goal

Give every user a one-to-one live text chat with the operator (admin), reachable from
Settings → SUPPORT. Messages the user sends appear in real time in an admin-only inbox
with an unread badge; the operator replies and the user sees it live. History persists in
the DB so nothing is lost across reload/logout. The existing mailto email buttons stay as
a fallback.

## Non-goals (v1)

- **No file/image uploads.** Text only. (Add later if needed.)
- **No external push (Telegram/email-on-new-message).** Operator sees messages when they
  open Zeus (in-app badge). Telegram is unconfigured project-wide; deferred.
- **No 24/7 guarantee.** Single operator on mobile. UX sets the expectation: "we're not
  always online — we'll reply as soon as we can."
- No multi-agent / multiple support staff. One admin (role `admin`).

## Constraints

- **Server-side change → one `pm2 reload`** (brain restarts once). All recent work was
  deliberately client-only to protect the multi-scan brain soak heading to the
  SERVER_BRAIN flip. Code is built now (zero soak impact — local build only); reload
  happens only on explicit operator GO in a chosen window.
- Live VPS runs as user `zeus`, pm2 app `zeus`, port 3000. Hetzner IP is ban-prone →
  minimise reloads (this feature = exactly one).
- UI strings in English; conversation with operator in Romanian.
- Money-path discipline does not apply (no order/exchange path touched), but TDD still
  applies to the new server route + client logic.
- NEVER run full jest on the live VPS (starves brain → GLOBAL_HALT). Server tests:
  targeted `jest <support test> --runInBand --forceExit` only. Client: `vitest run <file>`.

## Architecture (reuses existing infra)

### Data model — new table `support_messages`

```sql
CREATE TABLE IF NOT EXISTS support_messages (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL,
  sender        TEXT NOT NULL CHECK(sender IN ('user','admin')),
  message       TEXT NOT NULL,
  read_by_admin INTEGER NOT NULL DEFAULT 0,
  read_by_user  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_support_user   ON support_messages(user_id, id);
CREATE INDEX IF NOT EXISTS idx_support_unread ON support_messages(read_by_admin) WHERE read_by_admin = 0;
```

Added via the existing `migrate('NNN_support_messages', () => db.exec(...))` pattern in
`server/database.js`. Additive only — no change to existing tables.

`read_by_user` flags admin→user messages the user hasn't seen yet (drives the user-side
"Support replied" badge). `read_by_admin` flags user→admin messages the operator hasn't
seen (drives the admin inbox badge).

### Server — new route module `server/routes/support.js`

Mounted in `server.js`: `app.use('/api/support', require('./server/routes/support'))`,
after `sessionAuth`. Admin id resolved once (the single `role='admin'` user).

User endpoints (`_requireAuth`):
- `POST /api/support/send` — body `{ message }`. Validate (non-empty, length cap e.g.
  2000 chars, trim). Insert `sender='user'`. Push live to admin sockets via
  `app.locals.wsBroadcastToUser(adminId, { type:'support.message', data:{ ... } })`.
  Return the saved row.
- `GET  /api/support/thread` — caller's own messages (ordered). Marks admin→user
  messages `read_by_user=1`.
- `GET  /api/support/unread` — count of unread admin→user messages for the caller
  (drives user badge on load / when WS down).

Admin endpoints (`_requireAuth` + `_requireAdmin`):
- `GET  /api/support/inbox` — list of `{ user_id, email, last_message, last_at,
  unread_count }` grouped per user, ordered by most recent. Plus a top-level
  `total_unread`.
- `GET  /api/support/thread/:userId` — full thread for that user. Marks that user's
  user→admin messages `read_by_admin=1`.
- `POST /api/support/reply/:userId` — body `{ message }`. Insert `sender='admin'`.
  Push live to that user via `wsBroadcastToUser(userId, { type:'support.message', ... })`.

WS message type `support.message` is additive to the existing typed router in `server.js`
(no structural change to the WS server). Clients already connect with the `zeus_token`
cookie and per-user socket tracking exists.

### Client — user UI (SettingsHubModal SUPPORT tab)

New "💬 Live Chat with Support" section under the existing Email button:
- Scrollable message list (amethyst bubbles: user right, admin left).
- Textarea + Send button (Enter to send, Shift+Enter newline; disabled while empty).
- Onboarding note: "We're not always online — we'll reply as soon as we can."
- On open: `GET /thread`. On send: `POST /send`, optimistic append. Live inbound via WS
  `support.message` handler appends + (if tab not on SUPPORT) shows a small badge/toast
  "Support replied".
- New store slice (e.g. `useSupportStore`) holds messages + unread count; WS handler
  dispatches into it. Keep the slice small and single-purpose.

### Client — admin UI (new modal `SupportInboxModal`)

- Admin-only header icon with unread badge (the "1"). Rendered only when
  `user.role === 'admin'`. Badge = `total_unread` from `/inbox` + live WS increments.
- Modal: left = conversation list (email + last message snippet + unread dot); right =
  selected thread + reply input. Amethyst theme, scoped to the modal id.
- On open: `GET /inbox`. On select: `GET /thread/:userId` (marks read, clears that user's
  dot). On reply: `POST /reply/:userId`, optimistic append. Live inbound WS increments the
  right conversation + badge + toast.

### Notifications

- Admin badge: header icon count, updated on `/inbox` load and live via WS.
- User badge: small indicator when an unread admin reply exists, cleared when they open
  the chat. Reuse existing `toast()` from `marketDataHelpers.ts`.
- No external push in v1 (documented limitation above).

## Error handling

- Empty / whitespace-only / over-length messages rejected server-side (and disabled
  client-side).
- WS down → client falls back to the REST endpoints (`/thread`, `/unread`) on open and on
  a light interval; no message is lost because persistence is the source of truth.
- Non-admin hitting admin endpoints → 403 via `_requireAdmin` (same pattern as
  `server/routes/admin.js`).
- DB write failure → 500 with `{ ok:false }`; client shows a non-destructive error toast
  and keeps the unsent text in the input.

## Testing

- **Server (jest, targeted only):** insert/read/unread-count, `/send` persists +
  broadcasts (mock `wsBroadcastToUser`), `/reply` persists + broadcasts, `_requireAdmin`
  blocks non-admins (403), thread read-marking flips flags, length/empty validation.
- **Client (vitest):** support store reducer (append, unread inc/clear), message render
  ordering, send disabled-when-empty, WS `support.message` handler dispatch.
- **Live verification (Playwright):** as a normal user send a message → as admin (minted
  admin JWT) see it in inbox with badge → reply → confirm user thread shows it. Check
  amethyst styling. Verify admin icon hidden for non-admin role.

## Deployment

1. Build client (`cd client && npm run build`) — no reload, zero soak impact.
2. `chown -R zeus:zeus public/app` + chown touched server/client source files.
3. Run targeted server + client tests green.
4. **WAIT for explicit operator GO**, then single `pm2 reload zeus` in the chosen window.
5. Verify live post-reload; commit + push.

## Open / deferred

- Telegram (or web-push) ping to operator on new message — deferred, separate feature.
- Image/screenshot attachments — deferred.
- Typing indicators / read receipts beyond unread badges — out of scope v1.

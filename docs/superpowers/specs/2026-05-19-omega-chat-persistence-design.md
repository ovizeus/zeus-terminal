# Omega Chat Persistence — Design Spec

**Date:** 2026-05-19
**Status:** Approved for implementation
**Sub-Project:** A (of 3) — Chat Persistence Foundation
**Follow-ups:** Sub-B User Profile, Sub-C Long-Term Memory (separate specs)

---

## Goal

Eliminate volatile chat state. After this work, refreshing the browser, closing the tab, or `pm2 reload zeus` MUST NOT lose:
1. User's view of past conversation in TalkWithMe (UI restore)
2. Omega's contextual awareness when continuing the conversation (brain rehydration)

Operator must be able to wipe their own chat history on demand (privacy control).

## Scope (Sub-Project A only)

**In scope:**
- Backend `GET /api/omega/chat/history` endpoint (per-user paginated read)
- Backend `DELETE /api/omega/chat/history` endpoint (per-user nuclear wipe + audit)
- `chatResponder._loadConvoHistory(userId)` lazy hydration on first chat post-restart
- `TalkWithMe.tsx` `useEffect` mount fetch + populate state
- New `OmegaMemorySection.tsx` Settings UI with "Clear chat history" button + confirm dialog
- Rate limit on DELETE (1/min/user)
- Audit log entry on every DELETE

**Out of scope (deferred to B/C):**
- User profile / nickname / addressing (Sub-B)
- Long-term fact memory + auto-extraction (Sub-C)
- Granular "/forget last N messages" command (Sub-C)
- Pagination scroll-up infinite history (not needed for 50-msg load)
- Search across past chats (Sub-C)
- Per-user encryption of chat content (operator decision; not in scope here)

## Architecture

```
TalkWithMe.tsx (mount) ──→ GET /api/omega/chat/history?limit=50
       │                              ↓
       │                    routes/omega.js — _requireUser(req) gates per-user filter
       │                              ↓
       │                    sqlite SELECT FROM ml_voice_log WHERE user_id=? AND utterance_type='CHAT_REPLY'
       │                                                                                     ORDER BY created_at DESC LIMIT 25
       │                              ↓
       └──── setState(history) ←─ expand each row into [you, omega] ChatRow pair, reverse to chronological

User sends msg ──→ POST /api/omega/chat ──→ chatResponder.respond({userId, text})
                                                  │
                                                  ↓
                                          _loadConvoHistory(userId)  [lazy, idempotent, once-per-restart]
                                                  │
                                                  ↓
                                          _convoHistory: Map<userId, ChatTurn[]> hydrated from DB

Settings → "Clear chat history" button ──→ DELETE /api/omega/chat/history
                                                  ↓
                                          sqlite DELETE FROM ml_voice_log WHERE user_id=? AND utterance_type IN (...)
                                                  ↓
                                          audit_log entry OMEGA_CHAT_HISTORY_CLEARED
                                                  ↓
                                          chatResponder._convoHistory.delete(userId)  [in-memory invalidate]
                                                  ↓
                                          200 OK { ok: true, deletedCount }
```

### Key invariants

- **Per-user isolation strict:** every DB query MUST filter `WHERE user_id = req.user.id`. No admin override path through this API.
- **No schema migration:** the existing `ml_voice_log` table is sufficient. User question is in `context_json.question`, Omega reply in `text`, mood in `mood`, timestamp in `created_at`.
- **Lazy brain hydration:** zero boot cost; +20ms only on first chat per user after restart (one DB read, then cached in `_convoHistory` Map).
- **Idempotent load:** multiple mounts/reloads safe — load doesn't mutate DB, only reads.
- **In-memory cache trustworthy after first hydration:** subsequent chat calls hit cache; DB writes by `voiceLogger.logUtterance` keep DB and cache in sync via existing `_pushConvo` calls.

## Components & Files

| File | Action | Approximate diff size |
|---|---|---|
| `server/routes/omega.js` | MODIFY — add 2 new route handlers | +60 lines |
| `server/services/ml/_voice/chatResponder.js` | MODIFY — add `_loadConvoHistory` + lazy invocation in `respond()` | +35 lines |
| `client/src/components/omega/TalkWithMe.tsx` | MODIFY — useEffect mount fetch + setState population | +15 lines |
| `client/src/components/settings/OmegaMemorySection.tsx` | CREATE — Settings UI with Clear button + confirm dialog | +60 lines |
| `client/src/components/settings/SettingsModal.tsx` (or equivalent) | MODIFY — mount OmegaMemorySection in Omega tab | +5 lines |
| `tests/unit/ml/chatResponderLoadHistory.test.js` | CREATE — TDD coverage for `_loadConvoHistory` | +90 lines |
| `tests/unit/omegaRoutesChatHistory.test.js` | CREATE — TDD coverage for GET/DELETE endpoints | +110 lines |

Total estimated diff: ~375 lines across 6 files (5 modified + 2 new tests + 1 new component).

## API Contracts

### `GET /api/omega/chat/history`

```http
GET /api/omega/chat/history?limit=50
Cookie: zeus_token=<jwt>
```

| Query param | Type | Default | Cap | Notes |
|---|---|---|---|---|
| `limit` | integer | 50 | 100 | number of ChatRow objects (= 25 DB rows → 50 messages) |

Response 200:
```json
{
  "ok": true,
  "history": [
    { "role": "you", "text": "Salut Omega", "ts": 1779200000000 },
    { "role": "omega", "text": "Salut boss", "mood": "CALM", "ts": 1779200000500 },
    ...
  ],
  "total": 248
}
```

`history` is in chronological order (oldest first); `total` is the total chat exchanges (CHAT_REPLY rows) for this user across all time (not limited).

Response 401: `{ "ok": false, "error": "Authentication required" }`

Response 500: `{ "ok": false, "error": "<details>" }`

### `DELETE /api/omega/chat/history`

```http
DELETE /api/omega/chat/history
Cookie: zeus_token=<jwt>
```

No body.

Response 200:
```json
{ "ok": true, "deletedCount": 247 }
```

Side effects (server-side):
- `DELETE FROM ml_voice_log WHERE user_id = ? AND utterance_type IN ('CHAT_REPLY', 'GREETING', 'FAREWELL', 'REACTION')` (preserves `THOUGHT` and `CRITICAL_ALERT` — those are operator-facing brain narration, not chat content)
- audit_log entry: `action='OMEGA_CHAT_HISTORY_CLEARED'`, `user_id=req.user.id`, `details={deletedCount, ip:req.ip}`, `created_at=now`
- `chatResponder._convoHistory.delete(userId)` to invalidate the in-memory cache

Response 429: `{ "ok": false, "error": "Rate limit: 1 clear per minute" }`

Response 401 / 500: standard shape.

## Data Flow

### Flow 1 — TalkWithMe Mount Load

1. Component mounts; `useEffect` with empty dependency array fires once
2. Set `loading=true` state
3. `api.get<HistoryResponse>('/api/omega/chat/history?limit=50')`
4. Server: `_requireUser(req)` → userId; query DB DESC LIMIT 25; expand to ChatRow pairs; reverse chronological
5. On 200: `setHistory(history)`, `setLoading(false)`, scroll to bottom on next paint
6. On error: `setError(...)`, toast notification, `setLoading(false)`, conversation continues to work (empty state)
7. Subsequent component re-mounts (operator opens/closes panel) re-fetch — acceptable for low-frequency UX action

### Flow 2 — Brain Rehydration on First Chat Post-Restart

1. User types message → POST `/api/omega/chat` → `chatResponder.respond({userId, text})`
2. Inside `respond`, BEFORE any LLM call or local intent dispatch:
   - Check `_loadedForUser.has(userId)` — if false:
     - Set `_loadedForUser.set(userId, _loadConvoHistory(userId))` (stores the Promise; deduplicates concurrent calls)
   - `await _loadedForUser.get(userId)` (subsequent calls await same Promise)
3. `_loadConvoHistory(userId)`:
   - Query DB: last 10 turns for this user (10 CHAT_REPLY rows; each provides user question from `context_json.question` and omega reply from `text`)
   - For each row, `_pushConvo(userId, 'user', question); _pushConvo(userId, 'assistant', reply);`
   - On DB error: log warning, push empty array, continue (don't block conversation)
4. Continue with existing `respond` logic — `_getConvo(userId)` now returns hydrated history for LLM context

### Flow 3 — Clear History (DELETE)

1. User clicks "Clear chat history" in Settings → confirm dialog ("This will permanently delete your conversation history with Omega. Continue?")
2. On confirm: `api.del<DeleteResponse>('/api/omega/chat/history')`
3. Server: rate-limit check (1/min/user via in-memory Map); execute DELETE; audit_log entry; invalidate cache
4. Response with `deletedCount`
5. Client: toast `"Cleared {deletedCount} messages"`; `setHistory([])` → empty UI; close confirm dialog

## Error Handling

| Failure mode | Surface | Recovery |
|---|---|---|
| DB unreachable on GET | `{ok:false, error}` 500 | UI toast; conversation continues to work, history empty until next refresh |
| DB unreachable on rehydration | log warning; `_convoHistory.set(userId, [])` | conversation continues without past context; next message succeeds normally |
| Concurrent GET requests on mount | Promise dedup via `_loadedForUser` Map (stores Promise, not result) | Only one DB read; both callers resolve from same Promise |
| Concurrent DELETE | rate-limit (in-memory Map per user); second call gets 429 | first call completes; second informed via toast |
| Audit log write failure | log error; do NOT block DELETE | DELETE still succeeds; ops team alerted via existing audit log monitoring |
| LLM call fails after rehydration | existing fallback already handles (current chatResponder code) | unchanged |
| `context_json.question` malformed JSON | catch JSON.parse; treat user question as empty string | row still included for chronology, user question shown as "(?)" in UI |

## Security & Audit

- **Per-user filter enforced everywhere:** every SQL query in this spec MUST have `WHERE user_id = ?` bound to `req.user.id`. Code review MUST verify this on every diff.
- **`_requireUser` middleware:** existing helper validates JWT cookie. No request reaches handler without authenticated user.
- **Audit log on DELETE:** persisted to `audit_log` table (existing). Includes user_id, action, deletedCount, ip, timestamp. Operator audit retention rules apply.
- **Confirm dialog client-side:** prevents accidental clicks. NOT a security feature (server enforces rate limit + auth).
- **Rate limit on DELETE:** 1 per user per minute, in-memory Map. Prevents abuse / accidental loops.
- **NO admin override route in this API:** admins must use direct DB access if data needs to be removed via legal request. This keeps the public API surface minimal and per-user-scoped.

## Testing Strategy

### Unit tests (TDD)

**`tests/unit/omegaRoutesChatHistory.test.js`** (supertest + jest):
- GET returns chronological order (oldest first)
- GET filters per user (user A query returns user A's chat, not user B's)
- GET limit clamping (limit=500 → capped at 100 messages = 50 DB rows)
- GET handles empty history (returns `{ok:true, history:[], total:0}`)
- GET malformed `context_json.question` doesn't crash response
- DELETE returns deletedCount
- DELETE creates audit_log entry with correct fields
- DELETE filters per user (does NOT delete other users' chat)
- DELETE preserves `THOUGHT` and `CRITICAL_ALERT` (operator-facing brain narration kept)
- DELETE rate limit: second call within 60s returns 429
- 401 on missing JWT cookie

**`tests/unit/ml/chatResponderLoadHistory.test.js`** (jest):
- `_loadConvoHistory(userId)` populates `_convoHistory` Map from DB
- Idempotent: second call with same userId doesn't re-query
- Concurrent calls dedup (same Promise awaited by all)
- Returns empty array on DB error, doesn't throw
- Lazy: not called until `respond({userId, ...})` is invoked
- Only loads up to `CONVO_MAX_TURNS` (10) most recent turns

### Manual smoke (post-deploy)

1. Open TalkWithMe → verify history visible (assuming prior chat exists)
2. Hard refresh browser (Ctrl+Shift+R) → history still visible
3. `pm2 reload zeus` → reload TalkWithMe → first new chat message picks up context from previous (Omega responds aware of past topic)
4. Settings → Clear chat history → confirm → UI empty
5. Reload page → still empty (DB confirmed wiped)
6. Verify `audit_log` table has entry `OMEGA_CHAT_HISTORY_CLEARED`
7. Try Clear again within 60s → toast "Rate limit"

## Implementation Estimate

- Backend (routes + chatResponder hook + tests): 1.5–2h
- Frontend (TalkWithMe fetch + Settings button + CSS): 1h
- Tests TDD + manual smoke: 30–45min
- **Total: ~3–4h** with subagent-driven reviews per task

## Defense-in-depth Posture

This sub-project changes ONLY the read/write paths in `ml_voice_log`. It does NOT touch:
- Phase 2 brain fusion math
- ARCH-3 per-(user × env × symbol) isolation (orthogonal — chat is per-user only)
- Ring5 bandit / influence pipeline
- Phase B/A.1/C/A.2 Binance rate-limit defense

Safe to ship independently; rollback is `git revert` on the feature commit + `pm2 reload` (no schema migration to undo).

## Dependencies on Future Work

- Sub-Project B (User Profile) will add `ml_user_chat_profile` table and consult it in `chatResponder.respond()` to address user by name. Sub-A's `_loadConvoHistory` is forward-compatible — Sub-B reuses the same in-memory cache.
- Sub-Project C (Long-Term Memory) will add `ml_chat_memory` table for LLM-extracted facts, plus auto-extraction post-reply. Sub-A's history flow is forward-compatible — Sub-C reads the same `ml_voice_log` rows for source attribution of extracted facts.

## Open Questions / Deferred Decisions

None blocking. Operator confirmed:
- History depth: 50 messages (last 25 exchanges) ✅
- Clear chat history: Settings button + audit log ✅
- Lazy load over eager preload ✅
- Single architecture approach (Approach 1) ✅

## Approval Trail

- Audit completed 2026-05-19 — empirical review of `chatResponder.js`, `TalkWithMe.tsx`, `routes/omega.js`, `ml_voice_log` schema and volume (5142 rows, 9+ users)
- Decomposition approved 2026-05-19 — A3 (full A+B+C sequential)
- Clarifying questions (1/2) answered 2026-05-19:
  - Q1 history depth: B (50 messages)
  - Q2 delete capability: B (Settings nuclear button + audit log)
- Approach approved 2026-05-19 — Approach 1 (lazy HTTP fetch + lazy brain rehydration)
- Design sections approved 2026-05-19 — all 7 sections (architecture, components, contracts, flow, errors, security, testing)
- Final spec written 2026-05-19, awaiting operator review before writing-plans transition

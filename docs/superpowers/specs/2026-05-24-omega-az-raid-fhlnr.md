# OMEGA A-Z Raid — 5 MUST-ADD Features (F/H/L/N/R)

> **Status:** APPROVED 2026-05-24
> **Operator:** Ovi (wsov2@protonmail.com)

## Goal

Complete the 5 remaining MUST-ADD features from the A-Z Raid: Feedback, History, Latency cap, Telegram critical push, Reaction system.

---

## F — Feedback (thumb up/down per voice thought)

**Module:** `server/services/ml/_voice/voiceFeedback.js`

**Table:** `ml_voice_feedback` (migration 403)
```sql
CREATE TABLE ml_voice_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voice_log_id INTEGER NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    feedback TEXT NOT NULL CHECK(feedback IN ('up', 'down')),
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_voice_fb_user ON ml_voice_feedback(user_id, created_at);
```

**Rate limiting:**
- UNIQUE on voice_log_id — 1 feedback per thought (upsert on conflict)
- Max 50 feedbacks/day per user — count check before insert

**Exports:**
- `submitFeedback({ voiceLogId, userId, feedback })` → `{ ok, id }`
- `getFeedbackStats({ userId, since? })` → `{ up, down, total }`

**API:** POST `/api/omega/feedback` `{ voiceLogId, feedback: 'up'|'down' }`

**Integration:** Feedback feeds R5A attribution as operator ground truth (future wire).

---

## H — History (voice thought stream scrollback)

**API:** GET `/api/omega/voice-history`

**Query params:**
- `since` — timestamp ms (pagination)
- `limit` — max 100, default 50
- `mood` — filter: CALM|ALERT|CAUTIOUS|EXCITED|SAD|NERVOUS|FOCUSED
- `templateId` — filter by template
- `severity` — filter: info|warning|critical (mapped from mood)

All filters combinable. SQL WHERE built dynamically.

**Route:** Added to `server/routes/omega.js`

**Returns:** `{ ok, thoughts: [{ id, mood, text, templateId, contextJson, createdAt }] }`

---

## L — Latency Cap (<100ms)

**Module:** `server/services/ml/_voice/voiceLatencyGuard.js`

**Constant:** `VOICE_LATENCY_CAP_MS = 100`

**Mechanism:**
- Wraps any voice generation call with timeout
- On timeout: silent skip (no UI write, no voice log entry)
- Logs abandon as P2 Doctor event via telemetryCollector
- Tracks count of abandons per minute for Doctor stats

**Exports:**
- `withLatencyCap(fn, timeoutMs?)` → wrapped function that rejects after cap
- `getAbandonStats()` → `{ abandonsLastMinute, abandonsLastHour, totalAbandons }`

**Telemetry:** Each abandon increments in-memory counter + emits Doctor P2 event (max 1 per minute to avoid spam).

---

## N — Telegram Critical Push

**Module:** `server/services/ml/_voice/criticalPush.js`

**Triggers:**
- DD lockout (drawdownGuard sizeScale=0)
- Black swan detected (blackSwanAbstention severity != NONE)
- GLOBAL_HALT armed
- Cognitive state COMPROMISED or DEAD

**Deduplication:**
- Map: `(eventType, severity)` → lastPushTs
- Min 5 minutes between pushes for same (type, severity)

**Format:** `🚨 OMEGA: [reason]\n[detail]` — plain text, no Markdown

**Wire points:**
- `analyzer.js` on P0 state transitions
- `serverAT.js` on GLOBAL_HALT
- `serverDrawdownGuard.js` on LOCKOUT tier

**Exports:**
- `pushCritical({ userId, eventType, severity, message })` → `{ sent, deduplicated }`

---

## R — Reaction System

**Module:** `server/services/ml/_voice/tradeReaction.js`

**Triggers:**
- Manual entry (serverAT register-manual)
- Manual close (exitType='MANUAL_CLIENT')

**Frequency cap:**
- Max 1 reaction per symbol per 5 minutes (Map: `symbol` → lastReactionTs)
- Scalping detection: if 5+ trades/15min on same symbol → silent skip (no reaction)

**Tone per mood:**
Pool of phrases branched by OMEGA mood (from moodEmaTracker):

```
CALM: neutral observations
  entry: "manual {side} on {symbol}. noted."
  win: "{symbol} closed green. clean execution."
  loss: "{symbol} closed red. it happens."

ALERT: heightened awareness
  entry: "going manual on {symbol}? interesting timing."
  win: "nice manual {side} on {symbol}. market agreed."
  loss: "{symbol} didn't work. rough one."

CAUTIOUS: warning tone
  entry: "manual {side} on {symbol}... careful out there."
  win: "{symbol} manual win. don't push luck."
  loss: "told you {symbol} looked sketchy. review this one."
```

~10 phrases per mood × 3 moods × 3 scenarios (entry/win/loss) = ~90 phrase pool

**Output:** Writes to `ml_voice_log` with `templateId='omega_reaction'` — appears in Voice stream.

**Exports:**
- `reactToTrade({ userId, symbol, side, action, pnl?, mood? })` → `{ reacted, text }` or `{ reacted: false, reason }`

---

## File Map

| File | Action |
|------|--------|
| `server/services/ml/_voice/voiceFeedback.js` | CREATE |
| `server/services/ml/_voice/voiceLatencyGuard.js` | CREATE |
| `server/services/ml/_voice/criticalPush.js` | CREATE |
| `server/services/ml/_voice/tradeReaction.js` | CREATE |
| `server/services/database.js` | MODIFY (migration 403) |
| `server/routes/omega.js` | MODIFY (2 endpoints: feedback + voice-history) |
| `server/services/serverAT.js` | MODIFY (reaction wire on manual entry/close) |
| `server/services/ml/_doctor/analyzer.js` | MODIFY (critical push on P0) |
| `tests/unit/ml/voiceFeedback.test.js` | CREATE |
| `tests/unit/ml/voiceLatencyGuard.test.js` | CREATE |
| `tests/unit/ml/criticalPush.test.js` | CREATE |
| `tests/unit/ml/tradeReaction.test.js` | CREATE |
| `tests/unit/ml/azRaidRoutes.test.js` | CREATE |

## Constraints

- All try/catch isolated — never block trading hot path
- Voice latency cap = silent skip, not error
- Telegram dedup prevents spam (5min per event type)
- Reaction frequency cap prevents annoyance (1 per symbol per 5min)
- Scalping auto-detection silences reactions during rapid trading
- All admin/user auth follows existing patterns

## Testing

- `voiceFeedback.test.js`: submit, upsert, rate limit 50/day, stats
- `voiceLatencyGuard.test.js`: within cap passes, over cap abandons, stats counter
- `criticalPush.test.js`: push, dedup 5min, format
- `tradeReaction.test.js`: react entry/win/loss, frequency cap, scalping skip, mood branching
- `azRaidRoutes.test.js`: POST feedback + GET voice-history with filters

## Out of Scope

- Client UI for feedback buttons (API-only, UI can be added later)
- Voice history UI component (API-only)
- Telegram "Snooze 1h" inline button (future enhancement)
- TTS voice generation (separate #5 Voice/Sound item)

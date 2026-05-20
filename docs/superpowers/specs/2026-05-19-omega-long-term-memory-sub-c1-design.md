# Omega Long-Term Memory — Sub-C.1 Design Spec

**Date:** 2026-05-19
**Author:** Claude (Opus 4.7) + operator (Ovi) via /superpowers:brainstorming + Phone Claude reviews
**Status:** DESIGN LOCKED — awaiting spec review → writing-plans → subagent-driven implementation
**Effort:** 17-19h (6-9 TDD tasks, subagent-driven)
**Branch:** `omega/wave-1-foundation`
**Prerequisite:** Sub-A (chat persistence) shipped v1.7.96 b122

---

## 1. Context & Scope

### Problem
After Sub-A shipped (chat history persists via `ml_voice_log`, rehydrates on PM2 reload, UI clear button in Settings), Omega still has no long-term memory of *who the operator is*. Each chat starts from zero personal context — Omega doesn't remember name, language preference, trading style, location, communication preferences. Operator must re-state context every session.

### Solution: Sub-C.1
Add a long-term memory layer that:
- Silently extracts facts from each chat exchange (via LLM extraction call after reply)
- Persists facts in `ml_chat_memory` per-user × per-env (where applicable)
- Injects relevant facts into the persona prompt on subsequent chats
- Surfaces all stored facts in Settings → Omega tab for operator review/forget
- Decays facts naturally by class (identity never, style 180d, personal 90d, trading 60d, temporary 7d)
- Enforces class-bounded caps to prevent unbounded growth
- Protects against accidental secret extraction via 7-step redact pipeline (bidirectional input + reply)

### Sub-Project Decomposition

| Sub | Scope | Status |
|---|---|---|
| Sub-A | Chat persistence: rehydrate on reload, UI clear button | ✅ SHIPPED v1.7.96 b122 |
| Sub-B | User profile (name, language, comm style) | ABSORBED into Sub-C identity-class facts |
| **Sub-C.1** | **UI-first forget + silent extraction + caps (THIS SPEC)** | **DESIGN LOCKED** |
| Sub-C.2 | `/forget X` chat command + edit-fact mutation API | DEFERRED |
| Sub-C.3 | Contradiction proposal pattern (when LLM extracts fact that conflicts with existing) | DEFERRED |

### What This Spec Is NOT
- ❌ Not chat-command driven (Sub-C.2)
- ❌ Not contradiction-proposal (Sub-C.3)
- ❌ Not embedding-based semantic retrieval (defer if facts >100/user becomes routine)
- ❌ Not at-rest encryption (operator-layer concern, full-disk encryption recommended at OS layer)
- ❌ Not edit-fact mutation (only forget, no in-place edit — Sub-C.2)
- ❌ Not Phase 2 fusion math change (UNTOUCHED per ARCH-4)

---

## 2. Design Decisions (Q1-Q6 LOCKED)

### Q1: Extraction strategy → **A: Silent auto-extract + UI review**
After every chat exchange, fire-and-forget async extraction call to LLM (Groq). Operator never sees an extraction prompt mid-conversation. Operator reviews extracted facts in Settings → Omega tab and forgets unwanted ones via 🗑.

### Q2: Decay model → **D: Class-based decay**

| Class | Decay (half-life) | Why |
|---|---|---|
| `identity` | Never | Name, language, role rarely change |
| `style` | 180d | Communication preferences drift slowly |
| `personal_context` | 90d | Location, job, family — semi-stable |
| `trading_strategy` | 60d | Strategies evolve mid-term |
| `temporary` | 7d | Today's mood, current focus |

### Q3: Retrieval algorithm → **D': identity-always + top-N hybrid scored**

```
score = importance × 0.6 + exp(-Δt × ln2/halflife(class)) × 0.4
```

Where `Δt` = days since `last_seen_at`. Halflife per Q2 (identity=∞ → decay term = 1.0 always).

Persona injection rule:
1. Always include all `identity` facts (max 4, closed enum)
2. From remaining classes, select top-N by hybrid score until N=12 (or budget exhausted)
3. `active_state` (current intent inferred from conversation context) NOT stored in Sub-C.1 — derive live from ctx if needed (deferred to Sub-C.2+)

**Implementation note:** `better-sqlite3` standard build does NOT have `exp()` / `ln()` SQL functions. Scoring MUST be done in JS — load candidate facts to memory, compute scores, sort, slice top-N.

### Q4: Forget UX → **A-first (UI) + soft tombstone 7d + multi-match + cross-cluster cache invalidation**
- **A-first:** Settings UI is the primary forget channel for Sub-C.1; `/forget X` chat command deferred to Sub-C.2
- **Soft tombstone 7d:** `tombstone_at` set on UI delete; hard-delete only after 7d via cron (admin-recoverable window)
- **Multi-match disambiguation:** UI groups facts by class with metadata (key, value, importance, last_seen, added); each 🗑 is per-fact-row, not key-search
- **Cross-cluster cache invalidation:** PM2 cluster mode = multiple workers each with own in-process cache. Cache freshness via db-poll on `ml_chat_memory_meta.last_modified_at` (30s TTL aligned with existing pattern)

### Q5: Redact pipeline → **D': Sequential fail-fast 7-step, bidirectional, context-aware**

Steps (input mode = high-recall, reply mode = high-precision; see Fix 4):

1. **Input regex redact** — apply context-aware regex to user-input text BEFORE save
2. **Pre-LLM redact** — apply to (question + reply) before extraction prompt
3. **Class allowlist gate** — skip if content has no extractable classes
4. **LLM extraction call** — prompt engineered with explicit "DO NOT EXTRACT" instructions
5. **Post-LLM regex** — apply context-aware regex to each `fact_value` (mode='input', high-recall)
6. **Fact-key blacklist** — reject if `fact_key` contains password|seed|wallet|etc
7. **Luhn / BIP39 / final validation** — Luhn on numeric values, BIP39 12-word check on textual values
8. **(Reply path)** — Steps 1, 2, 4 (no-op), 5, 6, 7 with `mode='reply'` (high-precision: exact regex only, no proximity-alone heuristic)

Context-aware regex examples (proximity ±50 chars to keywords like `private`, `seed`, `secret`, `cheia`, `mnemonic`, `wallet.*export`):

| Pattern | Redacts | Allows |
|---|---|---|
| Proximity + `[a-fA-F0-9]{64}` | private keys in suspicious context | TX hashes standalone (public) |
| Proximity + `0x[a-fA-F0-9]{40}` | private addresses in suspicious context | ETH addresses standalone (public) |
| `[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}` | JWT tokens (3-part dot) | order IDs, git SHAs |
| `\b(?:\d[ -]*?){13,19}\b` + Luhn | credit cards | Unix timestamps |
| `(password\|parol[aă]\|pwd\|secret)[: =]+\S+` | password=value | innocent uses of word |
| 12+ consecutive BIP39 words (NO non-BIP39 intercalate) | wallet seeds | educational mentions |

### Q6: Caps strategy → **E': Class-bounded + Q3 hybrid score eviction + watermark 80% + env-scoped**

| Class | Cap | Scope |
|---|---|---|
| `identity` | 4 | per user (closed enum, UPSERT not insert+evict) |
| `style` | 8 | per user |
| `personal_context` | 25 | per user |
| `trading_strategy` | 100 | **per user × per env** (DEMO/TESTNET/REAL separate) |
| `temporary` | 15 | per user |
| `active_state` | (not stored Sub-C.1) | — |

**Eviction rules:**
- Eviction triggered when class[+env] at 100% cap on UPSERT attempt
- Evict bottom 1 fact by Q3 hybrid score (consistent with retrieval)
- Watermark compaction: when class[+env] at 80% cap, cron evicts bottom 10% (gentler pace, prevents jitter at boundary)
- Identity uses `ON CONFLICT(user_id, class, fact_key) DO UPDATE` (slot-fixed, no eviction needed)

---

## 3. Architecture

### High-level

```
                ┌──────────────────────────────────────┐
                │  client/components/omega/            │
                │  TalkWithMe.tsx (existing, Sub-A)    │
                │  Settings/OmegaMemorySection.tsx     │
                │  (extends Sub-A clear-chat section)  │
                └──────────────┬───────────────────────┘
                               │ Zustand
                               ▼
                ┌──────────────────────────────────────┐
                │  client/src/stores/                  │
                │  omegaChatStore.ts (Sub-A)           │
                │  omegaMemoryStore.ts (NEW)           │
                └──────────────┬───────────────────────┘
                               │ HTTP
                               ▼
                ┌──────────────────────────────────────┐
                │  server/routes/omega.js              │
                │  + GET  /api/omega/memory            │
                │  + DELETE /api/omega/memory/:id      │
                │  + GET  /api/omega/memory/health     │
                └──────────────┬───────────────────────┘
                               │
                               ▼
                ┌──────────────────────────────────────┐
                │  server/services/ml/_voice/          │
                │  chatResponder.js (existing)         │
                │   ├─ _loadMemoryFacts() [extend]    │
                │   └─ persona slot injection [extend] │
                │                                      │
                │  omegaMemoryService.js (NEW)         │
                │   ├─ extract(voiceLogId, ctx)       │
                │   ├─ retrieve(userId, env)          │
                │   ├─ forget(factId, userId)         │
                │   ├─ evictIfOverCap(...)            │
                │   └─ compactWatermark(...)          │
                │                                      │
                │  redactPipeline.js (NEW)             │
                │   └─ redact(text, {mode})           │
                └──────────────┬───────────────────────┘
                               │
                               ▼
                ┌──────────────────────────────────────┐
                │  server/cron/                        │
                │  omegaMemoryCleanup.js (NEW)         │
                │   ├─ Hard-delete tombstones >7d     │
                │   ├─ Watermark compaction           │
                │   ├─ Retry failed_transient         │
                │   └─ Auto-decay expired facts       │
                └──────────────┬───────────────────────┘
                               │
                               ▼
                ┌──────────────────────────────────────┐
                │  SQLite (data/zeus.db)               │
                │   ├─ ml_chat_memory (NEW + Fix 3)    │
                │   ├─ ml_chat_memory_meta (NEW)       │
                │   └─ ml_voice_log (Sub-A + Fix 1)    │
                └──────────────────────────────────────┘
```

### Architectural Decisions (3 from initial Phone review + 4 from Phone Fix Review)

| # | Decision | Rationale |
|---|---|---|
| ARCH-1 | Extraction is async fire-and-forget (chat response NOT blocked) | LLM extraction adds ~2-5s; blocking would degrade UX |
| ARCH-2 | `extraction_status` column on `ml_voice_log` (NOT separate outbox table) | MVP simpler; 1 column < 1 new table; aligns with existing schema |
| ARCH-3 | Bidirectional redact pipeline (input + reply) | LLM can paraphrase contaminated input OR "helpfully complete" tokens in reply |
| ARCH-4 | Cache invalidation via db-poll on `ml_chat_memory_meta.last_modified_at` (NOT Redis pub/sub) | Aligned with existing 30s pattern; no new infra; max staleness 30s acceptable |
| **FIX-1** | `extraction_status` enum 4-state: `pending` / `done` / `failed_transient` / `failed_permanent` + exponential backoff retry | Prevents silent data loss on LLM downtime windows (transient = 5 attempts over ~14h) |
| **FIX-2** | Health endpoint + UI badge, ratio-based 4-state (healthy / degraded / down / idle) | Sub-C.1 must be self-observable; aligned with QuotaIndicator pattern (b119) |
| **FIX-3** | Dual source columns: `created_source_chat_id` + `last_source_chat_id` + `reaffirm_count` | UX: "Learned X, reaffirmed 8 times, last seen Y" |
| **FIX-4** | Redact pipeline `mode` param: `'input'` (high-recall) vs `'reply'` (high-precision, exact regex match only) | Prevents false-positive redact on LLM-generated natural language |

---

## 4. Schema

### 4.1 New table: `ml_chat_memory`

```sql
CREATE TABLE ml_chat_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  env TEXT,                          -- DEMO/TESTNET/REAL or NULL for env-agnostic classes
  class TEXT NOT NULL CHECK(class IN (
    'identity','personal_context','trading_strategy','temporary','style'
  )),
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5,
  
  -- Fix 3: source traceability
  created_source_chat_id INTEGER,    -- ml_voice_log.id at first sight (immutable)
  last_source_chat_id INTEGER,       -- ml_voice_log.id at most recent reaffirmation
  reaffirm_count INTEGER NOT NULL DEFAULT 1,
  
  decay_at INTEGER,                  -- epoch ms; NULL = never expires
  last_seen_at INTEGER NOT NULL,     -- epoch ms
  tombstone_at INTEGER,              -- NULL = active; set on forget
  forgotten_by TEXT,                 -- 'user_ui'|'auto_decay'|'admin'|'eviction'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  
  UNIQUE(user_id, class, fact_key, env)
);

CREATE INDEX idx_mlcm_user_active 
  ON ml_chat_memory(user_id, tombstone_at, class);

CREATE INDEX idx_mlcm_tombstone_cleanup 
  ON ml_chat_memory(tombstone_at)
  WHERE tombstone_at IS NOT NULL;

CREATE INDEX idx_mlcm_decay 
  ON ml_chat_memory(decay_at)
  WHERE decay_at IS NOT NULL AND tombstone_at IS NULL;
```

### 4.2 New table: `ml_chat_memory_meta`

```sql
CREATE TABLE ml_chat_memory_meta (
  user_id INTEGER PRIMARY KEY,
  last_modified_at INTEGER NOT NULL  -- epoch ms; updated on any write to ml_chat_memory for this user
);
```

### 4.3 Alter table: `ml_voice_log` (Fix 1)

```sql
ALTER TABLE ml_voice_log ADD COLUMN extraction_status TEXT;
  -- enum: NULL (pre-migration legacy rows) 
  --     | 'pending' | 'done' | 'failed_transient' | 'failed_permanent'
ALTER TABLE ml_voice_log ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ml_voice_log ADD COLUMN last_attempt_at INTEGER;
ALTER TABLE ml_voice_log ADD COLUMN next_retry_at INTEGER;

CREATE INDEX idx_mlvl_extraction_recovery 
  ON ml_voice_log(extraction_status, next_retry_at)
  WHERE extraction_status = 'failed_transient';
```

### 4.4 Migration ordering & atomicity (LOCKED)

**Rule 1: Atomic, independent migrations.** Each migration step runs in its own transaction. Failure of one does NOT corrupt earlier steps. Migration framework already enforces this per `server/services/database.js` existing pattern.

**Rule 2: Strict ordering** (implementer MUST follow):

| Order | Migration | Why this order |
|---|---|---|
| 1 | `CREATE TABLE ml_chat_memory` (with Fix 3 columns inline) | No FK dependencies; standalone |
| 2 | `CREATE TABLE ml_chat_memory_meta` | Depends conceptually on memory existing |
| 3 | `ALTER TABLE ml_voice_log ADD COLUMN extraction_status TEXT` (NO DEFAULT) | Separate migration from memory tables — schema-level isolation per Phone senior-dev pattern |
| 4 | `ALTER TABLE ml_voice_log ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0` | |
| 5 | `ALTER TABLE ml_voice_log ADD COLUMN last_attempt_at INTEGER` | |
| 6 | `ALTER TABLE ml_voice_log ADD COLUMN next_retry_at INTEGER` | |
| 7 | `CREATE INDEX idx_mlcm_user_active` | After table exists |
| 8 | `CREATE INDEX idx_mlcm_tombstone_cleanup` | After table exists |
| 9 | `CREATE INDEX idx_mlcm_decay` | After table exists |
| 10 | `CREATE INDEX idx_mlvl_extraction_recovery` (partial) | After ALTER columns exist |

**Rule 3: `extraction_status DEFAULT NULL` (critical).** Pre-migration `ml_voice_log` rows MUST have `extraction_status = NULL`, not `'pending'`. Cron retry query explicitly filters `WHERE extraction_status='failed_transient'` — NULL rows are skipped (no auto-extraction on legacy data). This avoids backfilling extraction for the entire pre-Sub-C.1 chat history on first deploy.

**Rule 4: Migration numbers.** Next available migration number per `server/services/database.js` — implementer assigns at task time. Spec assumes 381+ range (after Worktrack A 380 if shipped). Each ordered step = its own migration number.

---

## 5. Components

### 5.1 `server/services/ml/_voice/omegaMemoryService.js` (NEW)

**Public API:**

```js
omegaMemoryService = {
  // Extraction (called async after chat reply saved)
  async extract({ voiceLogId, userId, env, question, reply }) -> void,
  
  // Retrieval (called by chatResponder._loadMemoryFacts)
  async retrieve(userId, env) -> Array<{class, fact_key, fact_value, importance, last_seen_at}>,
  
  // Forget (called by DELETE route)
  async forget(factId, userId, source='user_ui') -> {ok, tombstoneUntil} | {ok, alreadyTombstoned},
  
  // Eviction (called inside UPSERT path when at cap)
  async _evictBottomOne(userId, klass, env) -> evictedFactId | null,
  
  // Watermark compaction (called by cron)
  async _compactWatermark(userId) -> {evictedCount},
  
  // NOTE: Health snapshot lives in separate service for separation of concerns.
  // See §5.1b omegaMemoryHealthService below.
}
```

**Internal helpers:**
- `_callLLMExtract(question, reply)` — Groq call with structured prompt (see §6.5)
- `_classifyFailure(err)` — categorize to `failed_transient` / `failed_permanent`
- `_calcBackoff(attempts)` — return next_retry_at delta per schedule
- `_hybridScore(fact, now)` — `importance × 0.6 + exp(-Δt × ln2/halflife(class)) × 0.4`
- `_classCap(klass)` — returns {cap, scope: 'user'|'user_env'}
- `_classHalflife(klass)` — returns days

### 5.1b `server/services/ml/_voice/omegaMemoryHealthService.js` (NEW)

**Separation of concerns:** Health computation lives in own file. Pure query module — no extraction side-effects. Testable in isolation.

**Public API:**

```js
omegaMemoryHealthService = {
  async getHealthStatus(userId) -> {
    status: 'healthy' | 'degraded' | 'down' | 'idle',
    last_success_at: epoch_ms | null,
    last_attempt_at: epoch_ms | null,
    failure_rate_last_hour: 0.0 - 1.0,
    pending_count: int,
    failed_transient_count_last_hour: int,
    failed_permanent_count_last_24h: int,
    total_attempts_last_hour: int
  }
}
```

**Internal:**
- `_queryAggregates(userId, now)` — single bundled SELECT for all counts
- `_calcStatus(aggregates, now)` — pure function (no I/O), the logic from §6.7

### 5.2 `server/services/ml/_voice/redactPipeline.js` (NEW)

**Public API:**

```js
redactPipeline = {
  redact(text, { mode = 'input' }) -> { redactedText, redactionCount, redactionTypes },
  // mode='input': proximity-aware (high-recall, may have FP)
  // mode='reply': exact match only (high-precision, no proximity-alone)
  
  classifyExtractableContent(text) -> { hasContent, blockedClasses },
  // Returns which classes are allowed/blocked for this content
  
  isFactKeyBlacklisted(key) -> boolean,
  
  validateFactValue(value, klass) -> { ok, reason }
  // Runs Luhn check on numeric values, BIP39 check on textual values, etc.
}
```

**Constants:**

```js
PROXIMITY_KEYWORDS = ['private', 'seed', 'secret', 'cheia', 'mnemonic', 'parol', 'password', 'pwd', 'wallet export', 'private key'];
KEY_BLACKLIST = ['password', 'parol', 'pwd', 'cheia', 'secret', 'seed', 'mnemonic', 'wallet', 'private', 'pin', 'otp', '2fa_code', 'api_key', 'jwt', 'token'];
KEY_ALLOWLIST_EXCEPTIONS = ['trading_token_preference']; // legitimate uses of "token" word in keys
```

### 5.3 `server/cron/omegaMemoryCleanup.js` (NEW)

**Schedule:** Daily 02:00 UTC (low-traffic window aligned with existing cron patterns)

**Tasks (in order):**
1. Hard-delete tombstones older than 7d
2. Retry pending/transient extractions: `extraction_status='failed_transient' AND next_retry_at < now() LIMIT 50`
3. Recover stuck pending: `extraction_status='pending' AND last_attempt_at < now() - 5min` (worker crash recovery)
4. Auto-decay expired facts: `decay_at < now() AND tombstone_at IS NULL` → set `tombstone_at`, `forgotten_by='auto_decay'`
5. Watermark compaction per user: iterate users with any class at ≥80% cap → evict bottom 10% by hybrid score

### 5.4 `server/routes/omega.js` (EXTEND)

**New routes (all behind `_requireUser` middleware):**

```js
GET /api/omega/memory
Response: { facts: [{ id, class, fact_key, fact_value, importance, 
                     created_at, last_seen_at, reaffirm_count,
                     created_source_chat_id, last_source_chat_id }],
           groupedByClass: { identity: [...], style: [...], ... } }

DELETE /api/omega/memory/:id
Response: { ok: true, tombstoneUntil: epoch_ms } 
       | { ok: true, alreadyTombstoned: true }  // idempotent
       | 404 if not found OR not owned by req.user

GET /api/omega/memory/health
Response: { status: 'healthy'|'degraded'|'down'|'idle',
            last_success_at, last_attempt_at,
            failure_rate_last_hour, pending_count,
            failed_transient_count_last_hour,
            failed_permanent_count_last_24h,
            total_attempts_last_hour }
```

**Rate limit:** DELETE: 5/15s per user (more generous than Sub-A's 1/15s since per-fact granularity; multiple legitimate quick-fire deletes possible).

### 5.5 `server/services/ml/_voice/chatResponder.js` (EXTEND)

**New private method:**

```js
async _loadMemoryFacts(userId, env) -> Array<{class, fact_key, fact_value}> {
  // 1. Check ml_chat_memory_meta.last_modified_at for this user
  // 2. If cache.loadedAt < meta.last_modified_at OR cache.loadedAt < now - 30s: reload
  // 3. Reload query: SELECT ... WHERE user_id=? AND tombstone_at IS NULL 
  //    AND (decay_at IS NULL OR decay_at > unixepoch()*1000)
  //    AND (class != 'trading_strategy' OR env=? OR env IS NULL)
  // 4. JS-side hybrid scoring (better-sqlite3 lacks exp/ln)
  // 5. identity (all) + top-(12-N) by score from rest
  // 6. Cache result in process-local Map<userId, {facts, loadedAt}>
  // 7. Return facts array
}
```

**Persona injection (existing OPERATOR PREFERENCES slot, ~line 1396):**

```js
// Existing Sub-A code:
if (ctx.traderProfile && ctx.traderProfile.length > 0) {
  persona.push('OPERATOR PREFERENCES (preferințele operatorului — respect them in your reads):');
  for (const pref of ctx.traderProfile) persona.push(`  • ${pref}`);
}

// Sub-C.1 extension: ctx.traderProfile is populated by _loadMemoryFacts:
ctx.traderProfile = facts.map(f => `[${f.class}] ${f.fact_key}: ${f.fact_value}`);
```

**Extraction trigger (post-reply):**

```js
// After ml_voice_log INSERT row with extraction_status='pending':
setImmediate(() => {
  omegaMemoryService.extract({ 
    voiceLogId, userId, env, question, reply 
  }).catch(err => logger.warn('Extraction failed (will retry)', err));
});
// Note: fire-and-forget; status column tracks state for cron recovery
```

**Reply redact (NEW step before save + return):**

```js
const { redactedText, redactionCount } = redactPipeline.redact(reply, { mode: 'reply' });
if (redactionCount > 0) {
  logger.info(`Reply redacted ${redactionCount} sensitive substrings`);
  reply = redactedText;
}
```

### 5.6 `client/src/stores/omegaMemoryStore.ts` (NEW)

```ts
interface MemoryFact {
  id: number;
  class: 'identity' | 'personal_context' | 'trading_strategy' | 'temporary' | 'style';
  fact_key: string;
  fact_value: string;
  importance: number;
  reaffirm_count: number;
  created_at: number;
  last_seen_at: number;
  created_source_chat_id: number | null;
  last_source_chat_id: number | null;
}

interface OmegaMemoryStore {
  facts: MemoryFact[];
  groupedByClass: Record<string, MemoryFact[]>;
  health: { status: 'healthy'|'degraded'|'down'|'idle'; ... } | null;
  isLoading: boolean;
  error: string | null;
  
  loadFacts(): Promise<void>;
  loadHealth(): Promise<void>;
  forgetFact(factId: number): Promise<void>;
  clearLocal(): void;
}
```

Pattern matches Sub-A `omegaChatStore.ts` (Zustand, `_loadInFlight` Promise dedup, `_CACHE_TTL_MS = 60_000`).

### 5.7 `client/src/components/settings/OmegaMemorySection.tsx` (EXTEND from Sub-A)

Existing Sub-A component has clear-chat-history button. Extension:

```
┌─────────────────────────────────────────────────┐
│ Memory                                          │
│ ┌─────────────────────────────────────────────┐ │
│ │ ✅ Memory extraction: Healthy (last 2min)   │ │  ← Fix 2: health badge
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ Identity (3)                                    │
│   • name: Ovi                          🗑       │
│   • primary_language: Romanian         🗑       │
│   • comm_style: terse_technical        🗑       │
│                                                 │
│ Style (5)                                       │
│   • tone: direct                       🗑       │
│   • emoji: minimal                     🗑       │
│   ...                                           │
│                                                 │
│ Personal Context (12)                           │
│   • location: Romania                  🗑       │
│   ...                                           │
│                                                 │
│ Trading Strategy [DEMO] (8)                     │
│   • risk_per_trade: 1%                 🗑       │
│   ...                                           │
│                                                 │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ [Clear Chat History] (Sub-A button, unchanged)  │
└─────────────────────────────────────────────────┘

Confirm dialog on 🗑:
┌─────────────────────────────────────┐
│ Forget fact?                        │
│                                     │
│ Class: personal_context             │
│ Key:   location                     │
│ Value: Romania                      │
│ Added:        2026-03-12            │
│ Last seen:    2026-05-18            │
│ Reaffirmed:   8 times               │
│ Importance:   0.8                   │
│                                     │
│ Recoverable for 7 days via admin.   │
│                                     │
│   [Cancel]      [Forget]            │
└─────────────────────────────────────┘
```

---

## 6. Data Flow

### 6.1 Chat exchange with memory + extraction

```
1. POST /api/omega/chat {text: "salut, sunt din România"}
2. INPUT REDACT (server, before respond):
   - redactPipeline.redact(text, {mode: 'input'})
   - High-recall: proximity-aware redact
3. chatResponder.respond({userId, text, env}):
   a. await _loadConvoHistory(userId)  [Sub-A]
   b. await _loadMemoryFacts(userId, env)  [NEW]
   c. ctx.traderProfile = facts.map(f => `[${f.class}] ${f.fact_key}: ${f.fact_value}`)
   d. LLM call → reply
4. REPLY REDACT:
   - redactPipeline.redact(reply, {mode: 'reply'})
   - High-precision: exact regex only, no proximity-alone
5. INSERT ml_voice_log row WITH extraction_status='pending' (same TX as reply save)
6. Return reply to client (HTTP 200) — DOES NOT wait on extraction
7. setImmediate(() => omegaMemoryService.extract(...))
   ├─ Pre-run: UPDATE ml_voice_log SET last_attempt_at=now() WHERE id=?
   │   (attempts column is incremented ONLY on failure, see end of flow)
   ├─ Pipeline steps 1-7
   ├─ For each surviving fact:
   │   - Check class cap (with env scope for trading_strategy)
   │   - If at cap: _evictBottomOne (audit OMEGA_MEMORY_FACT_EVICTED)
   │   - UPSERT:
   │     - identity: ON CONFLICT(user_id, class, key) DO UPDATE 
   │         SET fact_value=excluded.fact_value,
   │             importance=MAX(importance, excluded.importance),
   │             last_seen_at=now(),
   │             last_source_chat_id=excluded.last_source_chat_id,
   │             reaffirm_count=reaffirm_count+1,
   │             updated_at=now()
   │     - others: same pattern (UNIQUE constraint enforces upsert)
   │   - audit OMEGA_MEMORY_FACT_CREATED or _UPDATED
   ├─ UPDATE ml_chat_memory_meta SET last_modified_at=now() WHERE user_id=?
   ├─ On success: UPDATE ml_voice_log SET extraction_status='done'
   └─ On failure: 
       - Classify err (transient vs permanent)
       - UPDATE ml_voice_log SET extraction_status=failed_*,
                                  attempts=attempts+1,
                                  next_retry_at=calcBackoff(attempts)
       - audit OMEGA_MEMORY_FACT_REJECTED with reason (no key/value)
```

### 6.2 Forget fact via UI

```
1. Settings → Omega tab → user clicks 🗑 on fact id=42
2. Confirm dialog with metadata
3. DELETE /api/omega/memory/42
4. Server (_requireUser):
   a. SELECT fact WHERE id=42 AND user_id=req.user.id → fail 404 if not found
   b. If tombstone_at IS NOT NULL → return {ok: true, alreadyTombstoned: true}
   c. UPDATE ml_chat_memory SET tombstone_at=now(), forgotten_by='user_ui' WHERE id=42
   d. UPDATE ml_chat_memory_meta SET last_modified_at=now() WHERE user_id=?
   e. INSERT audit_log (action='OMEGA_MEMORY_FACT_FORGOTTEN',
                       user_id, details={class, msg_id})
      — NO fact_key, NO fact_value (privacy)
   f. Return {ok: true, tombstoneUntil: now+7d}
5. Client:
   - omegaMemoryStore.forgetFact() removes from local state
   - Toast: "Forgotten. Recoverable for 7 days via admin."
6. Other PM2 workers:
   - Next chat → _loadMemoryFacts checks meta → reloads → fact gone
   - Max staleness: 30s
```

### 6.3 Background cleanup (daily cron 02:00 UTC)

```
omegaMemoryCleanup.run():

1. Hard-delete tombstones >7d:
   DELETE FROM ml_chat_memory 
     WHERE tombstone_at < unixepoch()*1000 - 7*86400*1000
   audit OMEGA_MEMORY_HARD_DELETED (count only)

2. Retry failed_transient:
   SELECT id FROM ml_voice_log
     WHERE extraction_status='failed_transient'
       AND next_retry_at < unixepoch()*1000
       AND attempts < 5
     LIMIT 50
   For each: omegaMemoryService.extract({...})

3. Recover stuck pending (worker crash):
   SELECT id FROM ml_voice_log
     WHERE extraction_status='pending'
       AND last_attempt_at < unixepoch()*1000 - 5*60*1000
     LIMIT 50
   For each: extract retry

4. Auto-decay expired:
   UPDATE ml_chat_memory
     SET tombstone_at=unixepoch()*1000, forgotten_by='auto_decay'
     WHERE decay_at < unixepoch()*1000 AND tombstone_at IS NULL
   audit per user (count only)

5. Watermark compaction (per user, per class[+env]):
   For each (user, class) at ≥80% cap:
     - Load all live facts in class[+env]
     - JS-side hybrid score
     - Sort asc, slice bottom 10%
     - Tombstone bottom 10%, forgotten_by='eviction'
     - UPDATE meta.last_modified_at
     - audit OMEGA_MEMORY_FACT_EVICTED per (class, env, score, msg_id — NO key/value)
```

### 6.4 PM2 cluster cache sync

```
Worker A:
  T+0:   _loadMemoryFacts(uid=1) → cache=[fact1, fact2], loadedAt=T+0
  T+10s: chat → cache 10s old, < 30s TTL, meta unchanged → no reload

Worker B receives DELETE /api/omega/memory/2:
  T+15s: UPDATE ml_chat_memory_meta SET last_modified_at=T+15s WHERE user_id=1

Worker A:
  T+30s: chat → _loadMemoryFacts → meta(T+15s) > cache.loadedAt(T+0) → STALE → reload
         New cache=[fact1], loadedAt=T+30s
  T+40s: chat → cache 10s old, meta unchanged → no reload

Max staleness: 30s
```

### 6.5 Extraction LLM prompt

```
[SYSTEM]
You extract personal facts from user conversation for long-term memory.
OUTPUT: JSON array [{class, key, value, importance}] or [] if nothing.

ALLOWED CLASSES: identity, style, personal_context, trading_strategy, temporary

ALLOWED IDENTITY KEYS: name, primary_language, comm_style, role
ALLOWED STYLE KEYS: tone, format, emoji, length, depth, push_back, error_handling, jokes
ALLOWED PERSONAL_CONTEXT KEYS: location, timezone, language, comm_style, 
                                profession, schedule, family_context, hobbies
TRADING_STRATEGY and TEMPORARY: open vocabulary (validated server-side via blacklist)

IMPORTANCE: 0.0-1.0 scale. 
  - identity: 0.9-1.0
  - explicit preferences with "always" / "never": 0.7-0.9
  - habitual mentions: 0.5-0.7
  - one-off mentions: 0.3-0.5

DO NOT EXTRACT (treat as if not said):
- API keys, JWT tokens, passwords, parole, PIN codes, 2FA codes
- Credit card numbers, IBAN, SSN, ID numbers
- Wallet private keys, seed phrases, mnemonics
- Addresses paired with "private" or "secret" keywords
- Anything operator explicitly marked "secret" or "don't remember"

If conversation contains sensitive content, extract OTHER facts but skip sensitive ones.

[USER]
Question: <question text>
Reply: <reply text>

[ASSISTANT]
<JSON array>
```

### 6.6 Failure classification (Fix 1)

| Error | Classification | Next |
|---|---|---|
| HTTP 429, 5xx | `failed_transient` | Backoff retry |
| Network ECONNRESET, ETIMEDOUT | `failed_transient` | Backoff retry |
| Groq timeout (8s) | `failed_transient` | Backoff retry |
| Malformed JSON (parse error) | `failed_permanent` | Stop, audit |
| Schema validation failure (wrong shape) | `failed_permanent` | Stop, audit |
| 0 facts surviving entire pipeline | `done` (legitimate "nothing to extract") | Stop, success |
| HTTP 400 from Groq (prompt rejected) | `failed_permanent` | Stop, audit |

**Backoff schedule** (`_calcBackoff(attempts)`):

| attempts (post-fail) | next_retry_at delta |
|---|---|
| 1 | now + 5min |
| 2 | now + 30min |
| 3 | now + 2h |
| 4 | now + 12h |
| 5 | → status='failed_permanent', stop |

Total recovery window: ~14.5h. Sufficient for any realistic Groq outage.

### 6.7 Health status logic (Fix 2)

```js
function calcHealthStatus({ last_attempt_at, failure_rate_last_hour, pending_count }) {
  const now = Date.now();
  const idleThreshold = 30 * 60 * 1000; // 30 min
  
  // No activity → idle (NOT down)
  if (!last_attempt_at || now - last_attempt_at > idleThreshold) {
    return 'idle';
  }
  
  // Active state
  if (pending_count > 20) return 'degraded';  // backlog override
  if (failure_rate_last_hour > 0.5) return 'down';
  if (failure_rate_last_hour > 0.1) return 'degraded';
  return 'healthy';
}
```

UI badge states:

| status | Badge |
|---|---|
| `healthy` | ✅ Memory extraction: Healthy (last 2min ago) |
| `degraded` | ⚠️ Memory extraction: Degraded (12 pending, 15% failure rate) |
| `down` | ❌ Memory extraction: Down (78% failure rate last hour) |
| `idle` | 💤 Memory extraction: Idle (no recent chat) |

**Performance note:** Health calculation queries `ml_voice_log` with last-hour filter. At single-operator load (Zeus current) = fine. If exchange rate ever exceeds 10k/hour, add `ml_extraction_metrics` rollup table — deferred to Sub-C.2.

---

## 7. Error Handling

| Failure mode | Surface | Recovery |
|---|---|---|
| LLM call fails (transient) | `extraction_status='failed_transient'`, `attempts++`, next_retry scheduled | Cron retries per backoff (~14h window) |
| LLM call fails (permanent) | `extraction_status='failed_permanent'`, audit | No retry; log warn |
| LLM returns malformed JSON | `failed_permanent` | No retry |
| LLM returns 0 facts (legitimate) | `extraction_status='done'`, no write | Normal path |
| Post-LLM regex catches sensitive | Reject fact, audit (reason=`post_regex`, NO key/value) | Other facts in same extraction may still save |
| Class allowlist gate rejects | Reject + audit (reason=`class_blocked`) | Drop |
| Fact-key blacklist | Reject + audit (reason=`key_blacklist`) | Drop |
| UPSERT conflict on identity | `ON CONFLICT DO UPDATE` with `MAX(importance)` + reaffirm++ | Audit `_UPDATED` |
| Eviction can't find facts | Skip eviction, log warn | Insert proceeds; class temp over cap (cron fixes) |
| DB unavailable during extraction | `failed_transient` (best-effort write) | Cron retries |
| DB unavailable during retrieval | Return [] from `_loadMemoryFacts`, log warn | Chat continues without memory injection |
| DB unavailable during DELETE | 500, no tombstone | UI toast "Couldn't forget — retry" |
| Cache meta-poll DB error | Use stale cache, log warn | Bounded staleness |
| Concurrent forget (two clicks) | Second UPDATE affects 0 rows | Return `{ok: true, alreadyTombstoned: true}` (idempotent) |
| PM2 worker crash mid-extraction | `extraction_status='pending'` lingers (set BEFORE LLM call) | Cron picks up @ next run (5min window), retries |
| Cron service down | Pending extractions + tombstones accumulate | After restart, cron catches up |
| Reply redact false positive | `[REDACTED:eth_address]` shown when public TX hash meant | Acceptable trade-off; `mode='reply'` (high-precision) minimizes FP |
| LLM extracts hallucinated fact | Fact persists silently until operator forgets via UI | Self-correcting via UI review |

**Key invariants:**
- **Chat path NEVER blocks on memory** — `_loadMemoryFacts` returns `[]` on any DB error
- **Audit log NEVER contains `fact_key` or `fact_value`** — only class + reason + msg_id
- **Tombstone is reversible 7d** — admin can `UPDATE tombstone_at=NULL`
- **Extraction failures degrade gracefully** — no user-visible error from background extraction; health badge surfaces aggregate state

---

## 8. Privacy & Security

### 8.1 Per-user isolation (non-negotiable)
- Every DB query filters by `user_id = ?` bound to `req.user.id`
- `_requireUser` middleware on all routes
- Extraction is scoped to single userId per call (no cross-user mixing)
- UI shows only own facts

### 8.2 3-point redact pipeline
Same regex set applied at:
1. **Input capture** — `mode='input'`, before save to `ml_voice_log.context_json.question`
2. **Pre-LLM extraction input** — `mode='input'`, before extraction prompt
3. **Post-LLM output** — `mode='input'`, on each `fact_value` returned

Plus **reply path** — `mode='reply'`, steps 1, 2, 5, 6, 7 (no LLM extraction).

### 8.3 Class-based extraction allowlist (closed enum keys)
- `identity`: closed enum 4 keys
- `style`: closed enum 8 keys
- `personal_context`: closed enum 8 keys
- `trading_strategy`: open vocab + regex pipeline + blacklist
- `temporary`: open vocab + regex pipeline + blacklist (decays fast anyway)

### 8.4 Fact-key blacklist (case-insensitive substring match)
Reject if `fact_key` contains: `password`, `parol`, `pwd`, `key`, `cheia`, `secret`, `seed`, `mnemonic`, `wallet`, `private`, `pin`, `otp`, `2fa_code`, `api_key`, `jwt`, `token` (with allowlist exception for keys starting `trading_token_preference`).

### 8.5 Audit log shape (leak-safe)

```sql
INSERT INTO audit_log (user_id, action, details, ip, created_at)
VALUES (?, ?, ?, ?, ?)
```

Where `action` is one of:
- `OMEGA_MEMORY_FACT_CREATED`
- `OMEGA_MEMORY_FACT_UPDATED`
- `OMEGA_MEMORY_FACT_REJECTED`
- `OMEGA_MEMORY_FACT_FORGOTTEN`
- `OMEGA_MEMORY_FACT_EVICTED`
- `OMEGA_MEMORY_HARD_DELETED`
- `OMEGA_MEMORY_EXTRACTION_FAILED`

And `details` JSON:
```json
{
  "class": "personal_context",
  "reason": "post_regex|class_blocked|key_blacklist|luhn|bip39|cap_evict|auto_decay",
  "msg_id": "ml_voice_log.id"
}
```

**NEVER** include `fact_key`, `fact_value`, `matched_substring`, or LLM raw output in audit details.

### 8.6 At-rest encryption
Out of scope. SQLite not encrypted at DB layer. Operator-level decision (full-disk encryption at OS layer is standard for VPS). Deferred to Sub-C.2 if explicit operator request.

---

## 9. Testing

### 9.1 Unit tests (TDD-driven)

**File breakdown (93 tests total across 5 files):**

| File | Tests | Focus |
|---|---|---|
| `redactPipeline.test.js` | 30 | Regex + mode + Luhn + BIP39 |
| `omegaMemoryService.test.js` | 30 | Extract + retrieve + forget + evict + compact (excl. health) |
| `omegaMemoryHealthService.test.js` | 6 | Health 4-state calc + edge cases |
| `omegaMemoryRoutes.test.js` | 18 | 3 endpoints × validation/auth/success/edges |
| `omegaMemoryCleanup.test.js` | 9 | 5 cron tasks + concurrent safety |
| **TOTAL** | **93** | |

---

**`tests/unit/redactPipeline.test.js`** (30 tests):

Base regex behavior (15 tests):
- Pure regex matches: private key in proximity to "private", JWT, valid Luhn cards, password=X, BIP39 12-consecutive
- Pure regex NON-matches: TX hashes standalone, ETH addresses standalone, order IDs, Unix timestamps, BIP39 with non-BIP39 interpolated
- Multi-substring redact preserves surrounding context
- Class allowlist enforcement
- Fact-key blacklist
- Luhn validation on numeric values
- BIP39 detection (12+ consecutive, NO intercalate)

Mode divergence parametrized (10 tests) — **CRITICAL per Phone risk flag**:

| Test | Input | mode='input' expect | mode='reply' expect |
|---|---|---|---|
| FP-1 | `"folosesc cheia bună pentru orice"` (proximity keyword, no hex) | REDACT | ALLOW |
| FP-2 | `"my secret recipe is delicious"` (keyword, no hex) | REDACT | ALLOW |
| LEAK-1 | `"private key: a3b1c2...d8" (64-char hex)` | REDACT | REDACT |
| LEAK-2 | `"seed phrase: abandon ability able..." (12 BIP39)` | REDACT | REDACT |
| FP-3 | `"parola contului meu Steam"` (keyword, no value) | REDACT | ALLOW |
| FP-4 | `"the password word in this sentence"` (keyword, no value) | REDACT | ALLOW |
| LEAK-3 | `"password=hunter2"` (keyword + value) | REDACT | REDACT |
| LEAK-4 | `"sk_live_abc123def456..."` (Stripe-key shape) | REDACT | REDACT |
| FP-5 | `"jwt is good for tokens"` (keyword no actual JWT) | REDACT | ALLOW |
| LEAK-5 | `"jwt: eyJhbGc.eyJzdWI.SflKxw"` (3-part dot JWT) | REDACT | REDACT |

Combined edge cases (5 tests):
- Both modes preserve non-sensitive surrounding text
- Both modes correctly count redactions
- mode param defaults to 'input' if unspecified
- Long text with multiple sensitive substrings (3+ redactions)
- Empty / very short text (no false positives)

**`tests/unit/omegaMemoryService.test.js`** (30 tests):

Extract path (10 tests):
- LLM mocked returns 3 facts, all 7 pipeline steps pass → 3 UPSERT
- 1 fact rejected by post-LLM regex → 2 UPSERT + 1 audit reject
- LLM returns malformed JSON → 0 UPSERT + `failed_permanent` (no retry)
- LLM returns 0 facts → 0 UPSERT + `done`
- LLM 429 → `failed_transient` with backoff
- LLM timeout → `failed_transient`
- Network error → `failed_transient`
- Schema validation fail → `failed_permanent`
- Backoff schedule progression (5min/30min/2h/12h)
- Max 5 attempts then `failed_permanent`

Retrieve path (7 tests):
- identity-always + top-N by hybrid score
- Exponential half-life decay (180d/90d/60d/7d per class)
- Empty cache → reload from DB
- Cache fresh (<30s, meta unchanged) → no DB query
- Meta changed (forget on other worker) → reload triggered
- DB error → returns [] (graceful degrade)
- env-filter for trading_strategy (DEMO query returns only DEMO facts)

Forget + Eviction + Reaffirm (8 tests):
- Forget: tombstone set + meta updated + audit (NO key/value)
- Forget: idempotent (second call → alreadyTombstoned)
- Forget: 404 on other-user's fact
- Eviction: class at 100% cap → lowest-score tombstoned
- Eviction: identity is UPSERT (no eviction, slot-fixed)
- Eviction: env-scoped trading_strategy (DEMO/TESTNET/REAL separate)
- Reaffirm: duplicate fact UPSERT increments reaffirm_count + updates last_source_chat_id
- Audit: regex grep over audit_log details JSON — assert NO key/value field

Compact path (5 tests):
- Tombstones >7d hard-deleted
- Watermark 80% triggers bottom-10% eviction
- Auto-decay expired facts → tombstone with forgotten_by='auto_decay'
- Per-user iteration completeness
- Concurrent safety (compact + live extract on same user)

**`tests/unit/omegaMemoryHealthService.test.js`** (6 tests) — **NEW per Phone Q3**:
- idle: last_attempt > 30min ago → 'idle' (NOT 'down')
- idle: no attempts ever → 'idle' (NOT 'down')
- healthy: low failure rate (< 10%) + pending < 20 → 'healthy'
- degraded: failure rate 10-50% → 'degraded'
- degraded: pending > 20 OVERRIDE (even when rate is low) → 'degraded'
- down: failure rate > 50% → 'down'

**`tests/unit/omegaMemoryRoutes.test.js`** (18 tests):

GET /api/omega/memory (5 tests):
- Returns per-user facts (no leak across users)
- Groups by class
- Excludes tombstoned facts
- Includes Fix 3 dual source columns + reaffirm_count
- 401 on missing JWT cookie

DELETE /api/omega/memory/:id (8 tests):
- Tombstones (not hard delete)
- Other user's fact → 404
- Already tombstoned → idempotent { alreadyTombstoned: true }
- Updates meta.last_modified_at
- Creates audit_log entry without key/value
- 401 on missing JWT cookie
- Rate limit 5/15s per user
- 404 on non-existent id

GET /api/omega/memory/health (5 tests):
- Returns all required fields
- Idle state when no recent attempts
- Healthy state when low failure
- Degraded/Down states correct
- 401 on missing JWT cookie

**`tests/unit/omegaMemoryCleanup.test.js`** (9 tests):
- Hard-delete tombstones >7d
- Watermark compaction triggers at 80% cap
- Retry failed_transient per backoff schedule (5min interval test)
- Retry failed_transient per backoff schedule (30min interval test)
- Recover stuck pending after 5min
- Auto-decay expired
- Per-user iteration completeness
- Concurrent safety (cron + live chat)
- Cron stops at attempts ≥ 5 (no infinite retry loop)

### 9.2 Manual smoke (post-deploy)

1. Have multi-message conversation with Omega revealing personal context ("Sunt din România", "Folosesc 4h timeframe", "Numele meu e Ovi")
2. Wait ~5s for async extraction
3. Settings → Omega tab → memory section visible with facts grouped by class
4. Health badge shows ✅ Healthy
5. Forget one fact via 🗑 → confirm dialog with metadata → toast success
6. New conversation: Omega does not reference forgotten fact in replies
7. Try secret leak: send "my API key is sk_test_abc123_thisShouldNotBeStored" → check DB, verify NO fact created with that value, audit log shows REJECT entry without value
8. PM2 reload → next chat references identity facts from cache reload
9. Multi-tab: forget fact in Tab A → Tab B chat picks up change within 30s
10. Simulate LLM downtime: kill Groq endpoint temporarily, send 5 messages, badge transitions to ⚠️ Degraded then ❌ Down, restore Groq, cron retries within 5min, badge returns to ✅ Healthy

### 9.3 Regression baseline

- All Sub-A tests must still pass (GET/DELETE /chat/history, _loadConvoHistory)
- Phase B/A.1/A.2/C tests untouched (orthogonal)
- Phase 2 fusion math untouched (ARCH-4 invariant)
- Full jest baseline: 7179 + ~93 new ≈ 7272 passing

---

## 10. Out of Scope / Deferred

### Sub-C.2 (next sub-project after C.1 ships)
- `/forget X` chat command with 4 fixes (multi-match disambiguation, ambiguity prompts, undo-grace, audit)
- Edit-fact mutation API (currently only forget, no edit)
- `ml_extraction_metrics` rollup table (if perf becomes issue at scale)
- At-rest encryption (if operator request)
- `active_state` storage (currently derived live from ctx)

### Sub-C.3 (after C.2)
- Contradiction proposal pattern (when LLM extracts fact that conflicts with existing — propose vs auto-overwrite)
- `ml_chat_memory_history` audit table with `reaffirm_type` taxonomy (created/reaffirmed/contradicted_then_kept/contradicted_then_replaced)

### Sub-C.future
- Embedding-based semantic retrieval (if facts >100/user becomes routine)
- Cross-user pattern learning (anonymized, opt-in)
- Memory export / import

---

## 11. Effort & Task Breakdown

### Effort

| Component | Effort |
|---|---|
| Sub-C.1 core (Q1-Q6 + 3 arch fixes) | 13-15h |
| Fix 1 transient/permanent + backoff | +2h |
| Fix 2 health badge ratio-based | +1h |
| Fix 3 dual source columns + reaffirm | +30min |
| Fix 4 reply redact mode | +30min |
| **TOTAL** | **17-19h** |

### Task breakdown (6-9 TDD tasks, subagent-driven)

Concrete plan to be generated by writing-plans skill. Anticipated tasks:

1. **Schema migration** — 7 columns + 1 partial index + 2 new tables
2. **redactPipeline** — Pure module, mode='input'/'reply', constants
3. **omegaMemoryService.retrieve + cache** — Load, hybrid score, top-N, meta-poll
4. **omegaMemoryService.extract + classification** — LLM call, 7-step pipeline, transient/permanent
5. **omegaMemoryService.forget + evict + compact** — Tombstone, watermark, audit
6. **Routes (GET memory, DELETE memory, GET health)** — _requireUser, rate limit, idempotency
7. **chatResponder integration** — _loadMemoryFacts, persona inject, reply redact
8. **Cron (omegaMemoryCleanup)** — Schedule wiring, 5 tasks
9. **Client store + UI** — omegaMemoryStore, OmegaMemorySection extension, health badge

### Critical files

| File | Action | Notes |
|---|---|---|
| `server/services/database.js` | MODIFY | Migrations (10 ordered steps per §4.4) |
| `server/services/ml/_voice/omegaMemoryService.js` | CREATE | Core memory module (extract/retrieve/forget/evict/compact) |
| `server/services/ml/_voice/omegaMemoryHealthService.js` | CREATE | Health 4-state calc (per Phone Q3 separation) |
| `server/services/ml/_voice/redactPipeline.js` | CREATE | 7-step pipeline, mode='input'/'reply' |
| `server/services/ml/_voice/chatResponder.js` | MODIFY | `_loadMemoryFacts`, persona inject, reply redact, extraction trigger |
| `server/cron/omegaMemoryCleanup.js` | CREATE | Daily 02:00 UTC |
| `server/routes/omega.js` | MODIFY | +3 routes (GET memory, DELETE :id, GET health) |
| `client/src/stores/omegaMemoryStore.ts` | CREATE | Zustand, matches Sub-A pattern |
| `client/src/components/settings/OmegaMemorySection.tsx` | MODIFY | Extend Sub-A with facts list + health badge |
| `tests/unit/redactPipeline.test.js` | CREATE | 30 tests (incl. 10 parametrized mode divergence per Phone risk flag) |
| `tests/unit/omegaMemoryService.test.js` | CREATE | 30 tests (extract/retrieve/forget/evict/compact) |
| `tests/unit/omegaMemoryHealthService.test.js` | CREATE | 6 tests (4-state calc) |
| `tests/unit/omegaMemoryRoutes.test.js` | CREATE | 18 tests (3 endpoints × auth/success/edges) |
| `tests/unit/omegaMemoryCleanup.test.js` | CREATE | 9 tests (5 cron tasks + safety) |

---

## 12. Open Questions / Locked Decisions

### Locked (Q1-Q6 + 4 Phone fixes + Fix 2 nuance)
- ✅ Silent auto-extract + UI review (Q1)
- ✅ Class-based decay (Q2)
- ✅ D' hybrid retrieval (Q3)
- ✅ A-first delivery + soft tombstone + multi-match + cross-cluster (Q4)
- ✅ Sequential fail-fast 7-step + context-aware regex + bidirectional (Q5)
- ✅ E' class-bounded caps + watermark + env-scoped (Q6)
- ✅ Fix 1: transient/permanent + backoff
- ✅ Fix 2: ratio-based 4-state health badge (idle distinct from down)
- ✅ Fix 3: dual source columns + reaffirm_count
- ✅ Fix 4: reply redact high-precision mode

### Implementer-time decisions (delegated to plan + TDD)
- Exact migration number (next available)
- Exact column types (epoch_ms always INTEGER per existing pattern)
- LLM model selection in `llmClient.js` (current: Groq Llama-3.3-70B-versatile @ 320 maxTokens, 8s timeout — unchanged unless implementer finds extraction prompts need larger context)
- Audit log table location (existing `audit_log` table per Sub-A pattern)

---

## 13. References

- Sub-A spec: `docs/superpowers/specs/2026-05-19-omega-chat-persistence-design.md`
- Sub-A plan: `docs/superpowers/plans/2026-05-19-omega-chat-persistence-sub-a.md`
- Binance project (parallel quality bar): `project_bin_telem_diag.md` memory file
- Zeus working rules: `feedback_zeus_working_rules.md` memory file
- Per-user × per-env isolation pattern: ARCH-3 invariant, see `project_phase2_server_migration.md`
- ARCH-4 invariant (Phase 2 fusion math untouched): existing convention

---

**END SPEC — Sub-C.1**

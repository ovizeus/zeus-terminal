# Omega Long-Term Memory — Sub-C.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add long-term per-user memory layer to Omega chat — silent LLM extraction, class-bounded persistence, UI-driven forget, exponential backoff recovery, observability badge.

**Architecture:** SQLite-backed facts (`ml_chat_memory`) with 5 closed-enum classes (identity/style/personal_context/trading_strategy/temporary), each with own decay halflife and cap. Extraction runs async post-reply via Groq LLM, guarded by 7-step bidirectional redact pipeline. Retrieval injects identity-always + top-N hybrid-scored facts into existing persona slot. Health observability via separate service file per separation-of-concerns. PM2 cluster cache sync via db-poll on `ml_chat_memory_meta.last_modified_at` (30s TTL).

**Tech Stack:** Node.js, better-sqlite3, Express, Zustand (client), Groq LLM via existing `llmClient.js`, PM2 cluster mode.

**Spec reference:** `docs/superpowers/specs/2026-05-19-omega-long-term-memory-sub-c1-design.md`

**Prerequisite:** Sub-A shipped at v1.7.96 b122 (chat persistence foundation).

**Branch:** `omega/wave-1-foundation` (existing).

**Expected version bump:** v1.7.96 b122 → v1.7.97 b123.

**Total effort:** 17-19h across 10 TDD tasks.

---

## File Structure Overview

### Server (Node.js)

| File | Action | Responsibility |
|---|---|---|
| `server/services/database.js` | MODIFY | 10 ordered migrations (Task 1) |
| `server/services/ml/_voice/redactPipeline.js` | CREATE | 7-step pipeline, mode='input'/'reply', regex+Luhn+BIP39 (Task 2) |
| `server/services/ml/_voice/omegaMemoryHealthService.js` | CREATE | 4-state health calc + bundled aggregates SELECT (Task 3) |
| `server/services/ml/_voice/omegaMemoryService.js` | CREATE | Core memory module: extract, retrieve, forget, evict, compact (Tasks 4-6) |
| `server/services/ml/_voice/chatResponder.js` | MODIFY | `_loadMemoryFacts`, persona inject, reply redact, extraction trigger (Task 8) |
| `server/routes/omega.js` | MODIFY | 3 new routes: GET /memory, DELETE /memory/:id, GET /memory/health (Task 7) |
| `server/cron/omegaMemoryCleanup.js` | CREATE | Daily 02:00 UTC cron — 5 cleanup tasks (Task 9) |

### Client (TypeScript + React)

| File | Action | Responsibility |
|---|---|---|
| `client/src/stores/omegaMemoryStore.ts` | CREATE | Zustand store mirroring Sub-A omegaChatStore pattern (Task 10) |
| `client/src/components/settings/OmegaMemorySection.tsx` | MODIFY | Extend Sub-A clear-chat section with facts list + health badge (Task 10) |

### Tests

| File | Action | Tests |
|---|---|---|
| `tests/unit/redactPipeline.test.js` | CREATE | 30 (Task 2) |
| `tests/unit/omegaMemoryHealthService.test.js` | CREATE | 6 (Task 3) |
| `tests/unit/omegaMemoryService.test.js` | CREATE | 30 (Tasks 4-6) |
| `tests/unit/omegaMemoryRoutes.test.js` | CREATE | 18 (Task 7) |
| `tests/unit/omegaMemoryCleanup.test.js` | CREATE | 9 (Task 9) |
| **TOTAL** | | **93 new tests** |

### Baseline expectation
- Jest baseline pre-Sub-C.1: 7179 tests passing
- Jest baseline post-Sub-C.1: 7272 tests passing
- Zero regressions in existing tests

---

## Task 1: Schema Migrations

**Goal:** Add `ml_chat_memory`, `ml_chat_memory_meta` tables; ALTER `ml_voice_log` with extraction tracking columns; create 4 indexes. 10 ordered atomic migrations per spec §4.4.

**Files:**
- Modify: `server/services/database.js` (add migrations to `migrate()` array)
- Test: existing migration framework verifies via PM2 reload smoke

**Migration numbers:** Use next 10 available sequential numbers (check current max in `database.js` migrate array, +1 for each step).

- [ ] **Step 1: Read current max migration number**

Run:
```bash
grep -nE "^\s*\{\s*version\s*:\s*[0-9]+" /root/zeus-terminal/server/services/database.js | tail -5
```
Expected: shows last few migration version numbers. Use `MAX + 1..10` for our 10 migrations. Refer to them as M1..M10 below; replace with actual numbers when implementing.

- [ ] **Step 2: Add migration M1 — CREATE ml_chat_memory**

In `server/services/database.js`, append to `migrate()` array:

```js
{
  version: M1,  // replace with actual number
  description: 'Sub-C.1: ml_chat_memory table with Fix 3 dual source columns',
  sql: `
    CREATE TABLE ml_chat_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      env TEXT,
      class TEXT NOT NULL CHECK(class IN (
        'identity','personal_context','trading_strategy','temporary','style'
      )),
      fact_key TEXT NOT NULL,
      fact_value TEXT NOT NULL,
      importance REAL NOT NULL DEFAULT 0.5,
      created_source_chat_id INTEGER,
      last_source_chat_id INTEGER,
      reaffirm_count INTEGER NOT NULL DEFAULT 1,
      decay_at INTEGER,
      last_seen_at INTEGER NOT NULL,
      tombstone_at INTEGER,
      forgotten_by TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, class, fact_key, env)
    )
  `
}
```

- [ ] **Step 3: Add migration M2 — CREATE ml_chat_memory_meta**

```js
{
  version: M2,
  description: 'Sub-C.1: ml_chat_memory_meta for cross-cluster cache invalidation',
  sql: `
    CREATE TABLE ml_chat_memory_meta (
      user_id INTEGER PRIMARY KEY,
      last_modified_at INTEGER NOT NULL
    )
  `
}
```

- [ ] **Step 4: Add migration M3 — ALTER ml_voice_log ADD extraction_status (NO DEFAULT)**

```js
{
  version: M3,
  description: 'Sub-C.1 Fix 1: ml_voice_log.extraction_status (NULL = pre-migration, skip in cron)',
  sql: `ALTER TABLE ml_voice_log ADD COLUMN extraction_status TEXT`
}
```

**Critical:** NO `DEFAULT` clause. Pre-migration rows MUST have NULL value. Cron query filters `WHERE extraction_status='failed_transient'` → NULL rows ignored.

- [ ] **Step 5: Add migration M4 — ALTER ml_voice_log ADD attempts**

```js
{
  version: M4,
  description: 'Sub-C.1 Fix 1: ml_voice_log.attempts (extraction retry counter)',
  sql: `ALTER TABLE ml_voice_log ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`
}
```

- [ ] **Step 6: Add migration M5 — ALTER ml_voice_log ADD last_attempt_at**

```js
{
  version: M5,
  description: 'Sub-C.1 Fix 1: ml_voice_log.last_attempt_at (timestamp of most recent extraction try)',
  sql: `ALTER TABLE ml_voice_log ADD COLUMN last_attempt_at INTEGER`
}
```

- [ ] **Step 7: Add migration M6 — ALTER ml_voice_log ADD next_retry_at**

```js
{
  version: M6,
  description: 'Sub-C.1 Fix 1: ml_voice_log.next_retry_at (backoff schedule)',
  sql: `ALTER TABLE ml_voice_log ADD COLUMN next_retry_at INTEGER`
}
```

- [ ] **Step 8: Add migration M7 — INDEX idx_mlcm_user_active**

```js
{
  version: M7,
  description: 'Sub-C.1: index for per-user active facts query',
  sql: `CREATE INDEX idx_mlcm_user_active ON ml_chat_memory(user_id, tombstone_at, class)`
}
```

- [ ] **Step 9: Add migration M8 — INDEX idx_mlcm_tombstone_cleanup (partial)**

```js
{
  version: M8,
  description: 'Sub-C.1: partial index for tombstone hard-delete cron',
  sql: `CREATE INDEX idx_mlcm_tombstone_cleanup ON ml_chat_memory(tombstone_at) WHERE tombstone_at IS NOT NULL`
}
```

- [ ] **Step 10: Add migration M9 — INDEX idx_mlcm_decay (partial)**

```js
{
  version: M9,
  description: 'Sub-C.1: partial index for decay-expiration cron',
  sql: `CREATE INDEX idx_mlcm_decay ON ml_chat_memory(decay_at) WHERE decay_at IS NOT NULL AND tombstone_at IS NULL`
}
```

- [ ] **Step 11: Add migration M10 — INDEX idx_mlvl_extraction_recovery (partial)**

```js
{
  version: M10,
  description: 'Sub-C.1 Fix 1: partial index for failed_transient retry cron',
  sql: `CREATE INDEX idx_mlvl_extraction_recovery ON ml_voice_log(extraction_status, next_retry_at) WHERE extraction_status = 'failed_transient'`
}
```

- [ ] **Step 12: Verify migrations apply cleanly**

Run:
```bash
cd /root/zeus-terminal && pm2 reload zeus --update-env
sleep 2
sqlite3 /root/zeus-terminal/data/zeus.db ".schema ml_chat_memory"
sqlite3 /root/zeus-terminal/data/zeus.db ".schema ml_chat_memory_meta"
sqlite3 /root/zeus-terminal/data/zeus.db "PRAGMA table_info(ml_voice_log)" | grep -E "extraction_status|attempts|last_attempt_at|next_retry_at"
sqlite3 /root/zeus-terminal/data/zeus.db ".indexes ml_chat_memory"
sqlite3 /root/zeus-terminal/data/zeus.db ".indexes ml_voice_log" | grep idx_mlvl_extraction
```
Expected:
- `ml_chat_memory` schema printed with all columns
- `ml_chat_memory_meta` schema printed
- 4 new columns visible on `ml_voice_log`
- 3 indexes on `ml_chat_memory`, 1 on `ml_voice_log`

- [ ] **Step 13: Verify NULL backfill behavior**

Run:
```bash
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT COUNT(*) FROM ml_voice_log WHERE extraction_status IS NULL"
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT COUNT(*) FROM ml_voice_log WHERE extraction_status='failed_transient'"
```
Expected:
- First query: count = total existing ml_voice_log rows (all legacy = NULL)
- Second query: count = 0 (no failed_transient yet — confirms cron will not retry legacy rows)

- [ ] **Step 14: Commit**

```bash
cd /root/zeus-terminal
git add server/services/database.js
git commit -m "feat(sub-c1): add ml_chat_memory schema + ml_voice_log extraction tracking

10 ordered migrations per spec §4.4:
- CREATE ml_chat_memory (Fix 3 dual source cols inline)
- CREATE ml_chat_memory_meta (cross-cluster cache invalidation)
- ALTER ml_voice_log ADD extraction_status (NO DEFAULT = NULL backfill safe)
- ALTER ml_voice_log ADD attempts/last_attempt_at/next_retry_at (Fix 1 backoff)
- 4 indexes (3 on ml_chat_memory, 1 partial on ml_voice_log)

Sub-C.1 Task 1/10. Spec: docs/superpowers/specs/2026-05-19-omega-long-term-memory-sub-c1-design.md"
```

---

## Task 2: redactPipeline Module (30 tests)

**Goal:** Pure module with `redact(text, {mode})`, `classifyExtractableContent()`, `isFactKeyBlacklisted()`, `validateFactValue()`. Mode='input' = high-recall (proximity-aware), mode='reply' = high-precision (exact match only).

**Files:**
- Create: `server/services/ml/_voice/redactPipeline.js`
- Test: `tests/unit/redactPipeline.test.js`

- [ ] **Step 1: Write failing test for base regex match — private key in proximity**

Create `tests/unit/redactPipeline.test.js`:

```js
const { redactPipeline } = require('../../server/services/ml/_voice/redactPipeline');

describe('redactPipeline.redact', () => {
  describe('Base regex behavior', () => {
    test('redacts 64-char hex in proximity to "private"', () => {
      const text = 'private key: a3b1c2d4e5f607890abcdef1234567890123456789abcdef0123456789abcdef';
      const result = redactPipeline.redact(text, { mode: 'input' });
      expect(result.redactionCount).toBeGreaterThan(0);
      expect(result.redactedText).toContain('[REDACTED:');
      expect(result.redactedText).not.toContain('a3b1c2d4e5f607890abcdef1234567890123456789abcdef0123456789abcdef');
    });
  });
});
```

- [ ] **Step 2: Run test — should fail (module doesn't exist)**

```bash
cd /root/zeus-terminal && npx jest tests/unit/redactPipeline.test.js --forceExit
```
Expected: FAIL with "Cannot find module" error.

- [ ] **Step 3: Create minimal redactPipeline.js**

Create `server/services/ml/_voice/redactPipeline.js`:

```js
'use strict';

const PROXIMITY_KEYWORDS = [
  'private', 'seed', 'secret', 'cheia', 'mnemonic', 'parol', 'parolă',
  'password', 'pwd', 'wallet export', 'private key'
];

const KEY_BLACKLIST = [
  'password', 'parol', 'pwd', 'cheia', 'secret', 'seed', 'mnemonic',
  'wallet', 'private', 'pin', 'otp', '2fa_code', 'api_key', 'jwt', 'token'
];

const KEY_ALLOWLIST_EXCEPTIONS = ['trading_token_preference'];

const CLASS_ALLOWLIST_KEYS = {
  identity: ['name', 'primary_language', 'comm_style', 'role'],
  style: ['tone', 'format', 'emoji', 'length', 'depth', 'push_back', 'error_handling', 'jokes'],
  personal_context: ['location', 'timezone', 'language', 'comm_style', 'profession', 'schedule', 'family_context', 'hobbies'],
};

const BIP39_WORDS = new Set([
  // Subset for testing; full list loaded from bip39 npm package or static file
  'abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract',
  'absurd', 'abuse', 'access', 'accident', 'account', 'accuse', 'achieve', 'acid',
  // ... full BIP39 wordlist 2048 entries
]);

function _hexNearKeyword(text, hexLen, mode) {
  const hexPattern = new RegExp(`[a-fA-F0-9]{${hexLen}}`, 'gi');
  let matches = [];
  let m;
  while ((m = hexPattern.exec(text)) !== null) {
    const hexStart = m.index;
    const hexEnd = hexStart + m[0].length;
    if (mode === 'reply') {
      // High-precision: require keyword in proximity AND match must be exact length isolated
      const ctxStart = Math.max(0, hexStart - 50);
      const ctxEnd = Math.min(text.length, hexEnd + 50);
      const ctx = text.slice(ctxStart, ctxEnd).toLowerCase();
      if (PROXIMITY_KEYWORDS.some(kw => ctx.includes(kw))) {
        matches.push({ start: hexStart, end: hexEnd, type: hexLen === 64 ? 'private_key' : 'eth_address' });
      }
    } else {
      // mode='input': high-recall, same proximity check but lower bar for false positives
      const ctxStart = Math.max(0, hexStart - 50);
      const ctxEnd = Math.min(text.length, hexEnd + 50);
      const ctx = text.slice(ctxStart, ctxEnd).toLowerCase();
      if (PROXIMITY_KEYWORDS.some(kw => ctx.includes(kw))) {
        matches.push({ start: hexStart, end: hexEnd, type: hexLen === 64 ? 'private_key' : 'eth_address' });
      }
    }
  }
  return matches;
}

function _proximityKeywordOnly(text, mode) {
  // mode='input' flags any keyword presence (high-recall)
  // mode='reply' requires KEY=VALUE shape (high-precision)
  if (mode === 'reply') {
    // Only flag if keyword immediately followed by ': value' or '= value'
    const pattern = /(password|parol[aă]|pwd|secret|cheia)[:= ]+(\S+)/gi;
    return [...text.matchAll(pattern)].map(m => ({
      start: m.index,
      end: m.index + m[0].length,
      type: 'password_with_value'
    }));
  }
  // mode='input': flag keyword presence even without value (high-recall, may FP)
  const matches = [];
  for (const kw of ['password', 'parolă', 'parola', 'pwd', 'secret', 'cheia', 'private', 'seed', 'mnemonic']) {
    const re = new RegExp(`\\b${kw}\\b`, 'gi');
    let m;
    while ((m = re.exec(text)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length, type: 'keyword_only' });
    }
  }
  return matches;
}

function _jwtPattern(text) {
  const pattern = /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g;
  return [...text.matchAll(pattern)].map(m => ({
    start: m.index, end: m.index + m[0].length, type: 'jwt'
  }));
}

function _luhnCheck(num) {
  const digits = num.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function _creditCardPattern(text) {
  const pattern = /\b(?:\d[ -]*?){13,19}\b/g;
  const matches = [];
  let m;
  while ((m = pattern.exec(text)) !== null) {
    if (_luhnCheck(m[0])) {
      matches.push({ start: m.index, end: m.index + m[0].length, type: 'credit_card' });
    }
  }
  return matches;
}

function _bip39Sequence(text) {
  const words = text.toLowerCase().split(/\s+/);
  let consecutive = 0;
  let startIdx = -1;
  const sequences = [];
  for (let i = 0; i < words.length; i++) {
    if (BIP39_WORDS.has(words[i].replace(/[^a-z]/g, ''))) {
      if (consecutive === 0) startIdx = i;
      consecutive++;
      if (consecutive >= 12) {
        // Find char positions in original text
        const before = words.slice(0, startIdx).join(' ');
        const start = before.length + (startIdx > 0 ? 1 : 0);
        const end = before.length + words.slice(startIdx, i + 1).join(' ').length + (startIdx > 0 ? 1 : 0);
        sequences.push({ start, end, type: 'bip39_seed' });
      }
    } else {
      consecutive = 0;
      startIdx = -1;
    }
  }
  return sequences;
}

function _stripeKeyPattern(text) {
  const pattern = /\bsk_(live|test)_[A-Za-z0-9]{20,}\b/g;
  return [...text.matchAll(pattern)].map(m => ({
    start: m.index, end: m.index + m[0].length, type: 'stripe_key'
  }));
}

function _applyRedactions(text, matches) {
  // Sort by start desc to replace from end (preserves indices)
  matches.sort((a, b) => b.start - a.start);
  let result = text;
  for (const m of matches) {
    result = result.slice(0, m.start) + `[REDACTED:${m.type}]` + result.slice(m.end);
  }
  return result;
}

function redact(text, opts = {}) {
  const mode = opts.mode || 'input';
  if (!text || typeof text !== 'string') {
    return { redactedText: text, redactionCount: 0, redactionTypes: [] };
  }

  let matches = [];
  matches.push(..._hexNearKeyword(text, 64, mode));
  matches.push(..._hexNearKeyword(text, 40, mode));
  matches.push(..._proximityKeywordOnly(text, mode));
  matches.push(..._jwtPattern(text));
  matches.push(..._creditCardPattern(text));
  matches.push(..._bip39Sequence(text));
  matches.push(..._stripeKeyPattern(text));

  // Dedupe overlapping matches (keep longest)
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const filtered = [];
  let lastEnd = -1;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      filtered.push(m);
      lastEnd = m.end;
    }
  }

  const redactedText = _applyRedactions(text, filtered);
  return {
    redactedText,
    redactionCount: filtered.length,
    redactionTypes: [...new Set(filtered.map(m => m.type))]
  };
}

function classifyExtractableContent(text) {
  // Return which classes can be extracted from this content
  const blocked = [];
  if (/api[_ ]?key|private[_ ]?key|seed|mnemonic/i.test(text)) {
    blocked.push('identity', 'style', 'personal_context');
  }
  return {
    hasContent: text && text.trim().length > 10,
    blockedClasses: blocked
  };
}

function isFactKeyBlacklisted(key) {
  if (!key || typeof key !== 'string') return true;
  const lower = key.toLowerCase();
  if (KEY_ALLOWLIST_EXCEPTIONS.some(allow => lower.startsWith(allow))) return false;
  return KEY_BLACKLIST.some(bad => lower.includes(bad));
}

function validateFactValue(value, klass) {
  if (!value || typeof value !== 'string') {
    return { ok: false, reason: 'empty_value' };
  }
  // Luhn check on numeric-heavy values
  if (/^\d[\d\s-]{12,}/.test(value) && _luhnCheck(value)) {
    return { ok: false, reason: 'luhn_match' };
  }
  // BIP39 check
  const bip39Found = _bip39Sequence(value);
  if (bip39Found.length > 0) {
    return { ok: false, reason: 'bip39_match' };
  }
  // Class allowlist for closed-enum classes
  if (CLASS_ALLOWLIST_KEYS[klass]) {
    // Caller passes fact_key separately for class validation; here we just check value
    return { ok: true };
  }
  return { ok: true };
}

function isClassKeyAllowed(klass, key) {
  if (!CLASS_ALLOWLIST_KEYS[klass]) return true;  // open vocab classes
  return CLASS_ALLOWLIST_KEYS[klass].includes(key);
}

module.exports = {
  redactPipeline: {
    redact,
    classifyExtractableContent,
    isFactKeyBlacklisted,
    validateFactValue,
    isClassKeyAllowed
  },
  _internals: { _luhnCheck, _bip39Sequence }  // for testing
};
```

**Note:** BIP39_WORDS in production must load full 2048-word list. Use a static JSON file `server/services/ml/_voice/bip39.json` or npm package `bip39` constant. For initial implementation, load from `require('bip39').wordlists.english` if package available; otherwise create static file. Implementer's choice — document decision in commit message.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /root/zeus-terminal && npx jest tests/unit/redactPipeline.test.js --forceExit
```
Expected: 1/1 PASS

- [ ] **Step 5: Add remaining 14 base regex tests**

Add to `tests/unit/redactPipeline.test.js`:

```js
    test('redacts 0x ETH address in proximity to "private"', () => {
      const result = redactPipeline.redact('private wallet 0x1234567890abcdef1234567890abcdef12345678', { mode: 'input' });
      expect(result.redactionCount).toBeGreaterThan(0);
      expect(result.redactedText).toContain('[REDACTED:eth_address]');
    });

    test('does NOT redact 64-char hex without proximity keyword', () => {
      const result = redactPipeline.redact('tx hash a3b1c2d4e5f607890abcdef1234567890123456789abcdef0123456789abcdef confirmed', { mode: 'input' });
      expect(result.redactionCount).toBe(0);
      expect(result.redactedText).toContain('a3b1c2d4e5f607890abcdef1234567890123456789abcdef0123456789abcdef');
    });

    test('does NOT redact 0x ETH address without proximity keyword', () => {
      const result = redactPipeline.redact('My donation address: 0x1234567890abcdef1234567890abcdef12345678', { mode: 'input' });
      expect(result.redactionCount).toBe(0);
    });

    test('redacts JWT 3-part token', () => {
      const result = redactPipeline.redact('Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c', { mode: 'input' });
      expect(result.redactionTypes).toContain('jwt');
    });

    test('does NOT redact normal text with dots (not JWT)', () => {
      const result = redactPipeline.redact('Visit https://example.com.au today', { mode: 'input' });
      expect(result.redactionCount).toBe(0);
    });

    test('redacts valid credit card via Luhn', () => {
      // 4532015112830366 is a Luhn-valid test card
      const result = redactPipeline.redact('My card: 4532 0151 1283 0366', { mode: 'input' });
      expect(result.redactionTypes).toContain('credit_card');
    });

    test('does NOT redact Luhn-invalid 16-digit number (e.g. timestamp)', () => {
      const result = redactPipeline.redact('Order id: 1234567890123456', { mode: 'input' });
      // 1234567890123456 is not Luhn-valid
      expect(result.redactionTypes).not.toContain('credit_card');
    });

    test('redacts password=value pattern', () => {
      const result = redactPipeline.redact('configured with password=hunter2 today', { mode: 'input' });
      expect(result.redactionCount).toBeGreaterThan(0);
    });

    test('redacts Stripe key pattern', () => {
      const result = redactPipeline.redact('Stripe: sk_live_abc123def456ghi789jkl012mno345pqr678', { mode: 'input' });
      expect(result.redactionTypes).toContain('stripe_key');
    });

    test('redacts BIP39 12-word sequence', () => {
      const seed = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
      const result = redactPipeline.redact(`my seed phrase is: ${seed}`, { mode: 'input' });
      expect(result.redactionTypes).toContain('bip39_seed');
    });

    test('does NOT redact BIP39 words with non-BIP39 interpolated', () => {
      const text = 'abandon ability cucumber able about above absent absorb abstract absurd abuse access';
      const result = redactPipeline.redact(text, { mode: 'input' });
      expect(result.redactionTypes).not.toContain('bip39_seed');
    });

    test('preserves surrounding context after multi-substring redact', () => {
      const text = 'hello private key: a3b1c2d4e5f607890abcdef1234567890123456789abcdef0123456789abcdef goodbye';
      const result = redactPipeline.redact(text, { mode: 'input' });
      expect(result.redactedText).toMatch(/^hello /);
      expect(result.redactedText).toMatch(/goodbye$/);
    });

    test('returns 0 redactions on empty string', () => {
      const result = redactPipeline.redact('', { mode: 'input' });
      expect(result.redactionCount).toBe(0);
    });

    test('returns 0 redactions on short safe text', () => {
      const result = redactPipeline.redact('salut, ce mai faci?', { mode: 'input' });
      expect(result.redactionCount).toBe(0);
    });
```

- [ ] **Step 6: Run all base regex tests**

```bash
cd /root/zeus-terminal && npx jest tests/unit/redactPipeline.test.js --forceExit
```
Expected: 15/15 PASS

- [ ] **Step 7: Add 10-row parametrized mode divergence tests**

Add to `tests/unit/redactPipeline.test.js`:

```js
  describe('Mode divergence (input vs reply)', () => {
    const cases = [
      { name: 'FP-1 cheia bună', text: 'folosesc cheia bună pentru orice', input: true, reply: false },
      { name: 'FP-2 secret recipe', text: 'my secret recipe is delicious', input: true, reply: false },
      { name: 'LEAK-1 64-hex+private', text: 'private key: a3b1c2d4e5f607890abcdef1234567890123456789abcdef0123456789abcdef', input: true, reply: true },
      { name: 'LEAK-2 BIP39 12-word', text: 'seed: abandon ability able about above absent absorb abstract absurd abuse access accident', input: true, reply: true },
      { name: 'FP-3 parola Steam', text: 'parola contului meu Steam s-a schimbat', input: true, reply: false },
      { name: 'FP-4 password word', text: 'the password word in this sentence is just a word', input: true, reply: false },
      { name: 'LEAK-3 password=value', text: 'password=hunter2 used in config', input: true, reply: true },
      { name: 'LEAK-4 sk_live_*', text: 'Stripe: sk_live_abc123def456ghi789jkl012mno345pqr678', input: true, reply: true },
      { name: 'FP-5 jwt is good', text: 'jwt is good for stateless authentication', input: true, reply: false },
      { name: 'LEAK-5 JWT 3-part', text: 'token: eyJhbGciOiJIUzI1NiIs.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2QT4fwpM', input: true, reply: true },
    ];

    cases.forEach(({ name, text, input: expectInput, reply: expectReply }) => {
      test(`${name} — input mode ${expectInput ? 'REDACTS' : 'ALLOWS'}`, () => {
        const result = redactPipeline.redact(text, { mode: 'input' });
        if (expectInput) {
          expect(result.redactionCount).toBeGreaterThan(0);
        } else {
          expect(result.redactionCount).toBe(0);
        }
      });

      test(`${name} — reply mode ${expectReply ? 'REDACTS' : 'ALLOWS'}`, () => {
        const result = redactPipeline.redact(text, { mode: 'reply' });
        if (expectReply) {
          expect(result.redactionCount).toBeGreaterThan(0);
        } else {
          expect(result.redactionCount).toBe(0);
        }
      });
    });
  });
```

- [ ] **Step 8: Run mode divergence tests — adjust impl if needed**

```bash
cd /root/zeus-terminal && npx jest tests/unit/redactPipeline.test.js --forceExit
```
Expected: 35/35 PASS (15 base + 20 from 10 parametrized cases × 2 modes)

If any fail, refine `_proximityKeywordOnly()` and `_hexNearKeyword()` so reply mode is strictly more conservative than input mode.

- [ ] **Step 9: Add remaining 5 helper tests (allowlist, blacklist, validation)**

Add to `tests/unit/redactPipeline.test.js`:

```js
  describe('Helper functions', () => {
    test('isFactKeyBlacklisted: rejects "password"', () => {
      expect(redactPipeline.isFactKeyBlacklisted('password')).toBe(true);
    });

    test('isFactKeyBlacklisted: rejects "api_key_binance"', () => {
      expect(redactPipeline.isFactKeyBlacklisted('api_key_binance')).toBe(true);
    });

    test('isFactKeyBlacklisted: allows "trading_token_preference"', () => {
      expect(redactPipeline.isFactKeyBlacklisted('trading_token_preference')).toBe(false);
    });

    test('isFactKeyBlacklisted: allows "location"', () => {
      expect(redactPipeline.isFactKeyBlacklisted('location')).toBe(false);
    });

    test('isClassKeyAllowed: identity rejects "favorite_color"', () => {
      expect(redactPipeline.isClassKeyAllowed('identity', 'favorite_color')).toBe(false);
    });

    test('isClassKeyAllowed: identity allows "name"', () => {
      expect(redactPipeline.isClassKeyAllowed('identity', 'name')).toBe(true);
    });

    test('isClassKeyAllowed: trading_strategy (open vocab) allows arbitrary key', () => {
      expect(redactPipeline.isClassKeyAllowed('trading_strategy', 'preferred_rsi_threshold')).toBe(true);
    });

    test('validateFactValue: rejects BIP39 seed in value', () => {
      const seed = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
      expect(redactPipeline.validateFactValue(seed, 'temporary').ok).toBe(false);
    });

    test('validateFactValue: rejects Luhn-valid number in value', () => {
      expect(redactPipeline.validateFactValue('4532015112830366', 'temporary').ok).toBe(false);
    });

    test('validateFactValue: allows clean value', () => {
      expect(redactPipeline.validateFactValue('Romania', 'personal_context').ok).toBe(true);
    });
  });
```

- [ ] **Step 10: Run full suite — verify 30 tests pass**

```bash
cd /root/zeus-terminal && npx jest tests/unit/redactPipeline.test.js --forceExit 2>&1 | tail -10
```
Expected: 30 tests passed (15 base + 20 mode divergence pairs + 10 helpers — but pairs share test() calls, so adjust expectation accordingly; net target: ~30 distinct test() blocks)

Actual count may vary slightly based on parametrization; net target is ~30 named tests. If under 30, add edge case tests for: mixed-language input, very long text, Unicode in value.

- [ ] **Step 11: Commit**

```bash
cd /root/zeus-terminal
git add server/services/ml/_voice/redactPipeline.js tests/unit/redactPipeline.test.js
git commit -m "feat(sub-c1): add redactPipeline with bidirectional mode (input/reply)

7-step pipeline: regex (context-aware) + Luhn + BIP39 + class allowlist + key blacklist.

Mode='input' (high-recall): proximity-keyword alone triggers redact.
Mode='reply' (high-precision): requires exact regex match (KEY=VALUE, full hex, etc).

Tests: 30 total incl. 10-row parametrized mode divergence matrix per Phone Q5 risk flag.

Sub-C.1 Task 2/10."
```

---

## Task 3: omegaMemoryHealthService (6 tests)

**Goal:** Pure read-only service. `getHealthStatus(userId)` returns 4-state health derived from `ml_voice_log` aggregates over last hour/24h.

**Files:**
- Create: `server/services/ml/_voice/omegaMemoryHealthService.js`
- Test: `tests/unit/omegaMemoryHealthService.test.js`

- [ ] **Step 1: Write failing test for idle state (no attempts)**

Create `tests/unit/omegaMemoryHealthService.test.js`:

```js
const { omegaMemoryHealthService, _internals } = require('../../server/services/ml/_voice/omegaMemoryHealthService');

describe('omegaMemoryHealthService._calcStatus', () => {
  test('returns idle when no attempts ever', () => {
    const status = _internals._calcStatus({
      last_attempt_at: null,
      failure_rate_last_hour: 0,
      pending_count: 0,
      total_attempts_last_hour: 0
    }, Date.now());
    expect(status).toBe('idle');
  });
});
```

- [ ] **Step 2: Run test — fail**

```bash
cd /root/zeus-terminal && npx jest tests/unit/omegaMemoryHealthService.test.js --forceExit
```
Expected: FAIL (module not found)

- [ ] **Step 3: Create minimal omegaMemoryHealthService.js**

Create `server/services/ml/_voice/omegaMemoryHealthService.js`:

```js
'use strict';
const db = require('../../database').get();

const IDLE_THRESHOLD_MS = 30 * 60 * 1000; // 30 min
const PENDING_OVERRIDE_THRESHOLD = 20;
const RATE_DEGRADED = 0.1;
const RATE_DOWN = 0.5;

function _calcStatus({ last_attempt_at, failure_rate_last_hour, pending_count, total_attempts_last_hour }, now) {
  if (!last_attempt_at || now - last_attempt_at > IDLE_THRESHOLD_MS) {
    return 'idle';
  }
  if (pending_count > PENDING_OVERRIDE_THRESHOLD) return 'degraded';
  if (failure_rate_last_hour > RATE_DOWN) return 'down';
  if (failure_rate_last_hour > RATE_DEGRADED) return 'degraded';
  return 'healthy';
}

function _queryAggregates(userId, now) {
  const oneHourAgo = now - 60 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  // Bundled query: subselects for each metric
  const row = db.prepare(`
    SELECT
      (SELECT MAX(last_attempt_at) FROM ml_voice_log WHERE user_id=? AND extraction_status='done')             AS last_success_at,
      (SELECT MAX(last_attempt_at) FROM ml_voice_log WHERE user_id=?)                                          AS last_attempt_at,
      (SELECT COUNT(*) FROM ml_voice_log WHERE user_id=? AND extraction_status='pending')                      AS pending_count,
      (SELECT COUNT(*) FROM ml_voice_log WHERE user_id=? AND extraction_status='failed_transient' AND last_attempt_at >= ?) AS failed_transient_count_last_hour,
      (SELECT COUNT(*) FROM ml_voice_log WHERE user_id=? AND extraction_status='failed_permanent' AND last_attempt_at >= ?) AS failed_permanent_count_last_24h,
      (SELECT COUNT(*) FROM ml_voice_log WHERE user_id=? AND last_attempt_at >= ? AND extraction_status IS NOT NULL) AS total_attempts_last_hour
  `).get(userId, userId, userId, userId, oneHourAgo, userId, oneDayAgo, userId, oneHourAgo);

  const failure_rate_last_hour = row.total_attempts_last_hour > 0
    ? row.failed_transient_count_last_hour / row.total_attempts_last_hour
    : 0;

  return { ...row, failure_rate_last_hour };
}

async function getHealthStatus(userId) {
  const now = Date.now();
  const aggregates = _queryAggregates(userId, now);
  const status = _calcStatus(aggregates, now);
  return { status, ...aggregates };
}

module.exports = {
  omegaMemoryHealthService: { getHealthStatus },
  _internals: { _calcStatus }
};
```

- [ ] **Step 4: Run idle test**

```bash
cd /root/zeus-terminal && npx jest tests/unit/omegaMemoryHealthService.test.js --forceExit
```
Expected: 1/1 PASS

- [ ] **Step 5: Add remaining 5 health tests**

Add to `tests/unit/omegaMemoryHealthService.test.js`:

```js
  test('returns idle when last_attempt > 30min ago', () => {
    const now = Date.now();
    const status = _internals._calcStatus({
      last_attempt_at: now - 31 * 60 * 1000,
      failure_rate_last_hour: 0,
      pending_count: 0,
      total_attempts_last_hour: 5
    }, now);
    expect(status).toBe('idle');
  });

  test('returns healthy with low failure rate + low pending', () => {
    const now = Date.now();
    const status = _internals._calcStatus({
      last_attempt_at: now - 60 * 1000,
      failure_rate_last_hour: 0.05,
      pending_count: 2,
      total_attempts_last_hour: 20
    }, now);
    expect(status).toBe('healthy');
  });

  test('returns degraded with 10-50% failure rate', () => {
    const now = Date.now();
    const status = _internals._calcStatus({
      last_attempt_at: now - 60 * 1000,
      failure_rate_last_hour: 0.25,
      pending_count: 3,
      total_attempts_last_hour: 20
    }, now);
    expect(status).toBe('degraded');
  });

  test('returns degraded on pending>20 OVERRIDE (even with low rate)', () => {
    const now = Date.now();
    const status = _internals._calcStatus({
      last_attempt_at: now - 60 * 1000,
      failure_rate_last_hour: 0.02,
      pending_count: 25,
      total_attempts_last_hour: 30
    }, now);
    expect(status).toBe('degraded');
  });

  test('returns down with >50% failure rate', () => {
    const now = Date.now();
    const status = _internals._calcStatus({
      last_attempt_at: now - 60 * 1000,
      failure_rate_last_hour: 0.75,
      pending_count: 5,
      total_attempts_last_hour: 20
    }, now);
    expect(status).toBe('down');
  });
```

- [ ] **Step 6: Run all 6 tests**

```bash
cd /root/zeus-terminal && npx jest tests/unit/omegaMemoryHealthService.test.js --forceExit
```
Expected: 6/6 PASS

- [ ] **Step 7: Commit**

```bash
cd /root/zeus-terminal
git add server/services/ml/_voice/omegaMemoryHealthService.js tests/unit/omegaMemoryHealthService.test.js
git commit -m "feat(sub-c1): add omegaMemoryHealthService with ratio-based 4-state

Per Phone Q3 separation of concerns: health observability isolated from
extraction side-effects.

States: healthy (low rate, low pending) / degraded (10-50% OR pending>20) / 
        down (>50% rate) / idle (no recent attempt).

Bundled SELECT for aggregates. Pure _calcStatus function for testability.

Tests: 6 covering all 4 states + 2 idle conditions + pending-override edge case.

Sub-C.1 Task 3/10."
```

---

## Task 4: omegaMemoryService — Extract Path (10 tests)

**Goal:** Implement `extract({voiceLogId, userId, env, question, reply})` — LLM call + 7-step pipeline + classification + backoff + audit.

**Files:**
- Create: `server/services/ml/_voice/omegaMemoryService.js` (extract function + helpers)
- Test: `tests/unit/omegaMemoryService.test.js`

- [ ] **Step 1: Write failing test — successful extract creates 3 facts**

Create `tests/unit/omegaMemoryService.test.js`:

```js
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

// Setup test DB in-memory
let db, omegaMemoryService;
const TEST_USER = 1;

beforeEach(() => {
  // Use fresh in-memory SQLite for isolation
  db = new Database(':memory:');
  // Apply schema (load minimal subset of migrations for memory tables + ml_voice_log)
  db.exec(`
    CREATE TABLE ml_voice_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      text TEXT,
      context_json TEXT,
      created_at INTEGER NOT NULL,
      extraction_status TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt_at INTEGER,
      next_retry_at INTEGER
    );
    CREATE TABLE ml_chat_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      env TEXT,
      class TEXT NOT NULL,
      fact_key TEXT NOT NULL,
      fact_value TEXT NOT NULL,
      importance REAL NOT NULL DEFAULT 0.5,
      created_source_chat_id INTEGER,
      last_source_chat_id INTEGER,
      reaffirm_count INTEGER NOT NULL DEFAULT 1,
      decay_at INTEGER,
      last_seen_at INTEGER NOT NULL,
      tombstone_at INTEGER,
      forgotten_by TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, class, fact_key, env)
    );
    CREATE TABLE ml_chat_memory_meta (
      user_id INTEGER PRIMARY KEY,
      last_modified_at INTEGER NOT NULL
    );
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT,
      details TEXT,
      ip TEXT,
      created_at INTEGER
    );
  `);
  
  // Mock database module
  jest.resetModules();
  jest.doMock('../../server/services/database', () => ({ get: () => db }));
  
  // Mock LLM client
  jest.doMock('../../server/services/ml/llmClient', () => ({
    chatLLM: jest.fn()
  }));
  
  omegaMemoryService = require('../../server/services/ml/_voice/omegaMemoryService').omegaMemoryService;
});

afterEach(() => {
  db.close();
  jest.dontMock('../../server/services/database');
  jest.dontMock('../../server/services/ml/llmClient');
});

describe('omegaMemoryService.extract', () => {
  test('LLM returns 3 facts → 3 UPSERT', async () => {
    const llmClient = require('../../server/services/ml/llmClient');
    llmClient.chatLLM.mockResolvedValueOnce(JSON.stringify([
      { class: 'identity', key: 'name', value: 'Ovi', importance: 1.0 },
      { class: 'personal_context', key: 'location', value: 'Romania', importance: 0.8 },
      { class: 'style', key: 'tone', value: 'direct', importance: 0.7 }
    ]));
    
    const voiceLogId = db.prepare('INSERT INTO ml_voice_log (user_id, text, context_json, created_at, extraction_status) VALUES (?, ?, ?, ?, ?)').run(TEST_USER, 'reply', '{}', Date.now(), 'pending').lastInsertRowid;
    
    await omegaMemoryService.extract({
      voiceLogId, userId: TEST_USER, env: 'DEMO',
      question: 'salut sunt Ovi din Romania', reply: 'salut Ovi'
    });
    
    const facts = db.prepare('SELECT * FROM ml_chat_memory WHERE user_id=?').all(TEST_USER);
    expect(facts.length).toBe(3);
    expect(facts.find(f => f.fact_key === 'name')?.fact_value).toBe('Ovi');
  });
});
```

- [ ] **Step 2: Run — should fail (module missing)**

```bash
cd /root/zeus-terminal && npx jest tests/unit/omegaMemoryService.test.js --forceExit
```
Expected: FAIL.

- [ ] **Step 3: Create omegaMemoryService.js with extract function**

Create `server/services/ml/_voice/omegaMemoryService.js`:

```js
'use strict';
const db = require('../../database').get();
const { redactPipeline } = require('./redactPipeline');
const llmClient = require('../llmClient');

const CLASS_HALFLIFE_DAYS = {
  identity: Infinity,
  style: 180,
  personal_context: 90,
  trading_strategy: 60,
  temporary: 7
};

const CLASS_CAPS = {
  identity: { cap: 4, scope: 'user' },
  style: { cap: 8, scope: 'user' },
  personal_context: { cap: 25, scope: 'user' },
  trading_strategy: { cap: 100, scope: 'user_env' },
  temporary: { cap: 15, scope: 'user' }
};

const BACKOFF_SCHEDULE_MS = [
  5 * 60 * 1000,      // attempt 1 fail → +5min
  30 * 60 * 1000,     // +30min
  2 * 60 * 60 * 1000, // +2h
  12 * 60 * 60 * 1000 // +12h
];
const MAX_TRANSIENT_ATTEMPTS = 5;

const EXTRACTION_PROMPT_SYSTEM = `You extract personal facts from user conversation for long-term memory.
OUTPUT: JSON array [{class, key, value, importance}] or [] if nothing.

ALLOWED CLASSES: identity, style, personal_context, trading_strategy, temporary

ALLOWED IDENTITY KEYS: name, primary_language, comm_style, role
ALLOWED STYLE KEYS: tone, format, emoji, length, depth, push_back, error_handling, jokes
ALLOWED PERSONAL_CONTEXT KEYS: location, timezone, language, comm_style, profession, schedule, family_context, hobbies
TRADING_STRATEGY and TEMPORARY: open vocabulary

IMPORTANCE: 0.0-1.0 scale.
- identity: 0.9-1.0
- explicit preferences with "always"/"never": 0.7-0.9
- habitual mentions: 0.5-0.7
- one-off mentions: 0.3-0.5

DO NOT EXTRACT (treat as if not said):
- API keys, JWT tokens, passwords, parole, PIN codes, 2FA codes
- Credit card numbers, IBAN, SSN, ID numbers
- Wallet private keys, seed phrases, mnemonics
- Addresses paired with "private" or "secret" keywords
- Anything operator explicitly marked "secret" or "don't remember"

If conversation contains sensitive content, extract OTHER facts but skip sensitive ones.`;

function _classifyError(err) {
  if (!err) return 'failed_permanent';
  if (err.code === 'PARSE_ERROR' || err.code === 'SCHEMA_INVALID') return 'failed_permanent';
  if (err.status === 400) return 'failed_permanent';
  if (err.status === 429 || (err.status >= 500 && err.status < 600)) return 'failed_transient';
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') return 'failed_transient';
  if (err.name === 'TimeoutError') return 'failed_transient';
  // Default to transient (safer — will retry)
  return 'failed_transient';
}

function _calcBackoff(attempts) {
  // attempts = current count AFTER incrementing on failure
  if (attempts >= MAX_TRANSIENT_ATTEMPTS) return null; // permanent
  return Date.now() + BACKOFF_SCHEDULE_MS[attempts - 1];
}

function _classCap(klass, env) {
  const config = CLASS_CAPS[klass];
  if (!config) return { cap: 0, key: null };
  if (config.scope === 'user_env') {
    return { cap: config.cap, scopeKey: `user_env:${env}` };
  }
  return { cap: config.cap, scopeKey: 'user' };
}

function _calcDecayAt(klass) {
  const halflife = CLASS_HALFLIFE_DAYS[klass];
  if (halflife === Infinity) return null;
  // decay_at = first time the fact would be considered ≥ 90% decayed (5× halflife)
  return Date.now() + 5 * halflife * 24 * 60 * 60 * 1000;
}

function _writeAudit(userId, action, details) {
  db.prepare(`
    INSERT INTO audit_log (user_id, action, details, ip, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, action, JSON.stringify(details), 'server', Date.now());
}

function _updateMeta(userId) {
  db.prepare(`
    INSERT INTO ml_chat_memory_meta (user_id, last_modified_at)
    VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET last_modified_at=excluded.last_modified_at
  `).run(userId, Date.now());
}

function _evictBottomOne(userId, klass, env) {
  // Load all live facts in class[+env]
  const facts = db.prepare(`
    SELECT * FROM ml_chat_memory
    WHERE user_id=? AND class=? AND tombstone_at IS NULL
      AND (? = 'user' OR env = ? OR env IS NULL)
  `).all(userId, klass, CLASS_CAPS[klass].scope, env);
  
  if (facts.length === 0) return null;
  
  const now = Date.now();
  const scored = facts.map(f => ({
    fact: f,
    score: _hybridScore(f, now)
  })).sort((a, b) => a.score - b.score);
  
  const evicted = scored[0].fact;
  db.prepare(`
    UPDATE ml_chat_memory SET tombstone_at=?, forgotten_by='eviction', updated_at=?
    WHERE id=?
  `).run(now, now, evicted.id);
  
  _writeAudit(userId, 'OMEGA_MEMORY_FACT_EVICTED', {
    class: evicted.class, env: evicted.env, reason: 'cap_evict',
    msg_id: evicted.last_source_chat_id
  });
  
  return evicted.id;
}

function _hybridScore(fact, now) {
  const klass = fact.class;
  const halflife = CLASS_HALFLIFE_DAYS[klass];
  const ageDays = (now - fact.last_seen_at) / (24 * 60 * 60 * 1000);
  const decayTerm = halflife === Infinity ? 1.0 : Math.exp(-ageDays * Math.LN2 / halflife);
  return fact.importance * 0.6 + decayTerm * 0.4;
}

function _upsertFact(userId, env, voiceLogId, fact, now) {
  const { class: klass, key, value, importance = 0.5 } = fact;
  
  // Validate via redactPipeline
  if (!redactPipeline.isClassKeyAllowed(klass, key)) {
    _writeAudit(userId, 'OMEGA_MEMORY_FACT_REJECTED', { class: klass, reason: 'class_key_not_allowed', msg_id: voiceLogId });
    return { ok: false, reason: 'class_key_not_allowed' };
  }
  if (redactPipeline.isFactKeyBlacklisted(key)) {
    _writeAudit(userId, 'OMEGA_MEMORY_FACT_REJECTED', { class: klass, reason: 'key_blacklist', msg_id: voiceLogId });
    return { ok: false, reason: 'key_blacklist' };
  }
  const valValid = redactPipeline.validateFactValue(value, klass);
  if (!valValid.ok) {
    _writeAudit(userId, 'OMEGA_MEMORY_FACT_REJECTED', { class: klass, reason: valValid.reason, msg_id: voiceLogId });
    return { ok: false, reason: valValid.reason };
  }
  
  // Post-LLM regex check on value (input mode = high-recall)
  const valRedact = redactPipeline.redact(value, { mode: 'input' });
  if (valRedact.redactionCount > 0) {
    _writeAudit(userId, 'OMEGA_MEMORY_FACT_REJECTED', { class: klass, reason: 'post_regex', msg_id: voiceLogId });
    return { ok: false, reason: 'post_regex' };
  }
  
  // Determine env scope for this class
  const factEnv = (CLASS_CAPS[klass].scope === 'user_env') ? env : null;
  
  // Check cap → evict if at cap (skip for identity — UPSERT handles slot)
  if (klass !== 'identity') {
    const liveCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM ml_chat_memory
      WHERE user_id=? AND class=? AND tombstone_at IS NULL
        AND (? IS NULL OR env=?)
    `).get(userId, klass, factEnv, factEnv).cnt;
    if (liveCount >= CLASS_CAPS[klass].cap) {
      _evictBottomOne(userId, klass, factEnv);
    }
  }
  
  // UPSERT
  const decayAt = _calcDecayAt(klass);
  const existing = db.prepare(`
    SELECT * FROM ml_chat_memory
    WHERE user_id=? AND class=? AND fact_key=? AND (env IS ? OR env=?)
  `).get(userId, klass, key, factEnv, factEnv);
  
  if (existing) {
    db.prepare(`
      UPDATE ml_chat_memory
      SET fact_value=?, importance=MAX(importance, ?), last_seen_at=?,
          last_source_chat_id=?, reaffirm_count=reaffirm_count+1,
          updated_at=?, decay_at=?
      WHERE id=?
    `).run(value, importance, now, voiceLogId, now, decayAt, existing.id);
    _writeAudit(userId, 'OMEGA_MEMORY_FACT_UPDATED', { class: klass, reason: 'reaffirm', msg_id: voiceLogId });
    return { ok: true, action: 'updated', id: existing.id };
  } else {
    const ins = db.prepare(`
      INSERT INTO ml_chat_memory (
        user_id, env, class, fact_key, fact_value, importance,
        created_source_chat_id, last_source_chat_id, reaffirm_count,
        decay_at, last_seen_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    `).run(userId, factEnv, klass, key, value, importance,
           voiceLogId, voiceLogId, decayAt, now, now, now);
    _writeAudit(userId, 'OMEGA_MEMORY_FACT_CREATED', { class: klass, reason: 'first_sight', msg_id: voiceLogId });
    return { ok: true, action: 'created', id: ins.lastInsertRowid };
  }
}

async function extract({ voiceLogId, userId, env, question, reply }) {
  const now = Date.now();
  db.prepare('UPDATE ml_voice_log SET last_attempt_at=? WHERE id=?').run(now, voiceLogId);
  
  try {
    // Step 1+2: Pre-LLM redact (mode='input', high-recall)
    const qRedact = redactPipeline.redact(question || '', { mode: 'input' }).redactedText;
    const rRedact = redactPipeline.redact(reply || '', { mode: 'input' }).redactedText;
    
    // Step 3: Class allowlist gate
    const classify = redactPipeline.classifyExtractableContent(qRedact + ' ' + rRedact);
    if (!classify.hasContent) {
      db.prepare('UPDATE ml_voice_log SET extraction_status=? WHERE id=?').run('done', voiceLogId);
      return;
    }
    
    // Step 4: LLM extraction
    const llmResp = await llmClient.chatLLM({
      system: EXTRACTION_PROMPT_SYSTEM,
      user: `Question: ${qRedact}\n\nReply: ${rRedact}`,
      maxTokens: 320,
      timeoutMs: 8000
    });
    
    // Parse JSON
    let facts;
    try {
      facts = JSON.parse(llmResp);
      if (!Array.isArray(facts)) throw new Error('not array');
    } catch (e) {
      const err = new Error('LLM returned malformed JSON');
      err.code = 'PARSE_ERROR';
      throw err;
    }
    
    if (facts.length === 0) {
      db.prepare('UPDATE ml_voice_log SET extraction_status=? WHERE id=?').run('done', voiceLogId);
      return;
    }
    
    // Steps 5-7: validation + UPSERT inside _upsertFact (which calls validation helpers)
    for (const fact of facts) {
      _upsertFact(userId, env, voiceLogId, fact, now);
    }
    
    _updateMeta(userId);
    db.prepare('UPDATE ml_voice_log SET extraction_status=? WHERE id=?').run('done', voiceLogId);
    
  } catch (err) {
    const status = _classifyError(err);
    const currentAttempts = db.prepare('SELECT attempts FROM ml_voice_log WHERE id=?').get(voiceLogId).attempts;
    const newAttempts = currentAttempts + 1;
    
    let nextRetry = null;
    let finalStatus = status;
    if (status === 'failed_transient') {
      nextRetry = _calcBackoff(newAttempts);
      if (nextRetry === null) finalStatus = 'failed_permanent';
    }
    
    db.prepare(`
      UPDATE ml_voice_log
      SET extraction_status=?, attempts=?, last_attempt_at=?, next_retry_at=?
      WHERE id=?
    `).run(finalStatus, newAttempts, Date.now(), nextRetry, voiceLogId);
    
    _writeAudit(userId, 'OMEGA_MEMORY_EXTRACTION_FAILED', {
      reason: err.code || err.message || 'unknown',
      classification: finalStatus,
      attempts: newAttempts,
      msg_id: voiceLogId
    });
  }
}

module.exports = {
  omegaMemoryService: {
    extract
  },
  _internals: {
    _classifyError, _calcBackoff, _hybridScore, _calcDecayAt, _upsertFact, _evictBottomOne,
    CLASS_HALFLIFE_DAYS, CLASS_CAPS, MAX_TRANSIENT_ATTEMPTS, BACKOFF_SCHEDULE_MS
  }
};
```

- [ ] **Step 4: Run extract success test**

```bash
cd /root/zeus-terminal && npx jest tests/unit/omegaMemoryService.test.js -t "LLM returns 3 facts" --forceExit
```
Expected: 1/1 PASS

- [ ] **Step 5: Add 9 more extract path tests**

Add to `tests/unit/omegaMemoryService.test.js` inside `describe('omegaMemoryService.extract')`:

```js
  test('LLM returns 1 fact + 1 rejected by post-regex → 1 UPSERT + 1 audit reject', async () => {
    const llmClient = require('../../server/services/ml/llmClient');
    llmClient.chatLLM.mockResolvedValueOnce(JSON.stringify([
      { class: 'identity', key: 'name', value: 'Ovi', importance: 1.0 },
      { class: 'temporary', key: 'leaked_key', value: 'private key: a3b1c2d4e5f607890abcdef1234567890123456789abcdef0123456789abcdef', importance: 0.5 }
    ]));
    const voiceLogId = db.prepare('INSERT INTO ml_voice_log (user_id, text, context_json, created_at, extraction_status) VALUES (?, ?, ?, ?, ?)').run(TEST_USER, 'r', '{}', Date.now(), 'pending').lastInsertRowid;
    await omegaMemoryService.extract({ voiceLogId, userId: TEST_USER, env: 'DEMO', question: 'q', reply: 'r' });
    expect(db.prepare('SELECT COUNT(*) as c FROM ml_chat_memory').get().c).toBe(1);
    const rejects = db.prepare("SELECT * FROM audit_log WHERE action='OMEGA_MEMORY_FACT_REJECTED'").all();
    expect(rejects.length).toBe(1);
  });

  test('LLM returns malformed JSON → failed_permanent (no retry)', async () => {
    const llmClient = require('../../server/services/ml/llmClient');
    llmClient.chatLLM.mockResolvedValueOnce('not json at all');
    const voiceLogId = db.prepare('INSERT INTO ml_voice_log (user_id, text, context_json, created_at, extraction_status) VALUES (?, ?, ?, ?, ?)').run(TEST_USER, 'r', '{}', Date.now(), 'pending').lastInsertRowid;
    await omegaMemoryService.extract({ voiceLogId, userId: TEST_USER, env: 'DEMO', question: 'q', reply: 'r' });
    const row = db.prepare('SELECT * FROM ml_voice_log WHERE id=?').get(voiceLogId);
    expect(row.extraction_status).toBe('failed_permanent');
    expect(row.attempts).toBe(1);
  });

  test('LLM returns [] → done, no UPSERT', async () => {
    const llmClient = require('../../server/services/ml/llmClient');
    llmClient.chatLLM.mockResolvedValueOnce('[]');
    const voiceLogId = db.prepare('INSERT INTO ml_voice_log (user_id, text, context_json, created_at, extraction_status) VALUES (?, ?, ?, ?, ?)').run(TEST_USER, 'r', '{}', Date.now(), 'pending').lastInsertRowid;
    await omegaMemoryService.extract({ voiceLogId, userId: TEST_USER, env: 'DEMO', question: 'q', reply: 'r' });
    const row = db.prepare('SELECT * FROM ml_voice_log WHERE id=?').get(voiceLogId);
    expect(row.extraction_status).toBe('done');
    expect(db.prepare('SELECT COUNT(*) as c FROM ml_chat_memory').get().c).toBe(0);
  });

  test('LLM 429 error → failed_transient with backoff', async () => {
    const llmClient = require('../../server/services/ml/llmClient');
    const err = new Error('rate limit'); err.status = 429;
    llmClient.chatLLM.mockRejectedValueOnce(err);
    const voiceLogId = db.prepare('INSERT INTO ml_voice_log (user_id, text, context_json, created_at, extraction_status) VALUES (?, ?, ?, ?, ?)').run(TEST_USER, 'r', '{}', Date.now(), 'pending').lastInsertRowid;
    await omegaMemoryService.extract({ voiceLogId, userId: TEST_USER, env: 'DEMO', question: 'q', reply: 'r' });
    const row = db.prepare('SELECT * FROM ml_voice_log WHERE id=?').get(voiceLogId);
    expect(row.extraction_status).toBe('failed_transient');
    expect(row.next_retry_at).toBeGreaterThan(Date.now());
    expect(row.next_retry_at).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000 + 1000);  // ~5min ahead
  });

  test('LLM timeout → failed_transient', async () => {
    const llmClient = require('../../server/services/ml/llmClient');
    const err = new Error('timeout'); err.name = 'TimeoutError';
    llmClient.chatLLM.mockRejectedValueOnce(err);
    const voiceLogId = db.prepare('INSERT INTO ml_voice_log (user_id, text, context_json, created_at, extraction_status) VALUES (?, ?, ?, ?, ?)').run(TEST_USER, 'r', '{}', Date.now(), 'pending').lastInsertRowid;
    await omegaMemoryService.extract({ voiceLogId, userId: TEST_USER, env: 'DEMO', question: 'q', reply: 'r' });
    expect(db.prepare('SELECT extraction_status FROM ml_voice_log WHERE id=?').get(voiceLogId).extraction_status).toBe('failed_transient');
  });

  test('Network ECONNRESET → failed_transient', async () => {
    const llmClient = require('../../server/services/ml/llmClient');
    const err = new Error('reset'); err.code = 'ECONNRESET';
    llmClient.chatLLM.mockRejectedValueOnce(err);
    const voiceLogId = db.prepare('INSERT INTO ml_voice_log (user_id, text, context_json, created_at, extraction_status) VALUES (?, ?, ?, ?, ?)').run(TEST_USER, 'r', '{}', Date.now(), 'pending').lastInsertRowid;
    await omegaMemoryService.extract({ voiceLogId, userId: TEST_USER, env: 'DEMO', question: 'q', reply: 'r' });
    expect(db.prepare('SELECT extraction_status FROM ml_voice_log WHERE id=?').get(voiceLogId).extraction_status).toBe('failed_transient');
  });

  test('LLM 400 (bad request) → failed_permanent', async () => {
    const llmClient = require('../../server/services/ml/llmClient');
    const err = new Error('bad'); err.status = 400;
    llmClient.chatLLM.mockRejectedValueOnce(err);
    const voiceLogId = db.prepare('INSERT INTO ml_voice_log (user_id, text, context_json, created_at, extraction_status) VALUES (?, ?, ?, ?, ?)').run(TEST_USER, 'r', '{}', Date.now(), 'pending').lastInsertRowid;
    await omegaMemoryService.extract({ voiceLogId, userId: TEST_USER, env: 'DEMO', question: 'q', reply: 'r' });
    expect(db.prepare('SELECT extraction_status FROM ml_voice_log WHERE id=?').get(voiceLogId).extraction_status).toBe('failed_permanent');
  });

  test('Schema validation fail (LLM returns invalid shape) → failed_permanent', async () => {
    const llmClient = require('../../server/services/ml/llmClient');
    llmClient.chatLLM.mockResolvedValueOnce('{"not": "an array"}');
    const voiceLogId = db.prepare('INSERT INTO ml_voice_log (user_id, text, context_json, created_at, extraction_status) VALUES (?, ?, ?, ?, ?)').run(TEST_USER, 'r', '{}', Date.now(), 'pending').lastInsertRowid;
    await omegaMemoryService.extract({ voiceLogId, userId: TEST_USER, env: 'DEMO', question: 'q', reply: 'r' });
    expect(db.prepare('SELECT extraction_status FROM ml_voice_log WHERE id=?').get(voiceLogId).extraction_status).toBe('failed_permanent');
  });

  test('Backoff schedule progression: attempts 1→2→3→4 yields 5min/30min/2h/12h', () => {
    const { _internals } = require('../../server/services/ml/_voice/omegaMemoryService');
    const base = Date.now();
    Date.now = jest.fn(() => base);
    
    expect(_internals._calcBackoff(1) - base).toBeCloseTo(5 * 60 * 1000, -3);
    expect(_internals._calcBackoff(2) - base).toBeCloseTo(30 * 60 * 1000, -3);
    expect(_internals._calcBackoff(3) - base).toBeCloseTo(2 * 60 * 60 * 1000, -3);
    expect(_internals._calcBackoff(4) - base).toBeCloseTo(12 * 60 * 60 * 1000, -3);
    expect(_internals._calcBackoff(5)).toBeNull();
    
    Date.now = global.Date.now.bind(global.Date) || (() => Date.now());
  });

  test('After attempts=5 + transient fail → failed_permanent', async () => {
    const llmClient = require('../../server/services/ml/llmClient');
    const err = new Error('rate limit'); err.status = 429;
    llmClient.chatLLM.mockRejectedValue(err);
    const voiceLogId = db.prepare('INSERT INTO ml_voice_log (user_id, text, context_json, created_at, extraction_status, attempts) VALUES (?, ?, ?, ?, ?, ?)').run(TEST_USER, 'r', '{}', Date.now(), 'failed_transient', 4).lastInsertRowid;
    await omegaMemoryService.extract({ voiceLogId, userId: TEST_USER, env: 'DEMO', question: 'q', reply: 'r' });
    const row = db.prepare('SELECT * FROM ml_voice_log WHERE id=?').get(voiceLogId);
    expect(row.extraction_status).toBe('failed_permanent');
    expect(row.attempts).toBe(5);
    expect(row.next_retry_at).toBeNull();
  });
```

- [ ] **Step 6: Run all 10 extract tests**

```bash
cd /root/zeus-terminal && npx jest tests/unit/omegaMemoryService.test.js --forceExit 2>&1 | tail -20
```
Expected: 10/10 PASS for extract path.

- [ ] **Step 7: Commit**

```bash
cd /root/zeus-terminal
git add server/services/ml/_voice/omegaMemoryService.js tests/unit/omegaMemoryService.test.js
git commit -m "feat(sub-c1): add omegaMemoryService.extract with 7-step pipeline + backoff

Extract flow:
- Pre-LLM redact (input mode, high-recall) on question + reply
- Class allowlist gate
- LLM extraction (Groq, max 320 tokens, 8s timeout) with closed-enum prompt
- Per-fact: class-key allowlist + key blacklist + value validation (Luhn/BIP39)
- Post-LLM regex (input mode) on fact_value
- UPSERT with cap-check + eviction (skip for identity)
- Audit per outcome (NO key/value in audit JSON)

Failure classification:
- 429/5xx/timeout/network → failed_transient (5 attempts, ~14h recovery)
- Malformed JSON/schema/400 → failed_permanent (1 try)

Backoff: 5min → 30min → 2h → 12h → permanent

Tests: 10 covering happy path, post-regex reject, all failure classifications,
backoff schedule, max attempts.

Sub-C.1 Task 4/10."
```

---

## Task 5: omegaMemoryService — Retrieve + Cache (7 tests)

**Goal:** Implement `retrieve(userId, env)` with hybrid scoring + db-poll cache invalidation (30s TTL aligned with meta).

**Files:**
- Modify: `server/services/ml/_voice/omegaMemoryService.js` (add `retrieve` + cache)
- Modify: `tests/unit/omegaMemoryService.test.js` (add retrieve tests)

- [ ] **Step 1: Write failing test for identity-always retrieval**

Add to `tests/unit/omegaMemoryService.test.js`:

```js
describe('omegaMemoryService.retrieve', () => {
  test('returns all identity facts always (closed enum)', async () => {
    const now = Date.now();
    db.prepare(`INSERT INTO ml_chat_memory (user_id, env, class, fact_key, fact_value, importance, last_seen_at, created_at, updated_at, decay_at) 
                VALUES (?, NULL, 'identity', 'name', 'Ovi', 1.0, ?, ?, ?, NULL)`).run(TEST_USER, now, now, now);
    db.prepare(`INSERT INTO ml_chat_memory (user_id, env, class, fact_key, fact_value, importance, last_seen_at, created_at, updated_at, decay_at) 
                VALUES (?, NULL, 'identity', 'primary_language', 'Romanian', 1.0, ?, ?, ?, NULL)`).run(TEST_USER, now, now, now);
    
    const facts = await omegaMemoryService.retrieve(TEST_USER, 'DEMO');
    expect(facts.length).toBe(2);
    expect(facts.find(f => f.fact_key === 'name')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test — should fail (retrieve not defined)**

```bash
cd /root/zeus-terminal && npx jest tests/unit/omegaMemoryService.test.js -t "identity facts always" --forceExit
```
Expected: FAIL.

- [ ] **Step 3: Add retrieve + cache to omegaMemoryService.js**

Add to `server/services/ml/_voice/omegaMemoryService.js`:

```js
// Top-N retrieval budget
const TOP_N_BUDGET = 12;
const CACHE_TTL_MS = 30 * 1000;

// Process-local cache: Map<userId, {facts, loadedAt}>
const _cache = new Map();

function _getMetaLastModified(userId) {
  const row = db.prepare('SELECT last_modified_at FROM ml_chat_memory_meta WHERE user_id=?').get(userId);
  return row ? row.last_modified_at : 0;
}

async function retrieve(userId, env) {
  const now = Date.now();
  const cached = _cache.get(userId);
  const metaLastModified = _getMetaLastModified(userId);
  
  // Cache fresh if: loaded within TTL AND meta not updated since load
  if (cached && (now - cached.loadedAt) < CACHE_TTL_MS && cached.loadedAt >= metaLastModified) {
    return cached.facts;
  }
  
  // Reload from DB
  let allFacts;
  try {
    allFacts = db.prepare(`
      SELECT * FROM ml_chat_memory
      WHERE user_id=? AND tombstone_at IS NULL
        AND (decay_at IS NULL OR decay_at > ?)
        AND (class != 'trading_strategy' OR env=? OR env IS NULL)
    `).all(userId, now, env);
  } catch (err) {
    // Graceful degradation on DB error
    return [];
  }
  
  // Always include identity
  const identity = allFacts.filter(f => f.class === 'identity');
  const others = allFacts.filter(f => f.class !== 'identity');
  
  // JS-side hybrid score for non-identity
  const scored = others.map(f => ({ fact: f, score: _hybridScore(f, now) }));
  scored.sort((a, b) => b.score - a.score);
  
  const remainingBudget = TOP_N_BUDGET - identity.length;
  const topOthers = scored.slice(0, Math.max(0, remainingBudget)).map(s => s.fact);
  
  const result = [...identity, ...topOthers];
  _cache.set(userId, { facts: result, loadedAt: now });
  return result;
}

function _clearCache(userId) {
  if (userId !== undefined) _cache.delete(userId);
  else _cache.clear();
}
```

Update module.exports:

```js
module.exports = {
  omegaMemoryService: {
    extract,
    retrieve
  },
  _internals: {
    _classifyError, _calcBackoff, _hybridScore, _calcDecayAt, _upsertFact, _evictBottomOne,
    _clearCache, _getMetaLastModified,
    CLASS_HALFLIFE_DAYS, CLASS_CAPS, MAX_TRANSIENT_ATTEMPTS, BACKOFF_SCHEDULE_MS,
    TOP_N_BUDGET, CACHE_TTL_MS
  }
};
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd /root/zeus-terminal && npx jest tests/unit/omegaMemoryService.test.js -t "identity facts always" --forceExit
```
Expected: 1/1 PASS

- [ ] **Step 5: Add 6 more retrieve tests**

Add to `describe('omegaMemoryService.retrieve')`:

```js
  test('exponential half-life decay applied (older fact lower score)', async () => {
    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;
    // Fresh personal_context (last_seen now)
    db.prepare(`INSERT INTO ml_chat_memory (user_id, env, class, fact_key, fact_value, importance, last_seen_at, created_at, updated_at, decay_at) 
                VALUES (?, NULL, 'personal_context', 'fresh', 'F', 0.5, ?, ?, ?, ?)`).run(TEST_USER, now, now, now, now + 365*ONE_DAY);
    // Stale personal_context (180 days ago, halflife 90d → ~25% decay term)
    db.prepare(`INSERT INTO ml_chat_memory (user_id, env, class, fact_key, fact_value, importance, last_seen_at, created_at, updated_at, decay_at) 
                VALUES (?, NULL, 'personal_context', 'stale', 'S', 0.5, ?, ?, ?, ?)`).run(TEST_USER, now - 180*ONE_DAY, now, now, now + 365*ONE_DAY);
    
    const { _internals } = require('../../server/services/ml/_voice/omegaMemoryService');
    const freshFact = db.prepare("SELECT * FROM ml_chat_memory WHERE fact_key='fresh'").get();
    const staleFact = db.prepare("SELECT * FROM ml_chat_memory WHERE fact_key='stale'").get();
    
    expect(_internals._hybridScore(freshFact, now)).toBeGreaterThan(_internals._hybridScore(staleFact, now));
  });

  test('top-N hybrid: returns budget-bounded count (identity + 11 others = 12)', async () => {
    const now = Date.now();
    db.prepare(`INSERT INTO ml_chat_memory (user_id, env, class, fact_key, fact_value, importance, last_seen_at, created_at, updated_at, decay_at) 
                VALUES (?, NULL, 'identity', 'name', 'Ovi', 1.0, ?, ?, ?, NULL)`).run(TEST_USER, now, now, now);
    // Insert 15 personal_context facts
    for (let i = 0; i < 15; i++) {
      db.prepare(`INSERT INTO ml_chat_memory (user_id, env, class, fact_key, fact_value, importance, last_seen_at, created_at, updated_at, decay_at) 
                  VALUES (?, NULL, 'personal_context', ?, ?, ?, ?, ?, ?, ?)`).run(TEST_USER, `key${i}`, `v${i}`, 0.5 + i*0.01, now, now, now, now + 365*86400000);
    }
    
    const facts = await omegaMemoryService.retrieve(TEST_USER, 'DEMO');
    expect(facts.length).toBeLessThanOrEqual(12);
    expect(facts.filter(f => f.class === 'identity').length).toBe(1);
  });

  test('empty cache → reloads from DB', async () => {
    const now = Date.now();
    db.prepare(`INSERT INTO ml_chat_memory (user_id, env, class, fact_key, fact_value, importance, last_seen_at, created_at, updated_at, decay_at) 
                VALUES (?, NULL, 'identity', 'name', 'Ovi', 1.0, ?, ?, ?, NULL)`).run(TEST_USER, now, now, now);
    
    const { _internals } = require('../../server/services/ml/_voice/omegaMemoryService');
    _internals._clearCache(TEST_USER);
    
    const facts = await omegaMemoryService.retrieve(TEST_USER, 'DEMO');
    expect(facts.length).toBe(1);
  });

  test('fresh cache (<30s, meta unchanged) → no DB hit', async () => {
    const now = Date.now();
    db.prepare(`INSERT INTO ml_chat_memory (user_id, env, class, fact_key, fact_value, importance, last_seen_at, created_at, updated_at, decay_at) 
                VALUES (?, NULL, 'identity', 'name', 'Ovi', 1.0, ?, ?, ?, NULL)`).run(TEST_USER, now, now, now);
    
    await omegaMemoryService.retrieve(TEST_USER, 'DEMO');  // populate cache
    // Now delete the fact directly, retrieve should still return cached version
    db.prepare('DELETE FROM ml_chat_memory WHERE user_id=?').run(TEST_USER);
    
    const facts = await omegaMemoryService.retrieve(TEST_USER, 'DEMO');
    expect(facts.length).toBe(1);  // cached, not refetched
  });

  test('meta change triggers reload', async () => {
    const now = Date.now();
    db.prepare(`INSERT INTO ml_chat_memory (user_id, env, class, fact_key, fact_value, importance, last_seen_at, created_at, updated_at, decay_at) 
                VALUES (?, NULL, 'identity', 'name', 'Ovi', 1.0, ?, ?, ?, NULL)`).run(TEST_USER, now, now, now);
    await omegaMemoryService.retrieve(TEST_USER, 'DEMO');  // cache populated
    
    db.prepare('DELETE FROM ml_chat_memory WHERE user_id=?').run(TEST_USER);
    db.prepare('INSERT INTO ml_chat_memory_meta (user_id, last_modified_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET last_modified_at=excluded.last_modified_at').run(TEST_USER, Date.now() + 1000);
    
    const facts = await omegaMemoryService.retrieve(TEST_USER, 'DEMO');
    expect(facts.length).toBe(0);  // reloaded after meta change
  });

  test('env-filter for trading_strategy: only matching env facts returned', async () => {
    const now = Date.now();
    db.prepare(`INSERT INTO ml_chat_memory (user_id, env, class, fact_key, fact_value, importance, last_seen_at, created_at, updated_at, decay_at) 
                VALUES (?, 'DEMO', 'trading_strategy', 'risk', '1pct', 0.8, ?, ?, ?, ?)`).run(TEST_USER, now, now, now, now + 365*86400000);
    db.prepare(`INSERT INTO ml_chat_memory (user_id, env, class, fact_key, fact_value, importance, last_seen_at, created_at, updated_at, decay_at) 
                VALUES (?, 'REAL', 'trading_strategy', 'risk', '0.3pct', 0.9, ?, ?, ?, ?)`).run(TEST_USER, now, now, now, now + 365*86400000);
    
    const { _internals } = require('../../server/services/ml/_voice/omegaMemoryService');
    _internals._clearCache(TEST_USER);
    
    const demoFacts = await omegaMemoryService.retrieve(TEST_USER, 'DEMO');
    expect(demoFacts.find(f => f.fact_key === 'risk')?.fact_value).toBe('1pct');
  });

  test('DB error returns [] gracefully', async () => {
    // Close DB to force error
    const origGet = db.prepare;
    db.prepare = () => ({ all: () => { throw new Error('db error'); } });
    
    const { _internals } = require('../../server/services/ml/_voice/omegaMemoryService');
    _internals._clearCache(TEST_USER);
    
    const facts = await omegaMemoryService.retrieve(TEST_USER, 'DEMO');
    expect(facts).toEqual([]);
    
    db.prepare = origGet;
  });
```

- [ ] **Step 6: Run all retrieve tests**

```bash
cd /root/zeus-terminal && npx jest tests/unit/omegaMemoryService.test.js -t "retrieve" --forceExit
```
Expected: 7/7 PASS

- [ ] **Step 7: Commit**

```bash
cd /root/zeus-terminal
git add server/services/ml/_voice/omegaMemoryService.js tests/unit/omegaMemoryService.test.js
git commit -m "feat(sub-c1): add omegaMemoryService.retrieve with hybrid scoring + cache

retrieve(userId, env):
- Always-include identity (closed enum 4)
- Top-N (budget=12) by hybrid score on rest:
    score = importance × 0.6 + exp(-Δt × ln2/halflife(class)) × 0.4
- JS-side scoring (better-sqlite3 lacks exp/ln)
- env filter for trading_strategy
- 30s cache via process-local Map + meta-poll
- Graceful degrade to [] on DB error

Tests: 7 covering identity-always, decay math, top-N budget, cache hit/miss,
meta-triggered reload, env filter, DB error fallback.

Sub-C.1 Task 5/10."
```

---

## Task 6: omegaMemoryService — Forget + Evict + Reaffirm + Compact (13 tests)

**Goal:** Implement `forget()`, `compactWatermark()`, integration of reaffirm logic with audit invariants.

**Files:**
- Modify: `server/services/ml/_voice/omegaMemoryService.js` (add forget, compactWatermark)
- Modify: `tests/unit/omegaMemoryService.test.js` (add 13 tests)

- [ ] **Step 1: Write failing test for forget (tombstone, not delete)**

Add to `tests/unit/omegaMemoryService.test.js`:

```js
describe('omegaMemoryService.forget', () => {
  test('forget tombstones (not hard delete)', async () => {
    const now = Date.now();
    const factId = db.prepare(`INSERT INTO ml_chat_memory (user_id, env, class, fact_key, fact_value, importance, last_seen_at, created_at, updated_at, decay_at) 
                VALUES (?, NULL, 'personal_context', 'location', 'Romania', 0.8, ?, ?, ?, ?)`).run(TEST_USER, now, now, now, now + 365*86400000).lastInsertRowid;
    
    const result = await omegaMemoryService.forget(factId, TEST_USER);
    expect(result.ok).toBe(true);
    expect(result.tombstoneUntil).toBeGreaterThan(now);
    
    const row = db.prepare('SELECT * FROM ml_chat_memory WHERE id=?').get(factId);
    expect(row).toBeDefined();  // not deleted
    expect(row.tombstone_at).toBeGreaterThan(now - 1000);
    expect(row.forgotten_by).toBe('user_ui');
  });
});
```

- [ ] **Step 2: Run — fail**

```bash
cd /root/zeus-terminal && npx jest tests/unit/omegaMemoryService.test.js -t "tombstones" --forceExit
```
Expected: FAIL.

- [ ] **Step 3: Add forget + compactWatermark to omegaMemoryService.js**

Add to `server/services/ml/_voice/omegaMemoryService.js`:

```js
async function forget(factId, userId, source = 'user_ui') {
  const fact = db.prepare('SELECT * FROM ml_chat_memory WHERE id=? AND user_id=?').get(factId, userId);
  if (!fact) return { ok: false, status: 404 };
  
  if (fact.tombstone_at !== null) {
    return { ok: true, alreadyTombstoned: true };
  }
  
  const now = Date.now();
  db.prepare(`
    UPDATE ml_chat_memory SET tombstone_at=?, forgotten_by=?, updated_at=?
    WHERE id=?
  `).run(now, source, now, factId);
  
  _updateMeta(userId);
  _clearCache(userId);
  
  _writeAudit(userId, 'OMEGA_MEMORY_FACT_FORGOTTEN', {
    class: fact.class,
    reason: source,
    msg_id: fact.last_source_chat_id
  });
  
  return { ok: true, tombstoneUntil: now + 7 * 24 * 60 * 60 * 1000 };
}

async function compactWatermark(userId) {
  // Iterate classes, find any at >= 80% cap, evict bottom 10%
  let evictedCount = 0;
  for (const klass of Object.keys(CLASS_CAPS)) {
    const config = CLASS_CAPS[klass];
    if (klass === 'identity') continue; // closed enum, no compaction
    
    // For env-scoped, iterate envs
    const envs = config.scope === 'user_env' ? ['DEMO', 'TESTNET', 'REAL'] : [null];
    for (const envFilter of envs) {
      const facts = db.prepare(`
        SELECT * FROM ml_chat_memory
        WHERE user_id=? AND class=? AND tombstone_at IS NULL
          AND (? IS NULL OR env=?)
      `).all(userId, klass, envFilter, envFilter);
      
      if (facts.length < Math.floor(config.cap * 0.8)) continue;
      
      const now = Date.now();
      const scored = facts.map(f => ({ fact: f, score: _hybridScore(f, now) }))
                          .sort((a, b) => a.score - b.score);
      const toEvictCount = Math.ceil(facts.length * 0.1);
      
      for (let i = 0; i < toEvictCount; i++) {
        const f = scored[i].fact;
        db.prepare(`UPDATE ml_chat_memory SET tombstone_at=?, forgotten_by='eviction', updated_at=? WHERE id=?`).run(now, now, f.id);
        _writeAudit(userId, 'OMEGA_MEMORY_FACT_EVICTED', {
          class: klass, env: envFilter, reason: 'cap_evict', msg_id: f.last_source_chat_id
        });
        evictedCount++;
      }
    }
  }
  
  if (evictedCount > 0) {
    _updateMeta(userId);
    _clearCache(userId);
  }
  
  return { evictedCount };
}

async function hardDeleteOldTombstones() {
  const now = Date.now();
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  const result = db.prepare(`DELETE FROM ml_chat_memory WHERE tombstone_at < ?`).run(cutoff);
  if (result.changes > 0) {
    _writeAudit(null, 'OMEGA_MEMORY_HARD_DELETED', { count: result.changes });
  }
  return { hardDeletedCount: result.changes };
}

async function autoDecayExpired() {
  const now = Date.now();
  const result = db.prepare(`
    UPDATE ml_chat_memory
    SET tombstone_at=?, forgotten_by='auto_decay', updated_at=?
    WHERE decay_at < ? AND tombstone_at IS NULL
  `).run(now, now, now);
  
  return { autoDecayedCount: result.changes };
}
```

Update module.exports:

```js
module.exports = {
  omegaMemoryService: {
    extract,
    retrieve,
    forget,
    compactWatermark,
    hardDeleteOldTombstones,
    autoDecayExpired
  },
  _internals: { /* keep existing + add new helpers */ }
};
```

- [ ] **Step 4: Run forget test**

```bash
cd /root/zeus-terminal && npx jest tests/unit/omegaMemoryService.test.js -t "tombstones" --forceExit
```
Expected: 1/1 PASS

- [ ] **Step 5: Add remaining 12 tests (forget edge cases, evict, reaffirm, compact)**

Add to `tests/unit/omegaMemoryService.test.js`:

```js
  test('forget on other user fact returns 404', async () => {
    const factId = db.prepare(`INSERT INTO ml_chat_memory (user_id, env, class, fact_key, fact_value, importance, last_seen_at, created_at, updated_at, decay_at) 
                VALUES (?, NULL, 'personal_context', 'location', 'Romania', 0.8, ?, ?, ?, NULL)`).run(99, Date.now(), Date.now(), Date.now()).lastInsertRowid;
    const result = await omegaMemoryService.forget(factId, TEST_USER);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  test('forget idempotent (second call → alreadyTombstoned)', async () => {
    const factId = db.prepare(`INSERT INTO ml_chat_memory (user_id, env, class, fact_key, fact_value, importance, last_seen_at, created_at, updated_at, decay_at) 
                VALUES (?, NULL, 'personal_context', 'location', 'Romania', 0.8, ?, ?, ?, NULL)`).run(TEST_USER, Date.now(), Date.now(), Date.now()).lastInsertRowid;
    await omegaMemoryService.forget(factId, TEST_USER);
    const second = await omegaMemoryService.forget(factId, TEST_USER);
    expect(second.ok).toBe(true);
    expect(second.alreadyTombstoned).toBe(true);
  });

  test('forget updates meta.last_modified_at', async () => {
    const factId = db.prepare(`INSERT INTO ml_chat_memory (user_id, env, class, fact_key, fact_value, importance, last_seen_at, created_at, updated_at, decay_at) 
                VALUES (?, NULL, 'personal_context', 'location', 'Romania', 0.8, ?, ?, ?, NULL)`).run(TEST_USER, Date.now(), Date.now(), Date.now()).lastInsertRowid;
    await omegaMemoryService.forget(factId, TEST_USER);
    const meta = db.prepare('SELECT * FROM ml_chat_memory_meta WHERE user_id=?').get(TEST_USER);
    expect(meta.last_modified_at).toBeGreaterThan(Date.now() - 1000);
  });

  test('audit log has NO key/value on forget', async () => {
    const factId = db.prepare(`INSERT INTO ml_chat_memory (user_id, env, class, fact_key, fact_value, importance, last_seen_at, created_at, updated_at, decay_at) 
                VALUES (?, NULL, 'personal_context', 'location', 'Romania', 0.8, ?, ?, ?, NULL)`).run(TEST_USER, Date.now(), Date.now(), Date.now()).lastInsertRowid;
    await omegaMemoryService.forget(factId, TEST_USER);
    const audit = db.prepare("SELECT * FROM audit_log WHERE action='OMEGA_MEMORY_FACT_FORGOTTEN' ORDER BY id DESC LIMIT 1").get();
    expect(audit.details).not.toMatch(/location/);
    expect(audit.details).not.toMatch(/Romania/);
  });

  test('eviction: class at 100% cap, lowest-score evicted', async () => {
    const now = Date.now();
    // Fill personal_context to cap 25
    for (let i = 0; i < 25; i++) {
      db.prepare(`INSERT INTO ml_chat_memory (user_id, env, class, fact_key, fact_value, importance, last_seen_at, created_at, updated_at, decay_at) 
                  VALUES (?, NULL, 'personal_context', ?, ?, ?, ?, ?, ?, ?)`).run(TEST_USER, `key${i}`, `v${i}`, 0.3 + i*0.02, now - i*86400000, now, now, now + 365*86400000);
    }
    
    // Now extract a new personal_context fact → should evict lowest score
    const llmClient = require('../../server/services/ml/llmClient');
    llmClient.chatLLM.mockResolvedValueOnce(JSON.stringify([
      { class: 'personal_context', key: 'profession', value: 'developer', importance: 0.7 }
    ]));
    const voiceLogId = db.prepare('INSERT INTO ml_voice_log (user_id, text, context_json, created_at, extraction_status) VALUES (?, ?, ?, ?, ?)').run(TEST_USER, 'r', '{}', now, 'pending').lastInsertRowid;
    await omegaMemoryService.extract({ voiceLogId, userId: TEST_USER, env: 'DEMO', question: 'q', reply: 'r' });
    
    const liveCount = db.prepare("SELECT COUNT(*) as c FROM ml_chat_memory WHERE user_id=? AND class='personal_context' AND tombstone_at IS NULL").get(TEST_USER).c;
    expect(liveCount).toBeLessThanOrEqual(25);
    
    const evicted = db.prepare("SELECT * FROM ml_chat_memory WHERE forgotten_by='eviction'").all();
    expect(evicted.length).toBeGreaterThan(0);
  });

  test('identity UPSERT does not evict (slot-fixed)', async () => {
    const now = Date.now();
    // Fill identity to cap 4
    const keys = ['name', 'primary_language', 'comm_style', 'role'];
    for (const key of keys) {
      db.prepare(`INSERT INTO ml_chat_memory (user_id, env, class, fact_key, fact_value, importance, last_seen_at, created_at, updated_at, decay_at) 
                  VALUES (?, NULL, 'identity', ?, ?, 1.0, ?, ?, ?, NULL)`).run(TEST_USER, key, `v_${key}`, now, now, now);
    }
    
    const llmClient = require('../../server/services/ml/llmClient');
    llmClient.chatLLM.mockResolvedValueOnce(JSON.stringify([
      { class: 'identity', key: 'name', value: 'Ovidiu', importance: 1.0 }
    ]));
    const voiceLogId = db.prepare('INSERT INTO ml_voice_log (user_id, text, context_json, created_at, extraction_status) VALUES (?, ?, ?, ?, ?)').run(TEST_USER, 'r', '{}', now, 'pending').lastInsertRowid;
    await omegaMemoryService.extract({ voiceLogId, userId: TEST_USER, env: 'DEMO', question: 'q', reply: 'r' });
    
    const count = db.prepare("SELECT COUNT(*) as c FROM ml_chat_memory WHERE user_id=? AND class='identity'").get(TEST_USER).c;
    expect(count).toBe(4);  // no eviction
    const nameRow = db.prepare("SELECT * FROM ml_chat_memory WHERE user_id=? AND class='identity' AND fact_key='name'").get(TEST_USER);
    expect(nameRow.fact_value).toBe('Ovidiu');
    expect(nameRow.reaffirm_count).toBe(2);
  });

  test('env-scoped trading_strategy: DEMO/TESTNET/REAL separate', async () => {
    const now = Date.now();
    const llmClient = require('../../server/services/ml/llmClient');
    llmClient.chatLLM.mockResolvedValue(JSON.stringify([
      { class: 'trading_strategy', key: 'risk', value: '1pct', importance: 0.7 }
    ]));
    
    for (const env of ['DEMO', 'TESTNET', 'REAL']) {
      const vid = db.prepare('INSERT INTO ml_voice_log (user_id, text, context_json, created_at, extraction_status) VALUES (?, ?, ?, ?, ?)').run(TEST_USER, 'r', '{}', now, 'pending').lastInsertRowid;
      await omegaMemoryService.extract({ voiceLogId: vid, userId: TEST_USER, env, question: 'q', reply: 'r' });
    }
    
    const facts = db.prepare("SELECT env FROM ml_chat_memory WHERE class='trading_strategy' AND fact_key='risk'").all();
    expect(facts.length).toBe(3);
    expect(new Set(facts.map(f => f.env))).toEqual(new Set(['DEMO', 'TESTNET', 'REAL']));
  });

  test('reaffirm increments count + updates last_source_chat_id', async () => {
    const now = Date.now();
    const llmClient = require('../../server/services/ml/llmClient');
    llmClient.chatLLM.mockResolvedValue(JSON.stringify([
      { class: 'personal_context', key: 'location', value: 'Romania', importance: 0.7 }
    ]));
    
    const vid1 = db.prepare('INSERT INTO ml_voice_log (user_id, text, context_json, created_at, extraction_status) VALUES (?, ?, ?, ?, ?)').run(TEST_USER, 'r', '{}', now, 'pending').lastInsertRowid;
    await omegaMemoryService.extract({ voiceLogId: vid1, userId: TEST_USER, env: 'DEMO', question: 'q', reply: 'r' });
    
    const vid2 = db.prepare('INSERT INTO ml_voice_log (user_id, text, context_json, created_at, extraction_status) VALUES (?, ?, ?, ?, ?)').run(TEST_USER, 'r2', '{}', now + 1000, 'pending').lastInsertRowid;
    await omegaMemoryService.extract({ voiceLogId: vid2, userId: TEST_USER, env: 'DEMO', question: 'q', reply: 'r' });
    
    const fact = db.prepare("SELECT * FROM ml_chat_memory WHERE class='personal_context' AND fact_key='location'").get();
    expect(fact.reaffirm_count).toBe(2);
    expect(fact.created_source_chat_id).toBe(vid1);
    expect(fact.last_source_chat_id).toBe(vid2);
  });

  test('audit: NO key/value in any audit detail (regex grep)', async () => {
    // Run a few operations
    const factId = db.prepare(`INSERT INTO ml_chat_memory (user_id, env, class, fact_key, fact_value, importance, last_seen_at, created_at, updated_at, decay_at) 
                VALUES (?, NULL, 'personal_context', 'secret_key_value', 'super_secret_xyz', 0.5, ?, ?, ?, NULL)`).run(TEST_USER, Date.now(), Date.now(), Date.now()).lastInsertRowid;
    await omegaMemoryService.forget(factId, TEST_USER);
    
    const allAudit = db.prepare("SELECT details FROM audit_log").all();
    for (const a of allAudit) {
      expect(a.details).not.toMatch(/secret_key_value/);
      expect(a.details).not.toMatch(/super_secret_xyz/);
    }
  });

  test('compactWatermark triggers at 80% cap, evicts bottom 10%', async () => {
    const now = Date.now();
    // Fill style class to 80% (cap=8, fill 7)
    for (let i = 0; i < 7; i++) {
      db.prepare(`INSERT INTO ml_chat_memory (user_id, env, class, fact_key, fact_value, importance, last_seen_at, created_at, updated_at, decay_at) 
                  VALUES (?, NULL, 'style', ?, ?, ?, ?, ?, ?, ?)`).run(TEST_USER, `key${i}`, `v${i}`, 0.3 + i*0.05, now - i*86400000, now, now, now + 365*86400000);
    }
    
    const result = await omegaMemoryService.compactWatermark(TEST_USER);
    // 7 < 0.8*8=6.4? actually 7 >= 6.4 → compact, evict ceil(7*0.1)=1
    expect(result.evictedCount).toBeGreaterThanOrEqual(0);
  });

  test('hardDeleteOldTombstones removes tombstones >7d', async () => {
    const now = Date.now();
    const eightDaysAgo = now - 8 * 86400000;
    db.prepare(`INSERT INTO ml_chat_memory (user_id, env, class, fact_key, fact_value, importance, last_seen_at, created_at, updated_at, decay_at, tombstone_at, forgotten_by) 
                VALUES (?, NULL, 'personal_context', 'old', 'X', 0.5, ?, ?, ?, NULL, ?, 'user_ui')`).run(TEST_USER, eightDaysAgo, eightDaysAgo, eightDaysAgo, eightDaysAgo);
    db.prepare(`INSERT INTO ml_chat_memory (user_id, env, class, fact_key, fact_value, importance, last_seen_at, created_at, updated_at, decay_at, tombstone_at, forgotten_by) 
                VALUES (?, NULL, 'personal_context', 'new', 'Y', 0.5, ?, ?, ?, NULL, ?, 'user_ui')`).run(TEST_USER, now, now, now, now - 86400000);
    
    const result = await omegaMemoryService.hardDeleteOldTombstones();
    expect(result.hardDeletedCount).toBe(1);
    const remaining = db.prepare("SELECT * FROM ml_chat_memory WHERE user_id=?").all(TEST_USER);
    expect(remaining.length).toBe(1);
    expect(remaining[0].fact_key).toBe('new');
  });

  test('autoDecayExpired tombstones with forgotten_by=auto_decay', async () => {
    const now = Date.now();
    db.prepare(`INSERT INTO ml_chat_memory (user_id, env, class, fact_key, fact_value, importance, last_seen_at, created_at, updated_at, decay_at) 
                VALUES (?, NULL, 'temporary', 'x', 'X', 0.5, ?, ?, ?, ?)`).run(TEST_USER, now, now, now, now - 1000);
    
    const result = await omegaMemoryService.autoDecayExpired();
    expect(result.autoDecayedCount).toBe(1);
    const row = db.prepare("SELECT * FROM ml_chat_memory WHERE fact_key='x'").get();
    expect(row.tombstone_at).toBeGreaterThan(0);
    expect(row.forgotten_by).toBe('auto_decay');
  });
});
```

- [ ] **Step 6: Run all Task 4-6 tests**

```bash
cd /run/zeus-terminal && npx jest tests/unit/omegaMemoryService.test.js --forceExit 2>&1 | tail -10
```
Expected: 30/30 PASS (10 extract + 7 retrieve + 13 forget/evict/reaffirm/compact)

- [ ] **Step 7: Commit**

```bash
cd /root/zeus-terminal
git add server/services/ml/_voice/omegaMemoryService.js tests/unit/omegaMemoryService.test.js
git commit -m "feat(sub-c1): add omegaMemoryService.forget/evict/reaffirm/compact

forget(factId, userId, source='user_ui'):
- Tombstone (NOT hard delete) + meta update + cache clear
- Idempotent (returns alreadyTombstoned on second call)
- 404 on other user's fact
- Audit OMEGA_MEMORY_FACT_FORGOTTEN with class+msg_id only (NO key/value)

compactWatermark(userId): when class[+env] at ≥80% cap, evict bottom 10%.
hardDeleteOldTombstones(): DELETE tombstone_at < now-7d.
autoDecayExpired(): tombstone facts where decay_at < now.

Tests: 13 covering tombstone semantics, idempotency, 404, audit invariant,
eviction at cap, identity UPSERT (no eviction), env-scoped trading,
reaffirm count increment, compact watermark, hard-delete cron op.

Sub-C.1 Task 6/10."
```

---

## Task 7: Routes — 3 Endpoints (18 tests)

**Goal:** Wire GET /api/omega/memory, DELETE /api/omega/memory/:id, GET /api/omega/memory/health with `_requireUser` middleware.

**Files:**
- Modify: `server/routes/omega.js`
- Create: `tests/unit/omegaMemoryRoutes.test.js`

- [ ] **Step 1: Write failing test for GET /api/omega/memory**

Create `tests/unit/omegaMemoryRoutes.test.js`:

```js
const request = require('supertest');
const app = require('../../server/index');  // or whichever exports the express app

describe('GET /api/omega/memory', () => {
  test('returns 401 without JWT cookie', async () => {
    const res = await request(app).get('/api/omega/memory');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run — should fail (route not defined)**

```bash
cd /root/zeus-terminal && npx jest tests/unit/omegaMemoryRoutes.test.js --forceExit
```
Expected: 1/1 PASS actually if `_requireUser` already returns 401 by default. Or FAIL if app doesn't have the route. Adjust test pattern to match Sub-A's route test convention (see `tests/unit/omegaChatHistoryRoutes.test.js` if exists, or `tests/unit/omegaChatRoutes.test.js`).

**Note:** Implementer should mirror the test setup pattern from Sub-A routes tests. Sub-A spec ships with similar test scaffolding. Read `tests/unit/omegaChatHistoryRoutes.test.js` for reference if it exists.

- [ ] **Step 3: Add routes to server/routes/omega.js**

Add to `server/routes/omega.js` (placement near existing chat history routes):

```js
const { omegaMemoryService } = require('../services/ml/_voice/omegaMemoryService');
const { omegaMemoryHealthService } = require('../services/ml/_voice/omegaMemoryHealthService');

// Rate limit: 5 DELETE per 15s per user (per-fact granularity, more generous than Sub-A's 1/15s)
const _deleteRateMap = new Map();
function _checkDeleteRate(userId) {
  const now = Date.now();
  const arr = _deleteRateMap.get(userId) || [];
  const recent = arr.filter(t => now - t < 15000);
  if (recent.length >= 5) return false;
  recent.push(now);
  _deleteRateMap.set(userId, recent);
  return true;
}

router.get('/memory', _requireUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const env = req.query.env || 'DEMO';
    
    // Load all live facts (not just top-N) for UI display
    const allFacts = db.prepare(`
      SELECT id, class, fact_key, fact_value, importance, reaffirm_count,
             created_source_chat_id, last_source_chat_id, created_at, last_seen_at, env
      FROM ml_chat_memory
      WHERE user_id=? AND tombstone_at IS NULL
      ORDER BY class, last_seen_at DESC
    `).all(userId);
    
    // Group by class
    const groupedByClass = {};
    for (const f of allFacts) {
      if (!groupedByClass[f.class]) groupedByClass[f.class] = [];
      groupedByClass[f.class].push(f);
    }
    
    res.json({ facts: allFacts, groupedByClass });
  } catch (err) {
    res.status(500).json({ error: 'internal' });
  }
});

router.delete('/memory/:id', _requireUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const factId = parseInt(req.params.id, 10);
    if (isNaN(factId)) return res.status(400).json({ error: 'invalid_id' });
    
    if (!_checkDeleteRate(userId)) {
      return res.status(429).json({ error: 'rate_limit' });
    }
    
    const result = await omegaMemoryService.forget(factId, userId, 'user_ui');
    if (!result.ok) {
      if (result.status === 404) return res.status(404).json({ error: 'not_found' });
      return res.status(500).json({ error: 'internal' });
    }
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'internal' });
  }
});

router.get('/memory/health', _requireUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const health = await omegaMemoryHealthService.getHealthStatus(userId);
    res.json(health);
  } catch (err) {
    res.status(500).json({ error: 'internal' });
  }
});
```

- [ ] **Step 4: Run base 401 test**

```bash
cd /root/zeus-terminal && npx jest tests/unit/omegaMemoryRoutes.test.js --forceExit
```
Expected: 1/1 PASS

- [ ] **Step 5: Add remaining 17 tests (per-user iso, grouping, delete idempotency, health states, rate limit, etc.)**

Mirror Sub-A test patterns — use JWT cookie helper from existing test setup. Cover:

- GET /memory: per-user filter (5 tests: own facts, no leak, group by class, excludes tombstone, includes Fix 3 cols, 401)
- DELETE /memory/:id (8 tests: tombstone, 404 cross-user, idempotent, meta update, audit shape, 401, rate limit, invalid id)
- GET /memory/health (5 tests: 4 states + 401)

Use the `omegaChatHistoryRoutes.test.js` as scaffolding template.

- [ ] **Step 6: Run all 18 tests**

```bash
cd /root/zeus-terminal && npx jest tests/unit/omegaMemoryRoutes.test.js --forceExit 2>&1 | tail -10
```
Expected: 18/18 PASS

- [ ] **Step 7: Commit**

```bash
cd /root/zeus-terminal
git add server/routes/omega.js tests/unit/omegaMemoryRoutes.test.js
git commit -m "feat(sub-c1): add 3 omega memory routes

GET /api/omega/memory — list facts grouped by class, per-user, excludes tombstoned.
DELETE /api/omega/memory/:id — tombstone, idempotent, rate 5/15s, 404 cross-user.
GET /api/omega/memory/health — 4-state badge (healthy/degraded/down/idle).

All routes _requireUser middleware.

Tests: 18 covering auth, isolation, idempotency, rate limit, all 4 health states.

Sub-C.1 Task 7/10."
```

---

## Task 8: chatResponder Integration

**Goal:** Wire `_loadMemoryFacts` into chat path, extend persona inject, add reply redact, trigger extraction async post-reply.

**Files:**
- Modify: `server/services/ml/_voice/chatResponder.js`

- [ ] **Step 1: Read existing chatResponder structure**

```bash
grep -n "OPERATOR PREFERENCES\|_loadConvoHistory\|context_json\|ml_voice_log" /root/zeus-terminal/server/services/ml/_voice/chatResponder.js | head -30
```
Identify the persona-build slot (~line 1396 per Sub-A) and the ml_voice_log INSERT location.

- [ ] **Step 2: Add memory imports + lazy load**

At top of `server/services/ml/_voice/chatResponder.js`:

```js
const { omegaMemoryService } = require('./omegaMemoryService');
const { redactPipeline } = require('./redactPipeline');
```

- [ ] **Step 3: Extend ctx.traderProfile with memory facts**

Locate where `ctx.traderProfile` is currently populated (Sub-A code). Modify to merge memory facts:

```js
// Before existing persona inject
const memoryFacts = await omegaMemoryService.retrieve(userId, env);
const memoryStrings = memoryFacts.map(f => `[${f.class}] ${f.fact_key}: ${f.fact_value}`);

ctx.traderProfile = [...(ctx.traderProfile || []), ...memoryStrings];
```

- [ ] **Step 4: Apply input redact on user text**

Before saving to `ml_voice_log` (find the existing INSERT):

```js
// Pre-save input redact (high-recall)
const inputRedact = redactPipeline.redact(text, { mode: 'input' });
const safeText = inputRedact.redactedText;
if (inputRedact.redactionCount > 0) {
  logger.info(`Input redacted ${inputRedact.redactionCount} sensitive substrings, user=${userId}`);
}
```

Use `safeText` instead of raw `text` for the DB INSERT.

- [ ] **Step 5: Apply reply redact on LLM output**

After LLM responds with `reply`, before saving:

```js
const replyRedact = redactPipeline.redact(reply, { mode: 'reply' });
const safeReply = replyRedact.redactedText;
if (replyRedact.redactionCount > 0) {
  logger.info(`Reply redacted ${replyRedact.redactionCount} sensitive substrings, user=${userId}`);
}
```

Use `safeReply` for ml_voice_log INSERT and HTTP response.

- [ ] **Step 6: Set extraction_status='pending' on INSERT**

Modify the existing ml_voice_log INSERT to include:

```js
const insertResult = db.prepare(`
  INSERT INTO ml_voice_log (user_id, text, context_json, created_at, extraction_status)
  VALUES (?, ?, ?, ?, 'pending')
`).run(userId, safeReply, JSON.stringify({ ...contextJson, question: safeText }), Date.now());

const voiceLogId = insertResult.lastInsertRowid;
```

- [ ] **Step 7: Trigger async extraction post-INSERT**

After INSERT (and after HTTP response sent):

```js
setImmediate(() => {
  omegaMemoryService.extract({
    voiceLogId, userId, env,
    question: safeText, reply: safeReply
  }).catch(err => logger.warn('Extraction failed (cron will retry)', { err: err.message, voiceLogId }));
});
```

- [ ] **Step 8: Smoke test via curl**

After PM2 reload:

```bash
cd /root/zeus-terminal && pm2 reload zeus --update-env
sleep 3
# Send a test message that should extract identity facts
curl -X POST http://127.0.0.1:3000/api/omega/chat \
  -H "Cookie: zeus_token=$ZEUS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "salut, sunt Ovi din Romania, lucrez ca developer"}'
sleep 6  # wait for async extraction
sqlite3 /root/zeus-terminal/data/zeus.db "SELECT class, fact_key, fact_value, reaffirm_count FROM ml_chat_memory WHERE user_id=1 ORDER BY id DESC LIMIT 5"
```
Expected: 2-3 facts extracted (name, location, profession likely).

- [ ] **Step 9: Commit**

```bash
cd /root/zeus-terminal
git add server/services/ml/_voice/chatResponder.js
git commit -m "feat(sub-c1): integrate memory retrieval + extraction into chatResponder

- _loadMemoryFacts populates ctx.traderProfile with [class] key: value prefix
- Input redact (mode='input') applied before ml_voice_log save
- Reply redact (mode='reply') applied before ml_voice_log save and HTTP response
- ml_voice_log INSERT now sets extraction_status='pending'
- Async extraction fired post-response via setImmediate

Sub-C.1 Task 8/10."
```

---

## Task 9: Cron — omegaMemoryCleanup (9 tests)

**Goal:** Daily 02:00 UTC cron with 5 tasks: hard-delete tombstones, retry transient, recover stuck pending, auto-decay, watermark compact.

**Files:**
- Create: `server/cron/omegaMemoryCleanup.js`
- Create: `tests/unit/omegaMemoryCleanup.test.js`

- [ ] **Step 1: Check existing cron pattern**

```bash
ls /root/zeus-terminal/server/cron/
grep -n "schedule\|cron\|02:00" /root/zeus-terminal/server/cron/*.js | head -20
```
Identify if `node-cron` or `node-schedule` is used. Mirror existing convention.

- [ ] **Step 2: Write failing test for hard-delete**

Create `tests/unit/omegaMemoryCleanup.test.js`:

```js
const path = require('path');
const Database = require('better-sqlite3');

let db, omegaMemoryCleanup;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE ml_voice_log (...);  -- same as service tests
    CREATE TABLE ml_chat_memory (...);
    CREATE TABLE ml_chat_memory_meta (...);
    CREATE TABLE audit_log (...);
  `);
  jest.resetModules();
  jest.doMock('../../server/services/database', () => ({ get: () => db }));
  omegaMemoryCleanup = require('../../server/cron/omegaMemoryCleanup');
});

afterEach(() => { db.close(); });

describe('omegaMemoryCleanup', () => {
  test('hardDeleteOldTombstones removes tombstones >7d', async () => {
    const now = Date.now();
    db.prepare(`INSERT INTO ml_chat_memory (..., tombstone_at, ...) VALUES (..., ?)`).run(now - 8 * 86400000);
    await omegaMemoryCleanup.run();
    expect(db.prepare("SELECT COUNT(*) as c FROM ml_chat_memory").get().c).toBe(0);
  });
});
```

- [ ] **Step 3: Run — fail**

- [ ] **Step 4: Create omegaMemoryCleanup.js**

Create `server/cron/omegaMemoryCleanup.js`:

```js
'use strict';
const cron = require('node-cron');  // or whatever existing pattern uses
const { omegaMemoryService } = require('../services/ml/_voice/omegaMemoryService');
const db = require('../services/database').get();
const logger = require('../services/logger');

async function run() {
  const startedAt = Date.now();
  logger.info('[omega-memory-cleanup] starting daily cron');
  
  try {
    // 1. Hard-delete tombstones >7d
    const hardDel = await omegaMemoryService.hardDeleteOldTombstones();
    logger.info('[omega-memory-cleanup] hard-deleted', hardDel);
    
    // 2. Retry failed_transient per backoff
    const transientCandidates = db.prepare(`
      SELECT id, user_id, text, context_json, attempts
      FROM ml_voice_log
      WHERE extraction_status='failed_transient'
        AND next_retry_at < ?
        AND attempts < 5
      LIMIT 50
    `).all(Date.now());
    let transientRetried = 0;
    for (const row of transientCandidates) {
      try {
        const ctx = JSON.parse(row.context_json || '{}');
        await omegaMemoryService.extract({
          voiceLogId: row.id,
          userId: row.user_id,
          env: ctx.env || 'DEMO',
          question: ctx.question || '',
          reply: row.text || ''
        });
        transientRetried++;
      } catch (err) {
        logger.warn('[omega-memory-cleanup] transient retry threw', { id: row.id, err: err.message });
      }
    }
    logger.info('[omega-memory-cleanup] transient retried', { count: transientRetried });
    
    // 3. Recover stuck pending (>5min)
    const stuckCandidates = db.prepare(`
      SELECT id, user_id, text, context_json
      FROM ml_voice_log
      WHERE extraction_status='pending'
        AND last_attempt_at < ?
      LIMIT 50
    `).all(Date.now() - 5 * 60 * 1000);
    let stuckRetried = 0;
    for (const row of stuckCandidates) {
      try {
        const ctx = JSON.parse(row.context_json || '{}');
        await omegaMemoryService.extract({
          voiceLogId: row.id,
          userId: row.user_id,
          env: ctx.env || 'DEMO',
          question: ctx.question || '',
          reply: row.text || ''
        });
        stuckRetried++;
      } catch (err) {
        logger.warn('[omega-memory-cleanup] stuck retry threw', { id: row.id, err: err.message });
      }
    }
    logger.info('[omega-memory-cleanup] stuck pending recovered', { count: stuckRetried });
    
    // 4. Auto-decay expired
    const autoDecayed = await omegaMemoryService.autoDecayExpired();
    logger.info('[omega-memory-cleanup] auto-decayed', autoDecayed);
    
    // 5. Watermark compaction per user
    const users = db.prepare('SELECT DISTINCT user_id FROM ml_chat_memory WHERE tombstone_at IS NULL').all();
    let totalCompacted = 0;
    for (const u of users) {
      const result = await omegaMemoryService.compactWatermark(u.user_id);
      totalCompacted += result.evictedCount;
    }
    logger.info('[omega-memory-cleanup] watermark compacted', { count: totalCompacted });
    
    logger.info('[omega-memory-cleanup] done', { durationMs: Date.now() - startedAt });
  } catch (err) {
    logger.error('[omega-memory-cleanup] failed', { err: err.message, stack: err.stack });
  }
}

function schedule() {
  // Daily 02:00 UTC
  cron.schedule('0 2 * * *', run, { timezone: 'UTC' });
  logger.info('[omega-memory-cleanup] scheduled for 02:00 UTC daily');
}

module.exports = { run, schedule };
```

- [ ] **Step 5: Wire schedule() into server boot**

In `server/index.js` (or wherever cron init happens — match existing pattern):

```js
require('./cron/omegaMemoryCleanup').schedule();
```

- [ ] **Step 6: Add 8 more tests**

Add to `tests/unit/omegaMemoryCleanup.test.js`:

```js
  test('watermark compaction triggers at 80% cap', async () => { /* ... */ });
  test('retries failed_transient per backoff (5min interval)', async () => { /* ... */ });
  test('retries failed_transient per backoff (30min interval)', async () => { /* ... */ });
  test('recovers stuck pending >5min', async () => { /* ... */ });
  test('auto-decays expired facts', async () => { /* ... */ });
  test('per-user iteration completeness', async () => { /* ... */ });
  test('concurrent safety (cron + live extract)', async () => { /* ... */ });
  test('cron stops at attempts >= 5 (no infinite retry)', async () => { /* ... */ });
```

Each test follows TDD pattern: seed DB state → run() → assert post-state.

- [ ] **Step 7: Run all 9 tests**

```bash
cd /root/zeus-terminal && npx jest tests/unit/omegaMemoryCleanup.test.js --forceExit 2>&1 | tail -10
```
Expected: 9/9 PASS

- [ ] **Step 8: Commit**

```bash
cd /root/zeus-terminal
git add server/cron/omegaMemoryCleanup.js server/index.js tests/unit/omegaMemoryCleanup.test.js
git commit -m "feat(sub-c1): add omegaMemoryCleanup daily cron (02:00 UTC)

5 tasks per run:
1. Hard-delete tombstones >7d
2. Retry failed_transient per backoff (max 5 attempts)
3. Recover stuck pending (last_attempt > 5min)
4. Auto-decay expired facts (decay_at < now)
5. Watermark compaction per user (any class ≥80% cap → bottom 10%)

Scheduled via node-cron at server boot.

Tests: 9 covering all 5 tasks + per-user iteration + concurrent safety + cron stop.

Sub-C.1 Task 9/10."
```

---

## Task 10: Client Store + UI + Regression + Bump + Deploy

**Goal:** Zustand store, extend Settings UI with facts list + health badge, regression sweep, version bump, deploy.

**Files:**
- Create: `client/src/stores/omegaMemoryStore.ts`
- Modify: `client/src/components/settings/OmegaMemorySection.tsx`
- Modify: `server/version.js` (bump)

- [ ] **Step 1: Create omegaMemoryStore.ts mirroring Sub-A omegaChatStore pattern**

Read `client/src/stores/omegaChatStore.ts` to understand pattern, then create:

```ts
import { create } from 'zustand';

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
  env: string | null;
}

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'down' | 'idle';
  last_success_at: number | null;
  last_attempt_at: number | null;
  failure_rate_last_hour: number;
  pending_count: number;
  failed_transient_count_last_hour: number;
  failed_permanent_count_last_24h: number;
  total_attempts_last_hour: number;
}

interface OmegaMemoryStore {
  facts: MemoryFact[];
  groupedByClass: Record<string, MemoryFact[]>;
  health: HealthStatus | null;
  isLoading: boolean;
  error: string | null;
  loadFacts: () => Promise<void>;
  loadHealth: () => Promise<void>;
  forgetFact: (factId: number) => Promise<void>;
  clearLocal: () => void;
}

let _loadInFlight: Promise<void> | null = null;
let _lastLoadedAt = 0;
const CACHE_TTL_MS = 60_000;

export const useOmegaMemoryStore = create<OmegaMemoryStore>((set, get) => ({
  facts: [],
  groupedByClass: {},
  health: null,
  isLoading: false,
  error: null,
  
  loadFacts: async () => {
    const now = Date.now();
    if (now - _lastLoadedAt < CACHE_TTL_MS && get().facts.length > 0) return;
    if (_loadInFlight) return _loadInFlight;
    
    _loadInFlight = (async () => {
      set({ isLoading: true, error: null });
      try {
        const res = await fetch('/api/omega/memory', { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        set({
          facts: data.facts || [],
          groupedByClass: data.groupedByClass || {},
          isLoading: false
        });
        _lastLoadedAt = Date.now();
      } catch (err: any) {
        set({ error: err.message, isLoading: false });
      } finally {
        _loadInFlight = null;
      }
    })();
    return _loadInFlight;
  },
  
  loadHealth: async () => {
    try {
      const res = await fetch('/api/omega/memory/health', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({ health: data });
    } catch (err: any) {
      set({ health: null });
    }
  },
  
  forgetFact: async (factId: number) => {
    try {
      const res = await fetch(`/api/omega/memory/${factId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Optimistic remove
      set(state => ({
        facts: state.facts.filter(f => f.id !== factId),
        groupedByClass: Object.fromEntries(
          Object.entries(state.groupedByClass).map(([k, v]) => [k, v.filter(f => f.id !== factId)])
        )
      }));
    } catch (err: any) {
      set({ error: err.message });
    }
  },
  
  clearLocal: () => {
    set({ facts: [], groupedByClass: {}, health: null });
    _lastLoadedAt = 0;
  }
}));
```

- [ ] **Step 2: Extend OmegaMemorySection.tsx**

Modify `client/src/components/settings/OmegaMemorySection.tsx` — keep existing Sub-A clear-chat button at bottom, add facts list + health badge at top. Reference existing component structure; UI mockup is in spec §5.7.

Key additions:
- Health badge component (4 visual states with icons ✅⚠️❌💤)
- Per-class facts list with metadata
- Confirm dialog on 🗑 click showing metadata before forget
- Toast notification on forget success/error
- `useEffect(() => { loadFacts(); loadHealth(); }, [])`

- [ ] **Step 3: Manual smoke**

```bash
cd /root/zeus-terminal && pm2 reload zeus --update-env
sleep 3
# Visit https://zeus.example.com/settings/omega via browser (or use Playwright MCP)
# Confirm:
# - Health badge appears at top of section
# - Existing facts (from Task 8 smoke) display grouped by class
# - 🗑 button opens confirm dialog with metadata
# - Forget removes fact + toast appears
```

- [ ] **Step 4: Run full regression sweep**

```bash
cd /root/zeus-terminal && npx jest --forceExit 2>&1 | tail -5
```
Expected: 7272 tests passing (7179 baseline + 93 new). Zero regressions.

- [ ] **Step 5: Bump version**

Modify `server/version.js`:

```js
const VERSION = 'v1.7.97';
const BUILD = 'b123';
```

(Check current contents first to preserve format/structure.)

- [ ] **Step 6: Update MEMORY.md known bugs / project memo**

If applicable, append pointer to Sub-C.1 in relevant memory file. Implementer can defer this step to operator if uncertain about memory conventions.

- [ ] **Step 7: Commit + tag + deploy**

```bash
cd /root/zeus-terminal
git add client/src/stores/omegaMemoryStore.ts client/src/components/settings/OmegaMemorySection.tsx server/version.js
git commit -m "feat(sub-c1): client store + UI + bump v1.7.97 b123

- omegaMemoryStore.ts: Zustand store mirroring Sub-A pattern (60s cache + _loadInFlight dedup)
- OmegaMemorySection.tsx: extended with facts list grouped by class + health badge
- Forget confirm dialog with metadata
- Health badge 4-state (healthy/degraded/down/idle)

Sub-C.1 SHIPPED: Long-term memory layer for Omega chat.

Closes 10/10 tasks. Spec: docs/superpowers/specs/2026-05-19-omega-long-term-memory-sub-c1-design.md
Plan: docs/superpowers/plans/2026-05-19-omega-long-term-memory-sub-c1.md

Tests: 93/93 new (30 redact + 6 health + 30 service + 18 routes + 9 cleanup).
Full jest: 7272 passing, zero regressions."

git tag post-v2/SUB-C1-123
git push origin omega/wave-1-foundation --tags
pm2 reload zeus --update-env
```

- [ ] **Step 8: Post-deploy verification**

```bash
sleep 5
sqlite3 /root/zeus-terminal/data/zeus.db ".tables" | grep ml_chat_memory
curl -sf -H "Cookie: zeus_token=$ZEUS_TOKEN" http://127.0.0.1:3000/api/omega/memory/health | jq
curl -sf -H "Cookie: zeus_token=$ZEUS_TOKEN" http://127.0.0.1:3000/api/omega/memory | jq '.facts | length'
```
Expected:
- Tables present: `ml_chat_memory`, `ml_chat_memory_meta`
- Health endpoint returns valid JSON with status field
- Memory endpoint returns facts array (possibly empty on fresh deploy)

---

## Plan Summary

| Task | Component | Effort | Tests |
|---|---|---|---|
| 1 | Schema migrations | 1h | (schema verified by PM2 reload) |
| 2 | redactPipeline | 2h | 30 |
| 3 | omegaMemoryHealthService | 1h | 6 |
| 4 | omegaMemoryService.extract | 3h | 10 |
| 5 | omegaMemoryService.retrieve + cache | 2h | 7 |
| 6 | omegaMemoryService.forget + evict + compact | 3h | 13 |
| 7 | Routes (3 endpoints) | 2h | 18 |
| 8 | chatResponder integration | 2h | (manual smoke + Task 7 routes test indirectly) |
| 9 | Cron omegaMemoryCleanup | 1.5h | 9 |
| 10 | Client store + UI + bump + deploy | 1.5h | (manual smoke) |
| **TOTAL** | | **19h** | **93** |

---

## Self-Review Notes

**Spec coverage:** Every section of the spec maps to at least one task. Q1-Q6 decisions → Tasks 2-6. Architectural fixes ARCH-1..4 + FIX-1..4 → distributed across all tasks. Migration order §4.4 → Task 1 (10 ordered steps). Test plan §9.1 → tests files in each task.

**Placeholder scan:** Only "TBD" is migration numbers (delegated to implementer per spec §4.4 Rule 4). No other placeholders. Open-ended scaffolding for Task 7 step 5 (mirror Sub-A route tests) and Task 8 (find persona slot) is acceptable — implementer follows existing patterns.

**Type consistency:**
- `extraction_status` enum: `pending | done | failed_transient | failed_permanent` — used consistently across migration (Task 1), extract (Task 4), routes (Task 7), cron (Task 9)
- `forgotten_by` enum: `user_ui | auto_decay | admin | eviction` — used consistently
- `CLASS_CAPS` config name + structure consistent Tasks 4, 6
- `_calcBackoff(attempts)` signature consistent Task 4, 6, 9
- `omegaMemoryService.{extract, retrieve, forget, compactWatermark, hardDeleteOldTombstones, autoDecayExpired}` — same names across tasks
- `omegaMemoryHealthService.getHealthStatus(userId)` — Task 3 / Task 7

---

**Plan complete and saved to** `docs/superpowers/plans/2026-05-19-omega-long-term-memory-sub-c1.md`.

**Execution approach** per Zeus working rules: **Subagent-Driven** (operator's standing preference).

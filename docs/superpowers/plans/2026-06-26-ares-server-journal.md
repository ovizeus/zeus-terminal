# ARES Server-Side Journal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the ARES trade journal (ML training dataset) SERVER-SIDE so it persists when the phone is closed — the last functional piece keeping ARES from being fully server-side.

**Architecture:** ARES decision+execution+wallet already run server-side (serverAres.js + aresRules.js, SERVER_ARES=true). Only the journal (`aresJournal.ts`, client localStorage) remained client-only. Add an `ares_journal` DB table (spec migration 407), capture entry decision context per-seq in the ARES state at open, write a journal row on close in `onPositionClosed`, expose `GET /api/ares/journal`, and have the client read it. Additive only — does NOT change what ARES trades or how it executes. Client engine kept as inert fallback (Phase-4 deletion deliberately out of scope — too risky).

**Tech Stack:** Node CommonJS, better-sqlite3, Express, Jest (server), Vitest (client), React/Zustand.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `server/services/database.js` | MODIFY | migration `416_ares_journal` + prepared stmts + `insertAresJournal` / `getAresJournal` |
| `server/services/serverAres.js` | MODIFY | capture entry context at open; write journal row + prune on close |
| `server/routes/trading.js` | MODIFY | `GET /api/ares/journal` (auth, self-scoped) |
| `client/src/stores/aresStore.ts` | MODIFY | `loadJournal()` fetch from `/api/ares/journal` when serverSide |
| `tests/unit/ares-journal.test.js` | CREATE | db methods + close-hook journal write + prune |

---

### Task 1: DB table + journal read/write methods

**Files:**
- Modify: `server/services/database.js` (migration near line 384 after `017_ares_state`; stmts near line 10389; methods near line 11716)
- Test: `tests/unit/ares-journal.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/ares-journal.test.js
const path = require('path');
const fs = require('fs');
const os = require('os');

// Fresh temp DB per run
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ares-journal-'));
process.env.ZEUS_DB_PATH = path.join(tmp, 'test.db');
const db = require('../../server/services/database');

describe('ares_journal db methods', () => {
  test('insert + read newest-first with limit', () => {
    const uid = 7;
    db.insertAresJournal(uid, { symbol: 'BTCUSDT', side: 'LONG', entry_price: 100, exit_price: 102, leverage: 10, notional: 500, confidence: 72, pnl: 9.5, fees: 0.5, reason: 'DSL_PL', regime: 'TREND', session: 'NY', opened_at: 1000, closed_at: 2000, decision_json: JSON.stringify({ reasons: ['ares', 'trend'] }) });
    db.insertAresJournal(uid, { symbol: 'BTCUSDT', side: 'SHORT', entry_price: 200, exit_price: 198, leverage: 8, notional: 400, confidence: 70, pnl: 3.1, fees: 0.4, reason: 'HIT_TP', regime: 'BREAKOUT', session: 'LONDON', opened_at: 3000, closed_at: 4000, decision_json: '{}' });
    const rows = db.getAresJournal(uid, { limit: 10, offset: 0 });
    expect(rows.length).toBe(2);
    expect(rows[0].closed_at).toBe(4000);   // newest first
    expect(rows[1].closed_at).toBe(2000);
    expect(rows[0].side).toBe('SHORT');
    expect(rows[1].pnl).toBeCloseTo(9.5, 5);
    // scoped per-user
    expect(db.getAresJournal(999, { limit: 10, offset: 0 }).length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `sudo -u zeus npx jest tests/unit/ares-journal.test.js --forceExit --runInBand`
Expected: FAIL — `db.insertAresJournal is not a function`

- [ ] **Step 3: Add the migration** (in `server/services/database.js`, immediately after the `017_ares_state` migration block, ~line 384)

```javascript
migrate('416_ares_journal', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ares_journal (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            symbol        TEXT NOT NULL DEFAULT 'BTCUSDT',
            side          TEXT NOT NULL,
            entry_price   REAL,
            exit_price    REAL,
            leverage      REAL,
            notional      REAL,
            confidence    REAL,
            pnl           REAL,
            fees          REAL,
            reason        TEXT,
            regime        TEXT,
            session       TEXT,
            opened_at     INTEGER,
            closed_at     INTEGER NOT NULL,
            decision_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_ares_journal_user ON ares_journal(user_id, closed_at DESC);
    `);
});
```

- [ ] **Step 4: Add prepared statements** (in the `_stmts` object near line 10389, next to `aresGet`/`aresUpsert`)

```javascript
    aresJournalInsert: db.prepare(`INSERT INTO ares_journal
        (user_id, symbol, side, entry_price, exit_price, leverage, notional, confidence, pnl, fees, reason, regime, session, opened_at, closed_at, decision_json)
        VALUES (@user_id, @symbol, @side, @entry_price, @exit_price, @leverage, @notional, @confidence, @pnl, @fees, @reason, @regime, @session, @opened_at, @closed_at, @decision_json)`),
    aresJournalList: db.prepare('SELECT * FROM ares_journal WHERE user_id = ? ORDER BY closed_at DESC, id DESC LIMIT ? OFFSET ?'),
```

- [ ] **Step 5: Add db methods** (in the exported db API object near `getAresState`/`saveAresState`, ~line 11716)

```javascript
      // ARES ML journal (per-trade dataset)
      insertAresJournal: (userId, row) => {
          _stmts.aresJournalInsert.run({
              user_id: userId,
              symbol: row.symbol || 'BTCUSDT',
              side: row.side || 'LONG',
              entry_price: Number.isFinite(+row.entry_price) ? +row.entry_price : null,
              exit_price: Number.isFinite(+row.exit_price) ? +row.exit_price : null,
              leverage: Number.isFinite(+row.leverage) ? +row.leverage : null,
              notional: Number.isFinite(+row.notional) ? +row.notional : null,
              confidence: Number.isFinite(+row.confidence) ? +row.confidence : null,
              pnl: Number.isFinite(+row.pnl) ? +row.pnl : null,
              fees: Number.isFinite(+row.fees) ? +row.fees : null,
              reason: row.reason != null ? String(row.reason) : null,
              regime: row.regime != null ? String(row.regime) : null,
              session: row.session != null ? String(row.session) : null,
              opened_at: Number.isFinite(+row.opened_at) ? +row.opened_at : null,
              closed_at: Number.isFinite(+row.closed_at) ? +row.closed_at : Date.now(),
              decision_json: row.decision_json != null ? String(row.decision_json) : null,
          });
      },
      getAresJournal: (userId, opts) => {
          const limit = Math.min(500, Math.max(1, (opts && +opts.limit) || 50));
          const offset = Math.max(0, (opts && +opts.offset) || 0);
          return _stmts.aresJournalList.all(userId, limit, offset);
      },
```

- [ ] **Step 6: Run test to verify it passes**

Run: `sudo -u zeus npx jest tests/unit/ares-journal.test.js --forceExit --runInBand`
Expected: PASS (1 test)

- [ ] **Step 7: Commit**

```bash
git add server/services/database.js tests/unit/ares-journal.test.js
git commit -m "feat(ares): server-side ares_journal table + insert/get db methods (TDD)"
```

---

### Task 2: Capture entry context at open + write journal on close

**Files:**
- Modify: `server/services/serverAres.js` (entry context near line 332; journal write in `onPositionClosed` near line 371; prune helper)
- Test: `tests/unit/ares-journal.test.js` (add a describe block)

- [ ] **Step 1: Write the failing test** (append to `tests/unit/ares-journal.test.js`)

```javascript
describe('serverAres writes a journal row on close', () => {
  const serverAres = require('../../server/services/serverAres');
  test('close hook journals entry context + outcome', () => {
    const uid = 11;
    // seed entry context the way tick() does
    serverAres._recordEntryContext(uid, 5001, {
      side: 'LONG', entryPrice: 100, leverage: 10, notional: 500,
      confidence: 71, entryScore: 60, regime: 'TREND', session: 14,
      reasons: ['ares', 'trend'], openedAt: 1000,
    });
    serverAres.onPositionClosed({ owner: 'ARES', userId: uid, seq: 5001, side: 'LONG', closePnl: 8, size: 50, lev: 10, margin: 50, closeReason: 'DSL_PL', markPrice: 102 });
    const rows = db.getAresJournal(uid, { limit: 10, offset: 0 });
    expect(rows.length).toBe(1);
    expect(rows[0].confidence).toBe(71);
    expect(rows[0].regime).toBe('TREND');
    expect(rows[0].reason).toBe('DSL_PL');
    expect(rows[0].entry_price).toBe(100);
    expect(rows[0].pnl).toBeLessThan(8);   // net = gross - fees
  });
  test('close without context still journals from pos (no throw)', () => {
    const uid = 12;
    serverAres.onPositionClosed({ owner: 'ARES', userId: uid, seq: 6001, side: 'SHORT', closePnl: -3, size: 40, lev: 8, margin: 40, closeReason: 'HIT_SL' });
    const rows = db.getAresJournal(uid, { limit: 10, offset: 0 });
    expect(rows.length).toBe(1);
    expect(rows[0].side).toBe('SHORT');
    expect(rows[0].reason).toBe('HIT_SL');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `sudo -u zeus npx jest tests/unit/ares-journal.test.js --forceExit --runInBand`
Expected: FAIL — `serverAres._recordEntryContext is not a function` and no journal row written.

- [ ] **Step 3: Add `_recordEntryContext` + prune** (in `server/services/serverAres.js`, module-level, near the top helpers)

```javascript
// Per-seq entry context for the ML journal, persisted in ares_state so it
// survives a restart between open and close. Pruned to avoid unbounded growth.
function _recordEntryContext(userId, seq, ctx) {
    try {
        const st = _loadState(userId);
        st.openCtx = st.openCtx || {};
        st.openCtx[String(seq)] = { ...ctx, _ts: Date.now() };
        _pruneOpenCtx(st);
        _saveState(userId, st);
    } catch (_) { /* journal context is best-effort */ }
}
function _pruneOpenCtx(st) {
    if (!st.openCtx) return;
    const keys = Object.keys(st.openCtx);
    const cutoff = Date.now() - 24 * 3600 * 1000;
    for (const k of keys) { if (((st.openCtx[k] && st.openCtx[k]._ts) || 0) < cutoff) delete st.openCtx[k]; }
}
```

- [ ] **Step 4: Call `_recordEntryContext` at open** (in `tick()`, right after the successful-entry block that sets `st3.lastDecision`, ~line 332)

```javascript
    _recordEntryContext(userId, entry.seq, {
        side: decision.side, entryPrice: +mctx.price, leverage: sizing.leverage,
        notional: sizing.stake * sizing.leverage, confidence,
        entryScore: +mctx.confluenceScore || 0,
        regime: mctx.regime ? mctx.regime.regime : 'UNKNOWN',
        session: new Date(now).getUTCHours(),
        reasons: decision.reasons.slice(0, 6), openedAt: now,
    });
```

- [ ] **Step 5: Write the journal row in `onPositionClosed`** (after `_saveState(pos.userId, st)` at ~line 371, before the audit.record line; reuse the `net`/`fees` already computed above)

```javascript
        // ── ML journal row (server-side dataset; survives phone-closed) ──
        try {
            const ctxMap = st.openCtx || {};
            const ec = ctxMap[String(pos.seq)] || null;
            const _sessName = (h) => (h >= 7 && h < 13) ? 'LONDON' : (h >= 13 && h < 21) ? 'NY' : 'ASIA';
            db.insertAresJournal(pos.userId, {
                symbol: pos.symbol || 'BTCUSDT',
                side: pos.side || (ec && ec.side) || 'LONG',
                entry_price: ec ? ec.entryPrice : (+pos.entryPrice || null),
                exit_price: Number.isFinite(+pos.markPrice) ? +pos.markPrice : (+pos.closePrice || null),
                leverage: ec ? ec.leverage : (+pos.lev || null),
                notional: ec ? ec.notional : ((+pos.size || 0) * (+pos.lev || 0) || null),
                confidence: ec ? ec.confidence : null,
                pnl: net,
                fees,
                reason: pos.closeReason || null,
                regime: ec ? ec.regime : null,
                session: ec ? _sessName(ec.session) : null,
                opened_at: ec ? ec.openedAt : (+pos.openedAt || null),
                closed_at: Date.now(),
                decision_json: ec ? JSON.stringify({ reasons: ec.reasons, entryScore: ec.entryScore }) : null,
            });
            if (st.openCtx) { delete st.openCtx[String(pos.seq)]; _saveState(pos.userId, st); }
        } catch (e) { try { logger.error('ARES', `journal write failed seq=${pos.seq}: ${e.message}`); } catch (_) {} }
```

- [ ] **Step 6: Export `_recordEntryContext`** (add to `module.exports` of `serverAres.js`)

```javascript
    _recordEntryContext,
```

- [ ] **Step 7: Run test to verify it passes**

Run: `sudo -u zeus npx jest tests/unit/ares-journal.test.js --forceExit --runInBand`
Expected: PASS (3 tests total)

- [ ] **Step 8: Run the full ARES suite (no regression)**

Run: `sudo -u zeus npx jest tests/unit/ares-rules.test.js tests/unit/server-ares.test.js tests/unit/ares-source-tag.test.js tests/unit/ares-journal.test.js --forceExit --runInBand`
Expected: all PASS (73 + 3 = 76)

- [ ] **Step 9: Commit**

```bash
git add server/services/serverAres.js tests/unit/ares-journal.test.js
git commit -m "feat(ares): journal entry context + write journal row on close (TDD)"
```

---

### Task 3: GET /api/ares/journal endpoint

**Files:**
- Modify: `server/routes/trading.js` (next to the existing `/api/ares/state` handler)

- [ ] **Step 1: Find the existing ares route** — `grep -n "ares/state\|api/ares" server/routes/trading.js` to locate the auth middleware + router pattern used by `/api/ares/state`.

- [ ] **Step 2: Add the journal endpoint** (mirror the auth + self-scoping of `/api/ares/state`; use `req.user.id`)

```javascript
// GET /api/ares/journal — ARES trade journal (ML dataset), self-scoped
router.get('/ares/journal', /* same auth middleware as /ares/state */ (req, res) => {
    try {
        const uid = req.user && req.user.id;
        if (!uid) return res.status(401).json({ ok: false, error: 'auth' });
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
        const rows = require('../services/database').getAresJournal(uid, { limit, offset });
        return res.json({ ok: true, journal: rows });
    } catch (e) {
        return res.status(500).json({ ok: false, error: 'journal read failed' });
    }
});
```

- [ ] **Step 3: Validate syntax**

Run: `node --check server/routes/trading.js`
Expected: no output (valid)

- [ ] **Step 4: Live smoke (after deploy in Task 5)** — `curl /api/ares/journal` with an admin cookie returns `{ok:true, journal:[...]}`.

- [ ] **Step 5: Commit**

```bash
git add server/routes/trading.js
git commit -m "feat(ares): GET /api/ares/journal endpoint (self-scoped)"
```

---

### Task 4: Client reads the journal from the server

**Files:**
- Modify: `client/src/stores/aresStore.ts` (add `loadJournal()` that fetches `/api/ares/journal` when `serverSide`)

- [ ] **Step 1: Add `journal` state + `loadJournal()`** to the store

```typescript
// in the store state: journal: [] as any[],
loadJournal: async () => {
  try {
    const r = await fetch('/api/ares/journal?limit=50', { credentials: 'same-origin' })
    if (!r.ok) return
    const d = await r.json()
    if (d && d.ok) set({ journal: d.journal || [] })
  } catch { /* non-fatal */ }
},
```

- [ ] **Step 2: Call `loadJournal()` when serverSide loads** — inside `loadFromServer()` after `serverSide=true` is set, call `get().loadJournal()`.

- [ ] **Step 3: Type-check**

Run: `cd client && sudo -u zeus npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add client/src/stores/aresStore.ts
git commit -m "feat(ares): client reads ML journal from /api/ares/journal when server-side"
```

---

### Task 5: Verify + deploy

- [ ] **Step 1: Full ARES jest suite green** — `sudo -u zeus npx jest tests/unit/ares-*.test.js tests/unit/server-ares.test.js --forceExit --runInBand` → all pass.
- [ ] **Step 2: Build client** — `cd client && sudo -u zeus npx vite build` → success.
- [ ] **Step 3: Bump `server/version.js`** (build +1, no-apostrophe changelog) + validate `node -e "require('./server/version.js')"`.
- [ ] **Step 4: Reload** — `sudo -u zeus pm2 reload zeus --update-env` + health check. Migration `416_ares_journal` applies on boot (idempotent).
- [ ] **Step 5: Live smoke** — confirm migration ran (`sqlite3 data/zeus.db ".tables" | grep ares_journal`); curl `/api/ares/journal` returns ok; on the next real ARES close, a row appears.
- [ ] **Step 6: Commit + push** all + update `docs/BOOK_OF_ALL.md` (ARES item) + memory.

---

## Self-Review

**Spec coverage:** Spec migration 407 (ares_journal) → Task 1 ✅. Server-side journal capture (Phase 3 "execution+monitor" data) → Task 2 ✅. `GET /api/ares/journal` (spec API table) → Task 3 ✅. Client render-only journal viewer (Phase 4 "keep aresJournal.ts as read-only viewer") → Task 4 ✅. Phase-4 deletion of client engine → DELIBERATELY OUT OF SCOPE (documented: risk vs. reward — client engine stays as inert SERVER_ARES=false fallback). Multi-symbol / RL loop → out of scope per spec.

**Placeholder scan:** Task 3 Step 2 has "same auth middleware as /ares/state" — resolved at execution time by reading the actual middleware in Step 1 (not a code placeholder, an explicit lookup instruction). All other steps have complete code.

**Type consistency:** `insertAresJournal(userId, row)` / `getAresJournal(userId, {limit,offset})` used identically in Tasks 1-3. `_recordEntryContext(userId, seq, ctx)` defined Task 2 Step 3, called Task 2 Step 4, used in test Task 2 Step 1 — signatures match. `net`/`fees` reused from existing onPositionClosed scope (already computed above the insertion point).

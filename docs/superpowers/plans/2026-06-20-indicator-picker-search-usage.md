# Indicator Picker — Search + Live Usage Count — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a search box and a live per-indicator usage badge (distinct currently-active users) to the indicator picker.

**Architecture:** Pure, unit-tested helpers (`_indMatchesQuery`, `_usageBadge`) in a new `client/src/engine/indicatorPicker.ts`. A tiny telemetry-safe server store (`indicator_usage` table) fed by a debounced client report (`POST /api/indicators/active`); the picker fetches aggregated counts (`GET /api/indicators/usage`, distinct live users per id, 30-day liveness, 60s cache) and renders a badge (hidden at 0). Search filters the rendered rows client-side. Never touches brain/trading.

**Tech Stack:** Client = TS + Vite + vitest (`cd client && sudo -u zeus npx vitest run <file>`). Server = Node CommonJS + better-sqlite3 + jest (`sudo -u zeus npx jest <file> --forceExit --runInBand`). Picker render = `openIndPanel()` in `client/src/engine/indicators.ts` (`#indPanel`/`#indPanelBody`, `.ind-row` items). Routes mount in `server.js` (`app.use('/api/...', require('./server/routes/...'))`). CSRF header `X-Zeus-Request:1` is auto-added by the client's global fetch patch.

**Rules:** TDD for pure logic; never full jest on live VPS; build client `cd client && sudo -u zeus npm run build` then `chown -R zeus:zeus public/app` from repo root; validate `server/version.js` with `node -e require` BEFORE pm2 reload; one batched deploy; GET operator GO before deploy.

---

## File structure
- **Create** `client/src/engine/indicatorPicker.ts` — pure helpers `_indMatchesQuery(ind, query)`, `_usageBadge(count)`. No DOM/IO.
- **Create** `client/src/engine/__tests__/indicatorPicker.test.ts` — vitest for the two helpers.
- **Create** `server/routes/indicators.js` — `_aggregateUsage(rows, now, knownIds)` (pure, exported) + `POST /active` + `GET /usage` (60s cache).
- **Create** `tests/unit/server/routes/indicators.test.js` — jest for `_aggregateUsage`.
- **Modify** `server/services/database.js` — add `indicator_usage` table (additive migration).
- **Modify** `server.js` — mount `app.use('/api/indicators', require('./server/routes/indicators'))`.
- **Modify** `client/src/engine/indicators.ts` — `openIndPanel()`: search input + usage badges; debounced `_reportActiveIndicators()`; fetch usage on open.
- **Modify** `client/src/ui/dom2.ts` (`togInd`) + indicators.ts `toggleInd` — call `_reportActiveIndicators()` after a toggle.
- **Modify** `client/src/app.css` — search box + badge styles.
- **Modify** `server/version.js` — bump at deploy.

---

## Task 1: Pure client helpers (`_indMatchesQuery`, `_usageBadge`) — TDD

**Files:** Create `client/src/engine/indicatorPicker.ts`, `client/src/engine/__tests__/indicatorPicker.test.ts`

- [ ] **Step 1: Write the failing test** — create `client/src/engine/__tests__/indicatorPicker.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { _indMatchesQuery, _usageBadge } from '../indicatorPicker'

const ema = { id: 'ema', name: 'EMA 50/200', desc: 'Exponential Moving Average', cat: 'trend' }

describe('_indMatchesQuery', () => {
  it('empty query matches everything', () => {
    expect(_indMatchesQuery(ema, '')).toBe(true)
    expect(_indMatchesQuery(ema, '   ')).toBe(true)
  })
  it('matches on name, case-insensitive', () => {
    expect(_indMatchesQuery(ema, 'ema')).toBe(true)
    expect(_indMatchesQuery(ema, 'EMA 50')).toBe(true)
  })
  it('matches on description and category', () => {
    expect(_indMatchesQuery(ema, 'exponential')).toBe(true)
    expect(_indMatchesQuery(ema, 'trend')).toBe(true)
  })
  it('no match returns false', () => {
    expect(_indMatchesQuery(ema, 'volume')).toBe(false)
  })
})

describe('_usageBadge', () => {
  it('returns null for 0 / negative / non-finite (hidden)', () => {
    expect(_usageBadge(0)).toBeNull()
    expect(_usageBadge(-3)).toBeNull()
    expect(_usageBadge(undefined as any)).toBeNull()
  })
  it('returns the count string for >= 1', () => {
    expect(_usageBadge(1)).toBe('1')
    expect(_usageBadge(10)).toBe('10')
  })
})
```

- [ ] **Step 2: Run to verify fail**

```
cd /opt/zeus-terminal/client && sudo -u zeus npx vitest run src/engine/__tests__/indicatorPicker.test.ts 2>&1 | tail -15
```
Expected: FAIL — cannot resolve `../indicatorPicker`.

- [ ] **Step 3: Implement** — create `client/src/engine/indicatorPicker.ts`:

```ts
// Pure helpers for the indicator picker (search filter + usage badge). No DOM/IO — unit-tested.

// Case-insensitive substring match against name + description + category. Empty query = match all.
export function _indMatchesQuery(ind: { name?: string; desc?: string; cat?: string }, query: string): boolean {
  const q = (query || '').trim().toLowerCase()
  if (!q) return true
  const hay = `${ind.name || ''} ${ind.desc || ''} ${ind.cat || ''}`.toLowerCase()
  return hay.includes(q)
}

// Badge text for a usage count. Hidden (null) when count <= 0 or not a finite number.
export function _usageBadge(count: number): string | null {
  const n = Number(count)
  if (!Number.isFinite(n) || n <= 0) return null
  return String(Math.floor(n))
}
```

- [ ] **Step 4: Run to verify pass**

```
cd /opt/zeus-terminal/client && sudo -u zeus npx vitest run src/engine/__tests__/indicatorPicker.test.ts 2>&1 | tail -8
```
Expected: PASS (6 cases).

- [ ] **Step 5: Commit**

```
cd /opt/zeus-terminal && git add client/src/engine/indicatorPicker.ts client/src/engine/__tests__/indicatorPicker.test.ts
git commit -m "feat(picker): pure helpers _indMatchesQuery + _usageBadge with tests"
```

---

## Task 2: Server — usage table + aggregator + routes

**Files:** Modify `server/services/database.js`; Create `server/routes/indicators.js`, `tests/unit/server/routes/indicators.test.js`; Modify `server.js`

- [ ] **Step 1: Add the table** — in `server/services/database.js`, next to another `CREATE TABLE IF NOT EXISTS` (e.g. near `ml_dsl_outcome` ~line 10207), add inside the same migration block:

```js
db.exec(`
  CREATE TABLE IF NOT EXISTS indicator_usage (
    user_id INTEGER NOT NULL,
    indicator_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, indicator_id)
  );
`);
```
Verify: `cd /opt/zeus-terminal && node -e "const db=require('./server/services/database').db; console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE name='indicator_usage'\").get())"` → prints the row (table created).

- [ ] **Step 2: Write the failing test** — create `tests/unit/server/routes/indicators.test.js`:

```js
const { _aggregateUsage } = require('../../../../server/routes/indicators');

const NOW = 1_000_000_000_000;
const DAY = 86400000;
const known = new Set(['ema', 'rsi', 'macd']);

describe('_aggregateUsage', () => {
  it('counts DISTINCT live users per indicator', () => {
    const rows = [
      { user_id: 1, indicator_id: 'ema', updated_at: NOW - DAY },
      { user_id: 2, indicator_id: 'ema', updated_at: NOW - 2 * DAY },
      { user_id: 1, indicator_id: 'rsi', updated_at: NOW - DAY },
    ];
    const r = _aggregateUsage(rows, NOW, known);
    expect(r.ema).toBe(2);
    expect(r.rsi).toBe(1);
    expect(r.macd).toBeUndefined(); // nobody uses it → omitted (badge hidden client-side)
  });
  it('excludes rows older than 30 days (not live)', () => {
    const rows = [{ user_id: 1, indicator_id: 'ema', updated_at: NOW - 31 * DAY }];
    expect(_aggregateUsage(rows, NOW, known).ema).toBeUndefined();
  });
  it('ignores unknown indicator ids', () => {
    const rows = [{ user_id: 1, indicator_id: 'totally_fake', updated_at: NOW }];
    expect(_aggregateUsage(rows, NOW, known).totally_fake).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run to verify fail**

```
cd /opt/zeus-terminal && sudo -u zeus npx jest tests/unit/server/routes/indicators.test.js --forceExit --runInBand 2>&1 | tail -10
```
Expected: FAIL — cannot find module `indicators`.

- [ ] **Step 4: Implement the route** — create `server/routes/indicators.js`:

```js
// Indicator usage telemetry — never touches brain/trading/signals. Stores each user's currently
// active indicator set; serves an aggregate live-usage count per indicator for the picker.
'use strict';
const express = require('express');
const router = express.Router();
const db = require('../services/database').db;
const { INDICATOR_IDS } = require('../services/indicatorIds');

const LIVE_MS = 30 * 86400000; // 30-day liveness window

// Pure: count distinct live users per known indicator id. Rows older than LIVE_MS or with
// unknown ids are ignored. Returns { id: count } omitting zero-count ids.
function _aggregateUsage(rows, now, knownIds) {
  const seen = {}; // id -> Set(user_id)
  for (const r of rows || []) {
    if (!knownIds.has(r.indicator_id)) continue;
    if ((now - Number(r.updated_at)) > LIVE_MS) continue;
    (seen[r.indicator_id] = seen[r.indicator_id] || new Set()).add(r.user_id);
  }
  const out = {};
  for (const id of Object.keys(seen)) out[id] = seen[id].size;
  return out;
}

let _cache = { ts: 0, data: null };

// Client reports its currently-active indicator ids; we replace this user's rows.
router.post('/active', (req, res) => {
  try {
    const uid = req.user && req.user.id;
    if (!uid) return res.status(401).json({ ok: false });
    const active = Array.isArray(req.body && req.body.active) ? req.body.active : [];
    const now = Date.now();
    const valid = active.filter((id) => typeof id === 'string' && INDICATOR_IDS.has(id));
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM indicator_usage WHERE user_id=?').run(uid);
      const ins = db.prepare('INSERT OR REPLACE INTO indicator_usage (user_id,indicator_id,updated_at) VALUES (?,?,?)');
      for (const id of valid) ins.run(uid, id, now);
    });
    tx();
    _cache = { ts: 0, data: null }; // invalidate
    res.json({ ok: true, n: valid.length });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Aggregate live usage counts (cached 60s).
router.get('/usage', (req, res) => {
  try {
    const now = Date.now();
    if (_cache.data && now - _cache.ts < 60000) return res.json({ ok: true, usage: _cache.data });
    const rows = db.prepare('SELECT user_id, indicator_id, updated_at FROM indicator_usage').all();
    const usage = _aggregateUsage(rows, now, INDICATOR_IDS);
    _cache = { ts: now, data: usage };
    res.json({ ok: true, usage });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
module.exports._aggregateUsage = _aggregateUsage;
```

- [ ] **Step 5: Create the shared id set** — create `server/services/indicatorIds.js` (server-side mirror of the indicator id list, so `/active` can validate without importing client code):

```js
// Canonical indicator id set (mirror of client INDICATORS ids) for server-side validation.
'use strict';
const INDICATOR_IDS = new Set([
  'ema','wma','rsi','stoch','macd','atr','obv','mfi','cci','adx','willr','roc','cmf','ao','aroon',
  'trix','uo','chop','helios','atlas','pantheon','selene','themis','erebus','anemoi','cerberus',
  'proteus','typhon','styx','geras','kairos','nyx','psyche','hyperion','eunomia','metis','kronos',
  'mentor','apollo',
]);
module.exports = { INDICATOR_IDS };
```
Note: this list is the union of the sub-pane ids already enumerated in indicators.ts `_syncSubChartsToMain` plus the price-overlay ids (ema/wma/macd). Validation only rejects junk; a missing-but-real id just won't be counted until added — harmless.

- [ ] **Step 6: Run to verify pass**

```
cd /opt/zeus-terminal && sudo -u zeus npx jest tests/unit/server/routes/indicators.test.js --forceExit --runInBand 2>&1 | grep "Tests:"
```
Expected: PASS (3 cases).

- [ ] **Step 7: Mount the route** — in `server.js`, near the other `app.use('/api/...', ...)` mounts (~line 1218), add:

```js
app.use('/api/indicators', require('./server/routes/indicators'));
```
Verify syntax: `node --check server.js && echo OK`.

- [ ] **Step 8: Commit**

```
git add server/services/database.js server/services/indicatorIds.js server/routes/indicators.js tests/unit/server/routes/indicators.test.js server.js
git commit -m "feat(picker): indicator_usage table + /active report + /usage aggregate (server)"
```

---

## Task 3: Search box in the picker

**Files:** Modify `client/src/engine/indicators.ts` (`openIndPanel`)

- [ ] **Step 1: Add the search input + filter** — in `openIndPanel()`, after `body.innerHTML = ''` and before the `_sorted.forEach`, inject a search field once and tag each row for filtering. Replace the `_sorted.forEach((ind) => { ... body.appendChild(row) })` block so each row carries a `data-search` attribute:

```ts
  // search box (once) above the list
  const panEl = document.getElementById('indPanel')
  if (panEl && !document.getElementById('indSearch')) {
    const wrap = document.createElement('div')
    wrap.className = 'ind-search-wrap'
    wrap.innerHTML = `<input id="indSearch" class="ind-search" type="text" placeholder="Search indicators…" autocomplete="off"><span class="ind-search-x" id="indSearchX">✕</span>`
    panEl.insertBefore(wrap, body)
    wrap.querySelector('#indSearch')!.addEventListener('input', (e) => _filterIndRows((e.target as HTMLInputElement).value))
    wrap.querySelector('#indSearchX')!.addEventListener('click', () => {
      const inp = document.getElementById('indSearch') as HTMLInputElement
      if (inp) { inp.value = ''; _filterIndRows('') }
    })
  }
```
And in the `_sorted.forEach`, add `data-search` to the row element (right after `row.className = 'ind-row'`):

```ts
    row.setAttribute('data-search', `${ind.name || ''} ${ind.desc || ''} ${ind.cat || ''}`.toLowerCase())
```
Then add the filter function (module-level, near `openIndPanel`), importing the pure helper at the top of indicators.ts (`import { _indMatchesQuery, _usageBadge } from './indicatorPicker'`):

```ts
function _filterIndRows(query: string): void {
  const body = document.getElementById('indPanelBody'); if (!body) return
  const q = (query || '').trim().toLowerCase()
  body.querySelectorAll('.ind-row').forEach((r: any) => {
    const hay = r.getAttribute('data-search') || ''
    r.style.display = (!q || hay.includes(q)) ? '' : 'none'
  })
}
```
(`_indMatchesQuery` is unit-tested for the same logic; `_filterIndRows` applies it over the DOM using the pre-built `data-search` haystack.)

- [ ] **Step 2: Build to verify it compiles**

```
cd /opt/zeus-terminal/client && sudo -u zeus npm run build 2>&1 | grep -E "built in|error TS" | head
```
Expected: built clean.

- [ ] **Step 3: Commit**

```
cd /opt/zeus-terminal && git add client/src/engine/indicators.ts
git commit -m "feat(picker): search box filters indicator list by name/desc/cat"
```

---

## Task 4: Usage badge + client report

**Files:** Modify `client/src/engine/indicators.ts`

- [ ] **Step 1: Add the badge to each row** — in `openIndPanel`'s row template, add a usage badge span inside `.ind-row-l` after the name/desc `<div>` block (before the closing `</div>` of `ind-row-l`):

```ts
        <span class="ind-usage" data-usage-id="${ind.id}"></span>
```
After `body.appendChild(row)` loop completes, populate badges from the cached usage map:

```ts
  _applyUsageBadges()
```
Add the module-level cache + apply function:

```ts
let _indUsage: Record<string, number> = {}
function _applyUsageBadges(): void {
  document.querySelectorAll('.ind-usage').forEach((el: any) => {
    const id = el.getAttribute('data-usage-id')
    const txt = _usageBadge(_indUsage[id] || 0)
    if (txt == null) { el.textContent = ''; el.style.display = 'none' }
    else { el.textContent = `👤 ${txt}`; el.style.display = '' }
  })
}
```

- [ ] **Step 2: Fetch usage when the picker opens** — at the end of `openIndPanel` (after `pan.classList.add('open')`), fetch + refresh:

```ts
  fetch('/api/indicators/usage', { credentials: 'same-origin' })
    .then((r) => r.ok ? r.json() : null)
    .then((j) => { if (j && j.ok && j.usage) { _indUsage = j.usage; _applyUsageBadges() } })
    .catch(() => { /* badges just stay hidden */ })
```

- [ ] **Step 3: Add the debounced report** — module-level in indicators.ts:

```ts
let _reportTimer: any = null
export function _reportActiveIndicators(): void {
  if (_reportTimer) clearTimeout(_reportTimer)
  _reportTimer = setTimeout(() => {
    try {
      const active = Object.keys(w.S.activeInds || {}).filter((k) => w.S.activeInds[k])
      fetch('/api/indicators/active', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      }).catch(() => { /* fire-and-forget */ })
    } catch (_) { /* ignore */ }
  }, 2000)
}
```
(The client's global fetch patch adds the `X-Zeus-Request:1` CSRF header automatically.)

- [ ] **Step 4: Call the report on toggle + on load** — in `toggleInd` (indicators.ts), after the visibility/state change, add `_reportActiveIndicators()`. In `client/src/ui/dom2.ts` `togInd`, after `_usSave()`, add `import`-ed call `_reportActiveIndicators()` (import it at top: `import { ..., _reportActiveIndicators } from '../engine/indicators'`). In `initActBar` (dom2.ts), after the `INDICATORS.forEach` visibility loop, add `_reportActiveIndicators()` so a user's set is reported on load.

- [ ] **Step 5: Build**

```
cd /opt/zeus-terminal/client && sudo -u zeus npm run build 2>&1 | grep -E "built in|error TS" | head
```
Expected: built clean.

- [ ] **Step 6: Commit**

```
cd /opt/zeus-terminal && git add client/src/engine/indicators.ts client/src/ui/dom2.ts
git commit -m "feat(picker): live usage badge + debounced active-set report"
```

---

## Task 5: CSS + deploy + verify

**Files:** Modify `client/src/app.css`, `server/version.js`

- [ ] **Step 1: Styles** — append to `client/src/app.css`:

```css
/* [2026-06-20] indicator picker search + usage badge */
.ind-search-wrap { position:relative; padding:8px 10px 4px; }
.ind-search { width:100%; box-sizing:border-box; padding:7px 28px 7px 10px; background:#0c1219; border:1px solid #1e2a36; border-radius:7px; color:#c8d6e5; font-size:13px; outline:none; }
.ind-search:focus { border-color:#2e6f9e; }
.ind-search-x { position:absolute; right:18px; top:14px; color:#5a6a7a; cursor:pointer; font-size:12px; }
.ind-usage { font-size:10px; color:#7a9ab8; background:rgba(122,154,184,.12); border-radius:8px; padding:1px 6px; margin-left:6px; white-space:nowrap; }
```

- [ ] **Step 2: Build + chown**

```
cd /opt/zeus-terminal/client && sudo -u zeus npm run build 2>&1 | grep -E "built in|error TS" | head
cd /opt/zeus-terminal && chown -R zeus:zeus public/app
```
Expected: built clean.

- [ ] **Step 3: Bump version** — edit `server/version.js`: version `1.7.120`, build `146`, add a changelog line describing the picker search + live usage badge. Validate: `node -e "require('./server/version.js')" && echo OK` BEFORE reload.

- [ ] **Step 4: Reload + headless verify (GET OPERATOR GO FIRST)**

```
sudo -u zeus pm2 reload zeus && sleep 3 && curl -s -o /dev/null -w "health=%{http_code}\n" http://localhost:3000/api/health
```
Headless (uid=1 token, serviceWorkers:'block'): open the picker (`openIndPanel`), assert: the search box exists and typing "rsi" hides non-matching `.ind-row`s; `POST /api/indicators/active` is sent on toggle; `GET /api/indicators/usage` returns `{ok:true}`; badges render for indicators with ≥1 user and are hidden for 0; 0 page/console errors. Screenshot.

- [ ] **Step 5: Commit + push (after GO)**

```
git add server/version.js client/src/app.css
git commit -m "feat(picker): styles + b146 release — search + live usage badge"
git push origin main
```

---

## Rollback
Pure client + an additive table + a new isolated route. To disable: revert the commits; the `indicator_usage` table can stay (unused). No brain/trading impact at any point.

## Self-review
- **Spec coverage:** search client-only (T1 helper + T3) ✓; live usage count — table (T2 S1) + report endpoint (T2 S4) + aggregate endpoint w/ 30-day liveness + 60s cache (T2 S4) + client report debounced on toggle/load (T4 S3-4) + badge hidden at 0 (T1 `_usageBadge` + T4 `_applyUsageBadges`) ✓; fail-safe (fetch .catch, fire-and-forget) ✓; telemetry-safe / no brain-trading (separate table + route) ✓; tests (vitest T1, jest T2, headless T5) ✓.
- **Type/name consistency:** `_indMatchesQuery(ind,query)`, `_usageBadge(count)`, `_aggregateUsage(rows,now,knownIds)`, `_reportActiveIndicators()`, `_applyUsageBadges()`, `_filterIndRows(query)`, `_indUsage`, table `indicator_usage(user_id,indicator_id,updated_at)`, endpoints `POST /api/indicators/active {active:[]}` + `GET /api/indicators/usage {ok,usage}` — consistent across tasks. `INDICATOR_IDS` shared set used by both `/active` validation and `_aggregateUsage`.
- **Placeholder scan:** all steps have concrete code/commands. The `INDICATOR_IDS` list is enumerated explicitly (Task 2 Step 5).

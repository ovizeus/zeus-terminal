# REAL Gate Package (P0-3 ML opt-in + P0-4 coherence guard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the path to REAL money fail-closed by construction: per-user ML opt-in enforced at influence-eligibility level, and a coherence guard that screams (log + Telegram) if the REAL flags are ever flipped into an incoherent combination (exec on / fills blind / hybrid race / ML without consent).

**Architecture:** Three small, pure, independently-testable units wired into existing seams: (1) `mlLiveOptin` store (new DB table via the established `migrate()` pattern + accessor), (2) a new check inside `influenceEligibility.checkEligibility` for env=REAL, (3) `realGateCoherence` pure predicate wired at boot and into `migrationFlags.set()`. Everything is INERT today (`_SRV_POS_REAL_ENABLED=false`, `ML_LIVE_INFLUENCE_ENABLED=false`) — zero behavior change until the REAL day; this package only adds teeth for that day.

**Tech Stack:** Node CommonJS, better-sqlite3 (`migrate()` pattern in `server/services/database.js`), jest (`--runInBand --forceExit`, output to file, NEVER full suite on the live VPS).

**Money-path note:** No execution code is touched. `serverAT.js` is NOT modified. The 3 existing fail-closed REAL layers (serverAT.js:1650, :3562, :3950) and `ownership.computeFullOwnership` (T1-3) stay exactly as they are.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `server/services/database.js` | Modify (append one `migrate()`) | `ml_live_optin` table |
| `server/services/ml/mlLiveOptin.js` | Create | opt-in persistence: `isOptedIn`, `setOptin` (+audit row) |
| `server/services/ml/_ring5/influenceEligibility.js` | Modify | REAL ⇒ require opt-in (new reason `live_optin_missing`) |
| `server/migrationFlags.js` | Modify | `ML_LIVE_OPTIN_REQUIRED` default `false→true`; export `_DEFAULTS` for tests |
| `data/migration_flags.json` | Modify (runtime, NOT committed if gitignored) | persisted `ML_LIVE_OPTIN_REQUIRED: true` |
| `server/services/realGateCoherence.js` | Create | pure predicate: flags → `{coherent, problems[]}` |
| `server.js` | Modify (2 lines near :1388) | boot coherence check (log + Telegram) |
| `server/routes/ring5.js` | Modify | `GET/POST /api/ring5/live-optin` (self-service, audited) |
| `docs/runbooks/REAL-GATE-CHECKLIST.md` | Create | ordered flag-flip runbook for the REAL day |
| `tests/unit/mlLiveOptin.test.js` | Create | store TDD |
| `tests/unit/influenceEligibility-optin.test.js` | Create | gate TDD |
| `tests/unit/realGateCoherence.test.js` | Create | predicate TDD |
| `tests/unit/migrationFlags-defaults.test.js` | Create | pins fail-closed default |

**Conventions:** commit after every green step (operator's crash-safety rule — net drops often). Jest: `npx jest <files> --runInBand --forceExit > /tmp/<name>.log 2>&1` then grep the log. NO pm2 reload inside this plan — all code is inert; reload rides with the next scheduled deploy window (anti-ban).

---

### Task 1: `ml_live_optin` table + store module

**Files:**
- Modify: `server/services/database.js` (append a `migrate()` near the end of the migrate block)
- Create: `server/services/ml/mlLiveOptin.js`
- Test: `tests/unit/mlLiveOptin.test.js`

- [ ] **Step 1.1: Find the next migration number**

Run: `grep -oE "^migrate\('([0-9]+)" server/services/database.js | grep -oE "[0-9]+" | sort -n | tail -1`
Expected: the highest existing number (e.g. `390`). Use `<next>` = that + 1 in Step 1.4 (e.g. `391_ml_live_optin`).

- [ ] **Step 1.2: Write the failing test**

```js
'use strict';
// tests/unit/mlLiveOptin.test.js
// [REAL-GATE P0-3 2026-06-09] Per-user explicit opt-in for REAL ML influence.
// Fail-closed: absence of a row === NOT opted in.

const fs = require('fs');
const os = require('os');
const path = require('path');

let optin;

beforeAll(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-optin-'));
    process.env.ZEUS_DB_PATH = path.join(tmp, 'test.db');
    optin = require('../../server/services/ml/mlLiveOptin');
});

describe('mlLiveOptin store', () => {
    test('user with no row is NOT opted in (fail-closed default)', () => {
        expect(optin.isOptedIn(42)).toBe(false);
    });

    test('setOptin(true) then isOptedIn === true', () => {
        optin.setOptin(42, true, 'test');
        expect(optin.isOptedIn(42)).toBe(true);
    });

    test('setOptin(false) revokes (upsert, not insert-only)', () => {
        optin.setOptin(42, true, 'test');
        optin.setOptin(42, false, 'test');
        expect(optin.isOptedIn(42)).toBe(false);
    });

    test('opt-in is per-user — user 43 unaffected by user 42', () => {
        optin.setOptin(42, true, 'test');
        expect(optin.isOptedIn(43)).toBe(false);
    });

    test('setOptin writes an audit_log row ML_LIVE_OPTIN_SET', () => {
        const { db } = require('../../server/services/database');
        optin.setOptin(42, true, 'test-audit');
        const row = db.prepare(
            "SELECT details FROM audit_log WHERE action='ML_LIVE_OPTIN_SET' AND user_id=42 ORDER BY id DESC LIMIT 1"
        ).get();
        expect(row).toBeTruthy();
        expect(JSON.parse(row.details).source).toBe('test-audit');
    });

    test('isOptedIn never throws on garbage input', () => {
        expect(optin.isOptedIn(null)).toBe(false);
        expect(optin.isOptedIn(undefined)).toBe(false);
    });
});
```

- [ ] **Step 1.3: Run it — must FAIL with "Cannot find module .../mlLiveOptin"**

Run: `npx jest tests/unit/mlLiveOptin.test.js --runInBand --forceExit > /tmp/optin-red.log 2>&1; grep -E "Cannot find|Tests:" /tmp/optin-red.log`

- [ ] **Step 1.4: Add the migration in `server/services/database.js`**

Append after the LAST existing `migrate('...')` call (number from Step 1.1):

```js
// [REAL-GATE P0-3 2026-06-09] Per-user explicit opt-in for REAL ML influence.
// Absence of a row = NOT opted in (fail-closed). Written only via
// mlLiveOptin.setOptin (audited). Read by influenceEligibility on env=REAL.
migrate('<next>_ml_live_optin', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_live_optin (
            user_id     INTEGER PRIMARY KEY,
            opted_in    INTEGER NOT NULL DEFAULT 0,
            updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
            source      TEXT
        );
    `);
});
```

**IMPORTANT for fresh-DB tests:** `_seedBaselineIfFresh()` marks baseline migrations as applied on fresh DBs, but new migrations added AFTER the baseline snapshot still run normally via `migrate()` — verify the table exists in the test DB (the test from 1.2 does this implicitly).

- [ ] **Step 1.5: Create `server/services/ml/mlLiveOptin.js`**

```js
'use strict';
// [REAL-GATE P0-3 2026-06-09] Per-user explicit opt-in for REAL ML influence.
// Fail-closed: no row === not opted in. Every change is audited.

const { db } = require('../database');

function isOptedIn(userId) {
    if (!userId) return false;
    try {
        const row = db.prepare('SELECT opted_in FROM ml_live_optin WHERE user_id = ?').get(userId);
        return !!(row && row.opted_in === 1);
    } catch (_) {
        return false; // table missing / DB error → fail-closed
    }
}

function setOptin(userId, optedIn, source) {
    if (!userId) throw new Error('mlLiveOptin.setOptin: userId required');
    const val = optedIn === true ? 1 : 0;
    db.prepare(`
        INSERT INTO ml_live_optin (user_id, opted_in, updated_at, source)
        VALUES (?, ?, datetime('now'), ?)
        ON CONFLICT(user_id) DO UPDATE SET
            opted_in = excluded.opted_in,
            updated_at = excluded.updated_at,
            source = excluded.source
    `).run(userId, val, source || null);
    try {
        db.prepare(
            "INSERT INTO audit_log (user_id, action, details) VALUES (?, 'ML_LIVE_OPTIN_SET', ?)"
        ).run(userId, JSON.stringify({ optedIn: val === 1, source: source || null }));
    } catch (_) { /* audit best-effort */ }
    return { userId, optedIn: val === 1 };
}

module.exports = { isOptedIn, setOptin };
```

- [ ] **Step 1.6: Run tests — must PASS 6/6**

Run: `npx jest tests/unit/mlLiveOptin.test.js --runInBand --forceExit > /tmp/optin-green.log 2>&1; grep -E "Tests:" /tmp/optin-green.log`
Expected: `Tests: 6 passed, 6 total`

- [ ] **Step 1.7: Commit**

```bash
git add server/services/database.js server/services/ml/mlLiveOptin.js tests/unit/mlLiveOptin.test.js
git commit -m "feat(real-gate): ml_live_optin store — per-user REAL ML consent, fail-closed, audited (P0-3 1/3)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 2: opt-in gate in `influenceEligibility` (env=REAL)

**Files:**
- Modify: `server/services/ml/_ring5/influenceEligibility.js` (after the `envAllowed` block, ~line 66)
- Test: `tests/unit/influenceEligibility-optin.test.js`

- [ ] **Step 2.1: Write the failing test**

```js
'use strict';
// tests/unit/influenceEligibility-optin.test.js
// [REAL-GATE P0-3 2026-06-09] env=REAL requires per-user opt-in BEFORE any
// other eligibility math. Audit finding: ML_LIVE_OPTIN_REQUIRED existed as a
// flag but was consulted by NOBODY.

const mockFlags = {
    ML_PIPELINE_SHADOW: true,
    ML_DEMO_INFLUENCE_ENABLED: true,
    ML_TESTNET_INFLUENCE_ENABLED: true,
    ML_LIVE_INFLUENCE_ENABLED: true,   // worst case: someone flipped it
    ML_LIVE_OPTIN_REQUIRED: true,
};
jest.mock('../../server/migrationFlags', () => mockFlags);

let optedIn = false;
jest.mock('../../server/services/ml/mlLiveOptin', () => ({
    isOptedIn: jest.fn(() => optedIn),
}));

// Downstream deps stubbed so the pipeline would otherwise continue:
jest.mock('../../server/services/ml/_ring5/banditPosteriors', () => ({
    getPosterior: () => null, // → insufficient_observations if gate passes
}));
jest.mock('../../server/services/ml/R5B_governance/versionRegistry', () => ({ getActive: () => null }));
jest.mock('../../server/services/ml/R5B_governance/preRegistration', () => ({ getRegistrationsForVersion: () => [] }));

const { checkEligibility } = require('../../server/services/ml/_ring5/influenceEligibility');

const base = { userId: 1, symbol: 'BTCUSDT', regime: 'trend', nowTs: 1000 };

describe('influenceEligibility REAL opt-in gate', () => {
    beforeEach(() => { optedIn = false; mockFlags.ML_LIVE_OPTIN_REQUIRED = true; });

    test('REAL + no opt-in → ineligible with live_optin_missing', () => {
        const r = checkEligibility({ ...base, env: 'REAL' });
        expect(r.eligible).toBe(false);
        expect(r.reason).toBe('live_optin_missing');
    });

    test('REAL + opted in → gate passes through (next check fires)', () => {
        optedIn = true;
        const r = checkEligibility({ ...base, env: 'REAL' });
        expect(r.reason).toBe('insufficient_observations'); // proves we got past opt-in
    });

    test('TESTNET does not require opt-in', () => {
        const r = checkEligibility({ ...base, env: 'TESTNET' });
        expect(r.reason).toBe('insufficient_observations');
    });

    test('env casing: "real" lowercase still gated', () => {
        const r = checkEligibility({ ...base, env: 'real' });
        expect(r.reason).toBe('live_optin_missing');
    });

    test('flag escape hatch: ML_LIVE_OPTIN_REQUIRED=false skips the gate (deliberate)', () => {
        mockFlags.ML_LIVE_OPTIN_REQUIRED = false;
        const r = checkEligibility({ ...base, env: 'REAL' });
        expect(r.reason).toBe('insufficient_observations');
    });
});
```

- [ ] **Step 2.2: Run — must FAIL (`live_optin_missing` vs received `insufficient_observations`)**

Run: `npx jest tests/unit/influenceEligibility-optin.test.js --runInBand --forceExit > /tmp/elig-red.log 2>&1; grep -E "✕|Tests:|Expected|Received" /tmp/elig-red.log | head -8`

- [ ] **Step 2.3: Implement — insert AFTER the `envAllowed` if-block (after its closing `}`, before `const cellKey`)**

```js
    // [REAL-GATE P0-3 2026-06-09] Real money requires the user's explicit,
    // audited consent — checked HERE so no downstream math can bypass it.
    // ML_LIVE_OPTIN_REQUIRED defaults TRUE (fail-closed); setting it false is
    // a deliberate operator escape hatch (see REAL-GATE-CHECKLIST runbook).
    if (envUpper === 'REAL' && MF.ML_LIVE_OPTIN_REQUIRED === true) {
        const mlLiveOptin = require('../mlLiveOptin');
        if (!mlLiveOptin.isOptedIn(userId)) {
            return {
                eligible: false,
                reason: 'live_optin_missing',
                observationCount: 0,
                preRegStatus: null,
                versionId: null,
                env: envUpper,
            };
        }
    }
```

- [ ] **Step 2.4: Run — must PASS 5/5; then run the EXISTING ring5/eligibility suites for regression**

Run: `npx jest tests/unit/influenceEligibility-optin.test.js --runInBand --forceExit > /tmp/elig-green.log 2>&1; grep "Tests:" /tmp/elig-green.log`
Run: `ls tests/unit | grep -iE "eligib|ring5|influence"` then `npx jest <those files> --runInBand --forceExit > /tmp/elig-reg.log 2>&1; grep "Tests:" /tmp/elig-reg.log`
Expected: all pass, zero regression.

- [ ] **Step 2.5: Commit**

```bash
git add server/services/ml/_ring5/influenceEligibility.js tests/unit/influenceEligibility-optin.test.js
git commit -m "feat(real-gate): REAL ML influence requires per-user opt-in at eligibility level (P0-3 2/3)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 3: fail-closed default for `ML_LIVE_OPTIN_REQUIRED`

**Files:**
- Modify: `server/migrationFlags.js` (DEFAULTS + export `_DEFAULTS`)
- Modify: `data/migration_flags.json` (runtime file on the VPS — persisted value)
- Test: `tests/unit/migrationFlags-defaults.test.js`

- [ ] **Step 3.1: Write the failing test**

```js
'use strict';
// tests/unit/migrationFlags-defaults.test.js
// [REAL-GATE P0-3 2026-06-09] Pins fail-closed defaults. The flag's own doc
// comment said "(default)" true while the code said false — this test makes
// the doc true and keeps it true.

const MF = require('../../server/migrationFlags');

describe('migrationFlags fail-closed defaults', () => {
    test('exports _DEFAULTS for inspection', () => {
        expect(MF._DEFAULTS).toBeDefined();
    });

    test('ML_LIVE_OPTIN_REQUIRED defaults TRUE (fail-closed)', () => {
        expect(MF._DEFAULTS.ML_LIVE_OPTIN_REQUIRED).toBe(true);
    });

    test('REAL execution flags default FALSE (fail-closed)', () => {
        expect(MF._DEFAULTS._SRV_POS_REAL_ENABLED).toBe(false);
        expect(MF._DEFAULTS._USERDATA_STREAM_REAL_ENABLED).toBe(false);
        expect(MF._DEFAULTS.ML_LIVE_INFLUENCE_ENABLED).toBe(false);
    });
});
```

- [ ] **Step 3.2: Run — must FAIL (`_DEFAULTS` undefined)**

Run: `npx jest tests/unit/migrationFlags-defaults.test.js --runInBand --forceExit > /tmp/flags-red.log 2>&1; grep -E "✕|Tests:" /tmp/flags-red.log`

- [ ] **Step 3.3: Implement in `server/migrationFlags.js`**

(a) In `DEFAULTS`, change `ML_LIVE_OPTIN_REQUIRED: false,` → `ML_LIVE_OPTIN_REQUIRED: true,` (keep the existing comment above it).
(b) In the `module.exports` object, add one line: `_DEFAULTS: DEFAULTS,`

- [ ] **Step 3.4: Run — must PASS 3/3**

Run: `npx jest tests/unit/migrationFlags-defaults.test.js --runInBand --forceExit > /tmp/flags-green.log 2>&1; grep "Tests:" /tmp/flags-green.log`

- [ ] **Step 3.5: Update the persisted runtime file (VPS)**

`data/migration_flags.json` currently has `"ML_LIVE_OPTIN_REQUIRED": false` (persisted values override DEFAULTS). Edit it to `true`:

Run: `node -e "const f='data/migration_flags.json';const fs=require('fs');const j=JSON.parse(fs.readFileSync(f));j.ML_LIVE_OPTIN_REQUIRED=true;fs.writeFileSync(f,JSON.stringify(j,null,2));console.log('ML_LIVE_OPTIN_REQUIRED →',j.ML_LIVE_OPTIN_REQUIRED)"`
Expected: `ML_LIVE_OPTIN_REQUIRED → true`. (Takes effect at next reload; inert either way today since `ML_LIVE_INFLUENCE_ENABLED=false`.)

- [ ] **Step 3.6: Commit**

```bash
git add server/migrationFlags.js tests/unit/migrationFlags-defaults.test.js
git commit -m "feat(real-gate): ML_LIVE_OPTIN_REQUIRED defaults true + _DEFAULTS export pinned by test (P0-3 3/3)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
```
(`data/migration_flags.json` is runtime state — add it ONLY if the repo tracks it; check `git check-ignore data/migration_flags.json` first.)

---

### Task 4: self-service opt-in route `GET/POST /api/ring5/live-optin`

**Files:**
- Modify: `server/routes/ring5.js` (route file already mounted at `/api/ring5`, server.js:1201)

The route is deliberately THIN (all logic lives in the already-tested store). Add at the end of `server/routes/ring5.js`, before `module.exports = router;`:

- [ ] **Step 4.1: Implement**

```js
// [REAL-GATE P0-3 2026-06-09] Per-user REAL ML influence consent.
// Self-service (req.user.id only — no cross-user access), audited in store.
const mlLiveOptin = require('../services/ml/mlLiveOptin');

router.get('/live-optin', (req, res) => {
    if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'auth required' });
    res.json({ ok: true, optedIn: mlLiveOptin.isOptedIn(req.user.id) });
});

router.post('/live-optin', (req, res) => {
    if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'auth required' });
    const optedIn = req.body && req.body.optedIn === true;
    const result = mlLiveOptin.setOptin(req.user.id, optedIn, 'api');
    res.json({ ok: true, ...result });
});
```

- [ ] **Step 4.2: Regression — ring5 route suite (if present)**

Run: `ls tests/ -R | grep -i ring5` → if a route test exists run it: `npx jest <file> --runInBand --forceExit > /tmp/ring5-reg.log 2>&1; grep "Tests:" /tmp/ring5-reg.log`. Expected: no regression (new routes don't alter existing ones).

- [ ] **Step 4.3: Commit**

```bash
git add server/routes/ring5.js
git commit -m "feat(real-gate): GET/POST /api/ring5/live-optin self-service consent route

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
```

(Post-deploy verification for this route lives in Task 6's checklist — curl with the operator JWT, expect `{ok:true, optedIn:false}`.)

---

### Task 5: `realGateCoherence` guard (P0-4 remainder)

Context: execution refusal (3 layers in serverAT) and ownership (T1-3) are DONE. The remaining hole is **incoherent flag combinations** on the REAL day — e.g. exec enabled while the REAL userDataStream is off → positions open but fills are invisible. Nothing watches for that. This guard is pure + loud, never blocking (it ALERTS; the existing fail-closed layers do the blocking).

**Files:**
- Create: `server/services/realGateCoherence.js`
- Modify: `server.js` (right after the `Feature flags:` log, ~line 1388)
- Modify: `server/migrationFlags.js` (inside `set()`, after persisting)
- Test: `tests/unit/realGateCoherence.test.js`

- [ ] **Step 5.1: Write the failing test**

```js
'use strict';
// tests/unit/realGateCoherence.test.js
// [REAL-GATE P0-4 2026-06-09] Flag-combination sanity. Each problem string
// must name the flags involved so the Telegram alert is actionable.

const { checkRealGateCoherence } = require('../../server/services/realGateCoherence');

const SAFE_TODAY = {
    _SRV_POS_REAL_ENABLED: false,
    _USERDATA_STREAM_REAL_ENABLED: false,
    USERDATA_STREAM_ENABLED: true,
    SERVER_AT_FULL_OWNERSHIP: true,
    ML_LIVE_INFLUENCE_ENABLED: false,
    ML_LIVE_OPTIN_REQUIRED: true,
};

describe('realGateCoherence', () => {
    test('today\'s production combination is coherent', () => {
        expect(checkRealGateCoherence(SAFE_TODAY)).toEqual({ coherent: true, problems: [] });
    });

    test('REAL exec without REAL userDataStream → blind fills problem', () => {
        const r = checkRealGateCoherence({ ...SAFE_TODAY, _SRV_POS_REAL_ENABLED: true });
        expect(r.coherent).toBe(false);
        expect(r.problems.join(' ')).toContain('_USERDATA_STREAM_REAL_ENABLED');
    });

    test('REAL exec without full ownership → two-engine race problem', () => {
        const r = checkRealGateCoherence({
            ...SAFE_TODAY,
            _SRV_POS_REAL_ENABLED: true,
            _USERDATA_STREAM_REAL_ENABLED: true,
            SERVER_AT_FULL_OWNERSHIP: false,
        });
        expect(r.coherent).toBe(false);
        expect(r.problems.join(' ')).toContain('SERVER_AT_FULL_OWNERSHIP');
    });

    test('REAL exec with master stream switch off → problem', () => {
        const r = checkRealGateCoherence({
            ...SAFE_TODAY,
            _SRV_POS_REAL_ENABLED: true,
            _USERDATA_STREAM_REAL_ENABLED: true,
            USERDATA_STREAM_ENABLED: false,
        });
        expect(r.coherent).toBe(false);
        expect(r.problems.join(' ')).toContain('USERDATA_STREAM_ENABLED');
    });

    test('ML live influence without opt-in requirement → consent problem', () => {
        const r = checkRealGateCoherence({
            ...SAFE_TODAY,
            ML_LIVE_INFLUENCE_ENABLED: true,
            ML_LIVE_OPTIN_REQUIRED: false,
        });
        expect(r.coherent).toBe(false);
        expect(r.problems.join(' ')).toContain('ML_LIVE_OPTIN_REQUIRED');
    });

    test('fully-armed correct REAL combination is coherent', () => {
        expect(checkRealGateCoherence({
            _SRV_POS_REAL_ENABLED: true,
            _USERDATA_STREAM_REAL_ENABLED: true,
            USERDATA_STREAM_ENABLED: true,
            SERVER_AT_FULL_OWNERSHIP: true,
            ML_LIVE_INFLUENCE_ENABLED: true,
            ML_LIVE_OPTIN_REQUIRED: true,
        }).coherent).toBe(true);
    });

    test('null/garbage input → incoherent, never throws', () => {
        expect(checkRealGateCoherence(null).coherent).toBe(false);
    });
});
```

- [ ] **Step 5.2: Run — must FAIL (module missing)**

Run: `npx jest tests/unit/realGateCoherence.test.js --runInBand --forceExit > /tmp/coh-red.log 2>&1; grep -E "Cannot find|Tests:" /tmp/coh-red.log`

- [ ] **Step 5.3: Create `server/services/realGateCoherence.js`**

```js
'use strict';
// [REAL-GATE P0-4 2026-06-09] Pure flag-combination sanity for the REAL day.
// NEVER blocks (the 3 fail-closed layers in serverAT + ownership do that) —
// this SCREAMS, so an incoherent flip is noticed in seconds, not at the
// first invisible fill. Wired: boot (server.js) + migrationFlags.set().

function checkRealGateCoherence(f) {
    if (!f || typeof f !== 'object') {
        return { coherent: false, problems: ['flags object missing — cannot assess REAL gate coherence'] };
    }
    const problems = [];
    if (f._SRV_POS_REAL_ENABLED === true) {
        if (f._USERDATA_STREAM_REAL_ENABLED !== true) {
            problems.push('REAL exec ON but _USERDATA_STREAM_REAL_ENABLED off — fills on real money would be INVISIBLE (phantom-position factory)');
        }
        if (f.USERDATA_STREAM_ENABLED !== true) {
            problems.push('REAL exec ON but master USERDATA_STREAM_ENABLED off — no fill stream at all');
        }
        if (f.SERVER_AT_FULL_OWNERSHIP !== true) {
            problems.push('REAL exec ON but SERVER_AT_FULL_OWNERSHIP off — SP2-a hybrid = two engines racing on real money');
        }
    }
    if (f.ML_LIVE_INFLUENCE_ENABLED === true && f.ML_LIVE_OPTIN_REQUIRED !== true) {
        problems.push('ML_LIVE_INFLUENCE_ENABLED on without ML_LIVE_OPTIN_REQUIRED — real-money ML without per-user consent');
    }
    return { coherent: problems.length === 0, problems };
}

// Convenience wrapper used by the two wiring points. Loud, best-effort.
function assertAndAlert(flagsGetAll, label) {
    try {
        const r = checkRealGateCoherence(flagsGetAll);
        if (!r.coherent) {
            const msg = `🚨 *REAL GATE INCOHERENT* (${label}):\n- ` + r.problems.join('\n- ');
            try { require('./logger').error('REAL_GATE', msg); } catch (_) { console.error(msg); }
            try { require('./telegram').send(msg); } catch (_) {}
        }
        return r;
    } catch (e) {
        return { coherent: false, problems: ['coherence check crashed: ' + e.message] };
    }
}

module.exports = { checkRealGateCoherence, assertAndAlert };
```

- [ ] **Step 5.4: Run — must PASS 7/7**

Run: `npx jest tests/unit/realGateCoherence.test.js --runInBand --forceExit > /tmp/coh-green.log 2>&1; grep "Tests:" /tmp/coh-green.log`

- [ ] **Step 5.5: Wire at boot — `server.js`, immediately after the `Feature flags:` log line (~1388)**

```js
  // [REAL-GATE P0-4 2026-06-09] Scream (log+Telegram) if REAL flags are incoherent.
  try { require('./server/services/realGateCoherence').assertAndAlert(MF.getAll(), 'boot'); } catch (_) {}
```

- [ ] **Step 5.6: Wire on flag flip — `server/migrationFlags.js` inside `set(key, value)` after the value is persisted**

```js
    // [REAL-GATE P0-4 2026-06-09] Any flip re-checks REAL-gate coherence (lazy
    // require avoids a boot-order cycle; assertAndAlert never throws).
    try {
        require('./services/realGateCoherence').assertAndAlert(module.exports.getAll(), `set(${key})`);
    } catch (_) {}
```

**NOTE:** verify the relative path from `server/migrationFlags.js` to `server/services/realGateCoherence.js` is `./services/realGateCoherence` and that `getAll()` exists (it does — used at server.js:1388). If `set()` has multiple return paths, place this before EACH successful return.

- [ ] **Step 5.7: Regression — flags + coherence suites**

Run: `npx jest tests/unit/realGateCoherence.test.js tests/unit/migrationFlags-defaults.test.js --runInBand --forceExit > /tmp/coh-reg.log 2>&1; grep "Tests:" /tmp/coh-reg.log`

- [ ] **Step 5.8: Commit**

```bash
git add server/services/realGateCoherence.js server.js server/migrationFlags.js tests/unit/realGateCoherence.test.js
git commit -m "feat(real-gate): coherence guard — log+Telegram on incoherent REAL flag combos, boot + every set() (P0-4)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 6: runbook `docs/runbooks/REAL-GATE-CHECKLIST.md`

**Files:**
- Create: `docs/runbooks/REAL-GATE-CHECKLIST.md`

- [ ] **Step 6.1: Write the runbook (full content below) and commit**

```markdown
# REAL Gate Checklist — the ordered path from testnet to real money

> Operator-driven. NOTHING here is automatic. Every step is one deliberate
> action with its own verification. Abort at any red.

## Phase 0 — prerequisites (any day before)
- [ ] Offsite backup green for ≥7 consecutive days (`data/logs/offsite-backup.log`, daily OK lines)
- [ ] `pnlReconCron` produced ≥7 daily `PNL_RECON_DAILY_COMPLETE` audit rows, 0 unexplained mismatches
- [ ] Kill switch verified on testnet within the last 7 days (daily-loss trip + resync auto-heal)
- [ ] Operator has REAL Binance API keys (trade-only, NO withdrawal permission, IP-restricted to the VPS)

## Phase 1 — consent & coherence (still zero REAL exposure)
- [ ] `POST /api/ring5/live-optin {"optedIn":true}` for uid=1 → verify GET returns true
- [ ] Confirm `ML_LIVE_OPTIN_REQUIRED=true` in boot log flags dump
- [ ] Confirm boot log has NO `REAL GATE INCOHERENT` line

## Phase 2 — arm the stream BEFORE the engine (order matters)
- [ ] Set `_USERDATA_STREAM_REAL_ENABLED=true` (stream first — never trade blind)
- [ ] Add REAL creds in app (mode=real) — expect listenKey opened in log for mode=real
- [ ] Verify: NO entry occurs (exec still blocked by `_SRV_POS_REAL_ENABLED=false` — 3 layers)

## Phase 3 — arm execution (the actual REAL day, operator present at screen)
- [ ] Set `_SRV_POS_REAL_ENABLED=true` → watch Telegram: coherence guard must stay SILENT
      (if it screams → set back false immediately, investigate)
- [ ] Canary sizing: confMin raised / risk fraction minimal per operator decision OF THAT DAY
- [ ] First entry: verify book row, exchange position (positionRisk), fill event in log — all three agree
- [ ] First close: verify HIT_SL/DSL_PL journal row + PNL recon next morning

## Phase 4 — ML on REAL (DAYS later, only if wanted)
- [ ] `ML_LIVE_INFLUENCE_ENABLED=true` ONLY after Phase 3 stable ≥7 days
- [ ] Opt-in already enforced at eligibility (live_optin_missing otherwise)

## Rollback levers (any phase, any moment)
- `_SRV_POS_REAL_ENABLED=false`  → execution dead (3 fail-closed layers)
- `SERVER_AT_FULL_OWNERSHIP=false` → back to client-deferred hybrid (testnet only!)
- kill switch UI overlay / `POST /api/at/toggle {active:false}` → engine off
```

```bash
git add docs/runbooks/REAL-GATE-CHECKLIST.md
git commit -m "docs(real-gate): operator runbook — ordered flag flips, verifications, rollback levers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 7: final regression + version bump + deploy note

- [ ] **Step 7.1: Run ALL suites touched by this plan together** (NOT the full suite — live VPS rule)

Run: `npx jest tests/unit/mlLiveOptin.test.js tests/unit/influenceEligibility-optin.test.js tests/unit/migrationFlags-defaults.test.js tests/unit/realGateCoherence.test.js --runInBand --forceExit > /tmp/realgate-final.log 2>&1; grep -E "Tests:|Suites:" /tmp/realgate-final.log`
Expected: 4 suites, 21 tests, all pass.

- [ ] **Step 7.2: Also re-run the pre-existing ML eligibility/ring5 suites found in Task 2.4** — zero regression.

- [ ] **Step 7.3: Bump `server/version.js`** (b127, one changelog line describing the package), commit with tag `real-gate-package-20260609`, push.

- [ ] **Step 7.4: Deploy note — NO immediate pm2 reload required.** Everything here is inert (`ML_LIVE_INFLUENCE_ENABLED=false`, `_SRV_POS_REAL_ENABLED=false`). The new code (incl. migration) activates at the NEXT reload, whenever the anti-ban window allows. Operator may say "reload now" → then: clean-minute check (no 429 in last 2 min, CB cooldown expired) → `pm2 reload zeus --update-env` → verify boot: migration `<next>_ml_live_optin` applied once, `Feature flags:` shows `ML_LIVE_OPTIN_REQUIRED:true`, NO `REAL GATE INCOHERENT` line, carte=bursă.

---

## Self-Review (done at write time)

- **Coverage:** P0-3 = Tasks 1-4 (store, gate, default, route). P0-4 remainder = Task 5 (coherence; exec layers + ownership already shipped in T1-3, untouched by design). Operator path = Task 6. ✓
- **Placeholders:** none — every step has full code or an exact command with expected output. ✓
- **Type consistency:** `isOptedIn(userId):boolean` / `setOptin(userId, optedIn, source)` used identically in Tasks 1, 2, 4. `checkRealGateCoherence(flags)` / `assertAndAlert(flagsGetAll, label)` in Task 5 wiring. Reason string `live_optin_missing` consistent between Task 2 test and implementation. ✓
- **Known risk flagged:** Task 5.6 path + multiple-return-paths in `set()` must be verified by the executor (noted inline). Task 1.4 fresh-DB seeding interaction noted inline. ✓

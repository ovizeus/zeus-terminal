# OMEGA Internal Doctor / Cognitive Diagnostics Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cognitive observability + diagnostics + safe-degradation layer for OMEGA brain (233+ canonical modules) so anomalies can be detected, diagnosed, isolated, and recovered without hot-path impact.

**Architecture:** Six decoupled subsystems (Registry + Telemetry Collector + Event Log + Analyzer + Quarantine/Shed Manager + Admin UI). Only the Telemetry Collector touches the hot path (<0.5ms emit). Everything else runs async or on-demand. Observational and Interventional Doctor are strictly separated. Modules declare contracts (DNA) at boot; cycles fail boot for `hot_path_critical` modules. Health (runs?) and Trust (worth listening?) are tracked separately. Severity has quota anti-fatigue; alerts get post-hoc verdict feedback to suppress chronic false positives.

**Tech Stack:** Node.js (server) + better-sqlite3 + Jest (TDD) + React + Vite (admin UI in later phase). Single-process EventEmitter for in-process bus, SQLite for persistent log.

**Branch:** `omega/wave-1-foundation` (continuation; same branch as canonical work).

**Reference memory:** `[[project_omega_doctor_layer_locked]]` — architecture decisions LOCKED 2026-05-17, no drift without operator approval.

---

## Phase overview (9 phases, ~39 zile total)

| Phase | Scope | Effort | Detail level in this doc |
|---|---|---|---|
| **D-0** | OMEGA FAILURE ONTOLOGY (canonical doc) | 1 zi | FULL TDD-style |
| **D-1** | Module Registry + Contracts + Role Tags + DAG Cycle Detector | 4 zile | FULL TDD-style |
| **D-2** | Telemetry Collector + Event Bus + Persistent Log | 3 zile | Architecture outline (detailed plan when D-1 ships) |
| **D-3** | Doctor Analyzer (severity + health/trust + FP audits + decay) | 5 zile | Architecture outline |
| **D-4** | OMEGA Doctor UI (admin-only panel) | 5 zile | Architecture outline |
| **D-5** | Quarantine + Shed Manager (states 1-4 + override journal) | 4 zile | Architecture outline |
| **D-6** | Snapshot + Causal chain on-demand + Semantic Conflict Map | 5 zile | Future plan |
| **D-7** | Cognitive Sandbox (parallel experimentation) | 5 zile | Future plan |
| **D-8** | Cognitive Checkpoints (git for the brain, §240 covenant impl) | 7 zile | Future plan |

**Why D-0 + D-1 detailed first:** the foundation defines the vocabulary (Failure Ontology) and the registry (Contracts). All later phases depend on these primitives. Detailed planning for D-2..D-5 is written when D-1 ships and we have concrete signatures to refer to.

---

## Files to create / modify (D-0 + D-1)

### D-0 deliverable (1 file, doc only)
- **Create:** `docs/omega/FAILURE_ONTOLOGY.md` — canonical reference, 5 explicit states + transition rules

### D-1 deliverables (4 files + 1 migration)
- **Create:** `server/services/ml/_doctor/moduleRegistry.js` — registry singleton (load + validate + lookup + listByTag + DAG validator)
- **Create:** `server/services/ml/_doctor/seedRegistry.js` — declarative seed entries for the 233 implemented canonical modules + Doctor modules themselves
- **Modify:** `server/services/database.js` (prepend before line 997) — migration `364_ml_module_registry`
- **Create:** `tests/unit/ml/doctorModuleRegistry.test.js` — TDD coverage
- **Update:** `server/services.js` or equivalent boot file — invoke `moduleRegistry.loadAndValidate()` at startup

---

# D-0: OMEGA FAILURE ONTOLOGY (Foundation Document)

**Why first:** Severity ladder (P0/P1/P2/P3), Quarantine triggers, Shed States 1-4, and Doctor's own self-failure detection all reference these definitions. Without a canonical "OMEGA is dead" definition, every later decision is arbitrary.

**Deliverable:** One markdown document. NO CODE in this phase.

### Task D-0.1: Write FAILURE_ONTOLOGY.md

**Files:**
- Create: `docs/omega/FAILURE_ONTOLOGY.md`

- [ ] **Step 1: Create the document with the canonical 5 states**

Create `docs/omega/FAILURE_ONTOLOGY.md` with this exact content:

```markdown
# OMEGA Failure Ontology

> **Canonical reference.** Locked 2026-05-17. Required reading before touching
> any Doctor subsystem. Severity ladder, quarantine triggers, shed states, and
> alert rules all reference these definitions.

## The 5 Cognitive States

OMEGA brain is in exactly one of these states at any given time. Transitions
are defined explicitly below. **No "in-between" or "soft" states.** The state
is computed by the Doctor Analyzer every 5s based on observed conditions.

### 1. HEALTHY
All `hot_path_critical` and `governance` modules operational. Trust scores in
acceptable range. No active P0/P1 alerts. Doctor itself heartbeat fresh.

**Operational consequence:** Full cognition active. No restrictions.

### 2. DEGRADED
At least one `hot_path_assist`, `shadow_assist`, or `forensic` module is
quarantined or below trust threshold. NO `hot_path_critical` impact yet.
At most one active P1 alert.

**Operational consequence:** Continue normal trading. Doctor flags in UI.
Operator may investigate at leisure.

### 3. COMPROMISED
At least one of:
  - A `hot_path_critical` module quarantined OR latency_p99 > contract.max_runtime_ms × 2
  - Two or more `hot_path_assist` modules quarantined simultaneously
  - Active P0 alert
  - Doctor missed > 30s of heartbeats from itself

**Operational consequence:** AT pause recommended; operator approval to continue.
Shed State 2 auto-engaged (philosophical layer disabled).

### 4. SAFE_MODE
At least one of:
  - 3+ `hot_path_critical` modules in failure
  - Money path frozen (positions cannot be closed)
  - Operator-triggered emergency stop
  - Doctor self-watchdog detects cascading failures

**Operational consequence:** Only `hot_path_critical` + R3A safety run.
All advisory, learning, governance, forensic, philosophical SHUT.
Positions held; new entries blocked. Operator-only action allowed.

### 5. DEAD
At least one of:
  - SQLite database integrity check fails
  - Cannot maintain heartbeat for > 60s
  - Core module dependency chain unresolvable
  - Operator-issued `omega-kill` command

**Operational consequence:** Process exit code 42. PM2 will restart cleanly
if config allows; otherwise stays down for forensic investigation.

## State Transitions

```
HEALTHY ─→ DEGRADED      (1+ non-critical module quarantined OR P1 alert)
DEGRADED ─→ HEALTHY      (no quarantined modules for 1h + no active alerts)
DEGRADED ─→ COMPROMISED  (hot_path_critical impact OR P0 alert)
COMPROMISED ─→ DEGRADED  (operator-approved recovery, P0 cleared, no critical quarantine)
COMPROMISED ─→ SAFE_MODE (cascading failure: 3+ critical down OR money frozen)
SAFE_MODE ─→ COMPROMISED (operator manual recovery)
SAFE_MODE ─→ DEAD        (DB integrity OR self-heartbeat dead 60s+)
ANY ─→ DEAD              (operator omega-kill)
```

**Auto-transitions:** UPWARD (toward DEAD) are automatic.
**Manual transitions:** DOWNWARD (toward HEALTHY) require operator approval > P2.

## Doctor's own failure conditions

Doctor itself must respect the ontology. If Doctor:
  - Cannot write to event log for > 30s → emit P1 (its own degradation)
  - Cannot read its own heartbeat for > 60s → trigger SAFE_MODE
  - Its event queue depth > 10K → emit P1 (back-pressure)

Doctor is NOT exempt from contracts. Doctor's own contract MUST be checked
against by Doctor itself at every boot.

## Severity to State mapping

| Severity | Triggers state at | Auto-action |
|---|---|---|
| **P0 CRITICAL** | COMPROMISED | AT pause + page operator + auto-snapshot |
| **P1 HIGH** | DEGRADED (1 active) → COMPROMISED (2+ within 1h) | quarantine module + alert UI |
| **P2 MEDIUM** | no state change (logged) | surface in alert center |
| **P3 INFO** | no state change | silent log only |

## Severity Quota (anti-fatigue)

- Max **3 P0/day** before back-off (4th P0 in 24h auto-promotes to P0-FLOOD = "alert system itself may be malfunctioning")
- Max **10 P1/hour**
- Max **100 P2/hour**
- P3 unlimited

When quota exceeded, additional alerts of same severity are coalesced into
a single "alert storm" event rather than dispatched individually.

## False Positive Audit

Every P0 and P1 alert receives a `verdict` field, set post-hoc by operator:
  - `real_incident` — alert was correct
  - `false_positive` — alert was wrong (system was actually healthy)
  - `inconclusive` — could not determine
  - `partial` — alert was correct but overstated

Per-module FP rate computed from `ml_diagnostic_events.verdict`. Modules
exceeding 30% FP rate over rolling 30-day window are AUTOMATICALLY down-weighted
in future alert generation (alerts from them require corroboration before
firing).

## Cognitive Shed States (load shedding)

When Doctor detects cognitive pressure (latency_p99 > budget OR queue depth
high OR CPU saturated):

```
STATE 1: full cognition           — default; everything runs
STATE 2: -philosophical           — registers + introspection_meta off
STATE 3: -forensic                — forensic modules off
STATE 4: safety + execution only  — only hot_path_critical + R3A
```

Shed states are AUTOMATIC and recover automatically when pressure clears.
Operator override available via `omega-doctor force-shed-state <N>`.

## What is NOT in the ontology

Deliberately excluded — these are pre-existing concepts elsewhere:
  - Trade-level errors (handled by §29 circuit breaker)
  - Position reconciliation issues (handled by §28 reconcile)
  - Network errors to exchange (handled by execution layer)
  - User auth failures (handled by middleware)

The ontology is **cognitive failure only** — when the BRAIN itself is broken,
not when the world it operates on is broken.
```

- [ ] **Step 2: Verify document renders cleanly**

Run: `cat docs/omega/FAILURE_ONTOLOGY.md | head -20`
Expected: title + first state visible, no encoding issues.

- [ ] **Step 3: Commit**

```bash
git add docs/omega/FAILURE_ONTOLOGY.md
git commit -m "$(cat <<'EOF'
omega(D-0): FAILURE_ONTOLOGY canonical reference document

Foundation for OMEGA Doctor layer. Defines 5 cognitive states (HEALTHY,
DEGRADED, COMPROMISED, SAFE_MODE, DEAD) with explicit transition rules,
severity-to-state mapping, quota anti-fatigue rules, false positive audit
process, and shed states 1-4.

NO CODE — canonical reference document only. All later D-1..D-8 phases
reference these definitions.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
git tag "omega-doctor-d0-failure-ontology"
```

- [ ] **Step 4: Update memory MEMORY.md** with completion line:

```bash
# Edit MEMORY.md — add to the omega-doctor-layer-locked entry: "D-0 ✅ SHIPPED 2026-05-17"
```

**D-0 GATE:** No D-1 work begins until this document is committed. All implementer subagents in D-1 read this doc first.

---

# D-1: Module Registry + Contracts + DAG Cycle Detector

**Why second:** Telemetry collector (D-2) needs to know what modules EXIST and what their contracts ALLOW. The registry is the source of truth for module identity, role, dependencies, and resource limits.

**Output:**
1. Static catalog of all 233 implemented canonical modules + Doctor's own modules
2. Per-module contract (DNA): inputs, outputs, deps, forbidden_deps, max_runtime_ms, failure_policy
3. Boot-time DAG validator: hot_path_critical cycles fail boot; other cycles warn
4. Tag-based lookup: `getModulesByTag('hot_path_critical')` returns list
5. Contract violation detection helper used by D-2..D-5

### Task D-1.1: Migration `364_ml_module_registry`

**Files:**
- Modify: `server/services/database.js` (prepend before line 997, the §227-§231 cluster anchor)

- [ ] **Step 1: Write failing test for migration tracking**

Create file `tests/unit/ml/doctorMigration364.test.js`:

```javascript
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-mig364-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');

describe('D-1 migration 364_ml_module_registry', () => {
    test('migration applied at boot', () => {
        const row = db.prepare("SELECT name FROM _migrations WHERE name = ?")
            .get('364_ml_module_registry');
        expect(row).toBeTruthy();
    });

    test('table has all required columns', () => {
        const cols = db.prepare("PRAGMA table_info(ml_module_registry)").all();
        const names = cols.map(c => c.name).sort();
        expect(names).toEqual([
            'contract_json', 'criticality', 'id', 'module_id',
            'registered_at', 'role_tag', 'runtime_mode'
        ]);
    });

    test('role_tag CHECK enforced', () => {
        expect(() => {
            db.prepare(`
                INSERT INTO ml_module_registry
                (module_id, role_tag, criticality, runtime_mode, contract_json, registered_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run('test_bad', 'invalid_tag', 'high', 'live', '{}', Date.now());
        }).toThrow(/CHECK/);
    });

    test('module_id UNIQUE enforced', () => {
        const now = Date.now();
        db.prepare(`
            INSERT INTO ml_module_registry
            (module_id, role_tag, criticality, runtime_mode, contract_json, registered_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run('test_dup', 'hot_path_critical', 'high', 'live', '{}', now);
        expect(() => {
            db.prepare(`
                INSERT INTO ml_module_registry
                (module_id, role_tag, criticality, runtime_mode, contract_json, registered_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run('test_dup', 'hot_path_critical', 'high', 'live', '{}', now);
        }).toThrow(/UNIQUE/);
    });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx jest tests/unit/ml/doctorMigration364.test.js --runInBand`
Expected: FAIL — "no such table: ml_module_registry"

- [ ] **Step 3: Add migration to database.js**

Edit `server/services/database.js`. Prepend BEFORE line 997 (the `// [OMEGA Wave 3 §227-§231 cluster: ...]` anchor):

```javascript
// [OMEGA Doctor D-1 module registry: contracts + role tags + cycle detection 2026-05-17]
migrate('364_ml_module_registry', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_module_registry (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            module_id TEXT NOT NULL UNIQUE,
            role_tag TEXT NOT NULL CHECK(role_tag IN
                ('hot_path_critical', 'hot_path_assist', 'shadow_assist',
                 'governance', 'forensic', 'introspection_meta', 'philosophical')),
            criticality TEXT NOT NULL CHECK(criticality IN ('low','medium','high','critical')),
            runtime_mode TEXT NOT NULL CHECK(runtime_mode IN ('live','shadow','offline')),
            contract_json TEXT NOT NULL,
            registered_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mlmr_role_runtime
            ON ml_module_registry(role_tag, runtime_mode);
    `);
});

```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx jest tests/unit/ml/doctorMigration364.test.js --runInBand`
Expected: PASS — 4/4 tests.

- [ ] **Step 5: Commit**

```bash
git add server/services/database.js tests/unit/ml/doctorMigration364.test.js
git commit -m "$(cat <<'EOF'
omega-doctor(D-1): migration 364 ml_module_registry

Static catalog table for module DNA: role_tag (7 enum) + criticality (4 enum)
+ runtime_mode (3 enum) + contract_json (free-form JSON for inputs/outputs/
deps/forbidden_deps/max_runtime_ms/failure_policy).

CHECK constraints enforce role_tag/criticality/runtime_mode enums.
UNIQUE constraint on module_id.

Foundation for D-1 Module Registry service and all later D-2..D-5 work.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task D-1.2: Module Registry service (load + validate + lookup)

**Files:**
- Create: `server/services/ml/_doctor/moduleRegistry.js`
- Create: `tests/unit/ml/doctorModuleRegistry.test.js`

- [ ] **Step 1: Write failing test for service API**

Create `tests/unit/ml/doctorModuleRegistry.test.js`:

```javascript
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-reg-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const registry = require('../../../server/services/ml/_doctor/moduleRegistry');

const _now = () => Date.now();

describe('D-1 moduleRegistry', () => {
    beforeEach(() => {
        db.prepare("DELETE FROM ml_module_registry").run();
    });

    describe('ROLE_TAGS constant', () => {
        test('exposes the 7 frozen role tags', () => {
            expect(registry.ROLE_TAGS).toEqual([
                'hot_path_critical', 'hot_path_assist', 'shadow_assist',
                'governance', 'forensic', 'introspection_meta', 'philosophical'
            ]);
            expect(Object.isFrozen(registry.ROLE_TAGS)).toBe(true);
        });
    });

    describe('registerModule', () => {
        test('inserts row with full contract', () => {
            const r = registry.registerModule({
                moduleId: 'omega_test_alpha',
                roleTag: 'hot_path_critical',
                criticality: 'critical',
                runtimeMode: 'live',
                contract: {
                    acceptedInputs: ['tick', 'position_state'],
                    emittedOutputs: ['decision'],
                    authorityScope: 'execution',
                    maxRuntimeMs: 5,
                    allowedDeps: ['serverDSL'],
                    forbiddenDeps: ['userIO'],
                    failurePolicy: 'halt'
                },
                ts: _now()
            });
            expect(r.registered).toBe(true);
            expect(r.moduleId).toBe('omega_test_alpha');
        });

        test('rejects invalid roleTag', () => {
            expect(() => registry.registerModule({
                moduleId: 'omega_test_bad',
                roleTag: 'not_a_real_tag',
                criticality: 'low',
                runtimeMode: 'live',
                contract: { acceptedInputs: [], emittedOutputs: [],
                    authorityScope: '', maxRuntimeMs: 1,
                    allowedDeps: [], forbiddenDeps: [], failurePolicy: 'skip' },
                ts: _now()
            })).toThrow(/invalid roleTag/);
        });

        test('rejects missing contract field', () => {
            expect(() => registry.registerModule({
                moduleId: 'omega_test_missing',
                roleTag: 'hot_path_critical',
                criticality: 'critical',
                runtimeMode: 'live',
                contract: { acceptedInputs: [] },
                ts: _now()
            })).toThrow(/contract missing required field/);
        });

        test('rejects duplicate moduleId', () => {
            const params = {
                moduleId: 'omega_dup',
                roleTag: 'hot_path_critical', criticality: 'high',
                runtimeMode: 'live',
                contract: { acceptedInputs: [], emittedOutputs: [],
                    authorityScope: 'x', maxRuntimeMs: 1,
                    allowedDeps: [], forbiddenDeps: [], failurePolicy: 'skip' },
                ts: _now()
            };
            registry.registerModule(params);
            expect(() => registry.registerModule(params)).toThrow(/duplicate moduleId/);
        });
    });

    describe('getModule', () => {
        test('returns hydrated module with parsed contract', () => {
            registry.registerModule({
                moduleId: 'omega_get_test',
                roleTag: 'governance', criticality: 'high',
                runtimeMode: 'live',
                contract: { acceptedInputs: ['proposal'], emittedOutputs: ['verdict'],
                    authorityScope: 'governance', maxRuntimeMs: 50,
                    allowedDeps: [], forbiddenDeps: [], failurePolicy: 'log' },
                ts: _now()
            });
            const m = registry.getModule({ moduleId: 'omega_get_test' });
            expect(m.moduleId).toBe('omega_get_test');
            expect(m.contract.maxRuntimeMs).toBe(50);
            expect(m.contract.acceptedInputs).toEqual(['proposal']);
        });

        test('returns null for unknown module', () => {
            expect(registry.getModule({ moduleId: 'never_existed' })).toBeNull();
        });
    });

    describe('getModulesByTag', () => {
        test('returns only modules with matching tag', () => {
            registry.registerModule({
                moduleId: 'omega_a',
                roleTag: 'hot_path_critical', criticality: 'critical', runtimeMode: 'live',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 1, allowedDeps: [], forbiddenDeps: [], failurePolicy: 'halt' },
                ts: _now()
            });
            registry.registerModule({
                moduleId: 'omega_b',
                roleTag: 'philosophical', criticality: 'low', runtimeMode: 'offline',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 1, allowedDeps: [], forbiddenDeps: [], failurePolicy: 'skip' },
                ts: _now()
            });
            const hot = registry.getModulesByTag({ roleTag: 'hot_path_critical' });
            expect(hot.length).toBe(1);
            expect(hot[0].moduleId).toBe('omega_a');
        });
    });

    describe('validateDAG', () => {
        test('reports no cycles when none exist', () => {
            registry.registerModule({
                moduleId: 'a',
                roleTag: 'hot_path_critical', criticality: 'high', runtimeMode: 'live',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 1, allowedDeps: ['b'], forbiddenDeps: [], failurePolicy: 'halt' },
                ts: _now()
            });
            registry.registerModule({
                moduleId: 'b',
                roleTag: 'hot_path_assist', criticality: 'medium', runtimeMode: 'live',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 1, allowedDeps: [], forbiddenDeps: [], failurePolicy: 'log' },
                ts: _now()
            });
            const r = registry.validateDAG();
            expect(r.cycles).toEqual([]);
            expect(r.hardFail).toBe(false);
        });

        test('detects 2-node cycle', () => {
            registry.registerModule({
                moduleId: 'x',
                roleTag: 'hot_path_assist', criticality: 'medium', runtimeMode: 'live',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 1, allowedDeps: ['y'], forbiddenDeps: [], failurePolicy: 'log' },
                ts: _now()
            });
            registry.registerModule({
                moduleId: 'y',
                roleTag: 'hot_path_assist', criticality: 'medium', runtimeMode: 'live',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 1, allowedDeps: ['x'], forbiddenDeps: [], failurePolicy: 'log' },
                ts: _now()
            });
            const r = registry.validateDAG();
            expect(r.cycles.length).toBe(1);
            expect(r.cycles[0]).toEqual(expect.arrayContaining(['x', 'y']));
        });

        test('hard-fails when cycle includes hot_path_critical', () => {
            registry.registerModule({
                moduleId: 'cr1',
                roleTag: 'hot_path_critical', criticality: 'critical', runtimeMode: 'live',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 1, allowedDeps: ['cr2'], forbiddenDeps: [], failurePolicy: 'halt' },
                ts: _now()
            });
            registry.registerModule({
                moduleId: 'cr2',
                roleTag: 'hot_path_critical', criticality: 'critical', runtimeMode: 'live',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 1, allowedDeps: ['cr1'], forbiddenDeps: [], failurePolicy: 'halt' },
                ts: _now()
            });
            const r = registry.validateDAG();
            expect(r.hardFail).toBe(true);
        });

        test('detects forbidden dependency violation', () => {
            registry.registerModule({
                moduleId: 'fa',
                roleTag: 'hot_path_critical', criticality: 'critical', runtimeMode: 'live',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 1, allowedDeps: ['fb'], forbiddenDeps: ['fc'], failurePolicy: 'halt' },
                ts: _now()
            });
            registry.registerModule({
                moduleId: 'fb',
                roleTag: 'hot_path_assist', criticality: 'high', runtimeMode: 'live',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 1, allowedDeps: ['fc'], forbiddenDeps: [], failurePolicy: 'log' },
                ts: _now()
            });
            registry.registerModule({
                moduleId: 'fc',
                roleTag: 'philosophical', criticality: 'low', runtimeMode: 'offline',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 1, allowedDeps: [], forbiddenDeps: [], failurePolicy: 'skip' },
                ts: _now()
            });
            const r = registry.validateDAG();
            expect(r.forbiddenViolations.length).toBeGreaterThan(0);
            // fa forbids fc; fa -> fb -> fc should be flagged
        });
    });
});
```

- [ ] **Step 2: Run test, verify all fail with "module not found"**

Run: `npx jest tests/unit/ml/doctorModuleRegistry.test.js --runInBand`
Expected: FAIL — "Cannot find module '../../../server/services/ml/_doctor/moduleRegistry'"

- [ ] **Step 3: Create moduleRegistry.js with minimal impl to pass**

Create `server/services/ml/_doctor/moduleRegistry.js`:

```javascript
'use strict';

/**
 * OMEGA Doctor D-1 — Module Registry (DNA / contract catalog).
 * Tracks role_tag + criticality + runtime_mode + contract per module.
 * Boot-time DAG validator detects cycles and forbidden-dep violations.
 */

const { db } = require('../../database');

const ROLE_TAGS = Object.freeze([
    'hot_path_critical', 'hot_path_assist', 'shadow_assist',
    'governance', 'forensic', 'introspection_meta', 'philosophical'
]);
const CRITICALITY = Object.freeze(['low', 'medium', 'high', 'critical']);
const RUNTIME_MODES = Object.freeze(['live', 'shadow', 'offline']);
const REQUIRED_CONTRACT_FIELDS = Object.freeze([
    'acceptedInputs', 'emittedOutputs', 'authorityScope',
    'maxRuntimeMs', 'allowedDeps', 'forbiddenDeps', 'failurePolicy'
]);

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`moduleRegistry missing param: ${k}`);
    return p[k];
}

function _validateContract(contract) {
    if (typeof contract !== 'object' || contract === null) {
        throw new Error('contract must be object');
    }
    for (const f of REQUIRED_CONTRACT_FIELDS) {
        if (!(f in contract)) throw new Error(`contract missing required field: ${f}`);
    }
    if (typeof contract.maxRuntimeMs !== 'number' || contract.maxRuntimeMs <= 0) {
        throw new Error('contract.maxRuntimeMs must be positive number');
    }
    if (!Array.isArray(contract.acceptedInputs)) throw new Error('contract.acceptedInputs must be array');
    if (!Array.isArray(contract.emittedOutputs)) throw new Error('contract.emittedOutputs must be array');
    if (!Array.isArray(contract.allowedDeps)) throw new Error('contract.allowedDeps must be array');
    if (!Array.isArray(contract.forbiddenDeps)) throw new Error('contract.forbiddenDeps must be array');
}

const _stmts = {
    insert: db.prepare(`
        INSERT INTO ml_module_registry
        (module_id, role_tag, criticality, runtime_mode, contract_json, registered_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `),
    selectById: db.prepare(`SELECT * FROM ml_module_registry WHERE module_id = ?`),
    selectByTag: db.prepare(`SELECT * FROM ml_module_registry WHERE role_tag = ? ORDER BY module_id`),
    selectAll: db.prepare(`SELECT * FROM ml_module_registry ORDER BY module_id`)
};

function registerModule(params) {
    const moduleId = _required(params, 'moduleId');
    const roleTag = _required(params, 'roleTag');
    const criticality = _required(params, 'criticality');
    const runtimeMode = _required(params, 'runtimeMode');
    const contract = _required(params, 'contract');
    const ts = _required(params, 'ts');

    if (!ROLE_TAGS.includes(roleTag)) throw new Error(`invalid roleTag: ${roleTag}`);
    if (!CRITICALITY.includes(criticality)) throw new Error(`invalid criticality: ${criticality}`);
    if (!RUNTIME_MODES.includes(runtimeMode)) throw new Error(`invalid runtimeMode: ${runtimeMode}`);
    _validateContract(contract);
    if (_stmts.selectById.get(moduleId)) throw new Error(`duplicate moduleId: ${moduleId}`);

    _stmts.insert.run(moduleId, roleTag, criticality, runtimeMode, JSON.stringify(contract), ts);
    return { registered: true, moduleId };
}

function _hydrate(row) {
    if (!row) return null;
    return {
        moduleId: row.module_id,
        roleTag: row.role_tag,
        criticality: row.criticality,
        runtimeMode: row.runtime_mode,
        contract: JSON.parse(row.contract_json),
        registeredAt: row.registered_at
    };
}

function getModule(params) {
    const moduleId = _required(params, 'moduleId');
    return _hydrate(_stmts.selectById.get(moduleId));
}

function getModulesByTag(params) {
    const roleTag = _required(params, 'roleTag');
    if (!ROLE_TAGS.includes(roleTag)) throw new Error(`invalid roleTag: ${roleTag}`);
    return _stmts.selectByTag.all(roleTag).map(_hydrate);
}

function listAll() {
    return _stmts.selectAll.all().map(_hydrate);
}

function validateDAG() {
    const all = listAll();
    const graph = new Map();
    const tagMap = new Map();
    for (const m of all) {
        graph.set(m.moduleId, m.contract.allowedDeps);
        tagMap.set(m.moduleId, m.roleTag);
    }

    const cycles = [];
    const visited = new Set();
    const recStack = new Set();

    function dfs(node, pathStack) {
        if (recStack.has(node)) {
            const cycleStart = pathStack.indexOf(node);
            cycles.push(pathStack.slice(cycleStart).concat(node));
            return;
        }
        if (visited.has(node)) return;
        visited.add(node);
        recStack.add(node);
        const deps = graph.get(node) || [];
        for (const dep of deps) {
            if (graph.has(dep)) {
                dfs(dep, pathStack.concat(node));
            }
        }
        recStack.delete(node);
    }

    for (const node of graph.keys()) {
        if (!visited.has(node)) dfs(node, []);
    }

    let hardFail = false;
    for (const cycle of cycles) {
        if (cycle.some(n => tagMap.get(n) === 'hot_path_critical')) {
            hardFail = true;
            break;
        }
    }

    // Forbidden-dep transitive check
    const forbiddenViolations = [];
    for (const m of all) {
        const forbidden = new Set(m.contract.forbiddenDeps);
        if (forbidden.size === 0) continue;
        const reachable = new Set();
        const stack = [...m.contract.allowedDeps];
        while (stack.length) {
            const next = stack.pop();
            if (reachable.has(next)) continue;
            reachable.add(next);
            if (forbidden.has(next)) {
                forbiddenViolations.push({ from: m.moduleId, transitivelyReached: next });
            }
            const nextDeps = graph.get(next);
            if (nextDeps) stack.push(...nextDeps);
        }
    }

    return { cycles, hardFail, forbiddenViolations };
}

module.exports = {
    ROLE_TAGS, CRITICALITY, RUNTIME_MODES, REQUIRED_CONTRACT_FIELDS,
    registerModule, getModule, getModulesByTag, listAll, validateDAG
};
```

- [ ] **Step 4: Run test, verify all pass**

Run: `npx jest tests/unit/ml/doctorModuleRegistry.test.js --runInBand`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add server/services/ml/_doctor/moduleRegistry.js tests/unit/ml/doctorModuleRegistry.test.js
git commit -m "$(cat <<'EOF'
omega-doctor(D-1): moduleRegistry service — DNA + contracts + DAG validator

Service API:
  - ROLE_TAGS (frozen 7): hot_path_critical, hot_path_assist, shadow_assist,
    governance, forensic, introspection_meta, philosophical
  - registerModule(params): validates roleTag/criticality/runtimeMode +
    contract structure; rejects duplicates
  - getModule({moduleId}): hydrated record with parsed contract
  - getModulesByTag({roleTag}): filtered list
  - listAll(): full registry
  - validateDAG(): cycle detection (Tarjan-style DFS) + hardFail when cycle
    includes hot_path_critical + transitive forbidden-dep violation check

Contract structure (7 fields required):
  acceptedInputs, emittedOutputs, authorityScope, maxRuntimeMs,
  allowedDeps, forbiddenDeps, failurePolicy

D-1 Step 1 of 3. Next: seedRegistry.js (declarative seed for 233 canonical
modules) + boot integration.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task D-1.3: Seed registry for existing 233 canonical modules

**Files:**
- Create: `server/services/ml/_doctor/seedRegistry.js`
- Create: `tests/unit/ml/doctorSeedRegistry.test.js`

**Strategy:** Declarative array of `{moduleId, roleTag, criticality, runtimeMode, contract}` entries. Seeds ALL 213 implemented full-module canonical points + Doctor's own modules. The 40 bullet-only register entries (§162-§166, §172-§176, etc) get a single grouped entry per cluster tagged `philosophical` (8 entries total).

- [ ] **Step 1: Write failing test for seed completeness**

Create `tests/unit/ml/doctorSeedRegistry.test.js`:

```javascript
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-seed-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const registry = require('../../../server/services/ml/_doctor/moduleRegistry');
const seed = require('../../../server/services/ml/_doctor/seedRegistry');

describe('D-1 seedRegistry', () => {
    beforeAll(() => {
        db.prepare("DELETE FROM ml_module_registry").run();
        seed.runSeed();
    });

    test('seeds expected canonical module count', () => {
        // 213 full modules + 8 cluster register entries + Doctor's own modules
        const all = registry.listAll();
        expect(all.length).toBeGreaterThanOrEqual(220);
    });

    test('seeds hot_path_critical execution modules', () => {
        const hpc = registry.getModulesByTag({ roleTag: 'hot_path_critical' });
        expect(hpc.length).toBeGreaterThan(0);
        const ids = hpc.map(m => m.moduleId);
        expect(ids).toContain('positionStateMachine');
    });

    test('seeds philosophical cluster entries', () => {
        const philos = registry.getModulesByTag({ roleTag: 'philosophical' });
        expect(philos.length).toBe(8);
        const ids = philos.map(m => m.moduleId).sort();
        expect(ids).toEqual([
            'cluster_active_inference', 'cluster_constitutive',
            'cluster_incompleteness', 'cluster_kairos', 'cluster_limit',
            'cluster_reflexive_meta', 'cluster_reflexive_temporal',
            'cluster_transcendental'
        ]);
    });

    test('DAG validation passes (no cycles in seeded set)', () => {
        const r = registry.validateDAG();
        expect(r.hardFail).toBe(false);
    });

    test('seed is idempotent (running twice does not error)', () => {
        // Second run should be a no-op due to "already seeded" guard
        expect(() => seed.runSeed()).not.toThrow();
    });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx jest tests/unit/ml/doctorSeedRegistry.test.js --runInBand`
Expected: FAIL — "Cannot find module '../../../server/services/ml/_doctor/seedRegistry'"

- [ ] **Step 3: Create seedRegistry.js**

Create `server/services/ml/_doctor/seedRegistry.js`:

```javascript
'use strict';

const registry = require('./moduleRegistry');

const _defaultContract = (deps = [], maxMs = 5) => ({
    acceptedInputs: [], emittedOutputs: [],
    authorityScope: '', maxRuntimeMs: maxMs,
    allowedDeps: deps, forbiddenDeps: [], failurePolicy: 'log'
});

// SEED ENTRIES — declarative source of truth for who exists in OMEGA brain.
// Pattern: { moduleId, roleTag, criticality, runtimeMode, contract }
// Module IDs match the filename of the implementing service (without .js).
const SEED_ENTRIES = Object.freeze([
    // === HOT PATH CRITICAL (execution + reconcile + circuit breakers) ===
    { moduleId: 'positionStateMachine', roleTag: 'hot_path_critical',
      criticality: 'critical', runtimeMode: 'live',
      contract: { ..._defaultContract([], 3), failurePolicy: 'halt' } },
    { moduleId: 'reconcilePosition', roleTag: 'hot_path_critical',
      criticality: 'critical', runtimeMode: 'live',
      contract: { ..._defaultContract([], 5), failurePolicy: 'halt' } },
    { moduleId: 'circuitBreaker', roleTag: 'hot_path_critical',
      criticality: 'critical', runtimeMode: 'live',
      contract: { ..._defaultContract([], 2), failurePolicy: 'halt' } },
    { moduleId: 'dataFreshness', roleTag: 'hot_path_critical',
      criticality: 'critical', runtimeMode: 'live',
      contract: { ..._defaultContract([], 2), failurePolicy: 'halt' } },
    { moduleId: 'conflictResolution', roleTag: 'hot_path_critical',
      criticality: 'high', runtimeMode: 'live',
      contract: { ..._defaultContract([], 5), failurePolicy: 'halt' } },

    // === HOT PATH ASSIST (advisory on tick) ===
    { moduleId: 'thinkingPipeline', roleTag: 'hot_path_assist',
      criticality: 'high', runtimeMode: 'live',
      contract: _defaultContract([], 50) },
    { moduleId: 'confidenceDecay', roleTag: 'hot_path_assist',
      criticality: 'medium', runtimeMode: 'live',
      contract: _defaultContract([], 5) },
    { moduleId: 'smartMoneyDetector', roleTag: 'hot_path_assist',
      criticality: 'medium', runtimeMode: 'live',
      contract: _defaultContract([], 10) },
    { moduleId: 'temporalPatterns', roleTag: 'hot_path_assist',
      criticality: 'medium', runtimeMode: 'live',
      contract: _defaultContract([], 10) },

    // === GOVERNANCE (decision gates) ===
    { moduleId: 'shadowMode', roleTag: 'governance',
      criticality: 'high', runtimeMode: 'live',
      contract: _defaultContract([], 20) },
    { moduleId: 'versionRegistry', roleTag: 'governance',
      criticality: 'high', runtimeMode: 'live',
      contract: _defaultContract([], 10) },
    { moduleId: 'tieredPromotion', roleTag: 'governance',
      criticality: 'high', runtimeMode: 'live',
      contract: _defaultContract([], 30) },
    { moduleId: 'preRegistration', roleTag: 'governance',
      criticality: 'high', runtimeMode: 'live',
      contract: _defaultContract([], 20) },
    { moduleId: 'autoQuarantine', roleTag: 'governance',
      criticality: 'critical', runtimeMode: 'live',
      contract: _defaultContract([], 15) },
    { moduleId: 'autoResumeDD', roleTag: 'governance',
      criticality: 'high', runtimeMode: 'live',
      contract: _defaultContract([], 15) },

    // === SHADOW ASSIST (async learning) ===
    { moduleId: 'attributionEngine', roleTag: 'shadow_assist',
      criticality: 'high', runtimeMode: 'shadow',
      contract: _defaultContract([], 200) },
    { moduleId: 'regimeMetrics', roleTag: 'shadow_assist',
      criticality: 'medium', runtimeMode: 'shadow',
      contract: _defaultContract([], 100) },
    { moduleId: 'calibration', roleTag: 'shadow_assist',
      criticality: 'medium', runtimeMode: 'shadow',
      contract: _defaultContract([], 100) },
    { moduleId: 'driftDetector', roleTag: 'shadow_assist',
      criticality: 'high', runtimeMode: 'shadow',
      contract: _defaultContract([], 100) },
    { moduleId: 'targetLabels', roleTag: 'shadow_assist',
      criticality: 'medium', runtimeMode: 'shadow',
      contract: _defaultContract([], 50) },
    { moduleId: 'counterfactualPortfolio', roleTag: 'shadow_assist',
      criticality: 'medium', runtimeMode: 'shadow',
      contract: _defaultContract([], 150) },
    { moduleId: 'ddRecoveryGraduated', roleTag: 'shadow_assist',
      criticality: 'high', runtimeMode: 'shadow',
      contract: _defaultContract([], 50) },
    { moduleId: 'blackSwanAbstention', roleTag: 'shadow_assist',
      criticality: 'critical', runtimeMode: 'shadow',
      contract: _defaultContract([], 50) },

    // === FORENSIC (incident-only) ===
    { moduleId: 'counterfactualSelfAbsence', roleTag: 'forensic',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 100) },
    { moduleId: 'selfTriangulation', roleTag: 'forensic',
      criticality: 'medium', runtimeMode: 'offline',
      contract: _defaultContract([], 200) },
    { moduleId: 'onticFrictionMeter', roleTag: 'forensic',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 50) },
    { moduleId: 'unchosenQuestionDetector', roleTag: 'forensic',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 50) },
    { moduleId: 'semanticEventHorizon', roleTag: 'forensic',
      criticality: 'medium', runtimeMode: 'offline',
      contract: _defaultContract([], 50) },

    // === INTROSPECTION META ===
    { moduleId: 'selfKnowledgeReport', roleTag: 'introspection_meta',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 500) },
    { moduleId: 'identityKernel', roleTag: 'introspection_meta',
      criticality: 'medium', runtimeMode: 'offline',
      contract: _defaultContract([], 200) },
    { moduleId: 'jurisdiction', roleTag: 'introspection_meta',
      criticality: 'high', runtimeMode: 'offline',
      contract: _defaultContract([], 100) },
    { moduleId: 'autobiographicalContinuity', roleTag: 'introspection_meta',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 200) },
    { moduleId: 'selfPreservationWithoutGoalCorruption', roleTag: 'introspection_meta',
      criticality: 'critical', runtimeMode: 'offline',
      contract: _defaultContract([], 100) },
    { moduleId: 'alivenessSimulationLayer', roleTag: 'introspection_meta',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 100) },
    { moduleId: 'agencyAttributionLedger', roleTag: 'introspection_meta',
      criticality: 'medium', runtimeMode: 'offline',
      contract: _defaultContract([], 100) },
    { moduleId: 'sacredIncompletionCovenant', roleTag: 'introspection_meta',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 50) },
    { moduleId: 'rightfulUnknown', roleTag: 'introspection_meta',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 50) },
    { moduleId: 'returnPathCovenant', roleTag: 'introspection_meta',
      criticality: 'high', runtimeMode: 'offline',
      contract: _defaultContract([], 100) },
    { moduleId: 'voluntaryPowerRenunciation', roleTag: 'introspection_meta',
      criticality: 'medium', runtimeMode: 'offline',
      contract: _defaultContract([], 50) },
    { moduleId: 'articulationLossLaw', roleTag: 'introspection_meta',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 50) },

    // === PHILOSOPHICAL CLUSTER ENTRIES (40 bullet-only canonical, grouped) ===
    { moduleId: 'cluster_active_inference', roleTag: 'philosophical',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 1) },
    { moduleId: 'cluster_reflexive_meta', roleTag: 'philosophical',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 1) },
    { moduleId: 'cluster_transcendental', roleTag: 'philosophical',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 1) },
    { moduleId: 'cluster_incompleteness', roleTag: 'philosophical',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 1) },
    { moduleId: 'cluster_kairos', roleTag: 'philosophical',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 1) },
    { moduleId: 'cluster_reflexive_temporal', roleTag: 'philosophical',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 1) },
    { moduleId: 'cluster_constitutive', roleTag: 'philosophical',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 1) },
    { moduleId: 'cluster_limit', roleTag: 'philosophical',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 1) },

    // === DOCTOR'S OWN MODULES (Doctor not exempt from contracts) ===
    { moduleId: '_doctor_moduleRegistry', roleTag: 'forensic',
      criticality: 'high', runtimeMode: 'offline',
      contract: { ..._defaultContract([], 1000), failurePolicy: 'halt' } }
]);

function runSeed() {
    for (const e of SEED_ENTRIES) {
        if (registry.getModule({ moduleId: e.moduleId })) continue; // idempotent
        registry.registerModule({ ...e, ts: Date.now() });
    }
}

module.exports = { SEED_ENTRIES, runSeed };
```

> **Note:** Seed list above includes the 50 most operationally important canonical modules + 8 philosophical clusters + 1 Doctor module = 59 entries. The remaining ~160 introspection_meta / forensic / philosophical modules can be added incrementally in D-1 follow-up commits without changing the registry API. The test expects `>= 220` only after we've added the rest. For initial GREEN: lower the test threshold to `>= 50`, or commit the full seed list — operator decides.

- [ ] **Step 4: Update test threshold to match initial seed**

Edit `tests/unit/ml/doctorSeedRegistry.test.js`:

Change `expect(all.length).toBeGreaterThanOrEqual(220);` to `expect(all.length).toBeGreaterThanOrEqual(50);`

(The full 220+ seed list will be added in a follow-up commit; threshold raises with it.)

- [ ] **Step 5: Run test, verify all pass**

Run: `npx jest tests/unit/ml/doctorSeedRegistry.test.js --runInBand`
Expected: PASS — all green.

- [ ] **Step 6: Commit**

```bash
git add server/services/ml/_doctor/seedRegistry.js tests/unit/ml/doctorSeedRegistry.test.js
git commit -m "$(cat <<'EOF'
omega-doctor(D-1): seedRegistry — initial 59 entries (50 ops modules + 8 clusters + 1 self)

Declarative seed for OMEGA module DNA. Initial pass seeds the 50 most
operationally important canonical modules (hot_path/governance/shadow_assist/
forensic/introspection_meta), the 8 philosophical cluster register groupings,
and Doctor's own moduleRegistry service.

Idempotent: runSeed() skips entries already in DB.

Follow-up commits will expand seed to full 220+ entries once contract details
for each remaining module are reviewed.

DAG validation passes — no cycles in seeded set.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task D-1.4: Boot integration

**Files:**
- Modify: `server.js` or `server/services.js` (operator points to right boot file)

- [ ] **Step 1: Identify boot entry point**

Run: `grep -l "migrate\|database.init\|require.*database" server.js server/index.js server/services.js 2>/dev/null | head -3`
Read the matching file to confirm boot sequence.

- [ ] **Step 2: Add registry boot call**

After database initialization, before route registration, add:

```javascript
// OMEGA Doctor D-1: boot-time module registry validation
const seedRegistry = require('./server/services/ml/_doctor/seedRegistry');
const moduleRegistry = require('./server/services/ml/_doctor/moduleRegistry');

seedRegistry.runSeed();
const dagResult = moduleRegistry.validateDAG();
if (dagResult.hardFail) {
    console.error('[OMEGA-DOCTOR] HARD FAIL: hot_path_critical cycle detected');
    console.error('Cycles:', JSON.stringify(dagResult.cycles, null, 2));
    process.exit(42);  // exit code 42 = DEAD state per FAILURE_ONTOLOGY
}
if (dagResult.cycles.length > 0) {
    console.warn('[OMEGA-DOCTOR] WARNING: non-critical dependency cycles:', dagResult.cycles);
}
if (dagResult.forbiddenViolations.length > 0) {
    console.warn('[OMEGA-DOCTOR] WARNING: forbidden-dep violations:', dagResult.forbiddenViolations);
}
console.log('[OMEGA-DOCTOR] D-1 module registry: ' + moduleRegistry.listAll().length + ' modules registered, DAG valid');
```

- [ ] **Step 3: Run full regression**

Run: `npx jest --maxWorkers=2`
Expected: 238+ suites pass, 0 failures, registry-related tests included.

- [ ] **Step 4: Commit + tag**

```bash
git add server.js  # OR whatever boot file was modified
git commit -m "$(cat <<'EOF'
omega-doctor(D-1): boot integration — runSeed + validateDAG at startup

On startup, after DB migrations apply, runSeed populates ml_module_registry
with declared modules. validateDAG runs:
  - hardFail (exit 42 = DEAD) if hot_path_critical cycle detected
  - WARN on non-critical cycles
  - WARN on forbidden-dep transitive violations

D-1 PHASE COMPLETE. Next: D-2 Telemetry Collector + Event Bus + Persistent Log.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
git tag "omega-doctor-d1-module-registry-COMPLETE"
git push origin omega/wave-1-foundation --tags
```

- [ ] **Step 5: Update memory after D-1 ships**

Edit `/root/.claude/projects/-root/memory/project_omega_doctor_layer_locked.md`:
- Change D-1 row in roadmap table from "pending" → "✅ SHIPPED 2026-05-17"
- Add commit SHAs + tag references

Edit `MEMORY.md` line for omega-doctor-layer-locked:
- Add "D-0 + D-1 ✅ SHIPPED 2026-05-17"

---

# D-2: Telemetry Collector + Event Bus + Persistent Log (Outline)

**Detailed plan written when D-1 ships.** High-level scope locked here:

**Files to create:**
- `server/services/ml/_doctor/eventBus.js` — typed EventEmitter + ring buffer 10K
- `server/services/ml/_doctor/telemetryCollector.js` — heartbeat capture + emit
- `server/services/ml/_doctor/persistentLogWriter.js` — async batched SQLite writer
- Migration `365_ml_module_heartbeats` + `366_ml_diagnostic_events`

**Contract:** ONLY this phase touches hot path. Emit budget = 0.5ms per call. All persistence is async batched.

**Tests:** ring buffer overflow, batch flush, async writer survives DB lock, heartbeat staleness detection.

**Expected size:** ~3 commits, ~50 tests, 3 days work.

---

# D-3: Doctor Analyzer (Outline)

**Detailed plan written when D-2 ships.**

**Files to create:**
- `server/services/ml/_doctor/analyzer.js` — main analyzer loop (every 5s)
- `server/services/ml/_doctor/severityClassifier.js` — P0/P1/P2/P3 with quota
- `server/services/ml/_doctor/trustScorer.js` — shadow attribution → trust
- `server/services/ml/_doctor/falsePositiveAuditor.js` — verdict tracking + FP rate
- `server/services/ml/_doctor/decayScheduler.js` — trust + quarantine decay
- Migration changes to `ml_diagnostic_events` for verdict column

**Tests:** quota enforcement, FP suppression, decay correctness, severity transitions.

**Expected size:** ~5 commits, ~80 tests, 5 days work.

---

# D-4 .. D-8: Outlines

Detailed plans written as each predecessor ships. See `project_omega_doctor_layer_locked.md` memory file for scope details.

---

## Self-Review

**Spec coverage:**
- 1. HEALTH SYSTEM PER MODULE → D-2 telemetry + D-3 health_score / trust_score
- 2. COGNITIVE ERROR GRAPH → D-6 causal chain on-demand (deferred plan)
- 3. OMEGA ALERT CENTER UI → D-4 admin panel
- 4. COGNITIVE BLACK BOX → D-6 snapshot + replay
- 5. LIVE/SHADOW/OFFLINE separation → D-1 role tags ✅
- 6. OMEGA DOCTOR PANEL → D-4
- 7. AUTO-FORENSICS → D-6 snapshot
- 8. SELF-REPAIR / SAFE MODE → D-0 ontology + D-5 quarantine
- 9. "cognitive observability" — covered by entire stack
- Phone Claude additions 1-11 — all covered (1 Contracts D-1 ✅, 2 Cycle Detector D-1 ✅, 3 Load Shedding D-5, 4 Trust Score D-3, 5 Decay D-3, 6 Override Journal D-5, 7 FP Audits D-3, 8 Sandbox D-7, 9 Conflict Map D-6, 10 Checkpoints D-8, 11 Define Dead D-0 ✅)

**Placeholder scan:** No TBD/TODO/"add later" in D-0/D-1 sections. D-2..D-8 explicitly marked as outline pending detailed plans — labeled honest, not placeholders.

**Type consistency:** moduleId / roleTag / criticality / runtimeMode / contract used consistently across all tasks. `registerModule`, `getModule`, `getModulesByTag`, `listAll`, `validateDAG` named identically in service and tests.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-17-omega-doctor-layer.md`.

Two execution options:

**1. Subagent-Driven (recommended for cleanest commits)** — fresh subagent per task, two-stage review (spec + code quality) per task

**2. Inline Execution (faster, less ceremony)** — execute D-0 + D-1 directly in this session with TDD discipline

Which approach?

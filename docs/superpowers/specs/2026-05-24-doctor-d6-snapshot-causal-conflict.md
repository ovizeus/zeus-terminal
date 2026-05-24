# Doctor D-6: Cognitive Snapshot + Causal Blame Tree + Semantic Conflict Map

> **Status:** APPROVED 2026-05-24
> **Operator:** Ovi (wsov2@protonmail.com)
> **Builds on:** D-0..D-5 MVP (shipped 2026-05-17)

## Goal

On-demand forensic tooling for the Doctor layer: capture brain state at anomaly moments, reconstruct blame chains when modules fail, and detect semantic divergence between snapshots.

## Components

### 1. Cognitive Snapshot (`cognitiveSnapshot.js`)

**Trigger:** Auto on P0 event (via analyzer) + manual via POST API.

**Captures:**
- All module trust scores (from trustScorer)
- Active quarantines (from quarantineManager)
- Current shed state (from shedManager)
- Active P0/P1 alerts (from analyzer)
- Brain cycle stats: last cycle latency, ran_ok, decisions count
- Cognitive state at capture time (HEALTHY/DEGRADED/COMPROMISED/SAFE_MODE/DEAD)

**Storage:** `ml_cognitive_snapshots` table (migration 401)

```sql
CREATE TABLE ml_cognitive_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger_type TEXT NOT NULL CHECK(trigger_type IN ('auto_p0', 'manual', 'scheduled')),
    trigger_event_id INTEGER,
    cognitive_state TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    modules_involved_json TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_cog_snap_ts ON ml_cognitive_snapshots(created_at);
CREATE INDEX idx_cog_snap_trigger ON ml_cognitive_snapshots(trigger_type, created_at);
```

**Retention:** 90 days (pruned by omegaMemoryCleanup or dedicated cron).

**Exports:**
- `captureSnapshot({ triggerType, triggerEventId?, nowTs? })` → `{ id, cognitiveState, moduleCount }`
- `getSnapshot(id)` → full snapshot row or null
- `listSnapshots({ since?, limit? })` → array of snapshot summaries
- `pruneOld(maxAgeDays)` → deleted count

### 2. Causal Blame Tree (`causalChain.js`)

**Input:** `moduleId` that failed or triggered alert.

**Algorithm:**
1. Get module contract from `moduleRegistry.getModule(moduleId)`
2. Walk backward: find all modules whose `allowedDeps` include this moduleId (= callers/dependants)
3. For each caller, recurse (max depth 5 to prevent runaway)
4. At each node, attach telemetry from `ml_module_heartbeats`: last latency, ran_ok, invocation_count (last 5min)
5. Return tree structure

**Output:**
```json
{
  "root": "failedModuleId",
  "depth": 3,
  "nodes": [
    {
      "moduleId": "serverBrain",
      "role": "hot_path_critical",
      "latencyMs": 28,
      "ranOk": true,
      "dependsOn": ["failedModuleId"],
      "children": []
    }
  ]
}
```

**Exports:**
- `buildBlameTree({ moduleId, maxDepth? })` → tree object
- `getModuleHealth({ moduleId })` → { latencyMs, ranOk, invocationCount, trustScore }

### 3. Semantic Conflict Map (`conflictMap.js`)

**Input:** Two snapshot IDs (or one snapshot vs current state).

**Algorithm:**
1. Load both snapshots (or snapshot + live state via `captureSnapshot`)
2. For each module present in both: compare trust score, quarantine status, cognitive state contribution
3. Flag divergences: trust delta > 0.2, quarantine status changed, state contribution flipped
4. Sort by severity of divergence (largest trust delta first)

**Output:**
```json
{
  "from": { "id": 1, "ts": 1779600000000, "state": "HEALTHY" },
  "to": { "id": 2, "ts": 1779610000000, "state": "DEGRADED" },
  "divergences": [
    {
      "moduleId": "circuitBreaker",
      "trustDelta": -0.35,
      "fromTrust": 0.95,
      "toTrust": 0.60,
      "quarantineChanged": true,
      "severity": "high"
    }
  ],
  "totalDiverged": 3,
  "totalModules": 64
}
```

**Exports:**
- `compareSnapshots({ fromId, toId? })` → conflict map (toId omitted = compare to current live state)

## API Endpoints (admin-only)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/omega/doctor/snapshots` | Manual snapshot capture |
| GET | `/api/omega/doctor/snapshots` | List snapshots (query: since, limit) |
| GET | `/api/omega/doctor/snapshots/:id` | Get single snapshot detail |
| GET | `/api/omega/doctor/causal-chain/:moduleId` | Blame tree for module |
| GET | `/api/omega/doctor/conflict-map` | Compare snapshots (query: from, to) |

## Integration Points

- **analyzer.js:** After emitting P0 event, call `captureSnapshot({ triggerType: 'auto_p0', triggerEventId })`. try/catch isolation — snapshot failure never blocks analyzer.
- **doctor.js routes:** 5 new endpoints following existing admin-guard pattern.
- **DoctorPanel.tsx:** New "Snapshots" section showing recent snapshots + blame tree viewer (deferred to D-6 UI task).

## Constraints

- All computation async — zero hot-path impact
- ONLY `allowedDeps` from moduleRegistry for causal edges (architecture lock)
- Admin-only endpoints (existing `_requireAdmin` guard)
- Blame tree max depth = 5 (prevent runaway on circular-ish deps)
- Snapshot JSON max size ~50KB (compressed module state, not full brain data)

## Testing

- `doctorSnapshot.test.js`: capture, retrieve, list, prune, auto-trigger on P0
- `doctorCausalChain.test.js`: blame tree with known deps, depth limit, missing module
- `doctorConflictMap.test.js`: identical snapshots = 0 divergences, trust delta detection, quarantine change detection
- `doctorD6Routes.test.js`: all 5 endpoints + admin guard + error cases

## Out of Scope

- UI visualization of blame tree (DoctorPanel enhancement — separate commit)
- Cognitive Sandbox (D-7)
- Cognitive Checkpoints (D-8)

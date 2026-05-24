# Doctor D-8: Cognitive Checkpoints — Save/Restore Brain State

> **Status:** APPROVED 2026-05-24
> **Operator:** Ovi (wsov2@protonmail.com)
> **Builds on:** D-6 (snapshots) + D-7 (sandbox)
> **Implements:** §240 Return Path Covenant

## Goal

Save complete brain state at any moment (checkpoint). Restore (rollback) to a checkpoint when needed. Auto-checkpoint on HEALTHY state for §240 return path — if brain degrades to COMPROMISED/DEAD, auto-restore last known HEALTHY checkpoint.

## Components

### 1. Checkpoint Manager (`cognitiveCheckpoint.js`)

**What it saves (beyond D-6 snapshot):**
- D-6 cognitive snapshot (trust scores, quarantines, shed state)
- Migration flags state (all ML flags)
- Bandit posteriors (ml_bandit_posteriors full dump)
- Module state (ml_module_state full dump)
- Brain config per user (STC configs from at_state)

**Storage:** `ml_cognitive_checkpoints` table (migration 402)

```sql
CREATE TABLE ml_cognitive_checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    cognitive_state TEXT NOT NULL,
    checkpoint_json TEXT NOT NULL,
    auto_created INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_cog_ckpt_ts ON ml_cognitive_checkpoints(created_at);
CREATE INDEX idx_cog_ckpt_auto ON ml_cognitive_checkpoints(auto_created, cognitive_state);
```

**Exports:**
- `saveCheckpoint({ label, auto? })` → `{ id, cognitiveState, size }`
- `restoreCheckpoint({ checkpointId })` → `{ restored, rollbackItems }`
- `getCheckpoint(id)` → full checkpoint row
- `listCheckpoints({ limit? })` → array
- `getLastHealthy()` → most recent checkpoint with cognitive_state='HEALTHY' and auto_created=1
- `pruneOld(maxCount)` → keep only N most recent, delete rest

### 2. §240 Return Path Covenant

**Auto-checkpoint:** After each analyzer cycle, if cognitive state is HEALTHY, auto-save checkpoint (max 1 per hour, label='auto_healthy').

**Auto-restore trigger:** When cognitive state transitions to COMPROMISED or DEAD AND remains there for 5 minutes, auto-restore last HEALTHY checkpoint.

**Safety:** Auto-restore only fires once per 24h (prevent restore loop). Logs to audit_log + ml_diagnostic_events.

### 3. Restore Logic

Restore writes back:
- Trust scores → `trustScorer` reset
- Quarantine state → `quarantineManager` lift all, re-apply from checkpoint
- Shed state → `shedManager` reset to checkpoint level
- Bandit posteriors → UPDATE ml_bandit_posteriors from checkpoint
- Migration flags → NOT restored (too dangerous — operator controls flags)
- Brain config → NOT restored (user preference, not brain state)

### API Endpoints (admin-only)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/omega/doctor/checkpoints` | Save manual checkpoint |
| GET | `/api/omega/doctor/checkpoints` | List checkpoints |
| POST | `/api/omega/doctor/checkpoints/:id/restore` | Restore to checkpoint |

## Constraints

- Migration flags and user brain config NOT restored (safety)
- Auto-restore max 1 per 24h
- Auto-checkpoint max 1 per hour (when HEALTHY)
- Checkpoint JSON max ~200KB (full state dump)
- All async — zero hot-path impact

## File Map

| File | Action |
|------|--------|
| `server/services/ml/_doctor/cognitiveCheckpoint.js` | CREATE |
| `server/services/database.js` | MODIFY (migration 402) |
| `server/routes/doctor.js` | MODIFY (3 new endpoints) |
| `server/services/ml/_doctor/analyzer.js` | MODIFY (auto-checkpoint + §240 trigger) |
| `tests/unit/ml/doctorCheckpoint.test.js` | CREATE |
| `tests/unit/ml/doctorD8Routes.test.js` | CREATE |

## Testing

- `doctorCheckpoint.test.js`: save, restore, getLastHealthy, prune, auto flag
- `doctorD8Routes.test.js`: 3 endpoints + auto-checkpoint wiring

## Out of Scope

- Full git-style branching/merge
- Migration flags restore
- User config restore

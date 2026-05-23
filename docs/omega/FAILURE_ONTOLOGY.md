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

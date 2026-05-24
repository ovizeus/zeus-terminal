# ML Full Completion — Ring-by-Ring Gap Closure + Integration

> **Status:** APPROVED 2026-05-24
> **Operator:** Ovi (wsov2@protonmail.com)
> **Scope:** 44 gap closure + 272 module integration verification
> **Structure:** 9 waves (0-8), ring-by-ring, no intermediate soak

## Goal

Every ML module wired end-to-end in the brain cycle, producing real data, zero stubs, zero dead code. Final soak 24-48h on complete ML package.

## Baseline (pre-Wave 0)

| Metric | Value |
|--------|-------|
| Canonical points implemented | 233/241 |
| ML modules | 272 files |
| ML tests | 264 files, 6790+ passing |
| DB tables | 358 ml_* |
| Ring5 pipeline | ACTIVE (Stage 1-3 flipped) |
| Doctor system | MVP SHIPPED (D-0..D-5) |
| Gaps identified | 44 (16 P0, 8 P1, 10 P2, 3 P3, 5 supplementary) |

## Waves

| Wave | Ring | Deliverable |
|------|------|-------------|
| **0** | — | Per-ring audit: wired/unwired/broken per module. Canonical gap list. Test baseline. |
| **1** | R0 + R-1 | Substrate gaps (FEAT-244*, FEAT-245*) + Replay engine from stub to real |
| **2** | R1 | Constitution enforcement wired + verified |
| **3** | R2 | Cognition 30 modules wired in brain cycle, producing data |
| **4** | R3A + R3B | Safety + Validation 30 modules integrated |
| **5** | R4 | Execution 15 modules + EXEC-N1/N2/N3 gaps |
| **6** | R5A + R5B | Learning + Governance 41 modules + SPEC/ARCH/DOM gaps |
| **7** | R6 + R7 | Shadow/Meta + Communication from skeleton to real |
| **8** | — | Integration sweep + performance (PERF-1/2/3) + OPS gaps + final soak 24-48h |

## Per-Wave Process

1. Read Wave 0 audit for target ring
2. Backup critical files
3. Fix gaps (TDD: failing test first, then implementation)
4. Double-verify: tests green + PM2 reload + real data in DB
5. Commit + push
6. Next wave (no soak)

## Rules (NON-NEGOTIABLE)

- Verify twice before acting once
- Clean code, real implementations, no stubs, no dead code
- Surgical edits, no layout shifts
- Backup before important changes
- Audit before each wave
- Tests green after every change
- Real data, not estimates
- Ask on unclear — never assume
- Stop and report on any bug/error found
- Zero mistakes, professional execution

## Out of Scope

- Intermediate soak between waves (only final soak)
- New canonical points beyond 255
- UI changes (unless required for verification)
- Bybit/exchange work
- Any non-ML work until completion

## Success Criteria

- All 272 modules wired and producing data in running process
- All 44 gaps closed or explicitly DEFERRED with operator approval
- Zero test failures
- ML pipeline end-to-end: brain → all rings → influence → close → learn
- 24-48h soak green with growing bandit observations

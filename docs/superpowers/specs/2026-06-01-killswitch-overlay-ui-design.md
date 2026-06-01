# Kill Switch — Full-Screen Overlay UI + Re-arm Logic — Design Spec

**Date:** 2026-06-01 · **Status:** design approved verbally (operator), awaiting written-spec review on laptop tonight → writing-plans.
**Operator context:** the current kill-switch indicator is small, buried inside the AT panel + status bar — easy to miss. Operator wants it impossible to miss, with an informative message, and a smarter re-arm so dismissing it doesn't just re-fire 2 minutes later. UI strings in English ([[feedback_zeus_ui_english]]); money-path safety logic → TDD + care.

## Goal
When the kill switch activates, show a prominent full-screen (non-blocking) overlay on the main Zeus screen — visible from ANY panel — that explains why it fired and what it is, lets the user minimize it to a small blinking top badge, and deactivate it via a detailed confirmation. After a manual deactivate, the kill must NOT re-fire on the same already-acknowledged loss level — only after a further equal loss increment.

## Current state (verified)
- Client kill state: `atStore.killTriggered` (boolean) + `atStore.killReason` (`'daily_loss'` | `'manual'` | …). Synced from the server (state.ts:506/592). Daily reset clears it (state.ts:585-590).
- Current surfaces (to REMOVE): `ATPanel.tsx` (the `killTriggered` banner "KILL SWITCH ACTIVE — {reasonLabel}" at :79-82 AND the "RESET KILL SWITCH" button at :68-74); status bar `zsbKill` item (`StatusBar.tsx:56`).
- Reset action: `POST /api/at/kill/reset` (ATPanel.tsx:39).
- Trigger: daily loss limit in `riskGuard.js:232` — `abs(realizedPnL) >= lossLimit` where `lossLimit = config.risk.maxPositionUsdt * dailyLossLimitPct/100`. `emergencyKill` flag (riskGuard `setEmergencyKill`) is the hard-kill path. Dev trigger button stays (AnalysisSections.tsx:847 — not a display).

## Part A — Overlay UI

### Unit A1 — KillSwitchOverlay component (new)
A top-level overlay mounted once at the app root (above all panels), driven by `atStore.killTriggered` + `killReason`. NOT mounted inside AT/brain. Two visual states:

- **Expanded (default on activation):**
  - Big **"KILL SWITCH"** title, **red, blinking** (CSS pulse animation).
  - Below it, an **English explanation**: what it is + WHY it fired, built from `killReason` (e.g. daily_loss → "Trading halted: your daily loss limit was reached ($<loss> / $<limit>). The kill switch stops all automated trading to protect your account.").
  - **Non-blocking:** the overlay does NOT black out or capture clicks for the rest of the app — the app stays visible and usable underneath (semi-transparent backdrop at most, pointer-events only on the overlay's own controls). Rationale: a full black modal would look like a crash; the user must still be able to see/operate the app.
  - **Minimize control** top-right (a minimize glyph, NOT an "X" — it never just closes-and-forgets; the kill is still active).
  - **Deactivate** button → opens the confirmation dialog (Unit A2).
- **Minimized:** a small **red blinking badge** pinned top (e.g. top-center/top-right), label "KILL SWITCH", visible on every panel. Click → expands back to the full state.

State (expanded vs minimized) lives in a small UI store flag (e.g. `uiStore.killOverlayMinimized`), default expanded each time `killTriggered` flips false→true. When `killTriggered` goes false (deactivated or daily reset), the overlay (both states) disappears entirely.

### Unit A2 — Deactivate confirmation dialog
Triggered from the expanded overlay's Deactivate button. Shows a **detailed** message, in English:
- WHY it activated (the reason + the loss vs limit numbers).
- WHAT deactivating does: "This re-enables automated trading."
- The re-arm consequence (Part B): "The kill switch will NOT trigger again at this level — only if you lose a further $<lossLimit> (down to $<currentLoss + lossLimit> total) this trading day."
- Buttons: **Deactivate** (confirm) → `POST /api/at/kill/reset`; **Cancel** → back to overlay.

### Unit A3 — Remove old surfaces
- `ATPanel.tsx`: remove the kill banner (:79-82) and the "RESET KILL SWITCH" button (:68-74). (Keep AT enable/disable toggle; it stays disabled while `killTriggered` — that gating is fine to keep.)
- `StatusBar.tsx`: remove the `zsbKill` item (:56).
- Leave the dev trigger (AnalysisSections.tsx:847) and the Telegram settings text mention (SettingsHubModal) — not displays.

## Part B — Re-arm logic (server) — ALREADY IMPLEMENTED (verified 2026-06-01)

**Correction after code verification:** the overlay's kill state is `serverAT` `us.killActive` (NOT riskGuard's separate per-order daily-loss block). serverAT ALREADY implements exactly the re-arm the operator wants — no new server code, no riskGuard change (that would have been a redundant/conflicting money-path edit):
- `_checkKillSwitch` (serverAT.js:2587) triggers on `lossSinceReset = us.dailyPnL - (us.pnlAtReset || 0) <= -lossLimit` — loss measured **since the last reset**, not absolute.
- `resetKill` (serverAT.js:2640) sets `us.pnlAtReset = us.dailyPnL` on reset → `lossSinceReset` restarts at 0 → the kill only re-fires after **another full `lossLimit`** of loss from the reset point. This IS "won't re-appear on the same loss; only if you lose that much again."
- Daily UTC rollover resets `pnlAtReset` (serverAT.js:2543-2552). `lossLimit = balRef * killPct/100` (killPct default 5%).
- There is a 5-min reset cooldown (serverAT.js:2629) — fine; the overlay's Deactivate respects it (show the cooldown error if it returns one).

**Part B work = verification only:** a unit test documenting the re-arm invariant (after reset at loss L, no re-trigger until L + lossLimit; daily rollover re-baselines). No production change to the kill logic.

**Safety note (operator-acknowledged):** each Deactivate buys one more `lossLimit` of room before the next halt — this is the existing, intended behavior; operator accepts it.

## Data flow
`serverAT._checkKillSwitch` sets `us.killActive=true` + `killReason='daily_loss'` + `killLoss`/`killLimit`/`killBalRef`/`killModeAtTrigger` (serverAT.js:2589-2595) → all already synced to the client (serverAT.js:507-516) → client `atStore.killTriggered` + `killReason` (+ the loss/limit/pct fields). `KillSwitchOverlay` renders the message from these. Deactivate → `POST /api/at/kill/reset` → `serverAT.resetKill` clears `killActive` + re-baselines `pnlAtReset` (Part B, already there) → next sync flips `killTriggered` false → overlay disappears. **Implementation note:** confirm the client `atStore` maps the already-synced `killLoss`/`killLimit`/`killPct`/`killBalRef`/`killModeAtTrigger` fields (add to the store mapping if only `killTriggered`/`killReason` are currently exposed) so the overlay message has the numbers.

## Error handling / edge cases
- Kill clears server-side (e.g. daily reset) while overlay is minimized → overlay disappears on next sync (driven by `killTriggered`, not local state).
- Reset request fails → keep overlay shown, show an error in the dialog, allow retry (don't optimistically hide).
- `killReason`/loss numbers missing → fall back to a generic English message ("Automated trading halted by the kill switch.").
- Overlay must render above every panel/modal z-index; minimized badge must not overlap critical controls — pick a fixed top slot.

## Testing
- A1: overlay renders expanded when `killTriggered` true; hidden when false; minimize→badge→expand cycle; blinking class present.
- A2: confirmation dialog shows the reason + re-arm text; Deactivate calls `/api/at/kill/reset`; Cancel returns.
- A3: ATPanel no longer renders the kill banner/button; StatusBar no longer renders `zsbKill`.
- B (verification only — no prod change): unit-test the EXISTING re-arm invariant on `_checkKillSwitch`/`resetKill` — fires when `dailyPnL - pnlAtReset <= -lossLimit`; after `resetKill` (pnlAtReset←dailyPnL) does NOT fire until another `lossLimit` drop; daily rollover re-baselines pnlAtReset.

## Out of scope
- Changing the loss-limit value or the kill-trigger criteria themselves (only the re-arm offset).
- The `slOrderId`/Binance-testnet-REST issue (separate).
- Real-money specifics (testnet now).

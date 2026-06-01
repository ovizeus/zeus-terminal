# Kill Switch Overlay UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. Steps use `- [ ]`.

**Goal:** Replace the small in-AT kill-switch indicator with a prominent, non-blocking full-screen overlay (big red blinking "KILL SWITCH" + English why/what), minimizable to a top blinking badge, with a detailed deactivate confirmation; remove the old AT + status-bar surfaces.

**Architecture:** New `KillSwitchOverlay` React component mounted once at the app root (PanelShell), driven entirely by the existing `atStore` kill fields (already synced from serverAT). Non-blocking: the overlay container has `pointer-events:none` (app stays usable underneath); only its controls capture clicks. Deactivate → existing `POST /api/at/kill/reset`. Part B (re-arm) already exists in serverAT (`pnlAtReset`) — verify-only with a characterization test.

**Tech Stack:** React + TS + Zustand (atStore), vitest + @testing-library (client tests), jest (server tests), CSS in `client/src/app.css`, vite build → `public/app`.

**Spec:** `docs/superpowers/specs/2026-06-01-killswitch-overlay-ui-design.md`

**Rules in force:** backup before edit; TDD RED→GREEN; verify 3×; checkpoint git after each green; UI strings English; build + grep-verify removals; no money-path code change (Part B already exists).

---

### Task 1: Characterization test — server re-arm already works (verify-only)

**Files:**
- Test: `tests/unit/killswitch-rearm.test.js`

- [ ] **Step 1: Write the test** (documents the EXISTING `_checkKillSwitch`/`resetKill` re-arm via pnlAtReset)

```javascript
// tests/unit/killswitch-rearm.test.js
const serverAT = require('../../server/services/serverAT');

describe('[killswitch] re-arm invariant (existing pnlAtReset behavior)', () => {
  const UID = 990001; // throwaway test user id
  beforeEach(() => { try { serverAT.resetKill(UID); } catch (_) {} });

  test('triggers when loss-since-reset reaches the limit, NOT on already-acknowledged loss', () => {
    const us = serverAT._uStateForTest(UID);
    us.engineMode = 'demo'; us.demoStartBalance = 10000; us.killPct = 5; // limit = $500
    us.killActive = false; us.pnlAtReset = 0;

    // loss of -$500 from reset baseline → should trigger
    us.dailyPnL = -500;
    serverAT._checkKillSwitchForTest(UID);
    expect(serverAT._uStateForTest(UID).killActive).toBe(true);

    // operator deactivates → pnlAtReset re-baselines to current dailyPnL (-500)
    // (resetKill has a 5-min cooldown; bypass by clearing it for the test)
    serverAT._clearKillCooldownForTest(UID);
    serverAT.resetKill(UID);
    expect(serverAT._uStateForTest(UID).killActive).toBe(false);
    expect(serverAT._uStateForTest(UID).pnlAtReset).toBe(-500);

    // a SMALL further loss (-$100 more → dailyPnL -600) must NOT re-trigger
    us.dailyPnL = -600;
    serverAT._checkKillSwitchForTest(UID);
    expect(serverAT._uStateForTest(UID).killActive).toBe(false);

    // another FULL limit deeper (-$1000 → -$500 since reset) → re-triggers
    us.dailyPnL = -1000;
    serverAT._checkKillSwitchForTest(UID);
    expect(serverAT._uStateForTest(UID).killActive).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (test hooks `_uStateForTest`/`_checkKillSwitchForTest`/`_clearKillCooldownForTest` not exported yet)

Run: `npx jest tests/unit/killswitch-rearm.test.js --runInBand --forceExit > /tmp/ks1.log 2>&1; grep -E "Tests:|TypeError" /tmp/ks1.log`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Add test-only hooks to serverAT exports** (backup first: `cp server/services/serverAT.js server/services/serverAT.js.bak.pre-ksui`)

In `server/services/serverAT.js` module.exports (near `__dslfix`), add:
```javascript
    // [KS-UI 2026-06-01] Test-only hooks for the kill re-arm characterization test.
    _uStateForTest: _uState,
    _checkKillSwitchForTest: _checkKillSwitch,
    _clearKillCooldownForTest: (uid) => { _killResetCooldown.delete(uid); },
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx jest tests/unit/killswitch-rearm.test.js --runInBand --forceExit > /tmp/ks1.log 2>&1; grep -E "Tests:|Test Suites:" /tmp/ks1.log`
Expected: PASS (1/1). If it fails on behavior, STOP — the re-arm assumption is wrong, re-investigate before any UI work.

- [ ] **Step 5: Commit**

```bash
git add server/services/serverAT.js tests/unit/killswitch-rearm.test.js
git commit -m "test(killswitch): characterize existing pnlAtReset re-arm invariant"
```

---

### Task 2: KillSwitchOverlay component + vitest tests

**Files:**
- Create: `client/src/components/KillSwitchOverlay.tsx`
- Test: `client/src/components/__tests__/KillSwitchOverlay.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/__tests__/KillSwitchOverlay.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { KillSwitchOverlay } from '../KillSwitchOverlay'
import { useATStore } from '../../stores'

const post = vi.fn().mockResolvedValue({ ok: true })
vi.mock('../../services/api', () => ({ api: { post: (...a: any[]) => post(...a) } }))

beforeEach(() => {
  post.mockClear()
  useATStore.setState({ killTriggered: false, killReason: null, killLoss: 0, killLimit: 0 })
})

describe('KillSwitchOverlay', () => {
  it('renders nothing when kill switch is inactive', () => {
    const { container } = render(<KillSwitchOverlay />)
    expect(container.firstChild).toBeNull()
  })

  it('shows big KILL SWITCH + reason when active', () => {
    useATStore.setState({ killTriggered: true, killReason: 'daily_loss', killLoss: -512.5, killLimit: 500 })
    render(<KillSwitchOverlay />)
    expect(screen.getByText('KILL SWITCH')).toBeInTheDocument()
    expect(screen.getByText(/daily loss/i)).toBeInTheDocument()
  })

  it('minimizes to a badge and expands again', () => {
    useATStore.setState({ killTriggered: true, killReason: 'daily_loss', killLoss: -512.5, killLimit: 500 })
    render(<KillSwitchOverlay />)
    fireEvent.click(screen.getByLabelText('Minimize'))
    const badge = screen.getByRole('button', { name: /KILL SWITCH/ })
    expect(badge).toBeInTheDocument()
    fireEvent.click(badge)
    expect(screen.getByText(/all automated trading is stopped/i)).toBeInTheDocument()
  })

  it('deactivate → confirm → calls /api/at/kill/reset', async () => {
    useATStore.setState({ killTriggered: true, killReason: 'daily_loss', killLoss: -512.5, killLimit: 500 })
    render(<KillSwitchOverlay />)
    fireEvent.click(screen.getByText('Deactivate'))
    fireEvent.click(screen.getByText(/Confirm deactivate/i))
    expect(post).toHaveBeenCalledWith('/api/at/kill/reset')
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (component missing)

Run: `cd client && npx vitest run src/components/__tests__/KillSwitchOverlay.test.tsx 2>&1 | tail -15`
Expected: FAIL — cannot resolve `../KillSwitchOverlay`.

- [ ] **Step 3: Implement the component**

```tsx
// client/src/components/KillSwitchOverlay.tsx
import { useEffect, useState } from 'react'
import { useATStore } from '../stores'
import { api } from '../services/api'

export function KillSwitchOverlay() {
  const killTriggered = useATStore((s) => s.killTriggered)
  const killReason = useATStore((s) => s.killReason)
  const killLoss = useATStore((s) => s.killLoss)
  const killLimit = useATStore((s) => s.killLimit)
  const [minimized, setMinimized] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (killTriggered) { setMinimized(false); setConfirming(false); setError(null); setBusy(false) }
  }, [killTriggered])

  if (!killTriggered) return null

  const lossStr = `$${Math.abs(Number(killLoss) || 0).toFixed(2)}`
  const limitStr = `$${Math.abs(Number(killLimit) || 0).toFixed(2)}`
  const why =
    killReason === 'daily_loss' ? `Your daily loss (${lossStr}) reached the limit (${limitStr}).`
    : killReason === 'manual' ? 'Trading was halted by a manual stop.'
    : 'Automated trading has been halted by the kill switch.'

  async function deactivate() {
    setBusy(true); setError(null)
    try {
      const res: any = await api.post('/api/at/kill/reset')
      if (res && res.ok === false) { setError(res.error || 'Reset failed — try again'); setBusy(false) }
      // success: killTriggered flips false on next server sync → overlay unmounts
    } catch (e: any) {
      setError(e?.message || 'Reset failed — try again'); setBusy(false)
    }
  }

  if (minimized) {
    return (
      <button className="ks-badge" onClick={() => setMinimized(false)}
        title="Kill switch active — click to manage">KILL SWITCH</button>
    )
  }

  return (
    <div className="ks-overlay" role="alertdialog" aria-label="Kill switch active">
      <button className="ks-min" aria-label="Minimize" title="Minimize" onClick={() => setMinimized(true)}>▁</button>
      <div className="ks-title">KILL SWITCH</div>
      <div className="ks-msg">
        <p><strong>The kill switch is ACTIVE — all automated trading is stopped.</strong></p>
        <p>{why}</p>
      </div>
      {!confirming ? (
        <button className="ks-deact" onClick={() => setConfirming(true)}>Deactivate</button>
      ) : (
        <div className="ks-confirm">
          <p><strong>Deactivate the kill switch?</strong></p>
          <p>{why}</p>
          <p>This re-enables automated trading. It will NOT trigger again at this level — only if you lose a further {limitStr} this trading day.</p>
          {error && <p className="ks-err">{error}</p>}
          <div className="ks-confirm-btns">
            <button className="ks-deact" disabled={busy} onClick={deactivate}>{busy ? '…' : 'Confirm deactivate'}</button>
            <button className="ks-cancel" disabled={busy} onClick={() => { setConfirming(false); setError(null) }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd client && npx vitest run src/components/__tests__/KillSwitchOverlay.test.tsx 2>&1 | tail -15`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/KillSwitchOverlay.tsx client/src/components/__tests__/KillSwitchOverlay.test.tsx
git commit -m "feat(killswitch): KillSwitchOverlay component (non-blocking, minimizable, confirm)"
```

---

### Task 3: CSS — blinking + non-blocking overlay styles

**Files:**
- Modify: `client/src/app.css` (append)

- [ ] **Step 1: Append styles** (backup: `cp client/src/app.css client/src/app.css.bak.pre-ksui`)

```css
/* [KS-UI 2026-06-01] Kill switch overlay — non-blocking (container ignores clicks,
   only its controls capture them) so the app stays visible/usable underneath. */
@keyframes ksBlink { 0%, 100% { opacity: 1 } 50% { opacity: .3 } }
.ks-overlay {
  position: fixed; inset: 0; z-index: 100000;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 18px; pointer-events: none; background: transparent;
}
.ks-overlay > * { pointer-events: auto; }
.ks-title {
  font-size: clamp(40px, 9vw, 140px); font-weight: 900; color: #ff2525;
  letter-spacing: 3px; text-shadow: 0 0 24px rgba(255,0,0,.7);
  animation: ksBlink 1s steps(1,end) infinite; user-select: none;
}
.ks-msg { max-width: 640px; text-align: center; color: #fff;
  background: rgba(10,0,0,.72); padding: 14px 20px; border-radius: 12px;
  border: 1px solid rgba(255,40,40,.5); }
.ks-msg p { margin: 6px 0; }
.ks-min { position: fixed; top: 12px; right: 16px; width: 34px; height: 34px;
  border-radius: 8px; background: rgba(0,0,0,.6); color: #fff; border: 1px solid #ff3b3b;
  cursor: pointer; font-size: 16px; line-height: 1; }
.ks-deact { background: #c0392b; color: #fff; border: none; border-radius: 8px;
  padding: 12px 22px; font-size: 16px; font-weight: 700; cursor: pointer; }
.ks-deact:disabled { opacity: .6; cursor: default; }
.ks-cancel { background: #333; color: #fff; border: none; border-radius: 8px;
  padding: 12px 18px; margin-left: 10px; cursor: pointer; }
.ks-confirm { max-width: 560px; text-align: center; color: #fff;
  background: rgba(10,0,0,.9); padding: 18px 22px; border-radius: 12px;
  border: 1px solid #ff3b3b; }
.ks-confirm-btns { margin-top: 12px; }
.ks-err { color: #ffcf3b; font-weight: 600; }
.ks-badge {
  position: fixed; top: 8px; left: 50%; transform: translateX(-50%); z-index: 100000;
  background: #c0392b; color: #fff; border: 1px solid #ff7b7b; border-radius: 8px;
  padding: 6px 14px; font-weight: 800; letter-spacing: 1px; cursor: pointer;
  animation: ksBlink 1s steps(1,end) infinite;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/app.css
git commit -m "style(killswitch): blinking non-blocking overlay + minimized badge"
```

---

### Task 4: Mount overlay at app root (PanelShell)

**Files:**
- Modify: `client/src/components/layout/PanelShell.tsx`

- [ ] **Step 1: Import + render** (backup: `cp client/src/components/layout/PanelShell.tsx client/src/components/layout/PanelShell.tsx.bak.pre-ksui`)

Add the import near the other component imports at the top of PanelShell.tsx:
```tsx
import { KillSwitchOverlay } from '../KillSwitchOverlay'
```

Render it inside the global overlays region (right after the line `{/* ── Modal Overlays (global, outside main flow) ── */}` at ~line 412):
```tsx
      <KillSwitchOverlay />
```

- [ ] **Step 2: Verify build compiles**

Run: `cd client && npm run build > /tmp/ksbuild.log 2>&1; echo "BUILD=$?"; grep -iE "error|✓ built" /tmp/ksbuild.log | tail -3`
Expected: `✓ built`, BUILD=0.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/layout/PanelShell.tsx
git commit -m "feat(killswitch): mount KillSwitchOverlay at app root"
```

---

### Task 5: Remove old kill surface in ATPanel

**Files:**
- Modify: `client/src/components/trading/ATPanel.tsx` (the kill banner + RESET button)
- Modify: `client/src/components/__tests__/ATPanel.test.tsx` (drop the kill-banner assertion)

- [ ] **Step 1: Read the current ATPanel kill block**

Run: `sed -n '36,92p' client/src/components/trading/ATPanel.tsx`
(Identify: the `doReset`/kill handler, the `{killTriggered && (... RESET KILL SWITCH ...)}` button block, and the `{killTriggered && (... KILL SWITCH ACTIVE — {reasonLabel})}` banner.)

- [ ] **Step 2: Remove the RESET button block + the banner block** (keep the AT enable toggle and its `disabled={... || killTriggered}` gating). Delete the two `{killTriggered && (…)}` JSX blocks and any now-unused `doReset`/`reasonLabel`/`killReason` locals. Backup: `cp client/src/components/trading/ATPanel.tsx client/src/components/trading/ATPanel.tsx.bak.pre-ksui`.

- [ ] **Step 3: Update ATPanel.test.tsx** — remove the test `it('shows kill banner when kill switch is active', …)` (the banner now lives in KillSwitchOverlay, tested in Task 2).

- [ ] **Step 4: Run ATPanel tests**

Run: `cd client && npx vitest run src/components/__tests__/ATPanel.test.tsx 2>&1 | tail -12`
Expected: PASS (remaining tests green; no reference to the removed banner).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/trading/ATPanel.tsx client/src/components/__tests__/ATPanel.test.tsx
git commit -m "refactor(killswitch): remove in-AT kill banner + RESET button (moved to overlay)"
```

---

### Task 6: Remove old kill surface in StatusBar

**Files:**
- Modify: `client/src/components/layout/StatusBar.tsx` (the `zsbKill` item)

- [ ] **Step 1: Read the zsbKill block**

Run: `sed -n '50,62p' client/src/components/layout/StatusBar.tsx`

- [ ] **Step 2: Remove the `<div className="zsb-item" id="zsbKill" …>…</div>` block** (and any now-unused local that only fed it). Backup: `cp client/src/components/layout/StatusBar.tsx client/src/components/layout/StatusBar.tsx.bak.pre-ksui`.

- [ ] **Step 3: Build to confirm no dangling references**

Run: `cd client && npm run build > /tmp/ksbuild2.log 2>&1; echo "BUILD=$?"; grep -iE "error|✓ built" /tmp/ksbuild2.log | tail -3`
Expected: `✓ built`, BUILD=0.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/layout/StatusBar.tsx
git commit -m "refactor(killswitch): remove zsbKill status-bar item (moved to overlay)"
```

---

### Task 7: Full verification + deploy

**Files:** none (verify + deploy)

- [ ] **Step 1: Client tests for the touched area**

Run: `cd client && npx vitest run src/components/__tests__/KillSwitchOverlay.test.tsx src/components/__tests__/ATPanel.test.tsx 2>&1 | tail -12`
Expected: all PASS.

- [ ] **Step 2: Server suite — no regressions**

Run: `npx jest --forceExit --silent > /tmp/ksfull.log 2>&1; grep -E "Tests:|Test Suites:" /tmp/ksfull.log | tail -3`
Expected: 23 failed = unchanged baseline (binance/order-place/omega), no new failures.

- [ ] **Step 3: Grep-verify old surfaces gone**

Run: `grep -nE "KILL SWITCH ACTIVE|RESET KILL SWITCH" client/src/components/trading/ATPanel.tsx; grep -nE "zsbKill" client/src/components/layout/StatusBar.tsx; echo "exit=$?"`
Expected: no matches (both removed).

- [ ] **Step 4: Build + confirm overlay in bundle**

Run: `cd client && npm run build > /tmp/ksbuild3.log 2>&1; echo "BUILD=$?"; grep -l "ks-overlay\|KILL SWITCH" public/app/assets/index-*.js && echo "overlay in bundle"`
Expected: BUILD=0, overlay present.

- [ ] **Step 5: Deploy (serve new bundle) + clean boot**

Run: `pm2 reload zeus --update-env 2>&1 | tail -1` then confirm online + no crash:
`pm2 list | grep zeus`
Expected: online, restart count +1, no loop. (No server logic changed — only the served client bundle + the test hooks.)

- [ ] **Step 6: Operator visual check (handoff note)**

The overlay only shows when the kill switch is ACTIVE. To verify visually, the operator (on the laptop) can trigger the dev kill switch (AnalysisSections "KILL SWITCH" dev button) and confirm: full-screen red blinking "KILL SWITCH" + message, app visible underneath, minimize→badge→expand, Deactivate→confirm→clears. Document this in the final report — Claude cannot see the rendered UI.

- [ ] **Step 7: Final checkpoint commit**

```bash
git commit --allow-empty -m "chore(killswitch): overlay UI shipped — tests green, deployed, awaiting operator visual check"
```

---

## Self-Review notes
- **Spec coverage:** overlay big/red/blink (Task 2+3), English why/what (Task 2), non-blocking app-visible (Task 3 pointer-events), minimize-not-X→badge→expand (Task 2), deactivate+detailed confirm (Task 2), remove AT + StatusBar surfaces (Tasks 5,6), Part B re-arm verify (Task 1). All covered.
- **No new server money-path code** — Part B already exists; Task 1 only adds test hooks + a test.
- **Visual rendering** cannot be auto-verified (no browser); Task 7 Step 6 hands that to the operator.

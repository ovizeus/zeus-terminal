# ZeuS Brain v7 — Implementation Spec

Reference: `docs/design/zeus_brain_v7_reference.html` (open it in a browser to see the target).
If this spec and the reference disagree, **this spec wins**.

---

## 0. Golden rules (read first, follow always)

1. **Never show a fake number.** Every value on screen comes from real ZeuS state, or it shows `—`. The tap-to-explain text for it then says "not available yet". Never interpolate, guess or "estimate" a value to fill a gap.
2. **Never change trading behaviour.** Do not modify scoring, confluence, gates, signals, ML inference, DSL, order execution, position management or exchange code. The brain is a **read-only consumer** of engine state. Nothing computed for the brain (mood, intent, déjà vu, template, psych report, sleep) may be read by the engine.
3. **Build what's missing, but only plumbing.** If a data source doesn't exist, you may build:
   - a read-only **adapter/selector** that exposes values the engine already computes internally;
   - **storage** (journal, frames, snapshots);
   - **UI/analytics** that run on recorded data.
   You may NOT build new trading logic or new indicators to "fill" an axis. If a value truly isn't computed anywhere, use the fallback in section 3 and list it in your report.
4. **Demo vs live.** Everything recorded carries `isDemo` (true when the app is in DEMO mode). Psych report, déjà vu and template use **live trades only** by default. Add a small toggle "include demo trades" (off by default) in the psych report footer.
5. **Port the reference exactly** for visuals: geometry, colors, alphas, timings, fonts. Constants are in the `[CONFIG]` and `[RENDER]` sections.
6. **Don't port** anything in `[DEMO-SIM]`: the `demoTick()` market simulator, the seeded 60 demo trades, the Long/Short/Squeeze/Chop demo buttons, `demoSwitchMain()`.

---

## 1. Architecture

```
ZeuS engine state ──► buildRawFromZeusState()  (NEW adapter, read-only)
                          │  raw (section 3 contract)
                          ▼
                     DERIVED.build(raw) ─► st (render contract)
                          │
            ┌─────────────┼──────────────────┐
            ▼             ▼                  ▼
       render(st)    REC.tick(st)       UI (DOM, journal, psych…)
                     REC.onEntry/onExit ◄── REAL engine events (fills)
                          │
                          ▼
                    Journal storage (section 4)
```

- One `requestAnimationFrame` loop. Pause on `visibilitychange` hidden.
- `buildRawFromZeusState()` is called every frame and must be cheap. Read from existing stores/state, don't fetch.
- `REC.onEntry` / `REC.onExit` are called from the **real** engine/position events: order filled = entry, position closed = exit. Never call them from the brain's own signal animation.

---

## 2. Files to create/modify (suggested, adapt to repo structure)

- `brain/brainAdapter.(js|ts)`: `buildRawFromZeusState()` plus engine event hooks.
- `brain/brainRender.(js|ts)`: port of `[RENDER]` (render, pts, spline, drawStrip).
- `brain/brainDerived.(js|ts)`: port of `[DERIVED]`.
- `brain/brainRecorder.(js|ts)`: port of `[RECORDER]` plus storage (section 4).
- `brain/brainUI.(js|ts)`: journal, all-trades modal, replay, share card, psych report, déjà vu, template, tap-to-explain, sound/haptics, focus.
- `brain/brainStrings.(js|ts)`: the `STR`, `AXD`, `GND`, `MX` texts (i18n-ready).
- Replace the current radar component's render with this. Keep the header, MODE/PROFILE/DSL bar, MTF bar and log **unchanged**.

---

## 3. Raw input contract: `buildRawFromZeusState()`

Return exactly this shape every frame. Values 0..1 unless stated. `null` = not available (renders `—`).

| Field | Meaning | Real source (find it, report file + variable) | If missing |
|---|---|---|---|
| `rt[12]` | Axis values, **REAL-TIME lens**. Order: TREND, DELTA, FLOW, OI, VOL, FUND, VOLAT, IMB, MOM, SENT, STRUCT, LIQ | The values the current radar draws (they show as `8%`, `0%`, `50%` …, `—` for LIQ/OI today) | per axis `null` → drawn at 10% floor, label `—` |
| `tf[12]` | Same axes, **TIMEFRAME lens** | Radar Lens "TIMEFRAME" source | Build: EMA of `rt` (α=0.025 per frame at 60fps). Label it in your report as "derived, not engine" |
| `sl[12]` | Same axes, **SLOW lens** | Radar Lens "SLOW" source | Build: EMA of `tf` (α=0.007 per frame) |
| `att[12]` | ML attention per axis (feature importance / contribution) | ML FULL model: feature importances, SHAP or per-feature contribution, **only if the model exposes it** | `null` → uniform spokes (0.5). Do NOT train or compute importance yourself |
| `ml` | ML FULL confidence 0..1 | ML FULL output probability/confidence | `null` → render uses 0.7, label `ML —` |
| `gatesFailing[]` | Indices of failing Safety Gates. 0 Risk, 1 Spread/Slip, 2 Cooldown, 3 Volatility, 4 Session, 5 No Opposite, 6 Regime | The existing SAFETY GATES panel state. **"Cooldown OFF" = PASS** | required, it exists |
| `conf` | Confluence (integer) | Existing `CONFLUENCE` value shown on screen | required |
| `thr` | Entry threshold for the **active profile** (FAST/SWING/DEF) | The engine's real threshold constant/config | required. **Never hardcode 72** |
| `mode` | `'LONG' \| 'SHORT' \| 'SQUEEZE' \| 'RANGE'` | Current mode (LONG MODE label) plus regime (SQUEEZE/RANGE from the "REGIME:" field) | map unknown → `'RANGE'` |
| `modeLabel` | Text shown, e.g. `LONG MODE` | same | — |
| `signalActive` | true for **2.2 s** after the engine emits SIGNAL CONFIRMED | The same event that logs `SIGNAL LONG CONFIRMED! … SENDING ORDER` | required |
| `dead` | Market is dead → brain sleeps | **Build (display-only detector):** `true` when NO open position AND (Session gate failing OR (`rt[VOL] < 0.15` AND `rt[VOLAT] < 0.15` AND `conf < thr - 25`)) continuously for **60 s**. Clears instantly when the condition breaks | — |
| `position` | Open position on main symbol or `null` | Real position store | — |
| `position.symbol`, `.side` | `'BTC'`, `'LONG'/'SHORT'` | position | — |
| `position.pnlPct` | Unrealized PnL % (incl. fees if ZeuS shows it that way, same number as elsewhere in the UI) | position / exchange | `null` → `—` |
| `position.progress` | −1..+1 for the aura: `+1` = at TP, `−1` = at SL, `0` = entry | Compute from real prices: long `p = (mark−entry)/(tp−entry)` if ≥0 else `−(entry−mark)/(entry−sl)`; mirror for short. Clamp −1..1 | **No TP** (DSL/trailing): outer ring = **+2R** where R = \|entry−SL\|; tap text says "outer ring = 2R (no fixed TP)". **No SL**: hide the aura and rings |
| `closeMsg` | e.g. `TP HIT +2.40%` for 2.5 s after close | From the real close event and **real realized PnL** | — |
| `main` | Main symbol, e.g. `BTC` | Current symbol | — |
| `sats[3]` | The 3 other symbols the scanner tracks (the ones in the log `SOL LONG Score:88`) | Scanner state | fewer than 3 → draw only what exists |
| `sats[].axes[12]` | Same 12 axes for that symbol | **If** the scanner already computes radar axes per symbol | `null` → satellite drawn as a circle sized by score (reference handles it). You MAY call the existing axis function for those symbols read-only **if it's already cheap and side-effect free**. Otherwise don't |
| `sats[].score` | Scanner score (88, 81 …) | Scanner | `null` → `—` |
| `sats[].mode` | Their mode/direction | Scanner | `'RANGE'` |

Satellite tap → call the **existing** ZeuS symbol-switch function (replaces `demoSwitchMain`).

---

## 4. Recorder and journal storage (BUILD if not present)

### 4.1 Frames
- Record `st` at **4 Hz** into an in-memory ring buffer of **20 min** (4800 frames).
- Frame = the full `st` object minus nothing (needed for replay). Keep numbers rounded to 3 decimals to save space.
- Mood strip shows the last **3 min** (720 frames) of the live buffer.

### 4.2 Trade record (one per real closed trade)
```
{
  id,                // engine trade/order id (real), not a local counter
  isDemo,            // DEMO mode at entry
  symbol, side,      // 'BTC', 'LONG'|'SHORT'
  entryTime, exitTime,
  entryPrice, exitPrice,
  result,            // 'TP' | 'SL' | 'MANUAL' | 'DSL' | 'LIQ' | 'OTHER'  ← from the REAL close reason
  pnlPct,            // REAL realized PnL % (same number as the rest of ZeuS)
  pnlAbs,            // real realized PnL in quote currency
  confAtEntry, thrAtEntry, profile,   // FAST/SWING/DEF
  pre,               // last mood in {CALM, ALERT, NERVOUS, CONFUSED, HESITANT} before entry
  entryShape: [12],  // rt at entry (nulls replaced with 0.1)
  snapshot,          // PNG 240×240 of the brain canvas, 350 ms after entry (Blob or dataURL)
  frames             // 4 Hz frames from entry−12 s to exit+2 s; null for trades older than the last 50
}
```
- Unknown close reason → `'OTHER'`. Never label a close as TP/SL unless the engine says so.
- **Storage:** if ZeuS already has a backend/DB for trades, add these fields there (frames and snapshot can live in client IndexedDB keyed by trade id). If not, use **IndexedDB** (DB `zeus_brain`, stores `trades`, `frames`, `snapshots`). Never localStorage for frames or snapshots (size).
- Keep `frames` for the **last 50** trades only. Older trades keep everything else, and their Replay button shows `STR.noReplay`.
- Load the history at startup so psych report, déjà vu and template survive reloads.
- Snapshot: capture with `drawImage(canvas → 240×240)` exactly 350 ms after entry (shows the shockwave). If a replay is playing at that moment, wait until it ends (as in the reference).

---

## 5. Derived values (port `[DERIVED]`, display-only)

- `div` = mean |rt − sl| over axes with values. Drives the "tension" tremble.
- `hes` (hesitation) = not dead AND `conf ≥ thr − 8` AND ≥ 1 gate failing.
- **Mood** (priority order, first match wins):
  1. `ATTACK`: signalActive
  2. in position: `CONFIDENT` if progress > 0.35, `FEARFUL` if progress < −0.5, else `FOCUSED`
  3. `SLEEPING`: dead
  4. `HESITANT`: hes
  5. `CONFUSED`: ml < 0.45 (skip if ml is null)
  6. `NERVOUS`: div > 0.18
  7. `ALERT`: conf ≥ thr − 10
  8. `CALM`
- `pre` mood for a trade = the last mood in {CALM, ALERT, NERVOUS, CONFUSED, HESITANT} before entry.
- Consensus: a satellite agrees when its mode ≠ RANGE and its direction = main direction.
- Intent outline: `clamp(rt + (rt − tf) × 2.5)`. Visual only.

---

## 6. Visual elements (port `[RENDER]` exactly)

| Element | Behaviour | Data |
|---|---|---|
| Main shape | Catmull-Rom closed spline, radial fill, glow, breathing (period 5−3·VOLAT s; 8 s asleep) | rt |
| ML clarity | 4 offset ghost strokes, offset = (1−ml)·7 px; glow = 6 + ml·14 | ml |
| Tension tremble | per-vertex wobble amplitude = div × 0.12 | div |
| Timeframe membrane | thin solid line, 5% fill | tf |
| Slow membrane | dashed line (hidden in Focus/sleep) | sl |
| Intent | white dotted line | derived |
| Best template | gold dashed line `rgba(255,200,90,.38)` | best winning trade entryShape |
| Spokes | width 0.5 + att·3.2, gradient alpha | att |
| Sweep beam | conic gradient, 1.1 rad/s, flashes labels it passes (hidden in Focus/sleep/reduced motion) | — |
| Synapses | dashed flowing curves between non-adjacent axes both ≥ 0.6 (hidden in Focus/sleep) | rt |
| Particles | max 36, outward along spokes (hidden in Focus/sleep/reduced motion) | rt |
| Gate armor | 7 arcs at R+12. Pass = solid. Fail = 5 cracked flickering red pieces | gatesFailing |
| Core heart | lub-dub; bpm = 48 + conf·0.7; amber, irregular and skipping when hesitating; ×0.4 asleep | conf, hes |
| Threshold ring | arc r=25, fraction = min(1, conf/thr); thicker when full | conf, thr |
| Position aura | ring between SL ring (R+20, red dotted) and TP ring (R+34, green dotted); radius by progress | position |
| Shockwave | expanding ring on signal, TP and wake | events |
| Satellites | 3 corner mini-brains; brightest = best score; consensus beams to core | sats |
| Attention director | secondary layers fade to 0.4 alpha when hesitating or in position | — |
| Sleep | dark overlay 55%, floating "z z z", render at 1/3 frame rate (~20 fps) | dead |
| Tap highlight | white pulsing ring on the tapped element, 1.6 s | — |

---

## 7. UI below the radar (port `[UI]`)

Order: mood strip → info line → MOOD word → MODE/CONF → GATES/ML → POS/PnL → consensus + legend → DÉJÀ VU → TEMPLATE → status line → **[Sound + haptics] [Focus]** → TRADE JOURNAL → share card area → PSYCH REPORT.

- **No "Break a gate" button. No Long/Short/Squeeze/Chop buttons.** (They were demo controls.)
- Status line: `SIGNAL CONFIRMED · ENTERING`, `MARKET DEAD · resting at 20fps`, `HESITATING · <gates> blocked`, `WAIT · building`.
- `CONF x / thr` shows the real threshold.

### 7.1 Trade journal
- Shows the **last 4** trades (newest first): snapshot thumbnail, `#id SYMBOL SIDE · RESULT ±x.xx%`, `before entry: MOOD · conf N`, buttons **Replay** and **Share**.
- If there are more than 4: a full-width button `View all trades (N)`.
- **All-trades modal:** full-screen overlay (dark 97%), header `ALL TRADES (N)` with ✕ close button, scrollable list with the same rows and the same Replay/Share buttons. Close with ✕, Escape or after choosing Replay/Share. Lock background scroll while open. For large histories use pagination or virtual scrolling (load 50 at a time).
- Replay on a trade without frames → info line `STR.noReplay`. Grey out its Replay button.

### 7.2 Replay
- Plays the trade's frames at **×4** (16 frames per second of real time), starting 12 s before entry and ending 2 s after exit.
- `● REPLAY #id · x4` on the canvas top. Label above the mood strip: `REPLAY #id · Xs / Ys · exit ✕`; tapping it exits.
- The mood strip shows the trade's frames with a white cursor. **Tapping the strip seeks.**
- Sounds play during replay too (if enabled). Satellites can't be switched during replay.
- Live recording continues in the background during replay.

### 7.3 Share card
- 720×900 PNG: `ZEU'S` and `AI TRADING ANALYTICS`, `@zeusterminal` top right, the entry snapshot, `#id SYMBOL SIDE`, `RESULT ±x.xx%` (green/red), `mood before entry: … · conf N`.
- **Only real values** from the trade record. Shown under the journal with "Long-press the image to save or share" and Close. If the Web Share API is available (`navigator.canShare({files})`), also add a **Share** button that shares the PNG file.

### 7.4 Déjà vu
- Similarity = `1 − mean|a−b| × 2.2`, clamped 0..1, against every past trade's `entryShape`.
- Shows the top 2: `86% like #29 SL −1.20%`, plus `n=<count>`.
- Hidden until **≥ 10** live trades with entryShape: shows `collecting data · n/10`.
- Recompute every 0.5 s, not per frame.

### 7.5 Template
- Best = the highest pnlPct winning live trade (tie → higher confAtEntry). Gold dashed ghost on the radar plus `TEMPLATE · match X% with best trade #id +x.xx%`.
- No winning trade yet → `appears after your first winning trade`, no ghost.

### 7.6 Psych report
- Rows for CALM, ALERT, NERVOUS, CONFUSED, HESITANT that have ≥ 1 trade, sorted by win rate. Bar, `xx% · n=N`, and `low` if N < 30.
- Win = pnlPct > 0.
- Footer: `Win rate by mood before entry · N trades · display only, never used by the engine.` plus the "include demo trades" toggle.

### 7.7 Tap-to-explain (keep texts from `STR`, `AXD`, `GND`, `MX`)
Hit zones in canvas coordinates (360×360 logical, scale by the displayed size):
1. Satellite (distance < 32 from slot centre) → switch main (or info during replay).
2. Core (d < 32) → heartbeat and threshold explanation with real conf/thr.
3. Gate ring (|d − (R+12)| < 7) → `Gate NAME: PASS/FAILING (description)`.
4. Aura band (in position, R+16 < d < R+38) → aura explanation with real PnL (and the 2R note if there's no TP).
5. Outer label zone (d > R+30) → nearest axis: `AXIS value%: description. ML attention x%, slow lens y%.` Use `not available yet` for nulls.
6. Anything else inside → main shape legend.

Also tappable: MOOD word (meaning plus "display only"), mood strip (time-ago and mood; seek in replay), DÉJÀ VU line, TEMPLATE line, PSYCH REPORT title.
The info line resets to the idle text after 8 s. Each explanation draws the white highlight on the element.

### 7.8 Sound and haptics
- WebAudio tones exactly as in `FX.sound`: attack, tp, sl, close, hes, wake. Vibration patterns as in the reference.
- Off by default. Browsers require a user tap to start audio, so the toggle state is remembered but audio is (re)armed on the first tap each session.
- Vibration works on Android Chrome only (iOS Safari doesn't support it). Fail silently.

### 7.9 Focus
- Toggle persisted in localStorage `zeus.brain.ui`. Default: ON if viewport < 600 px, else OFF.
- ON hides: sweep, synapses, slow membrane, particles.

---

## 8. Performance and accessibility
- 60 fps on a mid-range phone; ~20 fps while asleep.
- DPR-scaled canvas. Cache gradients where possible. Déjà vu at 2 Hz. Mood strip redrawn every 2nd frame.
- `prefers-reduced-motion`: no sweep, particles, wobble, breathing or beam flow; colour and value transitions stay.
- The modal has `role="dialog"`, `aria-modal`, and a close button with `aria-label="Close"`.

---

## 9. Acceptance checklist (verify each, report ✓/✗)
1. With the engine running, every number on the brain matches the same number elsewhere in ZeuS (CONFLUENCE, gates, PnL, scores).
2. CONF ring threshold equals the active profile's real threshold. Switch FAST/SWING/DEF and confirm it changes.
3. Failing gates on the old panel = cracked gates on the armor, same ones.
4. A real (or DEMO-mode) entry creates a journal row with snapshot, real id, real side, and `pre` mood.
5. Closing via TP/SL/manual records the correct `result` from the engine close reason and the real realized PnL.
6. Reload the page: journal, psych report and template are still there.
7. Replay works for the last 50 trades. Older ones show the no-replay message.
8. More than 4 trades → "View all" opens the modal, ✕ closes it, Replay/Share from the modal work.
9. Psych report excludes demo trades unless the toggle is on.
10. Déjà vu shows "collecting data" below 10 live trades.
11. Nothing in `[DEMO-SIM]` exists in production code. No fake or seeded data anywhere.
12. grep proof: no brain module is imported by engine, scoring, ML or order code.

## 10. Report back
1. Mapping table: every raw field → file + variable (or "BUILT: …" or "FALLBACK: …").
2. What you built (adapter, recorder, storage, dead detector, EMA lenses …).
3. Fallbacks in use and what data would remove them.
4. The diff.
5. The checklist results.

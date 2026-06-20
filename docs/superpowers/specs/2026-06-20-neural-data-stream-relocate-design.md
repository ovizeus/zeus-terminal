# Neural Data Stream — Relocate Below Fear & Greed — Design

**Date:** 2026-06-20
**Status:** Approved (operator). Pure client UI move. No brain/trading/data change.

## Goal

Move the **⬡ NEURAL DATA STREAM ⬡ QUANTUM ANALYTICS** panel (the "bext" brain-extension: quantum clock, market phase, 7-symbol price action, momentum heatmap, risk matrix, data-stream ticker) out of the collapsed `tap-to-expand` toggle in the AutoTrade panel and render it **always-visible, directly below the FEAR & GREED INDEX** in the bottom analysis area — keeping its existing pro styling and its live updates.

## Current state

- The panel lives in `client/src/components/dock/AutoTradePanel.tsx`: a `bext-toggle-btn` (lines 255-257, gated by `bextOpen` state at line 32) + the `<div className="bext show" id="brainExt" …>` block (lines 259-324), inside the `.at-sep` wrapper (line 253). Collapsed by default (`display:none` when `!bextOpen`).
- It updates **imperatively by element id** — a `brainExt` interval started in `startApp()` writes into `#qSecArc`, `#qClockTime`, `#brainMarketPhase`, `#symPulseRows`, `#brainHeatmap`, `#dstreamInner`, `rg-*`/`rgv-*`, etc. (render.ts). So the block works wherever it lives in the DOM, as long as it is the **single** instance with those ids.
- The FEAR & GREED INDEX is a `<div className="sec">` in `client/src/components/analysis/AnalysisSections.tsx` (~line 60), followed by the BTC metrics/order-book sections.

## Approach (MOVE, single instance)

Extract the bext markup into a focused component and render it once, below Fear & Greed. **Do not duplicate** — duplicate ids would split the imperative updates.

### Components
- **Create `client/src/components/analysis/NeuralDataStream.tsx`** — a presentational component returning exactly the current `<div className="bext show" id="brainExt">…</div>` markup (lines 259-324), but **always visible** (drop the `bextOpen` inline `display:none`; keep `className="bext show"`). Same ids, same children, same CSS classes → identical look + the existing interval keeps updating it.
- **Modify `AnalysisSections.tsx`** — render `<NeuralDataStream />` immediately after the Fear & Greed `<div className="sec">…</div>` block.
- **Modify `AutoTradePanel.tsx`** — remove the `bext-toggle-btn` (255-257), the `#brainExt` block (259-324), the now-empty `.at-sep` wrapper if it holds nothing else, and the `bextOpen`/`setBextOpen` state (line 32). Verify the surrounding `at-sep` / `at-line` tags still balance.

### Live updates / data flow
Unchanged. The `startApp()` `brainExt` interval + render.ts target elements by id; with one instance moved under F&G, every update lands there. No JS rewiring needed.

### Styling
Reuse the existing `.bext`, `.bext-title`, `.qclock`, `.nheat`, `.risk-*`, `.dstream` CSS (global in app.css) — the panel looks identical in the new location. Optional: a small top margin / section label so it sits cleanly under F&G (a `<div className="sec">` wrapper or a thin separator) — keep it minimal and consistent with the neighbouring sections.

## Error handling
Pure markup move. If the interval hasn't run yet, the panel shows its static placeholders (LOADING / —) exactly as it does today. No new failure modes.

## Testing
- Headless: load app → the `#brainExt` panel renders **once**, is **visible** (not display:none), and sits **after** the FEAR & GREED section in the DOM (its bounding top is below `#fgval`'s). The AutoTrade panel no longer contains `#brainExt` or the `bext-toggle-btn`. The quantum clock id `#qSecArc` + `#brainHeatmap` exist (interval target present). 0 page/console errors. Screenshot; delete after.
- Confirm there is exactly ONE `#brainExt` in the DOM (no duplicate id).

## Files
- Create: `client/src/components/analysis/NeuralDataStream.tsx`.
- Modify: `client/src/components/analysis/AnalysisSections.tsx` (render it after F&G).
- Modify: `client/src/components/dock/AutoTradePanel.tsx` (remove the toggle + block + state).
- Bump `server/version.js`.

## Out of scope (YAGNI)
- Redesigning the panel's internals/visuals (keep as-is — it's already the "pro" look).
- Making it collapsible again (operator wants it always visible).
- Touching the brainExt update interval / render.ts logic.

## Decision (operator)
MOVE (single instance) the Neural Data Stream below Fear & Greed, always visible, keep the pro styling.

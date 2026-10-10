# Zeus — institutional redesign of the trade panels, diagnostics into THEIA

**Date:** 2026-10-10
**Status:** design approved by the operator; implementation not started
**Mockup:** https://claude.ai/artifact/HGSwWUV2HmbC4RdPoqp9pB (private)
**Revert point:** git tag `pre-institutional-redesign`, branch `institutional-redesign`,
file copies and the live bundle in `/root/zeus-backups/pre-redesign-20261010-1640`

## What the operator asked for

> *"vreau sa fac o schimbare de look la autotrade si manual trade ceva mai institutional mai
> simplu dar sa pastram logica… activiti log brain dashboard si brain vision sa le scot sa le
> bagam in theia cu aceiasi tema si auto trade sa ramana gen ca manual trade doar informatiile
> stricte de trade si tema schimbata nu asa cu mov"*

Plus, in later messages: the three surfaces only, **do not change the main icons** (interior
only), make a backup so we can revert, and the logic stays exactly as it is.

### Decisions he made

| Question | Decision |
|---|---|
| Where do Auto Trade's ~30 settings go? | A **separate configuration drawer** opened from a gear. The panel shows live state only. |
| Where may colour exist? | **Only where it carries information.** Surfaces are hueless; green/red on P&L and direction, amber for warning. Nothing decorative. |
| How far does the theme reach? | **The three surfaces only.** Icons untouched. |

## Success criteria

1. Auto Trade and Manual Trade read as the same product — same columns, same rhythm, same
   type scale — because they are built from the same components, not because they were
   carefully matched.
2. Auto Trade's panel body contains **only** live trade information. Every setting lives in
   the drawer.
3. Activity, Brain Vision and Brain Dashboard are gone from Auto Trade and present in THEIA
   in THEIA's own card language.
4. **No behavioural change.** Every handler, store subscription and trading rule behaves
   exactly as before. The engine cannot tell the difference.
5. No icon changes anywhere.
6. Revertible: a bad result is undone from the tag without archaeology.

## What exists today (measured, not remembered)

| File | Lines | Role |
|---|---|---|
| `client/src/components/dock/ManualTradePanel.tsx` | 447 | 43 hook calls, 5 handlers. ORDER TYPE / MARGIN / LEVERAGE / TP / SL → OPEN POSITIONS → WIN RATE + TRADES → EXCHANGE POSITIONS → TRADE JOURNAL. Already strictly trade information; it is the reference shape. |
| `client/src/components/dock/AutoTradePanel.tsx` | 563 | 46 hook calls, 3 handlers (`handleSaveAT`, `handleKill`, `handleToggle`). Carries GLOBAL MODE, LEVERAGE AUTO, TRADING SYMBOLS, ENTRY CONDITIONS, ADVANCED CONTROLS, RISK MANAGEMENT, stats, **ACTIVITY LOG**, **BRAIN VISION**, **BRAIN DASHBOARD**, SAVE, KILL SWITCH, ACTIVE POSITIONS. |
| `client/src/components/intel/TheiaPage.tsx` | 95 | A flat grid of 9 read-only cards. |
| `client/src/core/bootstrapBrainDash.ts` | 211 | **Two IIFEs that poll and write `innerHTML`** into `#brainVisionBody` and `#brainDashBody`. Brain Vision and Brain Dashboard are not React components at all. Their data already comes from `useBrainStore` / `useATStore`. |
| `client/src/app.css` | 8066 | Has a `:root` token block already (`--gold`, `--dim`, `--txt`, `--ff: 'Share Tech Mono'`…). 68 `.at-` / `.tp-` rules. |

### The measurement that chose the approach

In the `.at-` / `.tp-` rules there are **138 hardcoded hex colours against 54 `var(--…)`
uses**, plus **35 hardcoded hex in `AutoTradePanel.tsx`** and **21 in `ManualTradePanel.tsx`**
inline styles — **194 hardcoded colours in total**.

So re-skinning by overriding the CSS variables would change almost nothing. The presentation
layer has to be **rewritten** against new primitives, with the logic lifted across untouched.
This is stated plainly because it sets the real size of the work: it is not a restyle.

A second fact from the same file: `--ff` is `'Share Tech Mono'` for the **whole application**.
Labels set in a monospace face is the main reason the current panels do not read as
institutional. The new type pairing must therefore be scoped to the three surfaces, never
applied globally.

## Architecture

### 1. The token layer — one scoped class

A new stylesheet, `client/src/styles/institutional.css`, defines the palette and type scale
**inside a single class**, `.zi`:

```css
.zi {
  --zi-bg: #0a0e14;  --zi-card: #111821;  --zi-line: #1c2733;  --zi-hair: #141c26;
  --zi-val: #e4ecf4; --zi-lbl: #8a9bb0;   --zi-mut: #7c8ea4;   --zi-faint: #5f7186;
  --zi-pos: #2bb673; --zi-neg: #d94f5c;   --zi-warn: #c89b3c;
  --zi-sans: 'IBM Plex Sans', system-ui, sans-serif;
  --zi-mono: 'IBM Plex Mono', ui-monospace, monospace;
}
```

`.zi` goes on exactly three roots: the Auto Trade panel, the Manual Trade panel, the THEIA
page. **The whole redesign is gated behind that one class.** Removing it from three places
restores the old look without touching anything else — which is the cheapest possible answer
to "if it is not good we go back".

Contrast was checked against `--zi-card`: label 5.5:1, muted 5:1, positive 6.6:1,
negative 4.6:1, warning 6.5:1. `--zi-faint` is for hairlines and non-essential text only.
Positive and negative also differ in lightness, not only hue, and the sign (`+` / `−`) is
always present, so nothing depends on colour alone.

### 2. Four primitives — `client/src/components/ui/`

This is what makes the two panels siblings by construction.

| Component | Purpose | Props |
|---|---|---|
| `ZiMetric` | One label/value row. Label small-caps in `--zi-lbl`; value in `--zi-mono` with `font-variant-numeric: tabular-nums`, right-aligned. | `label`, `value`, `tone?: 'neutral' \| 'pos' \| 'neg' \| 'warn'`, `secondary?` |
| `ZiTable` + `ZiRow` | The positions / journal table. Owns the column template so Auto Trade and Manual Trade cannot drift apart. | `columns`, `rows` |
| `ZiSection` | A titled block. One hairline above, no box. | `title`, `aside?`, `children` |
| `ZiPanel` | The panel frame: 2px state rail, title, one optional action slot. | `title`, `rail: 'pos'\|'neutral'\|'neg'`, `action?`, `children` |

Each is small, has one job, is used by at least two call sites, and is unit-testable without a
chart or a store. `tabular-nums` lives in exactly one place (`ZiMetric` and `ZiRow`), so the
"numbers do not jitter" property cannot be lost by editing a panel later.

The `Zi` prefix is deliberate and matches the `.zi` gate class: it is checked that
`Metric`, `Section`, `DataTable` and `DataRow` are all unused names today, but `PanelShell`
already exists at `client/src/components/layout/PanelShell.tsx`. Prefixing all five avoids
that collision and makes the whole new layer greppable and removable as one unit.

### 3. Manual Trade — rebuilt first

Rebuilt on the primitives. All 43 hook calls and 5 handlers (`handleOrdTypeChange`,
`handleLevChange`, `handleCustomLevChange`, `handleSizeChange`, and the generic `handler`)
move across **verbatim**. Only the returned markup changes. Done first because it is the
simpler file and the shape everything else is measured against.

### 4. Auto Trade — rebuilt, and emptied

The panel body keeps: state line (armed/idle · demo/live · cycle), Exposure, Today, Balance,
Day limit, the positions table, and two actions (Arm/Disarm, Close All).

Everything else leaves:

| Leaves the panel | Goes to |
|---|---|
| TRADING SYMBOLS | drawer, Symbols tab |
| ENTRY CONDITIONS | drawer, Entry tab |
| RISK MANAGEMENT | drawer, Risk tab |
| ADVANCED CONTROLS, GLOBAL MODE, LEVERAGE AUTO | drawer, Advanced tab |
| SAVE SETTINGS | drawer footer |
| ACTIVITY LOG | THEIA, Operations lane |
| BRAIN VISION | THEIA, Operations lane |
| BRAIN DASHBOARD | THEIA, Operations lane |

`handleSaveAT`, `handleKill` and `handleToggle` keep their current bodies exactly;
`handleSaveAT` is simply invoked from the drawer's Save instead of the panel's.

### 5. The configuration drawer

`client/src/components/dock/AutoTradeConfigDrawer.tsx`, built on the existing `ModalOverlay`
infrastructure the other modals use, with four tabs: Symbols · Entry · Risk · Advanced.

It owns no state of its own beyond the active tab. Every input stays bound to the same store
field and the same change handler it is bound to today — the controls are moved, not
reimplemented. "Allow adaptive on live" keeps a warning treatment, because it is the one
switch that lets the engine change real-money size by itself.

### 6. THEIA — lanes, and three real cards

`TheiaPage` gains three labelled lanes instead of one flat grid:

- **State** — BrainPulse, EnginePositions, SafetyHealth, MarketLens (existing)
- **Operations** — `ActivityCard`, `BrainVisionCard`, `BrainDashboardCard` (new)
- **Record** — MlDigest, Memory, RecentDecisions (existing)

`VerdictBand` stays above the lanes.

The three new cards are **real React components reading `useBrainStore` / `useATStore`
directly**, in `client/src/components/intel/theia/`. They replace the two polling IIFEs in
`bootstrapBrainDash.ts`.

**If both convert cleanly, `bootstrapBrainDash.ts` is deleted** — 211 lines of
`innerHTML` string building gone, and with it the last large block of imperative DOM poking in
this part of the app. That is to be confirmed during implementation, not assumed: the file
must first be proven to have no other consumers.

## Data flow

Unchanged everywhere. The stores remain the single source of truth; the panels remain
subscribers. The only new flow is that Brain Vision and Brain Dashboard stop reading the
stores *inside an IIFE and writing HTML strings into fixed DOM ids*, and start reading them
as components. Same stores, same fields, same polling cadence where polling is still needed.

## Error handling

No new failure modes are introduced, and three existing ones are preserved deliberately:

- The drawer must never block a save. `handleSaveAT` keeps its own try/catch.
- `BrainVisionCard` and `BrainDashboardCard` must render with empty stores (boot window) and
  show `—`, never fabricate a value. THEIA's existing rule is "real data only; a genuinely
  unavailable value is null, never invented" and the new cards inherit it.
- Removing the gear from Auto Trade must not remove the kill switch. The emergency stop stays
  in the panel, always visible, never behind a drawer.

## Testing

| Unit | Test |
|---|---|
| `ZiMetric` | renders tabular figures; applies the right tone per sign; right-aligns the value |
| `ZiRow` | one column template shared by both panels; a long symbol does not shift the P&L column |
| `ZiPanel` | rail colour follows state; the action slot is optional |
| `AutoTradeConfigDrawer` | every control is bound to the same store field as before (a parity test against the old panel's field list) |
| `BrainVisionCard` / `BrainDashboardCard` | render from an empty store without throwing and show `—` rather than a number |
| `AutoTradePanel` | **a guard test that the panel body contains no settings control** — the thing that would silently regress |
| Theme containment | a test that `.zi` tokens are not referenced outside the three surfaces, so the theme cannot leak |

Existing suites must stay green throughout: client 760/760, server 20/20 on the touched
routes, `tsc --noEmit` clean.

## Sequence

Four steps, each shippable and revertible on its own:

1. Token layer + four primitives + their tests (touches no existing panel)
2. Manual Trade rebuilt
3. Auto Trade rebuilt + the configuration drawer
4. The three THEIA cards + lanes; delete `bootstrapBrainDash.ts` if clean

**One pm2 reload at the very end, not one per step.** Eight reloads today earned a Binance 418
IP ban at 16:14; steps 1–4 are client-only and need a bundle build, not a restart.

## Out of scope

- Any trading logic, store, handler or rule
- Icons of any kind
- The other ~100 components (the token layer makes extending cheap later, panel by panel)
- A real S/R engine, drawings work, or anything else from the persistence audit

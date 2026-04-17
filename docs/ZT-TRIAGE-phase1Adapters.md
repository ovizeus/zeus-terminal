# ZT1.b — phase1Adapters.ts Triage (2026-04-17)

**File**: `client/src/bridge/phase1Adapters.ts` (199 lines, 16KB)
**Purpose**: Bridge install at boot — side-effect imports + window.* shims.

## Count reconciliation

Audit quantum claimed "100+ window exports". Precise count post-read: the function body `installPhase1Adapters()` attaches **24 slots** to `window` directly. The "100+" was counting the IMPORT SIDE (80+ module imports that self-register on window via their own IIFEs). Two different surfaces.

- **Direct `window.*` attachments from this file**: 24
- **Self-registering imports (70+ modules)**: side-effect registration, not this file's responsibility to triage

## Direct window attachments — classification

| # | window slot | File line | Category | Disposition |
|---|---|---|---|---|
| 1 | `ZT_safeInterval` | 148 | CRITICAL SHIM | **KEEP** — arianova.ts IIFE looks it up at import time |
| 2 | `MSCAN` | 165 | STATE REF | **KEEP** — circular-dep escape; klines.ts writes, many read |
| 3 | `DHF` | 166 | STATE REF | **KEEP** — DHF readers in ui/render.ts, engine/brain.ts |
| 4 | `PERF` | 167 | STATE REF | **KEEP** — perfStore exists but w.PERF is legacy mutable ref (HYBRID BY DESIGN — same as BM/BRAIN) |
| 5 | `ARM_ASSIST` | 168 | STATE REF | **KEEP** — engine/brain.ts armAssist state |
| 6 | `_fakeout` | 169 | STATE REF | **KEEP** — trading anti-fakeout counter, engine-internal |
| 7 | `cSeries` | 173 | CHART BRIDGE | **KEEP** — chartBridge legit; marketData bridge-active consumers |
| 8 | `cvdS` | 174 | CHART BRIDGE | **KEEP** |
| 9 | `cvdChart` | 175 | CHART BRIDGE | **KEEP** |
| 10 | `volS` | 176 | CHART BRIDGE | **KEEP** |
| 11 | `ema50S` | 177 | CHART BRIDGE | **KEEP** |
| 12 | `ema200S` | 178 | CHART BRIDGE | **KEEP** |
| 13 | `wma20S` | 179 | CHART BRIDGE | **KEEP** |
| 14 | `wma50S` | 180 | CHART BRIDGE | **KEEP** |
| 15 | `stS` | 181 | CHART BRIDGE | **KEEP** |
| 16 | `srSeries` | 182 | CHART BRIDGE | **KEEP** |
| 17 | `_showConfirmDialog` | 185 | HTML onclick handler | **KEEP** — called from `_showConfirmDialog` inline in HTML template strings |
| 18 | `calcPosPnL` | 186 | HTML onclick handler | **KEEP** — called from position row HTML strings |
| 19 | `getDemoLev` | 187 | HTML onclick handler | **KEEP** — called from demo panel HTML |
| 20 | `updateDemoLiqPrice` | 188 | HTML onclick handler | **KEEP** — called from demo panel |
| 21 | `updateDemoBalance` | 189 | HTML onclick handler | **KEEP** — called from demo panel |
| 22 | `procLiq` | 190 | STATE WRITER | **REVIEW** — used for liquidation event injection; could move to direct import if consumers are all TS |
| 23 | `showTab` | 191 | HTML onclick handler | **KEEP** — called `onclick="showTab(...)"` in static HTML / modal templates |
| 24 | `testNotification` | 192 | HTML onclick handler | **KEEP** — called `onclick="testNotification()"` in settings modal |

## Observations

### Dead imports (cleanup candidates)
The import list at the top of phase1Adapters.ts contains several names marked unused in the TS6133 errors currently flagged:
- L53 `ARES_JOURNAL` — unused (engine self-registers)
- L57 `ARES_EXECUTE` — unused
- L58 `ARES_MONITOR` — unused
- L101 `aresPlaceOrder`, `aresSetStopLoss`, `aresCancelOrder` — unused (from liveApi.ts)

These are **safe to remove** in ZT2 (TS errors) or ZT8 (phase1Adapters reduction). They represent ~6 lines of dead imports that don't affect runtime.

### Side-effect import policy
The 70+ side-effect imports are CORRECT composition — each module self-registers via IIFE at import time. This is not migration debt; it's the chosen architecture. Cannot be removed without rewriting each module's registration mechanism.

### File size explanation
The 16KB file size is dominated by the import list (~120 lines of imports), not by the function body (~60 lines). Post-cleanup (dead imports removed), target: ~14KB.

## ZT8 plan

**Remove as dead code** (ZT8 or ZT2):
- `ARES_JOURNAL`, `ARES_EXECUTE`, `ARES_MONITOR` imports (3 lines)
- `aresPlaceOrder`, `aresSetStopLoss`, `aresCancelOrder` from liveApi import (~1 line of names)

**Document as LEGIT KEEP** (update file header comment):
- 24 window attachments (all legit per classification above)
- 70+ side-effect imports (composition pattern)

**Clarification**: the "bridge" is NOT the problem the audit thought it was. The bridge surface is 24 slots + legitimate side-effect composition. The earlier audit "100+ exports" inflated the number by conflating import names with window attachments.

**Conclusion for ZT8**: reduction is **marginal** (~10-15 lines of dead imports). Primary outcome: **truthful documentation** that the bridge is intentional composition, not debt.

## What this triage changes about the close plan

- **ZT8 estimate revised down**: 30 min instead of 3h. Scope: remove 6 dead imports + rewrite header comment + commit. No structural changes.
- **Bridge residue item** (audit quantum §3.3): reclassified from DEBT → BY-DESIGN LEGITIM with dovadă scrisă.
- **"100+ window exports" claim**: OVERSTATED in audit; real is 24, all with documented purpose.

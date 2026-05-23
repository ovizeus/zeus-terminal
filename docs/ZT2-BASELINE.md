# ZT2-A — TS errors baseline pe `tsconfig.app.json` (2026-04-17)

**Comandă de referință**: `cd client && npx tsc -p tsconfig.app.json --noEmit`
**Exit code**: 2 (errors emitted)
**Total errors**: **826**
**Build vite**: verde (`npm run build` → passes, 0 errors, warnings doar pe chunk size)

## Grupare pe cod de eroare

| # | Cod | Explicație | Strategie |
|---|---|---|---|
| 442 | TS6133 | Variabilă/import declarat dar nefolosit | ZT2-B (bulk unused) |
| 176 | TS2339 | Proprietate nu există pe tip | ZT2-C (window typing) + ZT2-D (HTMLElement cast) + ZT2-E (store types) |
| 104 | TS2304 | Cannot find name | ZT2-C (window typing) |
| 15 | TS2345 | Argument type mismatch | ZT2-F + ZT2-H |
| 15 | TS2322 | Type not assignable | ZT2-F + ZT2-H |
| 12 | TS6192 | All imports in declaration unused | ZT2-B |
| 11 | TS18047 | Object possibly null | ZT2-H |
| 6 | TS2554 | Wrong argument count | ZT2-H |
| 4 | TS2551 | Property typo suggestion | ZT2-E |
| 4 | TS2353 | Unknown property in object literal | ZT2-E |
| 3 | TS2531 | Object possibly null | ZT2-H |
| 3 | TS2352 | Type conversion unsafe | ZT2-H |
| 2 | TS7053 | Element implicitly any (index) | ZT2-H |
| 2 | TS2591 | Missing type declaration (node types) | ZT2-H |
| 5 | TS2801/2741/2739/2556/17001 | Misc | ZT2-H |

**Total**: 826

## Grupare pe fișier (fișiere cu ≥5 errors)

| # errors | File | Principal error type |
|---|---|---|
| 336 | src/bridge/phase1Adapters.ts | TS6133 unused (dead imports R21-R28 residue) |
| 98 | src/engine/aub.ts | TS2304 "Cannot find name 'AUB'" (93) + misc |
| 48 | src/trading/autotrade.ts | TS2339 window/prop mix |
| 37 | src/engine/brain.ts | TS6133 + TS2339 mix |
| 37 | src/data/marketDataTrading.ts | TS2339 HTMLElement props |
| 26 | src/ui/panels.ts | TS2339 HTMLElement props |
| 25 | src/data/marketDataWS.ts | TS2339 HTMLElement props |
| 14 | src/ui/dom2.ts | TS2339 |
| 13 | src/stores/settingsStore.ts | TS2339 tc/setTC missing |
| 13 | src/data/orderflow.ts | TS2339 |
| 12 | src/engine/indicators.ts | TS2339 |
| 10 | src/engine/forecast.ts | TS6133 |
| 8 | src/trading/dsl.ts | mix |
| 7 | src/ui/render.ts | TS6133 + TS2339 |
| 7 | src/data/marketDataPositions.ts | TS2339 |
| 6 | src/hooks/useServerSync.ts | TS6133 |
| 6 | src/engine/arianova.ts | TS6133 |
| 6 | src/engine/ares.ts | TS6133 (3) + TS2322 (2) + others |
| 6 | src/data/klines.ts | TS2339 HTMLElement |
| 5 | src/hooks/useBrainEngine.ts | TS2339 |
| 5 | src/core/config.ts | mix |
| 5 | src/core/bootstrapStartApp.ts | TS2339 _modeConfirmed |
| 5 | src/components/dock/AutoTradePanel.tsx | TS2339 ATLogEntry |

**63 distinct files** cu cel puțin 1 error.

## Key patterns pentru fix

### 1. Unused imports (454 = 442 TS6133 + 12 TS6192)
Dominant în `phase1Adapters.ts`. Reziduu de la migrările R21-R28 când funcțiile au fost mutate în componenete React dar importurile au rămas. **Bulk-safe**: ștergerea unui import nefolosit nu poate schimba runtime.

### 2. Window globals untyped (104 TS2304 + multe TS2339)
| Nume | Count | Origine |
|---|---|---|
| AUB | 93 | aub.ts global (self-registered via IIFE) |
| _rsiChart | 4 | chart bridge |
| _obvChart | 4 | chart bridge |
| S | 3 | state.ts global |

Fix: `declare global { interface Window { AUB, S, _rsiChart, _obvChart } }` + `declare var` dacă sunt accesate nud.

### 3. HTMLElement property access (~104 TS2339)
Pattern comun: `document.getElementById('x').value` — `getElementById` returnează `HTMLElement | null`, nu `HTMLInputElement`. 88 × `.value` + 16 × `.checked` + 6 × `.disabled` + 4 × `.placeholder` + 4 × `.style` + 2 × `.readOnly`.

Fix: cast la `HTMLInputElement` (sau helper).

### 4. Store type definitions mismatch (~30 errors)
- `SettingsStoreState` — lipsesc `tc`, `setTC` (folosite în SettingsModal)
- `DslStoreState` — lipsește `dsl` (folosit în DslWidget + tests)
- `atStore` — lipsește `_modeConfirmed`
- `ATLogEntry` — lipsesc `time`, `type`, `msg`

Fix: extinde tipurile să reflecte runtime.

### 5. ATmosphere reziduale (TS2345, TS2322, TS18047, TS2554 etc ~55)
Misc errors: arg count, type conversion, null checks. Individuale, verdict per caz.

## Plan sub-loturi ZT2

| Lot | Scope | Expected reduction | Estimate |
|---|---|---|---|
| ZT2-A | Baseline (this doc) | 0 | DONE |
| ZT2-B | Bulk safe: unused imports & locals (TS6133 + TS6192) | ~454 → ~0 of category | 1-2h |
| ZT2-C | Window global typing augmentation (TS2304 + related TS2339) | ~104 + ~20 | 45min |
| ZT2-D | HTMLElement cast typing (TS2339 .value/.checked/etc) | ~104 | 1h |
| ZT2-E | Store type extensions (SettingsStore, DslStore, atStore, ATLogEntry) | ~30 | 45min |
| ZT2-F | Core targeted files (render/theme/dev/guards) | ~17 | 30min |
| ZT2-G | ARES engine TS cleanup | ~6 | 30min |
| ZT2-H | Remaining misc (TS2345, TS2322, TS18047, etc) | ~80-100 | 1-2h |
| ZT2-I | Final zero pass + verify | tsc = 0 | 30min |

**Total estimate**: 6-8h realist (up from "2h" assumption). Sub-loturile sunt independente; dacă unul revelează scope mai mare, se extrage sub-sub-lot.

## Regula de aur

După fiecare sub-lot: rulez `tsc` și contez exact. Dacă reducerea nu e cea așteptată, nu merg mai departe fără raport. La final: **tsc principal = 0** sau REOPEN motivat specific.

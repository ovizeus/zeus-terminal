# Zeus Terminal — Plan de Remediere P0
### Data: 2025-07-27 | Versiune: v1.3.1 build 15
### Regulă: ZERO cod modificat — doar plan executabil

---

## FRONT A — P0 Safety / Runtime Bugs (4 buguri critice)

### A1. Cancel Loop — SL nu se anulează niciodată
| Câmp | Detaliu |
|------|---------|
| **Fișier** | `server/services/serverAT.js` linia ~877 |
| **Funcție** | `_handleLiveExit()` — blocul `else` (cancel all orders) |
| **Cauză** | Loop iterează `[pos.live.slOrderId, pos.live.tpOrderId]` cu variabila `oid`, dar în `else` branch apelează `_cancelOrderSafe(pos.symbol, pos.live.tpOrderId, creds)` — hardcoded `tpOrderId` în loc de `oid`. SL order-ul nu se anulează niciodată. |
| **Risc** | SL activ pe exchange după ce poziția e închisă → dublu exit, pierdere reală |
| **Fix** | Înlocuiește `pos.live.tpOrderId` cu `oid` în apelul `_cancelOrderSafe` din else branch |
| **LOC** | 1 linie |
| **Verificare** | Test: deschide poziție live demo, declanșează exit prin TP → verifică în logs că AMBELE ordere (SL + TP) sunt cancelled. `grep "cancelOrder"` în logs trebuie să arate 2 cancel-uri. |

---

### A2. Telegram crash blochează TOATE orderele
| Câmp | Detaliu |
|------|---------|
| **Fișier** | `server/services/riskGuard.js` liniile 110 și 164 |
| **Funcție** | `validateOrder()` linia 164 — `telegram.alertDailyLoss()` ; `setEmergencyKill()` linia 110 — `telegram.alertKillSwitch()` |
| **Cauză** | Ambele apeluri telegram sunt fără try/catch. Dacă telegram API aruncă (timeout, network, rate limit), excepția propagă în sus, `validateOrder()` aruncă, și ORICE order ulterior eșuează — inclusiv SL/TP protective. |
| **Risc** | Toate ordinele blocate pe durata indisponibilității Telegram → nu se mai plasează SL/TP → expunere nelimitată |
| **Fix** | Wrap ambele apeluri telegram în `try { ... } catch(e) { logger.warn(...) }` — alerta Telegram este best-effort, nu trebuie să blocheze fluxul critic |
| **LOC** | ~6 linii (2 try/catch blocks) |
| **Verificare** | Test: mock `telegram.alertDailyLoss` să arunce → `validateOrder()` trebuie să returneze normal, fără throw. Repetă pentru `alertKillSwitch`. |

---

### A3. Emergency Close fallthrough — TP se plasează pe poziție eșuată
| Câmp | Detaliu |
|------|---------|
| **Fișier** | `server/services/serverAT.js` liniile 543-559 |
| **Funcție** | `_executeLiveEntry()` — blocul de emergency close (catch la market order) |
| **Cauză** | La linia ~555, `catch(emgErr)` loguiește eroarea și trimite telegram, dar NU face `return`. Execuția cade prin la linia ~559 unde plasează TP order pe o poziție al cărei emergency close tocmai a eșuat. Rezultat: TP activ pe o poziție zombie. |
| **Risc** | TP order fără poziție backing → dacă prețul atinge TP, exchange deschide o poziție nouă inversă, pierdere reală |
| **Fix** | Adaugă `return;` la finalul blocului `catch(emgErr)` (înainte de linia 559) |
| **LOC** | 1 linie |
| **Verificare** | Test: mock emergency close API să arunce → verifică că funcția returnează fără a atinge codul de TP placement. `grep "placing TP"` NU trebuie să apară în logs după un `emgErr`. |

---

### A4. Position push înainte de SL/TP — race condition
| Câmp | Detaliu |
|------|---------|
| **Fișier** | `server/services/serverAT.js` liniile 318 + 350 |
| **Funcție** | Entry flow — `_positions.push(entry)` la 318, `_executeLiveEntry(entry, stc).catch(...)` la 350 |
| **Cauză** | `_positions.push(entry)` este sincron. `_executeLiveEntry()` este async fire-and-forget (`.catch()` fără `await`). Între push și completarea live entry, `onPriceUpdate()` poate vedea poziția și declanșa exit logic pe o poziție fără SL/TP pe exchange. |
| **Risc** | Exit fără SL cancel (SL nu există încă) → orphan orders pe exchange, sau exit pe o poziție care încă se deschide |
| **Fix propus** | Adaugă un flag `entry.live._pending = true` setat înainte de push, cleared la finalul `_executeLiveEntry()`. În `onPriceUpdate()`, skip poziții cu `_pending === true`. Alternativ: `await _executeLiveEntry()` înainte de push (dar schimbă flow-ul). |
| **LOC** | ~5 linii (flag set + flag clear + guard in onPriceUpdate) |
| **Verificare** | Test: verifică că `onPriceUpdate` nu procesează o poziție cu `_pending = true`. Adaugă log temporar: dacă vreodată onPriceUpdate vede o poziție fără `slOrderId` setat, loguiește warning. |

---

## FRONT B — AT Persistence Bug

### Simptom
Utilizatorul activează AutoTrade, iese din aplicație (close tab / reload / alt device), la revenire AT apare dezactivat.

### Root Cause Analysis — 3 puncte de eșec

**1. Boot sync path NU merge `AT.enabled` de pe server**
- **Fișier**: `public/js/core/bootstrap.js` liniile 644-649
- **Cod actual** (PATCH2 block):
  ```js
  if (serverSnap.at && typeof AT !== 'undefined') {
    if (typeof serverSnap.at.killTriggered === 'boolean') AT.killTriggered = serverSnap.at.killTriggered;
    if (typeof serverSnap.at.realizedDailyPnL === 'number') AT.realizedDailyPnL = serverSnap.at.realizedDailyPnL;
    if (typeof serverSnap.at.closedTradesToday === 'number') AT.closedTradesToday = serverSnap.at.closedTradesToday;
  }
  ```
- **Problema**: `AT.enabled` și `AT.mode` NU sunt merge-uite din `serverSnap.at`, deși serverul le are (stocate via ZState.save → POST /api/sync/state).
- **Consecință**: Dacă localStorage nu are stare (device nou, cache cleared), `AT.enabled` rămâne `false` (default din events.js:6).

**2. `_modeConfirmed` resetat la boot blochează toggle-ul**
- **Fișier**: `public/js/core/state.js` linia 474
- **Cod**: `AT._modeConfirmed = false;` — setat la restore din localStorage
- **Problemă**: Chiar dacă localStorage restaurează `AT.enabled = true`, `_modeConfirmed = false` blochează funcția `toggleAutoTrade()` (autotrade.js:17-20: "Waiting for server mode confirmation..."). AT e "enabled" dar nu poate fi toggle-uit până la confirmarea modului.

**3. Server-side NU este sursa de adevăr pentru AT enabled**
- **Fișier**: `server/services/serverAT.js` linii 75-120
- **`_persistState()`** salvează: `engineMode`, `seq`, `killActive`, `demoBalance`, `stats`, etc. — dar NU `AT.enabled`
- **`_applyStateBlob()`** restaurează din SQLite — nu are câmp `AT.enabled`
- **Fișier**: `server/routes/sync.js` — stochează blob JSON trimis de client, inclusiv `at.enabled`, dar e plain pass-through, serverul nu validează/impune starea AT

### Flow complet al bug-ului:

```
1. User activează AT → AT.enabled=true
2. ZState.save() → POST /api/sync/state → server stochează {at:{enabled:true,...}} în JSON
3. User închide tab → syncBeacon() trimite {at:{enabled:true,...}} 
4. User redeschide tab:
   a. events.js: AT.enabled = false (default)
   b. state.js:471: ZState.restore() → AT.enabled = !!localStorage.at.enabled
      - Dacă localStorage există: AT.enabled = true ✓
      - Dacă device nou / cache cleared: AT.enabled = false ✗
   c. state.js:474: AT._modeConfirmed = false (blochează toggle)
   d. bootstrap.js:220: if (AT.enabled && !AT.killTriggered) → resume AT din localStorage
   e. bootstrap.js:590-660: pullFromServer() → serverSnap are {at:{enabled:true}}
   f. bootstrap.js:644-649: PATCH2 merge DOAR killTriggered, realizedDailyPnL, closedTradesToday
      ❌ AT.enabled NU e merge-uit din serverSnap
      ❌ AT.mode NU e merge-uit din serverSnap
5. Rezultat: AT rămâne dezactivat (din default sau din localStorage vechi)
```

### Plan de remediere AT Persistence — în 3 pași

#### Pas B1: Boot sync — merge `AT.enabled` + `AT.mode` din server (Quick Fix)
| Câmp | Detaliu |
|------|---------|
| **Fișier** | `public/js/core/bootstrap.js` linia ~649 (PATCH2 block) |
| **Acțiune** | Adaugă merge pentru `AT.enabled` și `AT.mode` din `serverSnap.at`, cu aceeași logică de freshness guard ca restul (server ts > local ts sau local empty) |
| **Cod conceptual** | `if (typeof serverSnap.at.enabled === 'boolean') AT.enabled = serverSnap.at.enabled;` + `if (serverSnap.at.mode) AT.mode = serverSnap.at.mode;` |
| **Guard** | Doar dacă `_bootFresh === true` (server e mai nou sau local e gol) — nu suprascrie dacă local e dirty |
| **LOC** | ~4 linii |
| **Efect** | Rezolvă 80% din cazuri: device nou, cache cleared, reload normal |

#### Pas B2: Mode confirmation la boot — deblochează toggle
| Câmp | Detaliu |
|------|---------|
| **Fișier** | `public/js/core/bootstrap.js` — după blocul PATCH2 |
| **Acțiune** | După merge din server, dacă `AT.enabled === true`, setează `AT._modeConfirmed = true` (serverul a confirmat deja modul prin sync state) |
| **Guard** | Doar dacă `serverSnap.at.mode` coincide cu `AT.mode` (consistency check) |
| **LOC** | ~3 linii |
| **Efect** | Deblochează toggle-ul AT după boot sync, elimină "waiting for confirmation" |

#### Pas B3: Resume AT scan interval dacă enabled din server
| Câmp | Detaliu |
|------|---------|
| **Fișier** | `public/js/core/bootstrap.js` linia ~220 (resume block) |
| **Acțiune** | Mută sau duplică logica de resume AT DUPĂ boot sync (nu înainte). Actualmente resume-ul e la linia 220, dar boot sync e la 590+. Dacă AT.enabled vine doar din server (B1), resume-ul trebuie re-evaluat după sync. |
| **Opțiuni** | (a) Adaugă un al doilea resume check după PATCH2 block, sau (b) Mută resume-ul într-un callback post-sync |
| **LOC** | ~10 linii (callback post-sync cu UI update) |
| **Efect** | AT resume funcționează corect pe orice device/sesiune |

### Pas B4 (viitor, nu acum): Server-authoritative AT state
> Acest pas e complex și NU trebuie făcut împreună cu P0-urile. E work de v1.4.
- `serverAT.js`: `_persistState()` include `atEnabled: true/false` per user
- API endpoint nou: `GET /api/at/state` → returnează `{enabled, mode, killTriggered}`
- Frontend la boot: pull AT state din endpoint dedicat, nu din sync blob
- Single source of truth: serverul decide dacă AT e pe sau nu
- Eliminate localStorage ca sursă primară

---

## VERDICT C — Ordine de execuție

### Prioritatea 1: Safety (Faci PRIMA DATĂ)
```
A1 (cancel loop)  → 1 linie → risc maxim (SL orphan pe exchange)
A2 (telegram crash) → 6 linii → risc maxim (all orders blocked)
A3 (fallthrough)   → 1 linie → risc mare (TP pe poziție zombie)
```
**Ordine**: A1 → A2 → A3 (cele mai simple, cel mai mare impact)

### Prioritatea 2: Race condition
```
A4 (pending flag)  → 5 linii → risc mediu (race window scurt dar real)
```
**Ordine**: A4 după A1-A3 (puțin mai complex, necesită test atent)

### Prioritatea 3: AT Persistence
```
B1 (boot merge)    → 4 linii
B2 (mode confirm)  → 3 linii
B3 (resume post-sync) → 10 linii
```
**Ordine**: B1 → B2 → B3 (fiecare pas e independent testabil)

### CE NU ATINGI ACUM
- B4 (server-authoritative AT) — v1.4
- Audit P1/P2 findings — separate sprint
- Refactoring serverAT.js — nu acum
- Test suite updates — doar după patches

### Estimare totală linii modificate: ~30 LOC
### Fișiere afectate: 4
1. `server/services/serverAT.js` (A1, A3, A4)
2. `server/services/riskGuard.js` (A2)
3. `public/js/core/bootstrap.js` (B1, B2, B3)
4. `public/js/trading/autotrade.js` (posibil B3 — resume callback)

### Test plan post-patch
1. `node test-preflight.js` → 55/55
2. `node test-p6-live.js` → 99/99
3. [Manual] Activează AT → close tab → reopen → AT trebuie ON
4. [Manual] Activează AT → clear localStorage → reload → AT trebuie ON (din server)
5. [Manual] Kill Telegram bot → declanșează dailyLoss → orderele NU trebuie blocate
6. [Manual] Deschide poziție live demo → trigger exit → verifică 2 cancel orders în logs

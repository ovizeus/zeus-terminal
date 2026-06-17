# Spec — ML-DSL Autonom („DSL Drive")
**Data:** 2026-06-17 · **Autor:** Claude (Opus 4.8) cu operatorul · **Status:** DESIGN (aprobat verbal, în review) · **Clasă:** money-path (high-sensitivity)

> Brain decide INTRĂRILE; ML învață să CONDUCĂ DSL-ul (stop dinamic) pe poziții deschise, mutând pivoții în timp real ca să păstreze cel mai mult profit pe winneri și cea mai mică pierdere pe loseri. Vizibil live în cutia OMEGA „DSL Drive". Roll-out staged shadow → control testnet → real, cu dublă plasă de siguranță.

---

## 1. Problema & motivația (dovedit 2026-06-17, read-only)
Engine testnet (21z, 269 trade): WR 50.7% **dar payoff 0.56** (avgWin +36.94 / avgLoss −66.19), expectancy −13.86/trade, total −1857.
- closeReason: **HIT_SL 23 = −3203**, DSL_PL 93 = +1520, EXTERNAL +118, 120× ENTRY_FAILED (margin/leverage testnet).
- **100% din trade folosesc preset-ul DSL `fast`** (cel mai strâns: pivotLeft 0.50% / pivotRight 0.40%), deși maparea pe regim (`serverRegimeParams.js`) cere TREND→`swing`, BREAKOUT→`def`, VOLATILE→`atr`. Adaptivul pe regim NU se aplică → winnerii tăiați scurt.
- F1 (excursion-based, `_min/_maxPrice`): winnerii lasă **>½ din MFE pe masă**; break-even pe loseri = inutil (loserii merg direct împotrivă). **Pârghia = trail adaptiv** (lasă winnerii să curgă), nu protecție de loseri.

**Concluzie:** un trail STATIC e fundamental greșit (taie winnerii sau riscă loserii). Soluția = trail ADAPTIV în timp real, condus de ML care citește piața — exact viziunea operatorului.

## 2. Context tehnic existent (pe ce construim — NU de la zero)
- **Motorul DSL** (`server/services/serverDSL.js`, 3 faze): Activare (după +`openDslPct`%) → Pivot Tracking (PR urmărește prețul live, PL = stop trailing, exit pe PL-hit) → Impuls (când PR≥IV → ratchet: PL se strânge monoton, PR/IV noi). `tick(posId, price)` → `{currentSL, plExit, changed, phase}`. Apelat din `serverAT.js:3214`.
- **Preseturi** (`DSL_PRESETS`): fast/tp/def/atr/swing — params ficși.
- **Calea de intrare LIVE:** `serverBrain._computeFusion` (serverBrain.js:2193) decide; `serverAT` deschide; `dslModeAtOpen` la serverAT.js:1480 (`stc.dslMode`).
- **Infra ML existentă:** ringuri R0–R7 (`server/services/ml/`), `R5A_learning`, `serverKNN.js`, `serverReflection.js`, zeci de tabele `ml_*`. **Ring5 deja rulează în „influence mode" cu poartă SHADOW** (`ML_PIPELINE_SHADOW`) + `mlLiveOptin.js` (opt-in la control live) + modificatori `_mods.*` aplicați pe confidence. Pattern-ul shadow→influență→live-optin EXISTĂ — îl reutilizăm.
- **Tracker P&L:** `scripts/pnl-testnet-track.js` (read-only) — măsoară payoff/WR/P&L per mode/side/tier → va fi GATE-ul de promovare.
- **Date per trade:** `at_closed.data` are `_minPrice`/`_maxPrice` (MFE/MAE), `dslParams`, `dslProgress`, qty, slPct, side, closePnl, closeReason → suficient pt reward + replay offline.

## 3. Obiectiv & metrică de succes
- **Reward ML:** maximizează profitul prins (% din MFE banit pe winneri) ȘI minimizează pierderea (exit la cea mai mică pierdere pe loseri), măsurat ca **avantaj vs DSL-ul baseline** pe același trade.
- **Succes (gate spre real):** pe fereastra testnet, ML-DSL bate baseline-ul la **payoff ≥ ~1.0 ȘI expectancy pozitivă** (tracker-ul confirmă). NU „1-2 zile n-a crăpat".

## 4. Arhitectura
Brain (intrări + feeder) → ML policy (conduce DSL) → motor DSL (chassis) → safety (dublă plasă) → cutia OMEGA (observabilitate). Manual „take control" detașează ML (doar AT; manualul neatins).

## 5. Componente (izolate, interfețe clare, testabile)
1. **`mlDslPolicy.decide(features) → { plPct, prPct, ivPct, action, reason }`** (pur, TDD).
   - `features`: side, entry, price, MFE/MAE-până-acum, momentum (ROC/RSI slope), ATR/vol regime, regime, timpInTrade, pivoții curenți, progress.
   - `action` ∈ {TIGHTEN, LOOSEN, HOLD, BREATHER, EXIT} (etichetă pt cutie + audit).
   - Determinist dat fiind features (învățarea ajustează parametri interni, nu introduce nedeterminism la decizie).
2. **`mlDslLearner`** — pe fiecare trade închis: `learn(trajectory, outcome, baselineOutcome)`. Recompensă = avantaj vs baseline (P&L realizat + % MFE captat − penalizare pe pierdere). Reutilizează infra ML (R5A_learning / serverKNN / Ring5). Persistă în tabel `ml_*` dedicat (additiv).
3. **`dslSafety.clamp(proposed, pos) → safeParams`** — **dubla plasă, fail-closed**: (a) PL niciodată mai larg ca `originalSL`; (b) kill-switch la `maxLossPct` (forțează EXIT). Monoton-tighten păstrat (există deja). Breather permis DOAR în interiorul podelei. Dacă features lipsesc/ML eșuează → degradare la DSL-ul determinist (NU la „fără stop").
4. **Integrare în `serverDSL.tick` / `serverAT`** — minim invaziv:
   - **Shadow:** policy rulează în paralel, output logat + emis la cutie; DSL real (preseturi) conduce stopul. Counterfactual logat.
   - **Control:** params ML → calculul pivoților din `tick`, prin `dslSafety.clamp`. În spatele unui flag per-user (`mlDslOptin`, ca `mlLiveOptin`).
5. **Cutia OMEGA „DSL Drive"** — panou care listează pozițiile active (orice exchange/mod), fiecare live: entry, preț, PL/PR/IV (animate „piston"), acțiune ML + reason, % din MFE captat, baseline-vs-ML, mod (SHADOW/LIVE). DOM-driven; animație pe **timer JS** (NU keyframe CSS pe poziție — lecție DAIMON).

## 6. Flux de date
`tick(posId, price)` → adună `features` → `mlDslPolicy.decide` → `dslSafety.clamp` → [SHADOW: log + emit la cutie, NU aplică | CONTROL: aplică params în `tick`] → la close: `mlDslLearner.learn(traiectorie, rezultat, baseline)` + emit final la cutie. Telemetrie în `ml_*` + audit.

## 7. Staging & promovare (gate-uri)
1. **F-shadow (1-2 zile testnet):** ML propune, nu conduce. Cutia activă. Învață. Zero risc.
2. **F-control-testnet:** flip `mlDslOptin` (staged, ca flip-urile noastre: un flag, reload). ML conduce pe testnet în garduri. Tracker-ul măsoară A/B vs baseline.
3. **F-real:** DOAR după ce ML bate baseline la payoff≥1.0 + expectancy pozitivă pe testnet (dovadă rulată, GO operator). Flip staged.
4. **End-state (timp):** ML preia comanda extinsă; brain → influență/feeder. Decizie separată, alt spec.

## 8. Siguranță & fail-closed (defense-in-depth)
- **Dubla plasă** mereu activă, indiferent de ML/shadow/control: (a) SL-ul de intrare = podea dură; (b) max-loss% kill-switch.
- **Degradare grațioasă:** ML eșuează/stale/features lipsă → revine la DSL-ul determinist existent (fail-safe), NU la „fără protecție".
- **Manual „take control"** detașează ML instant (AT). Manualul neatins.
- **Niciodată** ML nu lărgește stopul peste podea; monoton-tighten păstrat.

## 9. Testare (TDD obligatoriu — regula noastră)
- Unit (vitest/jest): `mlDslPolicy.decide` (determinist pe features), `dslSafety.clamp` (NU trece niciodată podelele, fail-closed pe input corupt), reward calc.
- **Replay offline** pe `_min/_maxPrice` + (unde se poate) klines istorice: estimează Δpayoff ML vs baseline ÎNAINTE de orice control live.
- Regresie completă pe suitele existente (DSL, AT, brain) — verde, zero regresie.
- **NU rula jest full pe VPS-ul viu** (înfometează brain → GLOBAL_HALT) — `--forceExit --runInBand`, redirect în fișier, doar suitele relevante.
- Soak shadow + A/B testnet via tracker înainte de promovare.

## 10. Reguli proiect respectate
- Money-path: **fiecare flip = GO operator** + backup `.bak` + revert (`git revert`/restore + reload). NU deploy orb. NU atins cod în soak window fără GO.
- **Verify 3×** înainte de a greși o dată; dovadă rulată, nu afirmații.
- Fail-closed + defense-in-depth pe money-path (dubla plasă).
- Staged flag flip (shadow→control→real, un flag pe rând).
- Auto-deploy NUMAI pe client-only verde; serverul/brain = GO.
- UI în engleză; conversația română.
- Crash-safety: checkpoint git după fiecare pas verde.

## 11. Out of scope (acum)
- ML preia INTRĂRILE (rămâne brain) — alt spec, end-state.
- Tuningul preseturilor statice (înlocuit de ML adaptiv).
- Curățarea celor 120 ENTRY_FAILED (operațional, separat).

## 12. Riscuri & mitigări
- *ML lărgește prea mult → pierdere mare:* dubla plasă (8) o oprește; replay offline (9) o prinde înainte.
- *ML cut winnerii la fel ca acum:* reward-ul pe % MFE captat + A/B vs baseline măsoară direct; nu promovăm dacă nu bate.
- *Complexitate ML:* reutilizăm infra existentă (Ring5/R5A/KNN), nu rescriem.
- *Nedeterminism:* decizia e deterministă pe features; învățarea ajustează params offline/între trade-uri.

## 13. Livrabil v1 (primul pas concret, după writing-plans)
**DSL Drive shadow:** `mlDslPolicy` + `dslSafety` (TDD) + integrare shadow în `tick` (emit, nu aplică) + cutia OMEGA + replay offline. Zero control live. Apoi promovare staged.

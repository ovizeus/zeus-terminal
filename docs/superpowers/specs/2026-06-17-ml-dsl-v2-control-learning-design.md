# Spec — ML-DSL v2: Control + Învățare („DSL Drive" preia comanda pe testnet)
**Data:** 2026-06-17 · **Autor:** Claude (Opus 4.8) cu operatorul · **Status:** DESIGN (aprobat verbal, în review) · **Clasă:** money-path (high-sensitivity) · **Construiește pe:** v1 SHADOW (`2026-06-17-ml-dsl-dsldrive-v1.md`, livrat+deployat)

> v1 a dovedit pipeline-ul în shadow (policy → safety → cutie). v2 lasă ML-ul să **conducă efectiv** DSL-ul pe poziții TESTNET și să **învețe** din rezultate, măsurat riguros vs baseline. Brain rămâne pe intrări. Real-ul e blocat în spatele unui gate de performanță. Dubla plasă de siguranță rămâne mereu activă.

---

## 1. Scop & success metric
- **Scop:** ML conduce params DSL în timp real pe poziții testnet (prin plasa de siguranță), învață din fiecare trade, și se dovedește superior baseline-ului ÎNAINTE de orice discuție de real.
- **Succes (gate spre real):** pe fereastra A/B forward testnet, cohorta ML bate cohorta baseline la **payoff ≥ ~1.0 ȘI expectancy pozitivă ȘI Δ pozitiv vs baseline** (dovadă rulată, nu „n-a crăpat"). Sub asta → rămâne pe testnet / revert.

## 2. NON-scop (explicit)
- ML preia INTRĂRILE (rămâne brain) — **v3** (end-state, alt spec).
- Brain redus la pură influență/feeder — **v3**.
- Real-money control — blocat după gate-ul §1, flip separat staged.
- Auto-revert pe underperformance — operatorul a ales **alertă + revert manual** (vezi §6).

## 3. Decizii de design (operator, 2026-06-17)
1. **Măsurare = AMBELE** (counterfactual replay pt învățare densă + A/B forward pt gate). Vezi §7.
2. **Learner = reutilizăm** infra ML existentă (Ring5/R5A_learning + serverKNN + bandit Thompson). Vezi §6.
3. **Underperformance cohortă ML = doar ALERTĂ + revert MANUAL** (NU auto-disable). DAR plasa per-poziție (max-loss kill + podea originalSL) rămâne hard + automată indiferent de asta. Vezi §8.

## 4. Arhitectura
```
Brain (intrări) → poziție deschisă
  └─ serverDSL.tick(posId, price)  [la fiecare tick]
       ├─ mod control? (mlDslOptin per-user + flag stage)
       │    ├─ SHADOW         → policy propune, se LOGează (v1, neschimbat)
       │    ├─ TESTNET_CONTROL → cohortă A/B: ML conduce SAU baseline conduce
       │    └─ REAL           → blocat (gate)
       ├─ dacă ML conduce: mlDslPolicy.decide → dslSafety.clamp → params în calculul pivoților
       └─ priceTrace.record(posId, price)   [înregistrează drumul pt counterfactual]
  └─ la close: mlDslLearner.learn(trajectory, outcome, baselineOutcome)
       ├─ baselineOutcome = counterfactualReplay(priceTrace, presetBaseline)
       └─ reward = advantage(outcome, baselineOutcome) → R5A/KNN/bandit update
```

## 5. Mecanismul de control (cum conduce ML)
- **Gate stage** (flag global, staged, un pas pe rând): `ML_DSL_STAGE ∈ {SHADOW, TESTNET_CONTROL, REAL}`. + **`mlDslOptin` per-user** (ca `mlLiveOptin.js`) — controlul ML pornește doar pe useri opt-in.
- În `serverDSL.tick(posId, price)`: dacă stage=TESTNET_CONTROL, poziția e env=TESTNET, user opt-in, **și** cohorta = ML (vezi §7 A/B):
  - construiește features (RSI/MACD/ST momentum + ATR% + regim + MFE/MAE + fază + progres — refolosim `mlDslShadow.buildFeatures` din v1),
  - `mlDslPolicy.decide(features)` → `dslSafety.clamp(proposed, pos)` → params (PL/PR/IV/activare) **înlocuiesc preset-ul static** în calculul pivoților din `tick`.
  - Altfel (SHADOW, cohortă baseline, non-testnet, non-optin, take-control) → preset-ul determinist actual conduce (neschimbat).
- **Monoton-tighten păstrat** (deja în motor). ML poate doar muta în garduri.
- **Degradare grațioasă:** ML eșuează/stale/features lipsă → fallback la preset determinist (fail-safe), niciodată „fără stop".

## 6. Learner-ul (`mlDslLearner`, reutilizează Ring5/R5A + KNN + bandit)
- **Interfață:** `learn(trajectory, outcome, baselineOutcome)` apelat la fiecare close din `_closePosition` (telemetry-mode, erori înghițite, nu afectează closul).
- **trajectory:** secvența de (features, acțiune ML, params aplicați) pe durata poziției (sample throttled, ca v1 1s).
- **reward = avantaj vs baseline** (vezi §7): `r = w1·(pnl_ML − pnl_baseline) + w2·(%MFE_captat) − w3·(penalizare_pierdere)`. Ponderi calibrabile, default documentat în plan.
- **Implementare (NU rescriem):** facade `R5A_learning` + `serverKNN` (vecini pe trade-uri similare după features) + **bandit Thompson** pe „ce set de params (sau ajustare a policy-ului) merge pe acest tip de piață (regim×simbol×fază)". PK runtime per `(user×env×symbol×regime×fază)`, aliniat cu arhitectura ML v2 înghețată existentă.
- **Online între trade-uri** (nu blochează nimic live). Persistă în tabele `ml_dsl_*` **additive** (trajectory, outcome, reward, posterior bandit). RETIRED-not-DELETE.
- **Cum ajustează policy-ul:** learner-ul nu introduce nedeterminism la decizie — `mlDslPolicy.decide` rămâne determinist pe features; learner-ul ajustează **parametrii interni** ai policy-ului (multiplicatori width per regim/fază) între trade-uri, pe baza posteriorului. v2.0 = ajustare conservatoare (bandit alege între câteva seturi de multiplicatori pre-definiți, fail-safe); regresie liberă a params = v2.1 după ce avem date.

## 7. Măsurare = counterfactual + A/B (ambele)
**(a) Counterfactual replay — semnal de învățare DENS (fiecare trade):**
- `priceTrace.record(posId, price)` (throttled, in-memory + persist ușor) înregistrează drumul de preț cât poziția e deschisă.
- La close: `counterfactualReplay(trace, presetBaseline, posMeta)` re-rulează **motorul DSL existent** (`serverDSL` în mod pur, fără efecte) pe ACELAȘI drum de preț cu preset-ul baseline → `pnl_baseline_simulat`. **`presetBaseline` = exact preset-ul/params pe care motorul le-ar fi folosit AZI pentru acea poziție** (status quo: `dslModeAtOpen`/regime→dslMode, în practică `fast`) — NU un preset ales arbitrar. Așa avantajul măsoară fix „ML vs ce facem acum".
- `advantage = pnl_ML_real − pnl_baseline_simulat` → reward pe FIECARE trade ML. (Avantaj: o singură poziție, zero cost de oportunitate, drum identic.)
- *Limită acceptată:* baseline-ul e simulat (model), nu rulat live — de-aia avem și (b).

**(b) A/B forward — dovada pt GATE (decizia de promovare):**
- Splitter determinist: `cohort(posId) = hash(seq) % 2` → jumate poziții testnet pe **ML-LIVE**, jumate pe **BASELINE** (preset). Persistat per poziție (nu se schimbă la mijloc).
- `pnl-testnet-track.js` extins compară cohortele: payoff/expectancy/WR/Δ — ambele REALE pe testnet.
- **Gate de promovare** se ia DOAR din (b) (date reale), counterfactual-ul (a) e doar pt învățare.

## 8. Siguranță & fail-closed (defense-in-depth)
- **Plasa per-poziție = HARD + AUTOMATĂ, mereu** (indiferent de stage/cohortă/learner): `dslSafety` (a) PL niciodată mai larg ca originalSL, (b) max-loss% kill-switch → forțează EXIT. Catastrofa individuală se oprește singură.
- **Underperformance cohortă ML** (payoff ML < baseline pe fereastră rulantă de N trade) → **ALERTĂ** (Telegram + badge roșu în cutie) + log audit. **Operatorul flip-uie manual** stage-ul înapoi la SHADOW. NU auto-disable (alegerea operatorului).
- **Degradare grațioasă:** ML/features eșuează → preset determinist.
- **„Take control"** detașează ML instant (ca v1).
- **Staged flag flip:** SHADOW→TESTNET_CONTROL→REAL, un pas pe rând, reload între ele, backup .bak + revert.

## 9. Observabilitate — cutia DSL Drive extinsă (peste v1)
- **Badge mod per-poziție:** `SHADOW` / `ML-LIVE` / `BASELINE` (cohorta A/B).
- **Tally rulant ML-vs-baseline:** payoff, expectancy, #trade per cohortă — dovada vie, live.
- **Status învățare:** #traiectorii învățate, încredere bandit (posterior), ultima ajustare de params.
- **Alertă vizuală** când ML pierde fața de baseline (te cheamă la revert manual).
- Endpoint extins: `/api/dsldrive/state` adaugă `stage`, `cohort` per poziție + `/api/dsldrive/scoreboard` (tally A/B + status learner).

## 10. Fluxul de date
`tick` → [SHADOW: log (v1) | CONTROL+cohortă ML: decide→clamp→aplică params + priceTrace.record | cohortă BASELINE: preset + priceTrace.record] → close → `counterfactualReplay` → `mlDslLearner.learn(traj, outcome, baselineOutcome)` → persist `ml_dsl_*` + emit scoreboard. Telemetrie + audit pe tot.

## 11. Testare (TDD obligatoriu)
- **Unit (jest, `--forceExit --runInBand`, suite izolate, NU full pe VPS viu):**
  - `mlDslLearner.learn` — reward determinist pe (outcome, baselineOutcome) cunoscute.
  - `counterfactualReplay` — pe drum de preț sintetic + real (`_min/_maxPrice` + klines unde există), preset baseline reproduce un PnL așteptat.
  - reward calc (ponderi, semne, clamp).
  - `cohort(seq)` splitter — determinist, stabil, ~50/50.
  - `dslSafety` în calea de CONTROL (nu doar shadow) — niciodată peste podea.
- **Regresie:** suitele DSL/AT/brain verzi, zero regresie. Invariant cardinal: calea preset/baseline neatinsă când ML nu conduce.
- **Replay offline** (extinde `dsl-replay.js`) ÎNAINTE de orice flip de control.
- **Soak:** SHADOW (verde) → A/B testnet (2-3 săpt) via tracker.

## 12. Reguli proiect respectate
- Money-path: fiecare flip = GO operator + backup .bak + revert + reload. NU deploy orb. NU cod în soak fără GO. Verify 3×, dovadă rulată. Fail-closed + defense-in-depth. Auto-deploy doar client-only verde. UI engleză, conversație română. Crash-safety checkpoint git după fiecare pas verde. NU jest full pe VPS viu. NU join greu pe zeus.db live.

## 13. Riscuri & mitigări
- *ML conduce prost pe testnet:* plasa per-poziție (8) + A/B măsoară real, nu promovăm dacă nu bate; operatorul alertat → revert manual.
- *Counterfactual optimist (baseline simulat):* gate-ul se ia din A/B real (7b), nu din counterfactual.
- *Învățare instabilă:* v2.0 bandit alege între seturi de multiplicatori pre-definiți fail-safe (nu regresie liberă); regresie liberă = v2.1 după date.
- *Complexitate:* reutilizăm Ring5/R5A/KNN, nu rescriem.
- *Drift cohortă A/B (selecție):* split determinist pe hash(seq), stabil per poziție, ~50/50.

## 14. Livrabile v2 (ordine de implementare — detaliat în plan)
1. `priceTrace` (înregistrare drum preț, throttled, persist ușor) + TDD.
2. `counterfactualReplay` (re-sim preset pe drum) + TDD.
3. `mlDslLearner` (reward + wrap R5A/KNN/bandit, tabele `ml_dsl_*`) + TDD.
4. `cohort` splitter A/B + integrare în `tick` (CONTROL aplică params ML pe cohortă ML, prin `dslSafety`) — money-path, gated `ML_DSL_STAGE` + `mlDslOptin`, fallback preset.
5. `pnl-testnet-track.js` extins (compară cohorte) + `/api/dsldrive/scoreboard`.
6. Cutia DSL Drive extinsă (badge mod, tally A/B, status învățare, alertă).
7. Alertă underperformance (Telegram + badge) — manual revert.
8. Replay offline extins (pre-flip evidence).

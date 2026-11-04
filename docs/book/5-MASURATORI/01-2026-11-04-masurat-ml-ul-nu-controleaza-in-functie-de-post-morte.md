<!-- generat din docs/BOOK_OF_ALL.md linia 11162 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔌 2026-11-04 — MĂSURAT: ML-ul nu controlează în funcţie de post-mortem. Bucla e scrisă, pe o ramură nemerge-uită

Întrebarea ta: *cum controlează ML-ul în funcţie de post-mortem, şi dacă DSL-ul merge cu el.* Audit, fără schimbare de comportament.

### Răspunsul scurt

**Post-mortemul există şi învaţă. Controlul nu-l întreabă niciodată.**

| verigă | starea |
|---|---|
| post-mortem la fiecare închidere | ✅ `mlDslLearner.learn()` — avantaj vs. linia de bază, scrie `ml_dsl_outcome` |
| antrenează bandit-ul | ✅ `bandit.update(...)` — **1 apelant** |
| controlul citeşte bandit-ul | ❌ `bandit.sampleArm(...)` — **0 apelanţi** |
| ce controlează de fapt | `mlDslPolicy.decide()` — praguri **deterministe**, hardcodate |

S-au acumulat **92 de celule, 1.770 de observaţii** pe care nimeni nu le citeşte. Bandit-ul a învăţat, printre altele, că `fast` — braţul cel mai folosit, 679 închideri — stă la **0,355**, iar `ml:TIGHTEN` la **0,077**.

Iar `mlDslPolicy` se autodescrie în prima linie: *„v1 DETERMINISTIC… the bootstrap policy the ML learner will later refine."* „Later" n-a venit.

### 🔑 Unde e bucla: scrisă integral, pe ramură

`feat/ml-dsl-v2-control`, commit **b614f271, 18 iunie** — `_resolveDslParams` → `mlDslBandit.sampleArm` → `dslSafety.clamp` → preset. **5 commits; main e cu ~691 înainte.**

**Şi asta explică o notă din octombrie pe care o lăsasem fără cauză.** Comentariul de pe main spune că `dslArm` „nu e atribuit nicăieri, doar citit". Cauza: **scriitorul lui e pe ramura aia.** De aceea cohortul cade mereu pe `shadow` şi braţul mereu pe `dslModeAtOpen` — deci cohortul `shadow` măsoară doar optimismul simulatorului, nu o geometrie alternativă.

Ramura cere şi `mlDslOptin` + `mlDslCohort`, care **nu există pe main**. Tabela `ml_dsl_optin` **există, cu 0 rânduri**: migrarea a ajuns, codul nu.

⚠️ **Reconectarea nu e un cherry-pick** — 691 de commits de divergenţă pe un sistem cu bani. E decizia ta.

### Dacă DSL-ul funcţionează cu el: DA instalaţia, aproape NU acţiunea

Verificat în cod şi pe date. **Merge:** DSL activ din intrare (`initialCap` → `attachActive`), repivotat la ~1s (`applyMlParams`), fail-closed la fiecare pas. `DSL_PL` închide 61 de poziţii pe săptămână, deci instalaţia chiar execută.

**Dar acţiunea distinctivă a ML-ului — tăietura pe reversal — a pornit de 3 ori în TOATĂ istoria:**

| când | simbol | PnL |
|---|---|---|
| 2026-06-26 | SOLUSDT | **−15,25** |
| 2026-08-06 | BTCUSDT | **−52,90** |
| 2026-11-01 | BNBUSDT | **−8,01** |

Trei din trei pe pierdere, **−76,16 cumulat**.

### Şi ieşirea pe care ML-ul o repivotează se degradează monoton

| fereastră | n | PnL mediu `DSL_PL` |
|---|---|---|
| tot istoricul | 397 | **+8,03** |
| 90 zile | 177 | +0,85 |
| 30 zile | 176 | +0,52 |
| **7 zile** | 61 | **−0,99** |

Nu e o săptămână slabă — e o scădere monotonă. Media bună de „tot istoricul" e purtată de tranzacţii mai vechi de 90 de zile.

*(Manual, pe aceleaşi ferestre: 30 zile +48,71 (n=73), 7 zile +8,85 (n=22). **NU e o comparaţie controlată** — tu alegi când închizi, deci selecţia e în favoarea manualului prin construcţie. O pun doar ca ordin de mărime.)*

### ⚠️ Patru corecţii la propriile mele măsurători

1. **`/proc/<pid>/environ` NU arată variabilele încărcate de dotenv.** Am citit de acolo şi am văzut „niciun ML_*" — eram pe punctul să-ţi raportez că flagurile sunt STINSE. `.env` (26 iunie) le are pe toate cinci `true`, inclusiv `ML_DSL_FULL_CONTROL`. **Toate sunt APRINSE.**
2. **`at_closed.closed_at` e TEXT datetime, nu ms.** În SQLite `TEXT >= INTEGER` e **mereu adevărat**, deci „ultimele 7 zile" îmi întorcea **tot istoricul** — a patra oară în două zile cu acelaşi tipar (`ts` vs `created_at` vs `closed_at`).
3. Din asta, am crezut o clipă că rândurile `DSL_ML_CUT` au data coruptă (`1970-01-01`). Nu: `closed_at/1000` pe un text dă 2.
4. Presetele `atr`/`def`/`swing`/`tp` par identice în posterior nu pentru că ar fi la fel — **sunt real diferite, 0,35 → 1,00** — ci pentru că presetele largi **nu se activează** pe majoritatea urmelor. Deci „câştigă 0,92" înseamnă „n-au tăiat, iar ieşirea reală tăiase un câştigător", nu „geometria largă e mai bună".

### Ce nu am atins

Niciun flag, nicio ramură, nicio decizie. Singura schimbare: un comentariu în `serverAT.js` care notează **cauza** orfanilor `dslArm`/`dslCohort`, ca să n-o mai redescopere nimeni.

### Ce rămâne al tău

| | |
|---|---|
| reconectarea buclei | merge `feat/ml-dsl-v2-control` (691 commits divergenţă, module lipsă) sau rescrie `sampleArm` pe main |
| `fast` la 0,355 | bandit-ul o ştie de luni de zile; politica determinstă îl alege în continuare |
| tăietura pe reversal | 3/3 pe pierdere — de recalibrat pragul sau de stins |

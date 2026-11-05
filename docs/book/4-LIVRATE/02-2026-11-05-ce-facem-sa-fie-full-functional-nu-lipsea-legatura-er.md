<!-- generat din docs/BOOK_OF_ALL.md linia 11239 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔧 2026-11-05 — „Ce facem să fie full functional": nu lipsea legătura, era stricată RECOMPENSA (b378 v1.7.352)

M-ai întrebat ce facem să fie full functional. Răspunsul **nu** e să legăm `sampleArm` la control — dacă o făceam acum, controlul ar fi optimizat pe **recompense corupte**. Două buguri, amândouă reparate azi, **cât e gratis**: bandit-ul n-are cititori, deci schimbarea nu atinge nicio tranzacţie.

### Bugul 1 — poluare: două fluxuri cu semn opus în aceeaşi celulă

Pe **aceeaşi** poziţie se scriu două rânduri:

| cohortă | outcome | baseline |
|---|---|---|
| `shadow` | PnL **realizat** | sim(presetul care a rulat) |
| `shadow_geom` | sim(preset) | PnL **realizat** |

Pentru presetul care a rulat, sunt **oglinzi exacte** — măsurat pe date vii: `advantage` **−0,15** vs **+0,15** pe acelaşi `pos_id`. Şi amândouă chemau `bandit.update` sub **acelaşi nume de braţ**:

| arm | cohortă | n | avantaj |
|---|---|---|---|
| `fast` | shadow | **422** | **−0,066** |
| `fast` | shadow_geom | 144 | **+0,0351** |

Fluxul negativ domina 3:1 → `fast` ajungea la **0,294**, iar `atr`/`swing`/`tp`, care primeau numai shadow_geom, stăteau la 0,854. **Clasamentul braţelor era un artefact.**

Reparat cu o listă explicită `TRAINING_COHORTS`, **fail-closed**: o cohortă necunoscută **nu** antrenează. `shadow` continuă să se scrie — măsoară optimismul simulatorului, care e util — doar nu mai antrenează, exact cum `lossside` trimitea deja `arm: null`.

### Bugul 2 — saturare: `win` binar faţă de o bază comună

Chiar curăţat, bandit-ul **tot** nu putea învăţa geometria. `win = advantage > 0`, iar baza e PnL-ul realizat, **comună tuturor presetelor** — şi toate o bat, **142 din 146 pe fiecare braţ**. Deci `win` iese 1 pentru toate, şi toate cinci ajungeau la **0,966 identic**.

Designul lui `dslGeomShadow` era **corect**: baza comună se anulează la scădere, deci `advantage(A) − advantage(B) = sim(A) − sim(B)`. Dar **codificarea binară arunca exact diferenţele pe care se baza.**

Reparat cu `relWin` — pe o urmă, braţul cu cel mai mare PnL simulat ia punctul. ⚠️ **La egalitate perfectă nimeni nu ia punctul**: cu presete largi care nu se activează egalitatea e frecventă, iar dacă primul din obiect ar lua punctul, bandit-ul ar învăţa **ordinea cheilor din `DSL_PRESETS`**. Coloana `win` **rămâne** `advantage > 0`, ca cele 2.299 de rânduri vechi să rămână comparabile.

### Ce spun datele, odată curăţate

Arm-vs-arm, pe **aceeaşi** poziţie:

| arm | vs `fast` | câştigă |
|---|---|---|
| `tp` | −0,0047 | 4 / 146 |
| `def` | −0,0152 | **0 / 146** |
| `swing` / `atr` | −0,0165 | **0 / 146** |

**`fast` e cel mai bun — exact invers decât spunea posteriorul poluat** — şi setarea ta e deja aia. Medianele confirmă ordinea (0,0097 vs 0,0088), deci nu e artefact de minoritate: verificarea pe care codul însuşi o cere.

**Dar diferenţa e 0,0165 pp — neglijabilă.** Alegerea presetului nu e acolo unde sunt banii.

### 🩸 Unde E semnalul

Cohortul `mlctl` compară calea ML **tick-cu-tick** cu un preset static:

| acţiune dominantă | câştigă | n |
|---|---|---|
| `ml:LOOSEN` | **3** | 173 |
| `ml:TIGHTEN` | 12 | 142 |
| `ml:HOLD` | 5 | 46 |

**Controlul ML tick-cu-tick pierde consecvent faţă de a lăsa presetul în pace.** Asta e ce merită atenţie, nu alegerea braţului.

### O corecţie la mine, prinsă de un test VECHI

Lista mea de cohorte omitea **`ml`** — cohorta în care bandit-ul îşi alege singur braţul, pe ramura nemerge-uită. `tests/unit/mlDslLearner.test.js` o folosea şi a picat. **Testul avea dreptate, lista mea era incompletă** — adăugată, fiindcă atunci când bucla se închide alea sunt exact rândurile care trebuie să antreneze.

### Dovada

**22 de teste noi, 6 din 6 mutaţii omorâte.** Suita: **10.339 verzi** pe 4 sharduri, 3 sărite, zero eşuate.

### Ce rămâne — în ordine

| pas | starea |
|---|---|
| 1. recompensa curată | ✅ livrat; colectarea curată începe la primul reload |
| 2. **resetarea posteriorului poluat** | 🙋 **decizia ta** — altfel datele curate se adună peste prioruri corupte şi durează ~1.770 de observaţii să se spele |
| 3. legarea `sampleArm` la control | după ce 2 produce un clasament; dar datele spun că presetul contează 0,0165 pp |
| 4. politica tick-cu-tick | aici e semnalul: `ml:LOOSEN` 3/173 |

⏳ **b376, b377, b378 nu sunt live** — aşteaptă un reload.

---

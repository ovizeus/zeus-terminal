<!-- generat din docs/BOOK_OF_ALL.md linia 10968 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🧠 2026-11-04 — Avea răspunsul în casă şi vorbea pe lângă (b373 v1.7.347)

Mi-ai cerut să mă uit **întâi** şi să-ţi spun ce lipseşte. Lista a mers cu dovada pentru fiecare punct, şi ai ales tot. Patru lucruri mari, două mărunte, şi **două corecţii la mine**.

### Ce am măsurat înainte să ating nimic

Din ~400 de tabele, am filtrat după un singur criteriu: **ce are date vii şi OMEGA nu le vede**.

| ce am găsit | dovada | verdict |
|---|---|---|
| `ml_r1_violations` | 67.568 rânduri, 65 azi, mod `advisory` | **lipsa cea mai mare** |
| `regime_history` | 5.000, viu la 18:47 | de adăugat |
| `ml_dsl_outcome` | 2.299, viu la 14:40 | de adăugat |
| `ml_thinking_traces` | 295.106 rânduri | **aruncat** — un singur tip de pas, 91,6% `SKIPPED` |

Ultimul rând contează la fel de mult ca primele: suna cel mai promiţător şi **nu valora nimic**. Filtrarea e jumătate din muncă.

### 1. Constituţia — şi e întrebarea ta din 1 noiembrie

`NO_OPPOSITE_ENTRY_ON_OPEN`, severitate **`hard`**, mod **`advisory`**: 54.555 încălcări ale userului 1, din 18 mai până azi. **Regula care interzice cartea mixtă există şi se măsoară de şase luni.** M-ai întrebat de ce ai LONG şi SHORT deschise; OMEGA avea 54.555 de însemnări despre exact asta şi **zero referinţe** la ele în toate 12 fişierele lui.

Adevărul care conteaza nu e numărul, e **modul**:

> `in the last 24h: opposite-side entry while same-symbol open x65 hard · 54555 on record since the rule went in · mode is advisory — every one of these was logged and the entry went through anyway; nothing was blocked.`

Fără propoziţia finală, „54.555 încălcări" ar suna ca **54.555 opriri** — exact greşeala de la `influenceStatus`, unde `ACTIVE` însemna „n-a rulat niciodată". Comutatorul rămâne al tău; nu l-am atins.

### 2. Starea în timp — nu lipsea scriitorul, lipsea cititorul

Starea lui e scrisă de şase luni în `ml_voice_log.mood`: **58.658 rânduri în 7 zile**. Răspundea doar despre clipa asta.

⚠️ **Capcana e forma datelor.** În *aceeaşi secundă* apar mai multe stări, câte una per rostire — deci „sunt nervos de trei zile" **nu se poate afirma**. Amestecul se poate. Şi comparaţia se face pe **cote**, nu pe numere brute: ziua în curs e parţială, deci pe brut orice dimineaţă pare mai liniştită decât ziua de ieri întreagă, din simplul motiv că are mai puţine ore în ea. Testul apără exact asta.

> `last 24h: calm 58%, focused 31%, nervous 9%, excited 2% — less calm than the day before (19pp).`

Şi am scos `sad 0%`: 8 rostiri din 7.583: **un zero care sună ca o măsurătoare**.

### 3. O singură masă de intenţii

Erau **două** lanţuri de ~27 de regexuri ţinute în acord **cu mâna**. Driftul se prindea cu un test care compara *textul* celor două funcţii — adică **după** ce se întâmpla — şi fiecare intenţie nouă trebuia scrisă de două ori.

**Şi chiar erau despărţite:** `market` e declarat în `LLM_PREFERRED_INTENTS`, dar **numai calea cu flux îl respecta**. Pe cealaltă, aceeaşi întrebare primea mereu şablonul.

Acum ambele citesc o masă unică. Ordinea e explicită şi probată (intenţiile cu simbol bat simbolul gol, cele de piaţă bat simbolul), iar preferinţa se aplică pe **nume**, nu pe un literal scris de mână în fiecare ramură. **Zero `if (text.match(`** rămase.

### 4. Deschiderile

Din 24 de şabloane, **unul** se termina cu semn de întrebare — cel de la înjurături. De-asta suna a terminal.

Cinci deschideri, alese din **textul răspunsului**, nu din `ctx`. Deliberat: `ctx` e mai bogat pe calea cu flux, deci o deschidere care s-ar uita în el ar **reintrodus exact driftul** pe care masa l-a scos.

> `feeling nervous. 3 losses back to back. last 24h: calm 58%… want to know what is driving it?`
> `influence: NEVER APPLIED — 20160 evaluations… want to know what would have to change to unlock it?`

### 🙋 Şi răspunsul la „de ce nu e inteligent la cât e de mare"

Bucla de reflecţie: **288 rulări în 24h, 14.373 decizii, 11 module, `total_insights = 0` pe toate.** `ml_reflection_insights` are **0 rânduri** — niciun scriitor, nicăieri.

**Nu e stricată. E înfometată.** Singura analiză rămasă cere ipoteze din `ml_hypothesis_registry`, iar registrul are **o singură ipoteză din toată istoria**: `ISO-1`, pentru **user_id 9112**, din 18 mai 09:37 — rând de semănat, din acelaşi lot cu `ml_veto_log` şi `ml_human_overrides`, toate cu 1 rând la acelaşi minut. Atribuirile tale sunt toate **user 1**. Interogarea întoarce gol **mereu**. Iar `registerHypothesis` **nu are niciun apelant**.

**Consumator fără producător** — aceeaşi clasă ca „71 din 157 câmpuri citite n-au scriitor" (b294). Să-i construiesc un producător e o funcţie de învăţare nouă pe o cale nedovedită: **decizia ta**, nu o iau singur.

### Două corecţii la mine

1. **O gardă care nu păzea nimic.** `typeof x !== 'number'` lângă `Number.isFinite`, justificată cu capcana `Number(null) === 0`. Capcana e reală — dar la **`isFinite` global**. Mutaţia a supravieţuit şi **am scos codul**, nu am adăugat un test care să-l acopere.
2. **O mutaţie supravieţuitoare mi-a arătat că testasem lipitorul, nu selectorul.** Acoperisem `_appendOpening` (pur) şi deloc `_withOpening` (care *decide*). Zece teste în plus.

### ⚠️ A patra oară în două zile

`grep -A1` mi-a tăiat răspunsul **multi-linie** al deciziilor, şi părea trunchiat **de cod**. L-am verificat înainte să-l raportez. Tot aşa: `require('services/database')` într-un script de probă **porneşte tot serverul** — cronuri, migrări. L-am oprit în 2 minute, serverul a rămas la 1149 reporniri, zero artefacte. **Pentru probe: conexiune proprie `readonly`, niciodată modulul.**

### Dovada

**51 de teste noi** pe trei fişiere. **7 din 7 mutaţii omorâte** pe masă şi pe deschideri. Suita: **10.265 verzi** pe 4 sharduri, 3 sărite, zero eşuate.

Două teste vechi **rescrise cinstit**: cereau duplicarea între lanţuri, ceea ce era corect pentru arhitectura de atunci. Acum apără invariantul nou — **să nu existe un al doilea loc**.

### Ce rămâne al tău

| | |
|---|---|
| `R1_ENFORCEMENT_MODE=blocking` | opreşte cartea mixtă în loc s-o noteze |
| producător de ipoteze | deschide bucla de reflecţie; funcţie nouă, cale nedovedită |
| ~207 rânduri orfane din octombrie | re-extragerea lor = 207 apeluri LLM |
| poarta ML, flipul `CLIENT_AT`, 7 chei localStorage | nemişcate din 1 noiembrie |

---

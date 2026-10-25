<!-- generat din docs/BOOK_OF_ALL.md linia 6805 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🏁 2026-10-24 — GĂSIT: desenul întreba seria de lumânări ŞTEARSĂ (b311 v1.7.285)

Operatorul a trimis o **captură**. În două secunde a dat ce cinci runde de citit cod nu
au dat:

- butonul de trendline **galben** → armarea merge;
- mesajul centrat, cel introdus la b310: **„Could not read the price there — tap on the
  candles"**.

`coordinateToPrice` întoarce `null` într-un **singur** caz: seria întrebată **nu are
date** (`firstValue()` e null). Dar lumânările se vedeau pe ecran. Deci aliasul folosit
de desen arăta spre **altă serie decât cea care desenează**.

### Cauza

`_zCSeries` — aliasul citit de `drawingTools` — e scris în **exact două locuri**,
amândouă în `chartBridge` (`registerChart` şi `unregisterChart`).

Iar `applyCandleType` **schimbă seria de lumânări**:

```js
_removeOldSeries()        // w.mainChart.removeSeries(w.cSeries); w.cSeries = null
const series = _buildSeries(type)
w.cSeries = series        // ← şi atât. `_zCSeries` rămâne pe seria ŞTEARSĂ.
```

Şi partea care face totul să se lege: tipul salvat se **re-aplică la BOOT**
(`stores/settingsStore.ts:184` şi `core/config.ts:2206` cheamă `applyCandleType(ct,
{persist:false})`). Deci pentru cine şi-a ales alt tip de lumânare decât cel implicit,
**desenul era rupt din secunda în care pornea aplicaţia, de fiecare dată**. În captură
se vede că avea un tip selectat.

**Asta explică de ce niciuna dintre cele cinci runde anterioare nu a ajutat.** Toate
reparau lucruri reale — armarea, panoramarea, tragerea, filtrul de tap, ciotul de chart,
prinderea la capete — dar pe un drum care oricum se termina într-o serie moartă.

### Fixul e pe clasă, nu pe instanţă

Puntea devine **singurul proprietar** al aliasurilor, prin `setCandleSeries(series)`,
care schimbă deodată `w.cSeries`, `w._zCSeries` şi `_refs.candle`. Toate cele trei
locuri care schimbau seria trec acum pe acolo: `candleTypeSwitcher` la ştergere şi la
reconstrucţie, şi calea de rezervă din `marketDataChart`.

`null` e acceptat în timpul schimbului: între ştergere şi reconstrucţie chiar nu există
serie, şi e mai cinstit decât un alias care arată spre un obiect mort.

### Verificare

4 teste noi, scrise înainte; **al treilea a reprodus bugul direct** — după
`applyCandleType`, `_zCSeries` rămânea seria veche în timp ce `cSeries` era cea nouă.
Mutaţie: 3 mutanţi ţintiţi — puntea uită iar aliasul; schimbătorul scrie iar direct pe
`cSeries`; `refs.candle` nu mai e actualizat — **toţi morţi**. 147 de fişiere,
**1240 teste** verzi, `tsc` curat. În bundle-ul servit:
`function af(e){let t=window;t.cSeries=e,t._zCSeries=e,ef&&(ef.candle=e)}`.

### R-V-15 (regulă nouă)

**Un alias către un obiect viu trebuie să aibă un singur proprietar, iar cine
înlocuieşte obiectul trece pe la el.** `w.cSeries` şi `w._zCSeries` arătau spre acelaşi
obiect şi erau scrise de module diferite; al treilea modul l-a înlocuit şi a actualizat
doar unul. Nimic nu a crăpat — aliasul rămas arăta spre un obiect valid sintactic, doar
mort semantic, şi a răspuns `null` la orice întrebare.

Simptomul la suprafaţă („nu pot desena") nu avea nicio legătură vizibilă cu cauza
(„s-a schimbat tipul de lumânare"), iar cele două sunt despărţite de un boot. De-aia
cinci runde de citit codul desenului n-aveau cum să o găsească: **cauza nu era în codul
care eşua.**

### Şi lecţia de proces, a doua oară în aceeaşi zi

La b310 am scris: *la un simptom de UI, întreabă din prima ce se VEDE*. Aici a mers mai
departe: **o captură a bătut cinci runde de analiză.** Iar ce a făcut captura utilă a
fost mesajul pe care îl adăugasem la b309/b310 — adică investiţia în „fiecare cale de
eşec spune de ce" s-a plătit la prima folosire.

Ordinea corectă, pentru data viitoare: **fă întâi eşecurile să vorbească, apoi cere o
captură.** Nu invers, şi în niciun caz cinci runde de dedus.

### ✅ CONFIRMAT DE OPERATOR (2026-10-24)

*„merge gata"* — desenul funcţionează pe telefon. Dosarul b306→b311 se închide.

Bilanţul cinstit al celor şase runde: **cinci cauze reale reparate care NU erau cauza
lui**, şi una care era. Toate cinci meritau reparate — armarea desincronizată, starea
armată fără indicaţie vizuală, trendline-ul de lungime zero, panoramarea care fura
gestul, filtrul care arunca atingerile atente, ciotul de chart care se dădea drept
chart, punctul care cădea în spaţiul gol — dar niciuna nu era ce îl bloca pe el.

Ce a rezolvat: **o captură**, citibilă doar pentru că adăugasem mesajele de eşec cu două
runde înainte. Şi asta rămâne lecţia, nu bugul: *fă întâi eşecurile să vorbească, apoi
cere o captură* — [[R-V-14]], [[R-V-15]].

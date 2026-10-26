<!-- generat din docs/BOOK_OF_ALL.md linia 6626 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔬 2026-10-24 — PROBA, şi cauza care a tăcut trei runde (b309 v1.7.283)

Operatorul: *„pur si simplu apas pe dunga sa o pun si nu face nimic intekegi probeaza tu"*.

Două lucruri în propoziţia asta. **„Apăs pe dungă"** — butonul de linie orizontală
chiar e desenat ca o dungă (`&#9473;` = ━), deci el apasă **butonul**, nu chartul. Şi
**„probează tu"** — pe bună dreptate, după trei runde de reparaturi pe citit.

### Am făcut proba care lipsea

Recunoscusem gaura chiar eu, la b308: *nimic nu testează gesturile cap-coadă, fiindcă
`drawingTools.ts` e un IIFE care cere un chart viu*. Aşa că am făcut-o — nu pot intra
în aplicaţie cu contul lui, fiindcă nu fabric sesiuni, dar pot porni **modulul real
prin puntea reală** cu un chart fals şi să apăs:

| gest | rezultat |
|---|---|
| apăs butonul | unealta se armează şi o anunţă |
| atingere pe chart | dunga se pune |
| atingere **atentă**, peste 300 ms | dunga se pune (fixul de la b308) |
| clic de mouse | dunga se pune |
| tragere cu mouse-ul | trendline-ul se pune (fixul de la b307) |

Deci **gestul nu era problema.** Trei runde am reparat gesturi, şi gesturile
funcţionează. Asta a mutat căutarea exact unde trebuia.

### Cauza reală: un ciot care se dă drept chart

`unregisterChart()` nu pune `null` pe globale — pune un `_noopStub`, ca vechiul JS să
nu crape în timpul demontării:

```js
const _noopStub: any = new Proxy(function () {}, { get(_t, prop) { ... } })
```

Un `Proxy` peste o **funcţie** este **truthy**. Iar `_activate` verifica exact asta:

```js
if (!_series()) { _toast('Chart not ready'); return; }
```

Cu ciotul, verificarea **trece**. `createPriceLine` întoarce `undefined`. Linia se
adaugă în `_lines` fără nimic desenat. Şi **nu apare nicio eroare**. Adică literal
„apăs şi nu face nimic".

Asta nu se putea găsi citind gesturile, fiindcă nu e un bug de gest: e o verificare de
pregătire care răspunde „gata" unui obiect care nu desenează nimic. Pregătirea se cere
de acum de la **punte**, prin `isChartReady()`. Regresie pinuită: după
`unregisterChart()` nu se mai desenează **şi se spune de ce**; după re-înregistrare
desenul merge iar.

### Tăcerea, care a costat cele trei runde

Fiecare cale de eşec era sau complet mută, sau anunţată printr-un toast de **12px**,
lipit **jos-dreapta**, care dispărea în **1,2 secunde**. El intră de pe telefon. Nu a
văzut niciodată vreun motiv — deci nici eu.

Şi de la b306 era mai rău: o apăsare pe buton cu modulul nelegat nu făcea **nimic**,
nici măcar nu aprindea butonul, fiindcă făcusem starea React oglinda modulului.

Modul nou `ui/drawNotice.ts`: mesaj centrat, 14px, 3,2 s, deasupra a tot
(`app.css` nu trece de 10000), `pointer-events: none` ca să nu fure atingerile de pe
chart. **Stă separat de `drawingTools.ts` dinadins**: când motivul eşecului e chiar că
modulul de desen nu s-a încărcat, mesajul trebuie să vină de altundeva — altfel tace
exact în cazul în care contează cel mai mult.

### Un test al meu a fost decor — prins la mutaţie

Numărasem apelurile la `addLineSeries` ca dovadă că tragerea pune trendline-ul. Dar
**previzualizarea** foloseşte tot `addLineSeries`, deci numărătoarea trecea şi când
trendline-ul nu se mai punea. Mutantul pe `mouseup` a **supravieţuit**.

Exact ce spune **R-V-11**: când un mutant supravieţuieşte, bănuieşte **întâi testul**.
Refăcut ca să deosebească seria reală de previzualizare (culoarea semi-transparentă),
şi acum mutantul moare.

### Verificare

10 teste pe anunţ + 7 pe proba cap-coadă. Mutaţie pe probă: 3 mutanţi ţintiţi —
pregătirea revine la „truthy"; filtrul de tap se aplică iar; tragerea cu mouse-ul
dispare — **toţi morţi** după ce am reparat testul decorativ. 146 de fişiere,
**1228 teste** verzi, `tsc` curat. În bundle-ul servit: ambele mesaje, elementul de
anunţ, centrarea.

### R-V-14 (regulă nouă)

**Un obiect-ciot pus ca să prevină crash-uri face orice verificare de tip „e truthy?"
să mintă.** Dacă un modul înlocuieşte o dependenţă cu un `noop` în loc de `null`, atunci
singura întrebare validă nu e „există?", ci „e **funcţională**?" — şi răspunsul trebuie
cerut de la cel care ştie (aici, `isChartReady()` al punţii), nu dedus din prezenţă.

Corolar, plătit cu trei runde: **o cale de eşec mută costă mai mult decât bugul.** Dacă
o acţiune a utilizatorului se poate opri, trebuie să spună de ce, acolo unde se vede —
pe telefon, nu într-un toast de 12px în colţ.

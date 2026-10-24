<!-- generat din docs/BOOK_OF_ALL.md linia 5216 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔍 2026-10-19 noaptea — AUDIT DE CHART cerut de operator: două bug-uri reale, reparate (b285 v1.7.259)

> *„acum eu ma culc, cauta in toata treaba de la chart indicatori tot ce e chart, vezi daca gasesti ceva
> buguri; daca sunt mai multe si nu le poti repara trece-le in book, daca le repari tot trece ce ai facut"*

### 🔴 BUG 1 — opt indicatori se băteau pe culoarea lumânărilor

**Opt** indicatori recolorează lumânările, și fiecare scria **necondiționat** peste celălalt:
METIS, APOLLO, MENTOR, KRONOS, MORPHEUS, HARMONIA, TERMINATOR și PULSAR. **Zero gărzi.** Câștiga ultimul
din dispecer, tăcut.

**HARMONIA e cazul extrem:** colorează **fiecare** bară într-un curcubeu, deci le masca pe toate celelalte
complet. Cu HARMONIA aprinsă, TERMINATOR ar fi părut stricat — exact plângerea pe care ai mai avut-o o
dată, *„nu bate culorile"*.

**Reparat cu un proprietar explicit.** Ultimul indicator **aprins** ia culoarea; ceilalți își păstrează
liniile și marcajele; și ți se **spune** printr-un mesaj cine a pierdut-o, în loc să rămână o surpriză.

Trei detalii care contează:
- **De ce „ultimul aprins" și nu o prioritate fixă:** o ordine fixă ar fi arbitrară. Asta e singura regulă
  pe care o poți prezice din ce ai făcut chiar tu.
- **La boot** indicatorii se restaurează *fără* să treacă prin buton, deci primul care cere revendică locul
  — altfel garda n-ar avea niciun efect după un refresh.
- **La stingere, doar proprietarul** dă lumânările înapoi. Altfel un indicator care nici nu colora ștergea
  culoarea celui care o deține, iar ea revenea abia la următorul tick — pâlpâit inutil.

### 🔴 BUG 2 — al meu, de azi: valorile unui simbol ajungeau pe barele altuia

Jurnalele panourilor de flux (HECATE, THANATOS, AION, NOTOS) erau cheiate **doar pe id-ul indicatorului**
și nu se goleau niciodată. Treceai de pe BTC pe ETH cu HECATE aprins și vedeai **presiunea cărții de ordine
a BTC-ului așezată pe barele ETH-ului**. La schimbarea de timeframe era și mai rău: intrările ștampilate pe
bare de 5m se amestecau între bare de 1h și stricau chiar alinierea reparată cu o oră înainte.

Cheia include acum **simbolul și timeframe-ul**, deci o schimbare pornește un jurnal nou de la sine, iar
întoarcerea la simbolul dinainte îl regăsește pe al lui — ceea ce e corect: acele valori chiar au fost ale
lui.

### ✅ Verificat și CURAT — scris ca să nu se recontroleze degeaba

| ce am verificat | rezultat |
|---|---|
| 95 de rotițe de setări vs `IND_SETTINGS` | **0** rotițe care promit setări inexistente |
| 98 de indicatori vs cazurile din comutator | **0** fără caz propriu (clasa TERMINATOR) |
| 43 de panouri vs lista de sincronizare | **43/43**, niciunul lipsă, niciunul în plus |
| 43 de containere vs `<div>`-urile din pagină | **0** fără div |
| id-uri duplicate în pagină / cazuri / chei / glifuri | **0** peste tot |
| funcții `update*` care adaugă serii fără să le scoată | **0** (fără scurgeri de memorie) |
| marcaje puse direct pe seria de lumânări | **0** (deci niciun conflict de marcaje) |

### ⚠️ Un fals pozitiv, scris ca să nu mă mai păcălească

Șase indicatori lipsesc din dispecerul pe bară: **ema, wma, st, cvd, macd, vwap**. Arată ca un bug —
„nu se reactualizează la bară nouă". **Nu e:** sunt serii deținute de chart, iar comutatorul doar le arată
și le ascunde; datele le pune chiar randarea chartului.

Am verificat înainte de a-l declara bug, pentru că **un grep prea îngust m-a dus deja de două ori azi** la
o concluzie greșită.

**19 teste noi, șase mutanți omorâți.** Client **1053 teste / 129 fișiere** (de la 1034), typecheck 67
neschimbat, build curat.

### 🔴 Și imediat după: fixul meu de acum o oră stătea în cod mort (b286 v1.7.260)

Continuarea auditului, și cea mai utilă parte din el.

Regula de proprietate asupra culorii lumânărilor, livrată în b285, o pusesem în **`toggleInd`** din
`engine/indicators.ts`. Dar există **două** căi prin care se aprinde un indicator:

| cale | cine o folosește |
|---|---|
| `toggleInd` (`engine/indicators.ts`) | panoul **legacy** |
| `togInd` (`ui/dom2.ts`) | panoul **React** — ăsta e cel pe care îl apeși tu |

Deci regula „ultimul aprins câștigă" și mesajul către tine **nu se executau niciodată**. Fixul parțial tot
funcționa — `_mayTint` revendică locul la prima cerere, deci conflictul se rezolva — dar determinist după
**ordinea din dispecer**, nu după ce ai apăsat tu, și fără să-ți spună nimic.

**E exact clasa de bug TERMINATOR:** o schimbare care trăiește într-o listă pe care nimeni nu o deschide.
A treia oară când arhitectura asta cu două liste paralele mușcă.

### Cum am găsit-o — și de ce contează metoda

Nu din citit cod. Am căutat **șirul mesajului în bundle-ul servit** și **nu era acolo** — deși era în sursă,
și deși bundle-ul era mai nou decât fișierul (20:44:31 față de 20:42:54). Singura explicație: funcția
fusese eliminată la build ca **nefolosită**.

> **Lecție, pentru data viitoare:** sursa spune ce ai scris, bundle-ul spune ce rulează. Când un fix pare
> livrat dar nu se vede, caută-l în fișierul servit. Dacă lipsește, nu e o problemă de randare — e cod mort.

**Reparat:** logica scoasă într-un `noteCandleTintToggle` exportat, chemat din **ambele** căi. Confirmat
pe bundle: șirul apare acum în fișierul servit.

Client **1053 teste / 129 fișiere**, typecheck 67 neschimbat, build curat.

---

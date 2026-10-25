<!-- generat din docs/BOOK_OF_ALL.md linia 2300 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🎨 2026-10-16 — RAPORTAT DE OPERATOR: „TERMINATOR nu bate culorile corespunzătoare"

A treia oară când raportează ceva la culorile TERMINATOR (b260 „dispar la refresh" — cauza reală era
că **toate** salvările erau respinse; b261 „se resetează la schimbarea timeframe-ului"). De data asta
spune că **nu se potrivesc**, nu că lipsesc. **Diagnostic terminat; reparația urmează.**

### Fapt stabilit: pe setarea LUI, TERMINATOR nu colorează deloc lumânările
```
uid 1 (el) : chartType = heikin      (actualizat azi 18:02:44)
uid 2      : chartType = candles
```
`indicators.ts:4314` aplică tint-ul **doar** pentru `candles | hollow | bars`, excluzând explicit
heikin, cu motivul scris în cod: *„data is Heikin-Ashi transformed, not raw klines"*.
Și `candleTypeSwitcher._applyLatestBar` ramifică pe tip: pentru `heikin` recalculează întreaga serie
HA și **nu ajunge niciodată** la ramura care aplică tint-ul.

**Deci pe Heikin Ashi: linia și marcajele TERMINATOR sunt verde/mov, dar lumânările rămân cu
culorile normale.** Pe `candles` se potrivesc toate. Asta e singura diferență reală de comportament
între cele două tipuri și explică exact formularea lui.

### 🔍 Două ipoteze proprii, verificate și RESPINSE (notate ca să nu le reia nimeni)
1. **„Setările oferă culori pe care renderer-ul le ignoră."** NU. `state.ts:1918` dă terminatorului
   doar `{ period: 10, mult: 3 }` — nicio culoare. Culorile sunt constante hardcodate
   (`TERMINATOR_UP = '#05E17F'`, `TERMINATOR_DN = '#E547FC'`).
2. **„Garda citește calea greșită, deci nu detectează heikin."** Părea tare: valoarea e stocată
   **plat** (`$.chartType`), iar garda citește **imbricat** (`USER_SETTINGS.chart.candleType`). Dar
   `config.ts:1831` chiar mapează plat → imbricat la hidratare. Garda vede corect `heikin`.
3. **„Tick-ul viu colorează ultima lumânare, deci una iese din rând."** NU — ramura `heikin` din
   `_applyLatestBar` iese înainte de codul de tint. Eram pe punctul de a raporta un bug inexistent.

### ⚠️ Ce NU e încă stabilit
„Nu bat culorile" admite mai multe citiri. Am eliminat trei; cea rămasă — *lumânările nu se colorează
pe heikin* — e singura susținută de cod și de setarea lui reală, **dar nu i-am cerut confirmarea**.
Dacă el vede altceva (de ex. verde unde ar trebui mov), e alt drum.

### ✅ REPARAT ȘI LIVRAT (bundle `index-M8NRyFwi.js`, FĂRĂ reload)
Tint și pe Heikin Ashi, aplicat **după** transformare — trendul e per-bară și aliniat pe index, deci
aceleași culori merg pe barele pe care chart-ul chiar le afișează. Acoperă ambele căi: randarea în
masă (`indicators.ts`) **și** tick-ul viu (`candleTypeSwitcher`, care re-setează seria întreagă la
fiecare tick, deci avea nevoie de **tot** vectorul de trend, nu de o singură culoare).

**Un ciclu de import pe care l-am făcut și l-am desfăcut:** prima variantă punea transformarea HA în
`candleTypeSwitcher` și o importa din `indicators`, care la rândul lui importa constantele de culoare
înapoi — `indicators → candleTypeSwitcher → indicators`. ES modules tolerează ciclul, dar constantele
ar fi fost `undefined` la inițializare, adică **exact culori lipsă**, ironic. Mutată în
`indicatorCalc`, neutru, importat de ambele. Un test afirmă acum că switcher-ul **nu** importă din
`indicators`, ca ciclul să nu revină.

**Și o singură implementare:** copia locală a transformării HA din switcher deleghează acum la cea
din `indicatorCalc`. Două copii ale unei transformări cu care tint-ul trebuie să fie de acord e
fix felul în care culorile ar fi divergat din nou peste câteva luni.

**Typecheck a prins o greșeală a mea pe drum:** 68 în loc de 67, din învelișul rămas după mutare.
Scos; înapoi la baseline.

### 🐛 Un defect în PROPRIUL meu fix, prins înainte să-l vadă el
Prima variantă a căii de tick viu cerea `w._termTrend.length === _ha.length`. Dar când se formează o
lumânare nouă, klines crește cu 1 iar vectorul de trend e încă cel de la randarea anterioară — deci
lungimile diferă **exact în momentul apariției barei**, condiția pică, și **toată seria** ar fi
pierdut tint-ul. O pâlpâire la fiecare bară nouă.

`terminatorTintBars` tolerează deja un vector mai scurt (`trend[i]` e `undefined`, deci bara rămâne
necolorată), ceea ce e fix comportamentul dorit: bara nouă așteaptă randarea următoare, tot ce e
înaintea ei își păstrează culoarea. Condiția e acum `length > 0`. Livrat în `index-C5Xvc6sV.js`.

### 🎓 A ZECEA oară: două teste ale mele treceau pe cod nereparat, din aceeași cauză
Ambele tăiau o **fereastră fixă** din sursă (500 și 700 de caractere) pornind de la începutul ramurii
heikin. Ramura are ~1150 de caractere, iar codul verificat stă spre final — deci fereastra se oprea
**înainte** de linia afirmată. Unul a picat abia când i-am adăugat un comentariu care a împins codul
afară; celălalt trecea senin peste mutație.

Reparate să taie **până la sfârșitul ramurii** (`indexOf('} else if')`), nu la un număr de caractere.
**Un test care se rupe când documentezi codul pe care-l testează e un test care pedepsește
comportamentul corect** — iar unul care nu ajunge la linia afirmată nu testează nimic.

### 🪞 ȘI CEALALTĂ JUMĂTATE A PERECHII — pe care o ratasem
Tint-ul pe Heikin Ashi era doar jumătate din treabă. `removeTerminatorSeries()` redă lumânările
re-setându-le **fără** câmpuri de culoare — dar făcea asta **doar** pentru `candles|hollow|bars`,
exact aceeași excludere care a produs reclamația inițială.

Deci după primul meu fix: **stingi TERMINATOR pe Heikin Ashi și culorile rămâneau pe ecran** până la
o randare completă ulterioară. **Am reparat o jumătate a perechii și nu geamăna ei** — fix tiparul pe
care acest Book îl documentează de două zile, călcat de mine la două ore după ce l-am scris.

Reparat: curățenia acoperă acum și heikin, prin **aceeași** transformare partajată (niciodată o a
doua copie), și curăță și `_termTrend`. **Mutație:** scot ramura heikin din curățenie → 2 teste pică.

**Client 911/911**, typecheck **67**, bundle `index-BjJoKbHZ.js`, zero reload-uri de server.

**Mutație (fixul principal):** pun la loc excluderea heikin → pică. Pun la loc condiția strictă → pică. **Client 906/906 (124 fișiere)**,
typecheck **67**, bundle parsează, site 302, **zero reload-uri de server**.

### ▶️ Reparația propusă
Tint și pe Heikin Ashi. Trendul TERMINATOR e un vector per-bară aliniat pe index cu klines, deci se
poate aplica peste barele HA **după** transformare — nu peste klines brute, ceea ce era motivul
original al excluderii. Atinge `indicators.ts` (tint masiv) și `candleTypeSwitcher` (ramura heikin),
ambele doar prezentare, zero logică de tranzacționare. **Client-only → rebuild, fără reload.**

---

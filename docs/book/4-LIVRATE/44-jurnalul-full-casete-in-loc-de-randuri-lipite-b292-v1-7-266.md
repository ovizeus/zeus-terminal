<!-- generat din docs/BOOK_OF_ALL.md linia 5791 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🎨 Jurnalul full — casete în loc de rânduri lipite (b292 v1.7.266)

Cererea ta: *„scrisul de la full jurnal de jos din autotrade să-l faci mai casetă, să se vadă mai bine."*

Linkul **Full journal** din `AutoTradePanel.tsx:334` duce la `/journal.html`. Ce era acolo: **15 coloane la
12 px**, cu `white-space: nowrap`, rândurile despărțite de o linie de **1 px** pe fundal întunecat — ochiul
nu avea de ce să se prindă și rândurile curgeau unul în altul. Pe telefon era mai rău: media query-ul
existent **cobora** scrisul la 11 px și strângea padding-ul, adică mergea exact invers.

### Ce am făcut

**Pe desktop** fiecare tranzacție e o casetă: `border-spacing` face spațiu **real** între rânduri (de-aia
`separate` în loc de `collapse`), fiecare rând are fundal propriu și colțuri rotunjite la capete, scrisul a
crescut la **13 px**, iar **simbolul și PnL-ul** sunt scoase în față — alea se caută primele.

**Pe telefon** tabelul se preface în casete adevărate, cu eticheta la stânga și valoarea la dreapta, capul
de tabel dispare, nu mai există derulare pe orizontală, și scrisul **crește** la 13 px (16 px pentru simbol
și PnL) în loc să scadă.

Etichetele vin din `data-label`, pus pe fiecare celulă în `journal.js`. **Verificat că toate 15 corespund
capetelor de coloană 1 la 1** — altfel pe telefon ai citi valori sub etichete greșite.

**Calea dublă, verificată înainte** *(lecția b286 — „fixul livrat în cod mort")*: există `public/journal.html`
**și** `public/legacy/journal.html`. Am confirmat din `express.static` plus absența oricărei rute mai devreme
că cel viu e `public/journal.html`; iar legacy încarcă oricum **aceleași** `/css/journal.css` și
`/js/journal.js`, deci se îmbunătățește și el.

### 🔴 Bug găsit pe drum — și merită spus cum

Randând pagina în **jsdom** ca să verific casetele, **tabelul ieșea gol**. Prima reacție ar fi fost să dau
vina pe stilul meu. Nu era el.

`fetchJournal` chema `applyFilters()` (care randează tabelul **corect**), apoi `renderStats` și
`renderChart`, toate în același `.then`, cu **un singur `.catch` la capăt**. Dacă randarea graficului arunca
— canvas indisponibil, date ciudate — `.catch` chema `showEmpty()` și **ștergea un tabel care se randase
perfect**. Iar mesajul din consolă zicea **„Fetch error"**, deși datele sosiseră impecabil.

Două daune, și a doua e mai perfidă: pierzi datele **și** ești trimis spre rețea în loc de randare.

**Reparat:** tabelul se randează **primul și neprotejat** (dacă *acela* pică, chiar e o problemă de date și
vrem s-o vedem), iar statisticile și graficul sunt izolate **fiecare cu numele lui** în consolă. Am scos și
al doilea apel `renderChart`, redundant, care randa canvas-ul de două ori. → **R-C-13**.

**4 teste noi** (vitest, încarcă pagina reală în jsdom), **3 mutanți omorâți**, suita de client **1057 de
teste pe 130 de fișiere** verde.

**Fără reload și fără refresh forțat:** sunt fișiere statice, iar serverul le livrează cu
`no-cache, no-store, must-revalidate`, deci o încărcare normală a paginii ia versiunea nouă.
*(Numărul de build intră la următoarea repornire naturală — nu dau o rafală de boot pentru CSS.)*


---

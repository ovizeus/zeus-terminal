<!-- generat din docs/BOOK_OF_ALL.md linia 4857 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🌊 2026-10-19 — CINCI INDICATORI NOI, pe date pe care nimeni nu le citea (b279 v1.7.253)

> *„sa te uiti in lista de indicatori sa vezi ce am sa mai faci 5 diferiti total culori tot frumos etc …
> nu uita de icoane dedicate ca la ceilalti … dar vreau date reale totul wow si bun"*

### Întâi inventarul, apoi proiectarea

Erau **91** de indicatori. 34 clasici, 57 inventați cu nume grecești. Dacă m-aș fi apucat direct de
scris, ți-aș fi dat cinci variații pe ceva ce ai deja. Deci am măsurat ce **citesc** cei 91:

```
referinte in indicatorCalc.ts:   S.bids → 0    S.asks → 0    S.buckets → 0    oiHistory → 0
```

**Toți cei 91 citesc exclusiv OHLCV.** Iar `S.basisRate` (premium-ul perpetualului) se calculează din
iunie 2026 și **nu îl citește nimeni**. Adică Zeus primește carte de ordine, feed de lichidări, open
interest și premium perp — date reale, plătite, vii — și le aruncă.

Acolo stau cei cinci. **Niciunul nu e o variație pe o medie mobilă.**

| indicator | sursa reală | ce întreabă |
|---|---|---|
| **HECATE** 🧱 | cartea de ordine (`S.bids`/`S.asks`) | cât apasă cumpărarea vs vânzarea, pe **patru benzi de distanță**, plus unde sunt zidurile |
| **THANATOS** ☠️ | bucket-urile de lichidări (Bybit+OKX, vii) | se **accelerează** lichidările, și pe care parte |
| **AION** ♾️ | open interest + funding | **cine** e aglomerat: longuri noi, shorturi noi, ieșiri sau acoperiri — plus risc de squeeze |
| **HYPNOS** 🕰️ | marcajele de timp din klines | **când**, nu încotro: profilul volatilității pe oră |
| **NOTOS** 🪁 | mark vs index + funding | cât de scump e perpetualul față de spot, și **când se contrazice cu funding-ul** |

### 🔴 Două bug-uri ale mele, prinse de teste înainte de livrare

**1. HECATE înclina tăcut cartea de ordine.** Benzile se calculau ca `mid * (1 + pct)` și `mid * (1 - pct)`.
Acelea **nu sunt simetrice în virgulă mobilă**: pentru `mid = 100` și `pct = 0,005`, limita de sus iese
`100.49999999999999`, deci un nivel exact la 100,5 cădea **afară**, în timp ce oglinda lui la 99,5 intra.
O carte perfect simetrică raporta presiune **+5,4** în loc de 0. Un indicator de presiune care minte cu
5 puncte pe o carte echilibrată e mai rău decât niciunul. Reparat prin măsurarea distanței **ca raport**.

**2. HYPNOS se autoamortiza, și mințea de-a dreptul la variație zero.** Norma orei includea și bara
curentă, deci un salt de trei ori peste normal se citea ca 2,6. Mai rău: cu deviație standard zero — o oră
care a fost mereu identică — z-score-ul ieșea 0, deci **o oră perfect stabilă care se triplează raporta
`NORMAL`**. Reparat: norma se construiește fără bara curentă, iar în cazul degenerat decide raportul.

Pe amândouă le-au găsit testele, nu ochii mei. Al doilea e exact genul de lucru care ar fi stat ascuns
luni de zile, pentru că panoul ar fi arătat plauzibil.

### Cum am evitat să-ți desenez un trecut inventat

Trei dintre ele (HECATE, THANATOS, NOTOS) descriu **prezentul**: cartea de ordine de acum, ultimul minut
de lichidări, premium-ul de acum. Nu au serie pe bare. Puteam să le „reconstruiesc" un istoric din preț
— ar fi arătat impresionant și ar fi fost fals.

În schimb fiecare **își ține propriul jurnal în memorie**, alimentat de tick-urile reale, și desenează
doar ce a văzut efectiv. **Un panou gol la pornire e corect**; unul plin de date fabricate nu ar fi.
Se reactualizează din tick propriu (carte / lichidare / funding), **o dată pe secundă cel mult**, și numai
când indicatorul e aprins — prin **import direct, nu printr-un global**, pentru că `window.toggleFS` a fost
exact genul de punte care nu a existat niciodată și a lăsat o scurtătură moartă luni de zile.

AION și HYPNOS au serie adevărată: `oiHistory` se adună în timp, iar HYPNOS are tot istoricul de bare.

### ✅ Dovada pe date vii — nu doar teste

Rulat chiar acum, pe datele serverului:

```
HYPNOS   500 bare 1h · ora 19 UTC · interval acum 0,163% vs norma OREI 0,383%
         raport 0,426 · z −1,13 → QUIET · 24/24 ore acoperite
         cele mai volatile ore gasite: 14h=0,86%  13h=0,73%  15h=0,70%  (UTC)

NOTOS    mark 81848,4 · index 81886,28 → premium −4,63 bps · funding +1 bps
         aliniat=false → DIVERGENT_CHEAP · combustibil 49

AION     OI 95392,802 → 95392,802 (0%) · pret 0% → QUIET, aglomerat=null
```

**Partea care mi-a plăcut:** nu i-am spus lui HYPNOS nimic despre sesiuni de tranzacționare. A primit
500 de bare și a găsit singur că cele mai volatile ore sunt **13–15 UTC** — adică exact deschiderea
pieței americane. Profilul nu e o presupunere, e măsurat din datele tale.

Și AION a spus corect **QUIET** pe un OI neschimbat în 6 secunde, în loc să inventeze un regim din
zgomot. Zona moartă funcționează.

### Iconițe și integrare

Cinci **glyph-uri SVG dedicate** în `IND_ICONS` — nu emoji, conform regulii: scara cărții de ordine
asimetrică, trepte în cascadă, aglomerare cu evadare, cadran de ceas cu urmă de volatilitate, două șine
cu prima dintre ele. Emoji-ul din listă rămâne doar rezervă, cum e la toți ceilalți.

Cele **trei liste** (`INDICATORS`, `IND_LIST`, `IND_ICONS`) rămân în pas — testul de paritate trece.
Fiecare are intrare în `IND_SETTINGS` cu **exact câmpurile pe care calculul le citește** (`wallRatio`,
`cascadeMult`, `lookback`/`deadzonePct`, `minSamples`, `fairBps`) — lecția TERMINATOR: o rotiță care
deschide un panou fără efect e mai rea decât niciuna.

### Dovezi

**40 de teste noi**, toate picate prima dată. **Zece mutanți omorâți**, acoperind toate cele cinci:

| mutant | ce pică |
|---|---|
| HECATE revine la limitele calculate (asimetria de virgulă mobilă) | 1 test |
| HECATE mediană → medie (zidul se ascunde pe sine) | 1 test |
| THANATOS ignoră pragul de cascadă | 2 teste |
| THANATOS inventează normalitate dintr-un bucket | 1 test |
| AION fără zonă moartă | 1 test |
| AION dă cost de squeeze fără să conteze semnul funding-ului | 1 test |
| HYPNOS include bara curentă în norma ei | 2 teste |
| HYPNOS fără rezervă pe z-score degenerat | 2 teste |
| NOTOS aliniere calculată greșit | 4 teste |
| NOTOS fără bandă de paritate | 1 test |

**Client 967 teste / 126 fișiere** (de la 927 / 125), **typecheck 67 neschimbat**, build curat.
Zero atingeri pe calea de bani sau de ordine.

**Ce rămâne de confirmat de tine:** aprinde-le pe rând din lista de indicatori. HECATE și THANATOS au
nevoie de câteva secunde ca să adune jurnalul — e normal, nu e defect.

### 🔴 Imediat după: THANATOS nu afișa nimic — și nu era „așteaptă date" (b280 v1.7.254)

> *„thanatos trebuie sa astept date sa intre ca nu afiseaza nimic"*

Mi-a fost ușor să zic „da, așteaptă". Am măsurat în loc de asta, și era **defectul meu**.

**Diagnostic, pe feed-ul viu:** de la reload, **7 evenimente de lichidare în 7 minute** — Binance futures
WS e blocat de rețeaua datacenterului din mai (P4), deci livrează doar OKX. Iar panoul se redesena **doar
la sosirea unui eveniment**. Între ele acceleraţia e 0, iar o histogramă de zerouri **nu desenează nimic**.
La deschidere: exact **un punct invizibil**. Nu puteai distinge „merge și e liniște" de „e rupt".

**Și era greșit pe fond, nu doar urât:** ferestrele de 1m/5m/15m **se scurg în timp**, deci valoarea se
schimbă și *fără* evenimente noi. Un panou îngheţat arăta o valoare veche ca fiind actuală.

**AION avea aceeași boală din alt motiv:** se reactualiza numai din dispecerul pe bară — pe un chart de
5m, o dată la cinci minute — în timp ce open interest-ul se schimbă între.

**Reparat cu un puls comun.** `flowPulseTargets()` spune care panouri de flux sunt aprinse; ceasul bate o
secundă și **se oprește singur** când niciunul nu mai e aprins — nu las un interval să bată în gol toată
sesiunea. Un panou care aruncă nu oprește ceasul celorlalte. Tick-urile pe eveniment rămân, cu aceeași
limită de o dată pe secundă, deci cartea de ordine și premium-ul nu devin mai scumpe.

**5 teste noi, doi mutanți omorâți:** pulsul care întoarce mereu toate cele cinci (ceasul nu s-ar mai opri)
→ 3 teste pică; lipsa gărzii pe stare lipsă → 1 test pică. Client **972 teste / 126 fișiere** (de la 967),
typecheck 67 neschimbat.

**Lecția, scrisă ca să nu se repete:** un indicator alimentat de evenimente rare are nevoie de ceas, nu
doar de evenimente — altfel panoul minte prin omisiune. Și dacă operatorul spune „nu afișează nimic",
prima mișcare e să măsor rata sursei, nu să-i explic că trebuie să aștepte.

### 🔴 Și imediat: panourile „se trăgeau în spate" — reparat (b281 v1.7.255)

> *„sa stea in linie cu chartul … se trag in spate vechea problema … gen cum e astrape"*
> *„hypnos e bun dar restul asa sunt facuti sa stea in spate ?"*

**Răspunsul la întrebare, scris ca să fie clar: NU, nu așa erau făcuți. Era defectul meu.**

Observația operatorului — *HYPNOS e bun, ceilalți nu* — a fost chiar cheia diagnosticului.

**Cauza.** `_syncSubChartsToMain` aliniază panourile prin `setVisibleLogicalRange`, adică prin **indici
de bare**. HYPNOS desenează pe timpii **barelor**, pentru că are serie proprie pe bare — deci stătea
perfect. Ceilalți patru își țineau jurnalul pe **secunde de ceas**: un panou cu 30 de puncte primea
intervalul logic al unui chart cu sute de bare, deci datele ajungeau **în afara ferestrei vizibile**,
lipite în extrema stângă. Nu era o nepotrivire de câțiva pixeli — **cele două axe nu aveau nimic în
comun**, deci nu se puteau alinia niciodată.

Capturile arătau exact asta: HECATE cu o singură bară în stânga (dar cu valoarea corectă, 80,93, în
legendă — calculul mergea), NOTOS la fel cu −3,45, THANATOS și AION goale, iar HYPNOS pe toată lățimea.

**Reparat.** O citire se așază în **bara** în care a fost făcută (`flowBucketTime`), iar fiecare panou
emite o linie de ancorare pe **fiecare bară** din chart (`flowAnchorSeries`) — tiparul ATLAS/HYPERION.
Atunci numărul de puncte e identic cu al chartului, intervalul logic înseamnă același lucru în ambele, și
panoul stă fix sub bara lui. Ancora se desenează și când n-a intrat nicio valoare, deci panoul **se vede
că e viu** în loc să pară rupt.

### 🔎 Găsit pe drum: AION compara două ferestre de timp diferite

Înregistrările din `oiHistory` **nu purtau prețul**. Deci AION compara variația de open interest pe 30 de
mostre cu variația de preț de pe **ultimul tick** — două ferestre de timp diferite, adică un regim
raportat greșit, plauzibil și fals. Acum prețul intră în aceeași înregistrare cu OI-ul și se folosesc
**perechi aliniate în timp**, cu întoarcere la capetele reale cât timp înregistrările vechi n-au preț.

**Și o corecție a mea, în aceeași oră:** am spus întâi că *nimeni nu scrie în `oiHistory`*. Fals — scrie
`trackOIDelta` din `services/storage.ts`. Grep-ul meu fusese prea îngust. **A doua oară în campania asta**
când un grep prea îngust mă duce la o concluzie greșită; prima dată a produs „poarta moartă".

**6 teste noi** pe invariantul alinierii, **doi mutanți omorâți**: ancora doar pe ultimele bare, și
întoarcerea bucket-ului la ceasul de perete — adică exact bug-ul raportat. Client **978 teste / 126
fișiere**, typecheck 67 neschimbat.

### 🔴 Și ultima: THANATOS și AION stăteau pe zero — desenau valoarea greșită (b282 v1.7.256)

> *„e ok acum dar thanatos si aion asteapta date de sunt 0 asa-i?"*

Întrebare bună. Am măsurat în loc să răspund „da, așteaptă" — **și nu era normal.**

| panou | ce desena | de ce stătea pe 0 |
|---|---|---|
| THANATOS | **acceleraţia** | pe feed-ul viu e **o lichidare pe minut**, și numai de la OKX de când Binance e blocat → acceleraţia e 0 aproape tot timpul |
| AION | **riscul de squeeze** | e 0 până se aglomerează cineva, iar OI-ul se mișcă **0,009% în 70 de secunde** — sub zona moartă |

Două panouri care stau pe zero aproape mereu **nu sunt panouri, sunt decor** — exact clasa pe care o
vânez la alții. Nu era „așteaptă date", era alegerea mea greșită a mărimii desenate.

**Reparat.** THANATOS desenează acum **fluxul net al minutului, cu semn** — pozitiv când au fost
lichidate longuri, negativ când shorturi — diferit de zero ori de câte ori chiar se lichidează ceva.
AION desenează **variația reală de open interest, cu semn**, care există și sub zona moartă.

**Informația veche nu s-a pierdut, s-a mutat în culoare:** starea de cascadă și regimul colorează barele,
iar riscul de squeeze rămâne în legendă. Valorile se țin **la vârf** în interiorul barei, nu la ultima
citire, ca o rafală de la mijlocul barei să nu fie ștearsă de liniștea de la final.

Zona moartă **rămâne** pentru *eticheta* de regim — zgomotul tot nu are voie să fie numit poziționare —
dar nu mai șterge variația din desen. Distincția asta contează: a numi zgomotul „regim" ar fi o minciună;
a nu-l desena deloc e o omisiune.

**6 teste noi, doi mutanți omorâți:** fluxul net care își pierde semnul (nu mai arată partea lichidată),
și variația de OI pierdută sub zona moartă — adică exact bug-ul raportat. Client **984 teste / 126
fișiere**, typecheck 67 neschimbat.

---

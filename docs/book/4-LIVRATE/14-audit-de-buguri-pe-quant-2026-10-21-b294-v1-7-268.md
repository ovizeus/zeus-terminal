<!-- generat din docs/BOOK_OF_ALL.md linia 6103 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔬 Audit de buguri pe Quant — 2026-10-21 (b294 v1.7.268)

Ai cerut audit pe Quant: *ce merge, ce nu*. Monitorul are **11 fișiere, 2435 de linii**, acoperite înainte
de **6 teste** pe trei fixuri înguste — **ciclul de viață era complet netestat**, și exact acolo era
bug-ul serios.

### 🔴 REPARAT 1 — scurgerea care lovea API-ul la infinit *(singura care atinge banii)*

`init()` e async și așteaptă **8 fetch-uri** înainte de a instala temporizatoarele periodice, iar panoul
îl cheamă fire-and-forget. Dacă închizi panoul **înainte** ca init să termine, `destroy()` rulează primul
și golește lista, apoi init își reia cursul și instalează 8 `setInterval` pe care **nu le mai curăță
nimeni**: `/api/market/*` la 5 s și 10 s, pe termen **nelimitat**.

**Măsurat în test: 12 apeluri pe minut per deschidere scursă, cumulative** la fiecare deschidere rapidă.
Pe un sistem cu istoric documentat de ban-uri de IP Binance, asta nu e o scurgere cosmetică.

**Dovada intenției pierdute:** panoul avea deja `let destroyed = false` și `void destroyed` **după**
`return` — cod inaccesibil, variabilă necitită de nimic. Cineva a vrut garda asta și n-a ajuns niciodată
cablată. Aceeași familie cu b286 *(fixul livrat în cod mort)*.

Reparat cu **jeton de rulare**, nu simplu flag: o a doua deschidere pune flagul pe `false`, iar prima
rulare, încă în await, s-ar crede vie.

### 🔴 REPARAT 2 — 28 de valori se calculau și se aruncau *(cea mai utilă)*

Baleiaj pe **tot repo-ul, 1014 fișiere** (TS de client + legacy JS + public JS + server): **71 din 157**
de câmpuri citite de randare **n-au niciun scriitor**. Portarea din HTML a aliasat *citirile* la
`S._qmFoo`, dar puntea `S.foo → S._qmFoo` a rămas la vreo 20 de câmpuri.

Separarea care conta:

| categorie | câte | ce înseamnă |
|---|---|---|
| **punte neterminată** | **28** | valoarea **există** pe `S`, calculată la fiecare 60 s, și e aruncată |
| **fără nicio sursă** | 43 | funcție neimplementată, nu punte lipsă |

Măsurat pe date vii: **Mayer Multiple real 1,137** (BTC $82.743 / media 200 zile $72.767) în timp ce
panoul afișa **0**. Cele 28 sunt reparate — **tot blocul on-chain e viu acum**: S2F, Mayer, Pi Cycle,
Puell, NUPL, RHODL, regresie logaritmică, faza de ciclu.

### 🔴 REPARAT 3 — două numere alăturate care descriau seturi diferite

Tabelul **REAL LIQUIDATIONS THIS SESSION**: `COUNT` era lungimea unui inel **plafonat la 300**, iar
`TOTAL` acumula la infinit. Deci după 300 de lichidări pe o bursă — ușor într-o oră volatilă — **COUNT
îngheață pe 300** în timp ce totalul urcă. Eticheta zice *sesiune*, deci totalul era cel corect; acum și
numărătoarea e pe sesiune, iar inelul rămâne doar pentru fluxul afișat.

**Plus calendarul macro:** hardcodat cu date din **mai–iulie 2025**, deci filtrul „doar viitorul" nu lasă
niciodată nimic și secțiunea afișa *„No upcoming events in calendar"* **neîntrerupt din august 2025** — un
panou mort care arată ca o perioadă liniștită. Acum spune că e **expirat și de când**. Datele noi le pui
tu; nu inventez un calendar FOMC din memorie.

### 🙋 DOVEDITE și NEREPARATE — intră ca D4, decizia ta

Astea **nu sunt stricate, sunt neterminate**, iar repararea lor schimbă numere pe care le citești de luni.
Fiecare e dovedită, nu bănuită:

**1. Motorul CVD Divergence nu poate semnala NICIODATĂ.** `obBV`/`obAV` sunt **citite în 3 locuri și
scrise în zero** — nimeni nu le populează. Deci istoricul de delta e tot zerouri, iar `dUp` și `dDn` sunt
imposibil să fie `true`. Simulat: preț clar în creștere → verdict `NONE`.

**2. Scorul SMF e blocat pe `NEUT` / 0, permanent.** Toate **cele 5 intrări** sunt moarte
(`_qmAbsorption`, `cumDelta`, `_qmOrderFlowDelta`, `_qmMfi`, `obBV/obAV`) → fiecare contribuie 0,
indiferent de piață.

**3. Încrederea oricărui pattern ARIA e CONSTANTĂ 48%.** `_qmMtfAlignScore` n-are scriitor → cade pe
fallback 50 → `Math.round(35 + 50/4) = 48`, pentru orice pattern, inclusiv în jurnalul `ARIA ... 48%`.

**4. Stiva MTF minte în etichete.** Rândurile scrise **5m … 4h** vin toate din **același** tampon de preț
(200 eșantioane × 500 ms = 100 s în total):

| eticheta | acoperă de fapt |
|---|---|
| 5m | **4 s** |
| 15m | **10 s** |
| 30m | **20 s** |
| 1h | **30 s** |
| 4h | **60 s** |
| 1D | hardcodat **0** (mereu neutru) |

Deci „4 timeframe-uri sunt de acord" e un singur trend scurt, numărat de cinci ori cu netezimi diferite —
de aceea verdictul basculează în bloc.

**5. Risipă:** `runAllEngines` remapează **tot** vectorul de klines la fiecare 500 ms, pentru totdeauna,
fiindcă gardul verifică `klines[0].open` iar remaparea **păstrează** chiar `open`. La 500 de bare:
**1.000 de obiecte pe secundă, 3,6 milioane pe oră**, cât timp panoul e deschis.

**6. O mină inactivă azi:** un `return` în blocul MMTRAP din `calcFLOW` ar tăia **EXHAUST, VOID, STOP și
SMF** în liniște dacă cineva coboară pragul de 30. Azi nu se atinge (am verificat aritmetica), dar stă
acolo.

### ✅ Ce MERGE, ca să nu rămână impresia că totul e rupt

VAC, ICE, FLIP, MMTRAP, EXHAUST, VOID, STOP — toate calculate din preț și klines, **vii**. Wyckoff,
Volume Profile, harta de lichidări cu bucketare pe 0,25%, persistența pe 24 h (filtrează corect la
salvare *și* la încărcare, și recalcula deja totalul ca să rămână onest). Formele evenimentelor OKX se
potrivesc exact cu ce așteaptă harta — verificat câmp cu câmp, nu presupus. Curățarea listener-ilor la
`destroy` era deja corectă (fixul PERF-2).

### 📜 Două reguli noi *(40 în total)*

**R-C-15** — un câmp citit pe care nimeni nu-l scrie nu e „zero", e un panou mort; `|| 0` degradează
politicos, deci arată exact ca o piață liniștită. Numără citirile și scriitorii, și separă **puntea
lipsă** de **funcția neimplementată**.

**R-V-11** — când un mutant supraviețuiește, bănuiește **întâi testul**. Prima rulare de mutație a lăsat
trei mutanți în viață: nu codul era slab, pusesem **două** gărzi iar testele atingeau doar prima. Refăcute
să țintească exact, mutația a arătat apoi că o **a treia** bucată a propriului meu fix era **redundantă**,
și am scos-o. Corolar: în bundle caută **forma de după minificare** — `if (aborted()) return` devine
`r()||(...)`, iar grep-ul naiv raportează fals că garda lipsește.

**18 teste noi, 10 mutanți omorâți**, suita de client **1079 pe 134 de fișiere** verde, `tsc` curat.
Fixurile confirmate **în bundle**. Fără reload pm2 — schimbare doar de client *(R-OP-2)*.

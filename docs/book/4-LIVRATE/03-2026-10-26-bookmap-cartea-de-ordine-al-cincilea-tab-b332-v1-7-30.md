<!-- generat din docs/BOOK_OF_ALL.md linia 9191 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 📙 2026-10-26 — BOOKMAP: cartea de ordine, al cincilea tab (b332 v1.7.306)

**Cerut de el:** *„acum sus lângă predict dacă vrei poţi să faci bookmap… tot aşa date reale ce se poate lua din piaţă, să fie full, să se citească uşor, să arate chartul preţul, să avem zoom, tot ce trebuie… totul funcţional"*.

Era **etapa 2** în carte. Condiţia de pornire pe care o scrisesem era *să judece el harta de lichidări ca bună* — a judecat-o („e bine aşa cum l-ai făcut"), deci am început.

### ⛔ Patru măsurători înainte de prima linie de cod — fiecare a schimbat designul

**1. Cartea care EXISTĂ e lată de 253 de dolari.**
Pe BTC la 80 322, cea mai mare adâncime disponibilă (Binance REST `limit=1000`) acoperă **−0,155% … +0,160%**, 92 M$. OKX cu 400 de niveluri: ±0,07%.

**Nu există pereţi la 1% distanţă.** Nu-s ascunşi, nu-s inaccesibili — **nu există.** I-am spus asta *înainte*, nu după: zoom-ul nu te depărtează de preţ, te duce **mai adânc** în bandă şi **mai departe pe timp**.

**2. Raportul max/median pe nivel e 427×** (median 3 459 $, max 1 478 544 $). Intensitatea trebuie logaritmică, şi scara am ales-o **pe tabel**:

| fracţie din maxim | liniar | 1e3 | **1e4** | 1e5 |
|---|---|---|---|---|
| 1/1 (max) | 1,000 | 1,000 | **1,000** | 1,000 |
| **1/427 (MEDIAN)** | 0,0023 | 0,175 | **0,347** | 0,474 |
| 1/5000 (zgomot) | 0,0002 | 0,026 | **0,119** | 0,264 |
| 1/50000 | 0,00002 | 0,003 | **0,020** | 0,095 |

La 1e3 medianul e 17% ⇒ harta stinsă. La 1e5 zgomotul sare la 26% ⇒ harta pare uniform aglomerată şi pereţii nu mai ies. **1e4.**

**3. OKX dă mărimea în CONTRACTE** (`ctVal` 0,01 BTC). Văzusem 3 016 M$ pe o bandă de ±0,07% — imposibil, şi aşa am prins-o. Aceeaşi capcană ca Gate la lichidări, acelaşi răspuns: **multiplicator necunoscut ⇒ aruncă cadrul.**

**4. Preţul iese din bandă.** Pe 1000 de bare de 1 minut, într-o fereastră de 10 minute preţul depăşeşte chiar şi banda de ±0,16% în **21%** din cazuri pe BTC şi **46%** pe ETH; din ±0,05%, în 90–100%. Deci rândurile **nu pot** fi ancorate pe preţ absolut — lichiditatea ar ieşi din cadru exact când se mişcă ceva.

### Şi de aici a ieşit un defect pe care l-am prins înainte să-l vadă

Cu rândurile ancorate pe mijlocul **fiecărei coloane**, preţul stă prin construcţie la mijloc ⇒ **linia ar fi ieşit dreaptă.** Adică nu un chart — o decoraţie.

**Reparat:** harta rămâne **relativă** (aşa lichiditatea e comparabilă în timp), iar **chartul preţului are banda lui şi scara lui**, deasupra, cu întreruperi acolo unde n-au fost cadre (nu interpolat — ar inventa un preţ care n-a existat). Un test se uită la **punctele desenate** şi cade dacă linia redevine dreaptă.

### Cele două surse sunt ţinute SEPARAT — o minciună subtilă evitată

| | niveluri | bandă |
|---|---|---|
| WS `depth20@100ms` | 40 | ±0,005% |
| REST `limit=1000` | 2000 | ±0,155% |

Amestecate în aceeaşi medie, rândurile de **lângă** preţ ar primi contribuţii din amândouă iar cele **depărtate** numai din REST ⇒ densitatea desenată ar depinde de **proporţia cadrelor**, nu de piaţă. Ar fi apărut un gât îngroşat la mijloc care nu există.

**Harta se desenează NUMAI din REST.** WS alimentează banda de sus (spread, cea mai bună cerere/ofertă), unde e util tocmai fiindcă e rapid.

### Spoofing — a treia capcană notată la amânare

*„Un perete care dispare când preţul se apropie nu e perete."*

Răspunsul care **nu** pretinde că citeşte intenţii: valoarea celulei e **media ponderată cu cadrele, nu maximul**. Un perete fulgerat într-un cadru din 100 contribuie 1% şi nu mai domină harta. Maximul se păstrează separat. Şi un nivel prezent în **sub 25%** din instantanee nu intră în lista de pereţi — iar **fermitatea e pe ecran** lângă fiecare.

### 🔴 O corecţie la mine, repetată de mai multe ori în aceeaşi zi

Spuneam că **„WS-ul de futures Binance e mort către acest VPS"**. **Prea larg.**

Testat serial, câte unul singur pe conexiune:

| flux | rezultat |
|---|---|
| `markPrice@1s` | MUT |
| `aggTrade` | MUT |
| `kline_1m` | MUT |
| `forceOrder` | MUT |
| `!forceOrder@arr` | MUT |
| **`depth20@100ms`** | **CURGE** (135 cadre / 15 s) |

Deci mut e aproape tot, **dar nu carnetul** — şi se nimereşte că singurul flux care merge e exact cel de care Bookmap are nevoie.

### Costul de rată, măsurat înainte

Binance raporta **748 din 2400** greutate/minut cu Zeus în funcţiune (31%). `limit=1000` are greutate 20; la 5 s pe două simboluri = 480/min ⇒ total ~51%. Am loc, dar nu nelimitat, deci **ritmul se încetineşte singur la 20 s** când greutatea raportată trece de 1700. Tot prin `binanceGateway`.

### Ce NU am inclus, şi de ce

**OKX şi Bybit.** Amândouă trimit instantaneu apoi **diferenţe**, deci ar cere o carte locală reconstruită cu verificare de secvenţă şi resincronizare pe gaură. **O carte reconstruită greşit e o hartă care minte.** Prefer o sursă corectă decât trei aproximative. Etapa următoare.

### Greşelile mele

1. **Două teste ale mele s-au înşelat, nu codul:** unul cerea doar să existe *un* `Math.min` pe undeva în rută şi trecea deşi `cols`/`rows` plecau nemărginite; altul căuta `const window` când în cod e `windowMs`, şi cădea pe o rută **corectă**. A cincea şi a şasea oară.
2. **Trei mutaţii mi-au supravieţuit** la prima trecere: garda redundantă de cadru pe jumătate, banda AUTO (testul trecea şi cu bandă fixă), şi excluderea din bandă pe grilă — testele existau doar pe scară, nu pe grilă.
3. **Testul vechi cerea exact patru taburi.** Contractul s-a schimbat fiindcă el a cerut al cincilea — actualizat dinadins, cu motivul scris în test.

### Dovada

**35 de mutaţii noi, toate moarte** — inclusiv multiplicator presupus 1, ce iese din bandă înghesuit la margine, maximul în loc de medie, spoof acceptat ca perete, WS amestecat în hartă, greutate declarată fals, zoom nemărginit şi chartul redevenit dreaptă.

**Server 233 de teste** pe shardurile bookmap+lichidări, **client 161 fişiere / 1 459 teste**, `tsc` 0 erori, build ✓, verificat în bundle-ul servit.

### 🔴 Adăugat după livrare: interogarea adâncă mergea CONTINUU degeaba (b333)

Am măsurat greutatea raportată de Binance la fiecare 10 secunde, în aceeaşi fereastră de minut:

| t | greutate |
|---|---|
| +10s | 268 |
| +20s | 492 |
| +30s | 804 |
| +40s | 1031 |
| +50s | 1255 |

**~1 380/min, adică 57% din plafon** — de la 748 (31%) înainte de Bookmap. Estimasem 51%, deci estimarea mea era şi optimistă **şi incompletă**: interogarea adâncă mergea **continuu din boot**, chiar când nimeni nu avea rubrica deschisă. Taxă curată pe tot Zeus pentru un ecran la care nu se uită nimeni.

**Reparat: ritmul e LA CERERE.** Rapid (5 s) cât timp cineva se uită — ruta anunţă fluxul la fiecare cerere — şi lent (30 s) în rest. Costul de bază scade de la **480/min la 80/min**, adică de la 20% la **3%**.

**Lent nu e OPRIT, dinadins:** fără un istoric minim, prima deschidere ar arăta o hartă goală şi ar părea stricată — exact confuzia care a pornit toată discuţia despre lichidări. Un test cere ca ritmul lent să fie peste cel rapid **dar sub un minut**.

**Ordinea contează: greutatea BATE cererea.** Peste 1700 raportat, ritmul trece la 20 s chiar dacă cineva se uită — mai bine o hartă cu coloane rare decât un ban pe tot Zeus.

**Două teste ale mele au căzut pe schimbarea de structură, nu pe comportament** (unul căuta `DEEP_MS_SLOW` lângă `const next`, logica mutându-se în `_intervalFor`; altul citea doar primii 2200 de caractere din rută). Actualizate, cu motivul scris în ele.

**5 mutaţii noi, toate moarte** — inclusiv bugul chiar măsurat. **40 pe Bookmap în total.**

### 🔴 Adăugat: harta ar fi arătat ca un PIEPTENE la prima deschidere (b334)

Judecata vizuală e a lui. Dar partea **obiectivă** din „să se citească uşor" se poate calcula — şi am calculat-o pe starea reală a serverului.

**Găsit:** la ritm lent (nimeni nu s-a uitat încă) se strâng ~20 de cadre în fereastra de 10 minute, iar clientul cere **110 coloane**.

| cadre | coloane cu date | GOALE |
|---|---|---|
| 20 | 20 | **90 (82%)** |
| 13 | 13 | **97 (88%)** |

Prima deschidere i-ar fi arătat **dungi subţiri cu găuri între ele**. Aceeaşi clasă cu b327 şi cu scara continuă de la b326: *dacă desenezi grila CERUTĂ în loc de cea care încape în date, ascunzi exact ce ai.*

**Reparat:** grila e mărginită la numărul de instantanee (minim 2). Cu 20 de cadre ies **20 de coloane late şi pline**; pe măsură ce se adună, coloanele cresc până la cât s-a cerut.

**Dar o hartă cu 20 de coloane late arată ca una stricată dacă nu se spune de ce** — deci panoul scrie `20/110 columns · filling in`, şi **tace** când grila e completă.

**Lăţimea pe telefon, calculată:** rândul de perete are sub 380px coloanele `26+52+46+1fr+30` cu goluri de 4px = **170px fixi din 296 utili** pe un iPhone SE ⇒ **126px** pentru coloana de dolari. Testul **citeşte** `grid-template-columns` şi `gap` din foaia de stil şi face suma — dacă cineva lăţeşte o coloană sau face dolarii coloană fixă, cade.

**Un test al meu declanşa cazul greşit:** cerea coloane goale cerând *mai multe coloane decât cadre*, ceea ce nu se mai poate. Rescris pe cazul **real** — cadre grupate neuniform, adică fluxul se întrerupe o vreme şi apoi revine.

**5 mutaţii noi moarte. 45 pe Bookmap în total.**

### 🔴🔴 AM RANDAT harta — şi am găsit două buguri pe care nicio aritmetică nu le putea prinde (b335)

Judecata vizuală e a lui. Dar **randarea e a mea.** Fără browser pe VPS (regula lui), am desenat grila în ASCII din **14 instantanee reale**, prin exact acelaşi `bookMap.heat()` care alimentează panoul şi cu aceeaşi scară logaritmică pe care o foloseşte clientul.

**Bug 1: fermitatea afişa `2450%`.**
Numărasem **nivelurile** care contribuie, nu **cadrele** în care palierul a avut ceva. Cu 500 de niveluri pe parte, zeci cad în acelaşi palier ⇒ contorul depăşea numărul de cadre de 24 de ori.
**Testul meu vechi trecea fiindcă folosea UN nivel pe cadru** — adică exact cazul în care bugul nu se vede.

**Bug 2: harta era uniform aprinsă** — 96% din grilă la intensitate între 0,79 şi 1,00.

Şi cauza e o **greşeală de raţionament a mea**: măsurasem raportul max/median **PE NIVEL** (745×) şi potrivisem scara pentru el. Dar o **celulă** de grilă adună ~19 niveluri:

| | max/median |
|---|---|
| pe nivel | **745×** |
| pe celulă, 26 rânduri | **3,0×** |
| pe celulă, 48 rânduri | 6,2× |

**Cifra pe care o calculasem era corectă — doar despre alt obiect.** Nicio aritmetică n-ar fi prins asta; numai privirea.

**Reparat:** grila raportează şi o **referinţă de jos** (percentila 5 a celulelor nenule — nu minimul absolut, care ar face scara să tremure între aduceri), iar intensitatea se normalizează logaritmic între ea şi maxim.

| celule reale | p10 | median | p90 |
|---|---|---|---|
| înainte | 0,79 | 0,88 | 0,97 |
| **după** | **0,25** | **0,50** | **0,70** |

**Randat din nou**, pe BTC şi pe ETH: fermitate **100%** pe toţi pereţii, gradient real de la `.` la `@`, pereţii groşi vizibili la +0,047% şi −0,066%, zona palidă lângă preţ (acolo chiar e puţină lichiditate). **Pe ETH banda AUTO a prins singură ±0,233%**, mai largă decât pe BTC — deci scara nu era potrivită pe un singur simbol.

**O lămurire:** presetările de bandă se opresc la 0,2% fiindcă **atât** acoperă cartea **pe BTC**; pe ETH se întinde până la 0,233%, deci presetarea de 0,2% taie puţin, iar **AUTO** e varianta corectă acolo — şi e şi implicită.

**5 mutaţii noi moarte**, inclusiv bugul original de fermitate. **50 pe Bookmap în total.**

### 🔴 Panoul putea arăta cartea BTC cu eticheta altui simbol (b336)

**Aceeaşi clasă cu tape-ul de la b328 — dar mai rea.**

Cartea de ordine există doar pe **BTCUSDT şi ETHUSDT** (aşa e construit fluxul). Dacă în chart era **SOLUSDT**, ruta cădea **în linişte** pe BTCUSDT, iar panoul scria *„the visible book on SOLUSDT"* peste date BTC.

La tape, cel puţin, se vedeau simboluri străine care te puneau pe gând. **Aici nimic nu arăta străin — doar numere perfect plauzibile.** E cel mai urât fel de minciună posibil în panoul ăsta.

L-am găsit verificând ce se întâmplă pe un simbol care **NU** e în listă, nu pe cel implicit.

**Reparat:**
1. Panoul afişează simbolul pe care **serverul** l-a dat, nu pe cel din chart — şi îl scrie lângă spread.
2. **Şi spune** când nu se potrivesc: *„Order book is available for BTCUSDT and ETHUSDT only — showing BTCUSDT, not the charted SOLUSDT."* Când se potrivesc, **tace** — altfel ar fi zgomot.
3. Nota de jos nu mai pretinde că e cartea simbolului din chart.

**4 teste noi de randare pe simbol nepotrivit, 3 mutaţii moarte** (inclusiv bugul original). **53 pe Bookmap în total.**

Client-only: intră la refresh, fără reload.

### 🧪 Contractul dintre rută şi panou (b337, fără schimbare de comportament)

Nimic nu dovedea că răspunsul rutei conţine exact câmpurile pe care clientul le **citeşte**. O nepotrivire **nu aruncă şi nu apare în loguri** — dă un panou rupt în linişte, adică exact clasa de bug care a costat cel mai mult în sesiunea asta: serviciul PREDICT plecat mort, şi tape-ul care arăta alt simbol decât antetul.

Testul **citeşte sursa clientului**, scoate câmpurile accesate (`heat.*`, `data.*`, `ladder.*`, `wl.*`) şi verifică că formele produse de `heat()`, `aggregate()` şi `walls()` le au pe toate — **inclusiv pe forma goală**, ca panoul să nu crape pe o hartă fără date.

**Un test al meu nu dovedea nimic, şi l-am prins la mutaţie:** căuta cheia în **tot** corpul rutei, deci trecea chiar când o redenumeam pe calea de succes — fiindcă o găsea în ramura de **eroare** (`walls: []`). Acum cele două ramuri se verifică **separat**. Şi ramura de eroare trebuie să trimită aceleaşi chei, altfel panoul citeşte `undefined` exact când serverul are o problemă.

**5 mutaţii moarte** (inclusiv `loUsd` nemai-trimis, `colsAsked` scos, `walls`/`source` redenumite pe calea de succes). **58 pe Bookmap în total.**

### 🔴🔴 PIEPTENELE — văzut în captura LUI (b338)

A deschis tabul şi mi-a trimis o captură: harta avea **nouă benzi de culoare cu goluri negre** între ele, şi **linia preţului ruptă** în bucăţi. Nu se citea.

**Cauza:** la b334 mărginisem coloanele la numărul de instantanee — dar asta repara doar **jumătate**. Cadrele **nu vin la intervale egale**: 31 s când nu se uită nimeni, 5 s cât timp se uită. Deci mai multe cad în aceeaşi coloană şi altele rămân goale.

Reprodus cu intervalele reale: **29 de cadre ⇒ 19 coloane cu date, 10 GOALE (34%)**:
```
##.#.#.##.#.#.#.##.#.#.######
```

**Reparaţia e un adevăr fizic, nu o cosmetizare:** cartea de ordine **nu dispare** între instantanee — doar n-am privit-o. Deci fiecare instantaneu **ţine** până la următorul. După: **29 din 29 de coloane pline**, zero goale, linia preţului neîntreruptă.

**Dar nu la nesfârşit.** O pană reală de flux nu are voie să fie pictată ca date: ţinerea se opreşte după **2,5 intervale tipice** (mediana, ca o pauză să nu tragă media), deci un gol adevărat rămâne gol. Un test cu o gaură de 5 minute o verifică.

**Şi se vede că sunt ţinute:** celulele ţinute se desenează la **72%** din opacitate, iar panoul scrie câte coloane sunt ţinute. Când nu e niciuna, tace. *O celulă ţinută nu e o observaţie nouă, şi diferenţa trebuie să se VADĂ, nu doar să fie scrisă.*

**O neglijenţă a mea, reparată înainte de livrare:** prima variantă împingea în `cells` chiar în timp ce itera peste el — se termina doar fiindcă sărea peste cele marcate, adică se baza pe noroc şi era pătratică. Acum sursa se indexează o dată.

Şi eticheta `PRICE` stătea peste linia preţului şi se citea prost în captură — are acum un fundal minim.

**6 teste noi pe pieptene + 3 de randare, 5 mutaţii moarte. 63 pe Bookmap în total.**

### 📖 „e bine dar nu ştiu să-l citesc" — panoul se explică singur (b339)

El, după ce a deschis tabul. **Şi asta nu e vina lui:** un panou care are nevoie de mine alături nu şi-a făcut treaba.

Bloc **HOW TO READ**, deschis din start, cu cinci rânduri care spun ce **înseamnă** fiecare lucru, nu cum se numeşte:

- **cyan sub preţ** = ordine de cumpărare care aşteaptă ⇒ preţul încetineşte peste ele
- **chihlimbar deasupra** = ordine de vânzare prin care trebuie să mănânce ca să urce
- **mai aprins = mai mulţi bani**; stânga-dreapta e timpul, linia punctată e preţul de acum
- în lista de jos, **fermitatea e cheia**: 100% = nivelul a stat acolo tot timpul; 30% = a licărit şi a dispărut
- **BAND** = cât de departe de preţ te uiţi; **SPAN** = cât de mult înapoi în timp

Se poate închide, şi alegerea se ţine minte — cu gardă pe modul privat (`localStorage` poate arunca).

### 🔴 Un test vechi al Zeus-ului m-a prins

`lsUserScoping` cere ca **orice cheie de localStorage pe user să fie legată de user**. Eu pusesem `zbk.help` nescopată ⇒ **doi useri pe acelaşi telefon şi-ar fi închis explicaţia unul altuia.** Adăugată în `_USER_KEYS`.

Regula există din **10 octombrie** şi a funcţionat exact cum trebuie — a căzut doar în suita completă, nu izolat, şi la prima vedere părea poluare între teste. Nu era.

### ✅ Verificat că totul e activ, cum a cerut

| | |
|---|---|
| flux adânc | **266 apeluri / 1h**, zero erori 4xx/5xx/reţea, latenţă 244 ms |
| ritm | **4,45/min** — lent aproape tot timpul, rapid cât s-a uitat el |
| WS banda de sus | deschis (dovada e **captura lui**: spread 0,10 / 0,01bp vin numai de acolo) |
| rute | toate trei răspund şi cer sesiune |
| lichidări | **19 049 / 466 simboluri** |
| PREDICT | 16 instantanee, **14 rezolvate** |

**8 teste noi, 5 mutaţii moarte. 68 pe Bookmap în total.**

### 🔴 Distanţa se măsura faţă de MEDIA ferestrei, nu faţă de preţul de ACUM (b340)

**Găsit citindu-i captura ca să i-o explic** — adică exact lucrul pe care mi l-a cerut: *„cum citesc asta?"*

Pe ecranul lui: preţul **79 900**, iar în listă un **BID la 79 942 etichetat `−12`**. Dar 79 942 e **deasupra** lui 79 900 — imposibil pentru un ordin de cumpărare care aşteaptă. **Eticheta se bătea cap în cap cu ce vedea.**

**Cauza:** preţul căzuse 93$ în 10 minute iar banda e ±132$, deci media ferestrei (~79 954) era cu 54$ peste preţul de acum. Scara traducea palierele în preţuri absolute folosind media aia.

Când piaţa stă pe loc nu se vede nimic. **Se vede exact când preţul se mişcă — adică exact când te uiţi.**

**Reparat:** palierele **rămân relative** (fiecare cadru faţă de mijlocul LUI, altfel lichiditatea n-ar fi comparabilă în timp), dar traducerea în preţuri **absolute** se face cu **ultimul cadru** — fiindcă ăla e preţul pe care îl vede sus.

Trei teste noi apără proprietăţi care nu se pot încălca: **un BID nu poate ieşi deasupra preţului**, un ASK nu poate ieşi dedesubt, şi semnul distanţei se potriveşte cu partea.

**2 mutaţii moarte** (bugul original + ancora pe primul cadru). **70 pe Bookmap în total.**

---

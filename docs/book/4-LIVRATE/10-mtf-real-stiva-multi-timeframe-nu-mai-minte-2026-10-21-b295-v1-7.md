<!-- generat din docs/BOOK_OF_ALL.md linia 5950 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 📐 MTF REAL — stiva multi-timeframe nu mai minte — 2026-10-21 (b295 v1.7.269)

**Cererea lui:** *„aria e fs?"* — e ARIA fals? Apoi, după răspuns: *„da fa mtf real"*.

**Răspunsul onest a fost: nu, dar două lucruri din el minteau.** Detecția de pattern era și este reală
(Liquidity Sweep, Upthrust, Spring, Absorption, Inside Squeeze — toate din klines adevărate). Citirea
lumânării la fel. Minteau încrederea și orizonturile.

### 🔴 Bug 1 — rândurile scriau ore și măsurau secunde

`_qmAriaMTF` se calcula din `S._qmBuf`, un tampon care primește un preț **la fiecare 500 ms**
(`index.ts`, `startRenderLoop`). Deci:

| scria | măsura de fapt | măsoară acum |
|---|---|---|
| 5m | 4 secunde | **0,5 h** |
| 15m | 10 secunde | **3 h** |
| 30m | 20 secunde | **10 h** |
| 1h | 30 secunde | **30 h** |
| 4h | 60 secunde | **160 h** |
| 1D | hardcodat 0 | **720 h (30 zile)** |

Un operator care citea *„4 din 6 timeframe-uri sunt bull"* vedea în realitate **un singur trend de un
minut, numărat de cinci ori**.

**Reparat** cu un modul nou, `client/src/quantmonitor/engines/mtf.ts`: trei fetch-uri pe simbolul
**curent**, prin proxy-ul cu cache de pe server (5m ×1000, 1h ×1000, 1d ×400), din care derivăm cele
șase rânduri prin agregare pe **găleți aliniate la ceas** — `floor(t/span)`, ca o bară de 15m să înceapă
la :00/:15/:30 ca la bursă, nu la prima bară primită. 15m și 30m din 5m, 4h din 1h.

**Costul:** 3 cereri la 3 minute = **1 pe minut**. Pentru comparație, `basisRate` face deja 12 pe minut,
iar cache-ul serverului ține klines 60 s — o cadență mai rapidă n-ar aduce date mai proaspete, doar
trafic spre Binance pe un sistem cu istoric de banuri de IP.

**Dovada pe date vii (BTCUSDT, 21 oct):** stiva a ieșit `5m: bear, 15m/30m/1h/4h/1D: bull` → scor
**67/100**, verdict `BULL`, încredere **75%**. Un **dezacord între orizonturi** este exact lucrul pe care
varianta din tampon nu-l putea produce niciodată, fiindcă toate rândurile citeau același minut.

### 🔴 Bug 2 — două câmpuri fără scriitor, din care ieșeau două semnale false

`_qmMtfAlignScore` și `_qmMtfAlignDetailed` aveau **trei cititori în `frame.ts` și zero scrieri**. De aici:

- **încrederea ARIA ieșea constant 48%** la orice pattern (`35 + 50/4`, cu `|| 50` din lipsa scriitorului);
- **eticheta STRUCTURE raporta permanent `ALIGNED BEAR`** — `frame.ts:747` numără câte rânduri sunt `1`,
  iar un obiect gol dă `u === 0`, care cădea exact pe ramura bearish. **Un semnal fals, nu un gol.**

Acum scorul e real pe scala 0..100 pe care panoul o randa deja (`ALIGN SCORE x / 100`, bară, praguri
70/40), încrederea acoperă **35..95**, iar STRUCTURE spune **`NO DATA`** când nu are date.

> **Despre formula de încredere:** factorul `/4` al autorului presupunea o scală 0..240 ca să atingă
> plafonul lui de 95. Cu scala 0..100 pe care o cere randarea, `*0,6` dă **exact același interval
> intenționat**, 35..95. Am schimbat factorul, nu intenția — și o spun aici fiindcă schimbă un număr
> pe care îl citești.

### 🔴 Bug 3 — găsit de propriul meu test: o piață plată dădea un trend încrezător

`emaTrend` pe o serie perfect constantă răspundea **`-1`**, nu `0`. Pe o serie de 100-uri cele două medii
*ar trebui* să iasă identice, dar `_ema` acumulează altfel pentru `k` diferiți și virgula mobilă lasă o
diferență de ordinul `1e-14` — din care compararea producea o **direcție încrezătoare pe o piață care nu
se mișcă deloc**. Reparat cu epsilon relativ. → **R-V-12**.

### Onestitate prin construcție

- un rând fără destule bare dă `0` = **necunoscut**, pe care panoul randează `─ ─`; **nu** cade niciodată
  înapoi pe tamponul de secunde;
- **zero surse dă scor 0, nu 100** — lipsa datelor nu e aliniere perfectă;
- verdictul e fail-closed: fără 4 rânduri de acord rămâne `WATCH`;
- la comutarea de simbol, klines-urile vechi sunt **ignorate**, nu citite ca trend al noului simbol
  (aceeași capcană pentru care `marketDataChart` filtrează răspunsurile învechite).

### Verificare

- **37 de teste noi** (25 pure + 12 de cablaj), inclusiv o regresie care cere ca `5m` și `30m` să dea
  semne **diferite** pe aceeași serie — cu valorile verificate numeric *înainte* de a fi scrise în test,
  nu presupuse.
- **Mutație: 13 din 14 omorâți.** Cel supraviețuitor a arătat că propria mea gardă `|| !bars.length` era
  **redundantă** (`aggregateBars` pe gol dă gol, `emaTrend` pe gol dă 0) — scoasă, ca `_runId++` în b294.
- Suita client **1116/136 verde**, `tsc` curat, fixurile confirmate **structural** în bundle
  (`index-Bblm00y_.js`).
- Doar client → **fără reload pm2** (R-OP-2).

---

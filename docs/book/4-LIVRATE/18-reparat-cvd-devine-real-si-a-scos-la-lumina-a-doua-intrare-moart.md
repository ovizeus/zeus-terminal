<!-- generat din docs/BOOK_OF_ALL.md linia 1676 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 📉 REPARAT — CVD devine real, şi a scos la lumină a doua intrare moartă a lui SMF — 2026-10-21 (b303 v1.7.277)

**Client-only → build, fără reload.**

`_qmCumDelta` se afişează ca **CVD** şi avea zero scriitori — randarea arăta mereu `+0.000`.

### Capcana de care m-am ferit

Tentaţia era să-l alimentez din puntea de carte adăugată în b301 (`obBV − obAV`), fiindcă devenise
disponibilă. **Ar fi fost greşit:** CVD înseamnă delta din tranzacţii **executate**, nu
dezechilibrul cărţii de ordine. Ar fi scris „CVD" peste un număr care nu e CVD — exact falsa
onestitate pe care auditul o vâna.

Testul fixează regula explicit: cu o carte puternic pe bid şi tranzacţii care spun invers, **CVD
urmează tranzacţiile.**

### Sursa corectă exista, doar nu era legată

`_onMsg` (orderflow.ts) primeşte fiecare `aggTrade`, îl pune în `RAW_FLOW.buf` cu `isBuyerMaker`, şi
e **punctul unic** prin care trec ambele căi directe. Lipsea acumulatorul — iar suma buffer-ului
**nu** era o alternativă: `_prune` îl taie la 10 secunde, deci ar fi dat o deltă pe fereastră, nu
cumulată.

Semnul vine din **rolul agresorului**, nu din cantitate: `isBuyerMaker = true` înseamnă că
cumpărătorul e maker, deci agresorul e **vânzătorul** → deltă negativă. Inversat, CVD-ul ar arăta
exact pe dos în fiecare trend, aşa că e fixat în test, nu lăsat la memorie.

### Descoperire pe drum, din verificarea în bundle

`cumDelta` apărea de 8 ori, şi una era un **cititor într-un motor de scor**: `flow.ts:105` citeşte
`c.cumDelta` — **fără prefix** — şi îi dă **±15 puncte** scorului SMF. N-avea nici el scriitor.

**Deci SMF avea DOUĂ intrări moarte, nu una:** `obBV`/`obAV` (reparate în b301) şi asta. Acum se
scrie pe ambele nume, deci şi afişajul şi scorul primesc valoarea.

### Şi RSI — cel mai înşelător câmp fără scriitor

`_qmRsi` n-avea scriitor, iar randarea face `S._qmRsi || 50` — deci panoul afişa **constant
`RSI:50.0`**, cu culoarea de neutru. **Mai înşelător decât un zero:** un zero se vede ca lipsă, un
50 se vede ca informaţie.

Sursa exista şi e populată (`S.rsi[tf]`, `marketDataFeeds.ts:239`), iar intervalul canonic pentru o
citire **vie** e `5m` — exact ce foloseşte panoul existent pentru RSI-ul live. Nu scriem nimic când
lipseşte, ca să nu inventăm o valoare.

**15 teste noi.** Client: **143 de fişiere, 1 182 de teste verzi**, `tsc` curat, asset **HTTP 200**.

---

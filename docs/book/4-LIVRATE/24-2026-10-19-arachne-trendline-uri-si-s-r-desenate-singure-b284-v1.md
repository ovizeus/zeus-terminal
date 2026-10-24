<!-- generat din docs/BOOK_OF_ALL.md linia 5210 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🕸️ 2026-10-19 — ARACHNE: trendline-uri și S/R desenate singure (b284 v1.7.258)

> *„sa arate singur trend line suport rezistenta cand rupe si cand poti intra … liniile alea sa se tot
> puna singure dupa cum merge chartul si pe fiecare linie sa scrie ce e … sa arate cand rupe si poti intra
> short long"* — plus două poze de pe un chart TradingView: diagonale roșii descendente, diagonale verzi
> ascendente, orizontale galbene.

### Întâi am verificat că e chiar un gol

În Zeus **nu există linii de trend geometrice**. Cele patru potriviri pentru „slope" din `indicatorCalc.ts`
sunt despre *panta unei medii adaptive*, nu despre o dreaptă prin puncte de pivot. Iar `calcSRTable` **nu e
S/R**: sunt multipli de ATR în jurul prețului curent — adică niveluri care se mișcă odată cu prețul și
**n-au fost atinse niciodată de nimic**.

### Ce face

Pornește de la **pivoți reali** (fractali, cu bare de confirmare pe ambele părți — barele de la capăt nu
pot fi pivoți, pentru că un vârf care se poate muta la următorul tick ar redesena linia întruna) și țese:

1. **Niveluri orizontale** — pivoți apropiați ca preț devin un nivel, etichetat cu numărul de atingeri
   (`SUP 3x`, `RES 12x`). Un singur vârf **nu** e nivel.
2. **Linii diagonale** prin perechi de pivoți, **validate**: o dreaptă are voie să fie linie de trend doar
   dacă prețul **nu a trecut prin ea între cele două ancore**. Fără regula asta, orice două vârfuri dau o
   „linie" — și chartul ar fi plin de ele.
3. **Ruperi cu toleranță** — o umbră care atinge nu rupe. Eticheta devine `✕ RUPT`.
4. **Intrări** — ruperea, și **retestul care ține** (prețul revine la nivel și închide pe partea nouă).

Liniile rupte rămân pe chart, dar **punctate și stinse**: un nivel rupt contează mai departe — își schimbă
rolul — dar nu mai are voie să arate ca unul valid.

### 🔴 Trei defecte proprii, prinse înainte să ajungă la tine

**1. De proiectare.** Clasificam nivelurile după poziția față de prețul **de acum**. Deci un suport prin
care prețul căzuse devenea „rezistență", iar ruperea lui — căutată în sus — **nu se mai detecta niciodată**.
Acum rolul se dă de **unde a venit prețul**, iar un nivel rupt își schimbă rolul, cum și așteaptă un trader.

**2. De test.** Fixture-ul meu producea doar **trei pivoți**, deci niciun suport cu două atingeri de rupt —
și două teste cădeau arătând spre cod când problema era fixture-ul. Reconstruit și **verificat empiric**
înainte de a-l folosi: 5 pivoți, un nivel `SUP 2x` rupt, două linii descendente, două semnale short.

**3. Găsit pe date vii, nu în teste.** O linie ancorată demult și prelungită până la marginea chartului
proiecta **93.037 când prețul era 81.967** — o dreaptă care nu mai înseamnă nimic, dar arată exact ca o
linie de trend. Acum o linie **se prelungește cel mult cât a durat formarea ei**.

### Două lucruri pe care le-am scos sau acoperit, nu le-am lăsat să treacă

- Aveam și un **filtru de distanță** față de preț. Niciun test nu-l putea face să conteze — mutantul care
  îl scotea trecea tot. **L-am scos**: un gard pe care nu-l pot dovedi e decor.
- Calea de **retest** a rămas la prima încercare **complet neacoperită**, și un mutant care scotea cerința
  „prețul ȚINE" a trecut toate testele. Scoasă ca funcție proprie (`findRetest`) și acoperită.

### Ce găsește acum, pe BTC

```
1h   93 pivoti · 6 niveluri · 4 linii · 5 semnale
     SUP 20x @81821,8 · SUP 2x @80970,4 · SUP 30x ✕ RUPT @83083,5
     TL ▼ RES ✕ RUPT 16x · TL ▲ SUP 8x
     ultimul semnal: SHORT ▼ retest, intrare 82729,3 stop 83404,8 (acum 11 bare)

4h   107 pivoti · 6 niveluri · 4 linii · 11 semnale
     ultimul semnal: LONG ▲ rupere 16x, intrare 82498,8 stop 79766,9 tinta 81385,3
```

Ținta unui semnal de nivel e **următorul nivel real de pe chart**, nu un multiplu inventat.

**30 de teste noi, nouă mutanți omorâți.** Client **1034 teste / 128 fișiere** (de la 1004), typecheck 67
neschimbat, build curat.

---

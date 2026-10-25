<!-- generat din docs/BOOK_OF_ALL.md linia 615 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ⚰️➡️🫀 SMART_CUT înviat — era cod mort de la livrare — 2026-10-21 (b299 v1.7.273)

**Server-only. NU s-a făcut reload** (R-OP-1: unul pe sesiune, consumat la b297) → **intră la
următoarea repornire**, ceea ce îţi lasă o fereastră de obiecţie.

### Bugul

`SMART_CUT` (b161, 22 iunie) n-a închis **niciodată** nimic — 0 rânduri în istoric, 0 apariţii în
jurnale — deşi `ML_DSL_LOSSSIDE_ACTIVE=true` în `.env` şi a avut ocazii pe TESTNET.

`const _dslRrSim = require('./dslRrSim')` era declarat la **2586, în `_closePosition()`**, dar
folosit la **3602, în `onPriceUpdate()`** — funcţii **surori** de nivel superior, fără nicio
închidere între ele şi fără nicio declaraţie la nivel de modul (3 apariţii în tot fişierul: o
declaraţie şi două folosiri). Deci 3602 arunca `ReferenceError: _dslRrSim is not defined` la
**fiecare tick**, iar `catch (e) { }` **gol** o înghiţea. Patru luni, zero semnal.

Dovedit empiric, cu o reproducere a structurii exacte: 200 de tickuri advers-susţinute dau
**0 tăieri şi 200 de excepţii înghiţite**; cu importul în domeniul corect, **acelaşi cod taie**.

### Fixul, în trei părţi

1. **`require` la nivel de modul**, iar cel local redundant din `_closePosition` eliminat.
2. **Pasul extras într-un ajutor exportat `_smartCutTick(pos, price)`.** Bugul a supravieţuit
   fiindcă blocul era **intestabil** — îngropat în mijlocul lui `onPriceUpdate`, care cere tot
   mediul de rulare. Acum e ţinut în loc de **8 teste**, inclusiv regresia care prinde exact
   `ReferenceError`-ul. Pragurile b161 **nemodificate**: 0,75% advers, K=2 extreme succesive.
3. **R-C-14 aplicat pe propriul cod:** `catch`-ul nu mai e mut — prima eroare se logheaza, apoi
   cel mult una pe minut, cu un contor cumulat, ca să nu inunde jurnalul la tickuri dese.

**Poarta rămâne neschimbată:** `MF.ML_DSL_LOSSSIDE_ACTIVE && pos.env === 'TESTNET'` → **DEMO şi
REAL nu sunt atinse.**

### Dovada care justifică învierea

Din cohortul de umbră `lossside` lăsat de b140 — **380 de observaţii**:

| | |
|---|---|
| baseline mediu | **−0,0463** |
| cu `SMART_CUT` | **+0,0056** |
| avantaj mediu | **+0,0519** |
| cumulat | **+19,72** |
| cazuri mai bune / mai rele | **40 / 2** |

Pe **TESTNET**: 172 de observaţii, avantaj mediu **+0,0852**, cumulat **+14,65**. Gardul de probe
cerut de b161 era `n>=30-50` — **depăşit de peste 3 ori.** Acţionează pe ~11% din pierzători şi,
când acţionează, are dreptate în **95%** din cazuri.

Context: DSL taie **numai câştigătorii** (0% activ pe cele 103 ieşiri HIT_SL, 100% pe cele 440
DSL), deci câştigul e tăiat la 3,4% din ţintă iar pierderea curge întreagă. `SMART_CUT` e exact
piesa care lipsea pe partea de pierdere.

### Regresie

**599 de suite, 9 595 de teste verzi pe 4 sharduri, zero eşuate.**

---

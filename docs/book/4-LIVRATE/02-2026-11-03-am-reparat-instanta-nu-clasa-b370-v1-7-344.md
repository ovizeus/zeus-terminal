<!-- generat din docs/BOOK_OF_ALL.md linia 10823 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔁 2026-11-03 — Am reparat instanţa, nu clasa (b370 v1.7.344)

Am verificat **singur** lucrul pe care tocmai îl ceream operatorului — dacă cele trei numărătoare spun acelaşi lucru — randând răspunsurile şi comparându-le. Nu se contraziceau (sunt ferestre diferite), **dar comparaţia a scos două defecte noi**.

### 1. Acelaşi separator greşit, într-un al doilea loc

Răspunsul despre învăţăminte spunea *„bandit cells: cold încă"* — deşi există celule cu **36, 29, 27 şi 20** de observaţii.

Cauza: **acelaşi** separator pe care l-am reparat la b366 în răspunsul despre predictivitate. Cheile sunt `1:DEMO:BNBUSDT:BREAKOUT`, cu două puncte; aici era încă bară verticală, deci interogarea întorcea zero rânduri mereu.

> **Am reparat instanţa, nu clasa** — exact greşeala pe care cartea o are deja scrisă de la escaparea pentru Telegram (b273), unde un fix pus într-un singur loc a lăsat **douăzeci şi cinci** de altele şi bugul s-a întors.

De data asta forma se construieşte **într-un singur loc**, printr-o funcţie, şi un test cere ca ambele interogări să o folosească şi ca nicio cheie să nu mai fie scrisă de mână.

### 2. Un număr corect cu o etichetă greşită

Acelaşi răspuns zicea *„am 382 trade-uri închise"*, în timp ce rândul de cont zice **1.366**. Numărul era corect pentru fereastra lui — ultimele 500 de rânduri — **dar propoziţia pretindea că e totalul**. Acum spune *„din ultimele 382"*.

> **Un număr corect cu o etichetă greşită e tot o minciună, doar mai greu de prins.**

### Rezultatul

```
din ultimele 382 trade-uri închise: 44% (168/382). … bandit cells:
1:TESTNET:BTCUSDT:TREND α9/β26 obs36 ~22% | 1:TESTNET:BTCUSDT:RANGE obs29 ~34%
| 1:DEMO:ETHUSDT:TREND obs28 ~50%.
```

### Dovada

**4 mutaţii moarte:** separatorul redevenit bară în constructor · învăţămintele scriindu-şi iar prefixul de mână · eticheta revenită la „am N" · prefixul fără simbol nemaifiltrând pe utilizator.

7 teste noi. Un test de la b366 cerea forma scrisă inline şi a fost **actualizat** să ceară constructorul, cu motivul scris în el.

Regresie: **10.208 verzi** pe 4 sharduri, 3 sărite, zero eşuate.

---

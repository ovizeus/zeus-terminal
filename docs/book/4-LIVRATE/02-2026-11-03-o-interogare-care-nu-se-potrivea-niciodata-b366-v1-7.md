<!-- generat din docs/BOOK_OF_ALL.md linia 10656 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔇 2026-11-03 — O interogare care nu se potrivea NICIODATĂ (b366 v1.7.340)

Am randat şi restul şabloanelor. Două defecte, amândouă **tăcute**.

### 1. Separatorul greşit — „bandit cold start" indiferent de date

Răspunsul despre predictivitate căuta celulele cu `cell_key LIKE '<uid>|%|<sym>|%'` — cu **bară verticală**. Cheile reale sunt cu **două puncte**: `1:DEMO:BNBUSDT:BREAKOUT`.

| căutare | rânduri găsite |
|---|---|
| `'1\|%\|BTCUSDT\|%'` | **0** |
| `'1:%:BTCUSDT:%'` | **4** (36, 29, 27, 20 observaţii) |

Deci răspunsul era *„bandit cold start, no edge yet. still learning"* **indiferent de date** — inclusiv pentru simbolul cel mai învăţat. Acelaşi separator greşit era şi la despărţirea cheii pentru afişare, deci regimul ar fi ieşit `?` oricum.

> **O interogare care nu se potriveşte niciodată nu dă eroare — dă un răspuns liniştit şi fals.** E cel mai greu de văzut, fiindcă nimic nu se strică zgomotos.

Acum spune cifrele reale **şi etichetează mediul** fiecărei celule: cele mai învăţate sunt pe **testnet**, iar el tradează **demo**. Fără etichetă, cifra pare a lui şi nu e.

```
BTCUSDT Ring5 bias: TREND 22% (obs 36, testnet), RANGE 34% (obs 29, testnet),
BREAKOUT 19% (obs 27, testnet), TREND 25% (obs 20, demo), …
```

### 2. Întrebarea care nu ajungea unde trebuie

*„is btc manipulated"* nu ajungea la verificarea de manipulare: regexul avea `manipulation` dar **nu** şi `manipulated`, deci cădea pe intenţia de simbol şi primea un raport de decizii.

**Aceeaşi clasă cu bugul reparat odată pe cuvântul „azi"** — un regex de intenţie care ratează o formă a cuvântului. Lărgit la `manipul\w*`, şi verificat explicit că **nu** prinde întrebări obişnuite — *un regex prea lacom e alt bug*. Schimbat în **ambele** lanţuri.

### Dovada

**4 mutaţii moarte:** separatorul revenit la bară în interogare · la despărţire · mediul nemaifiind arătat · regexul revenit la forma îngustă într-un singur lanţ.

Şi un test al meu scris încâlcit, cu o numărătoare care nu se înţelegea — rescris simplu: *un test greu de citit nu apără pe nimeni.*

7 teste noi. Regresie: **10.182 verzi** pe 4 sharduri, 3 sărite, zero eşuate.

---

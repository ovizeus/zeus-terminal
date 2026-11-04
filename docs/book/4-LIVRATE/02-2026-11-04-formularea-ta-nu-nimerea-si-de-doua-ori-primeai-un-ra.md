<!-- generat din docs/BOOK_OF_ALL.md linia 11056 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🗣️ 2026-11-04 — Formularea ta nu nimerea, şi de două ori primeai un răspuns GREŞIT (b374 v1.7.348)

Ţi-am cerut să probezi pe telefon dacă rutarea prinde felul în care scrii. Apoi mi-am dat seama că **exact asta pot proba singur** — şi era locul unde munca de la b373 putea să nu ajungă la tine.

**17 formulări fireşti, 13 rateau.**

### Ratarea nu e catastrofa. Răspunsul greşit, da.

O ratare cade la model, care are acum constituţia şi trendul de dispoziţie în context — deci **răspunde**. Dar trei cazuri nimereau intenţia `symbol` şi dădeau un rezumat de simbol:

| ce scriai | ce primeai |
|---|---|
| `zidurile pe BTCUSDT` | preţul şi trendul BTC |
| `cartea de ordine pe BTCUSDT` | preţul şi trendul BTC |
| `pozitia pe BTCUSDT` | preţul şi trendul BTC |

**Un răspuns greşit e mai rău decât niciunul, fiindcă pare un răspuns.**

### 1. Intenţie nouă: `constitution`

`de ce am long si short deschise` era prins de `positions`, care **listează** poziţiile. O întrebare **de ce** primea un răspuns **ce** — concret, `no positions open. flat.` la întrebarea pe care ai pus-o pe 1 noiembrie. Şi formularea mai vagă, care cădea la model, primea un răspuns **mai bun** decât cea precisă.

> `constitution — in the last 24h: opposite-side entry while same-symbol open x65 hard · 54555 on record since the rule went in · mode is advisory — every one of these was logged and the entry went through anyway; nothing was blocked. the switch that turns these into refusals is yours, not mine.`

Cere `long` **şi** `short` plus un declanşator de motiv, ca să nu fure `ce pozitii am`.

### 2. Opt regexuri lărgite — tiparul era unul singur

**Sufixele româneşti de articol şi plural.** Cereau `zid`/`ziduri` dar nu `zidurile`; `deschise` dar nu `deschis`; `decizii` dar nu `decizie`; `carte de ordine` dar nu `cartea de ordine`; `starea ta` dar nu `starea`. Lipseau cu totul: `castigurile`, `pierderile`, `problemele`, `alerta`, `influenta`, `pozitiile`.

Asta e, concret, ce înseamnă **„e cam trângă"**: scrii româneşte firesc şi rutarea nu prinde.

### 3. `positions` mutat înaintea lui `symbol`

### 💡 Unde se vede plata pentru b373

Fiecare din cele trei a fost **o singură editare**. Cu două lanţuri ţinute în acord cu mâna, ar fi fost şase — şi una s-ar fi uitat, ca `market`.

### ⚠️ O mutaţie supravieţuitoare, şi o corecţie la mine

**Gaura reală:** fără cerinţa celor două cuvinte, **orice** întrebare cu „de ce" ajungea la constituţie — `de ce nu ai intrat`, `de ce ai pierdut`. N-aveam niciun test cu „de ce" care să trebuiască să meargă altundeva. Acoperit.

**Corecţia la mine:** prima rulare a mutaţiei M6 **nu s-a aplicat deloc** (escapări de shell) şi a raportat `18 passed` — adică **nimic**. Era pe punctul să o număr ca omorâtă. Am reluat-o cu un patch pe fişier. **O mutaţie care nu se aplică nu dovedeşte nimic**, iar un harnaşament care tace la eşec minte mai convingător decât unul care crapă.

### Dovada

**26 de teste noi, 9 din 9 mutaţii omorâte.** Testele apără şi **lăcomia**, nu doar potrivirea: `start` nu devine `stare`, `influenza` nu devine `influenta`, `am pierdut cheile` nu devine pnl.

Suita: **10.283 verzi** pe 4 sharduri, 3 sărite, zero eşuate — **zero regresii** din lărgirea celor opt regexuri, care e singura dovadă care conta.

### ⏳ Nu e încă live

Am folosit deja singurul `pm2 reload` al sesiunii, la b373 (R-OP-1, ca să nu dau rafală de 429 pe Binance). **b374 e pe disc şi pushuit, dar cere un reload** ca să ajungă în procesul viu.

---

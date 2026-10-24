<!-- generat din docs/BOOK_OF_ALL.md linia 4650 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔎 2026-10-19 — REPARAT: 20 265 de eșecuri care spuneau „HTTP 503" și nimic altceva (b275 v1.7.249)

Căutând cauza banului am dat peste altceva, real și separat:

```
20265 × [FEED] [ALT_WS_FEEDS] kline poll failed [<simbol> <tf>]: HTTP 503
```

965 de eșecuri pe fiecare dintre cele **21 de serii** (7 simboluri × 3 timeframe-uri), continuu de pe
**18 oct 21:00** până pe **19 oct 08:24** — 11,4h în care brain-ul multi-simbol nu a primit lumânări.
Pe 16 octombrie, zi fără ban, au fost **2**. Deci nu e zgomot de fond.

**De ce nu se putea diagnostica:** `binanceGateway` sintetizează 503 **înainte** de fetch, pentru două
motive diferite — `circuit_open` (întrerupătorul deschis) și `rate_limit` (limitatorul a refuzat). Fiind
generat înainte de fetch, răspunsul **nu trece prin wrapper-ul de telemetrie**, deci `errors5xx` a rămas
`0` pentru `marketFeed:alt-klines` în tot intervalul. Telemetria nu mințea — pur și simplu nu le-a văzut.
Iar motivul *era* pe obiectul răspunsului, în `res._reason` și `res._backoffMs`, și era aruncat o linie
mai jos:

```js
if (!res.ok) throw new Error(`HTTP ${res.status}`);   // _reason, aruncat
```

**Reparat** cu un helper local `_httpError(res)`, aplicat în **ambele** locuri care aruncau așa:
`fetchKlines` (`klines-init`, linia 259) și `_altFetchKlinesLatest` (`alt-klines`, linia 493). L-am pus și
în al doilea, deși numai primul a țipat, pentru că altfel ar fi rămas orb exact la fel — e aceeași clasă.

**Ce NU am făcut:** nu am ghicit *care* dintre cele două motive a fost. Nu se poate afla retroactiv, iar
a inventa o cauză ca să pot „repara" ceva ar fi exact greșeala pe care regulile de aici o interzic.
Fixul face ca următoarea apariție să se explice singură.

**Dovezi:** 4 teste noi (`tests/unit/marketFeedAltKlineReason.test.js`), toate picate prima dată pe cauza
corectă. **Doi mutanți omorâți:** `why` golit → 2 teste pică; ramura de backoff ștearsă → 1 test pică.
Backoff-ul e asertat explicit, pentru că o ramură neasertată e decor — a cincea oară în campania asta când
verific asta și a doua oară când găsesc decor. Server **9504 teste pe 4 felii, 0 eșecuri** (9500 baseline + 4 noi).

**Observație lăsată deschisă, nereparată:** `_altStartPricePoller` (cel mai mare consumator, 8393 cereri)
face `if (!res.ok) return;` — eșec **complet silențios**. În aceleași 11,4h prețurile puteau fi învechite
fără nicio urmă în log. Nu l-am atins în același commit: regula „nu înlănțui schimbări riscante" și e
cale de prețuri. Candidat pentru următorul lot.

---

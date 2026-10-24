<!-- generat din docs/BOOK_OF_ALL.md linia 4566 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🧾 2026-10-19 — P1 era o atribuire greșită, și am dovada într-o singură linie de log

P1 stătea prima pe lista de priorități de nouă zile, cu eticheta *„singurul lucru mare rămas care e al meu"*.
Era greșit. Linia care închide subiectul:

```
04:01:30 [WARN] [BINANCE_RATE] HTTP 418 from testnet.binancefuture.com/fapi/v2/balance
                src=signer:GET /fapi/v2/balance  usedWeight=0/6000 — IP BAN response
```

**`usedWeight=0/6000`.** Contorul propriu al lui Zeus era la **zero** în momentul în care am fost banați.
Nu există nicio cantitate de throttling care să scadă zero. Asta nu mai e „probabil vecinii de NAT" — e
dovedit pe cererea care a primit 418-ul.

**Și ipoteza tehnică din P1 era falsă.** P1 zicea că `serverAT.js:5399` cere `positionRisk` *per poziție*
în loc de per user. Am citit linia: e în calea de **addon** (`AT_ADDON`, reconciliere de cantitate după ce
un addon s-a umplut), se execută **o dată per addon**, nu în buclă. Bucla de recon de la 5676 cheamă
`exchangeOps.getPositions(userId)` **o dată per (user, exchange)** — exact ce spunea comentariul.
Un grep îngust m-a dus la o linie care arată ca problema fără să fie problema. A treia oară în campania asta.

### Cât consumă Zeus de fapt — măsurat, nu estimat

Din `/api/diag/binance-rates`, după **15,6h** de uptime curat:

| host | cereri Zeus | greutate Zeus | contor IP (ultim / vârf) | partea lui Zeus |
|---|---|---|---|---|
| `testnet.binancefuture.com` ← **aici cad banurile** | 76 | 380 total | 1804 / **4089** din 6000 | **~0,4 greutate/min = 0,02%** |
| `fapi.binance.com` (date de piață) | 20 642 | 57 032 | 654 / 1107 din 6000 | ~61/min = **9,3%**, fără risc |

Citirea onestă: pe testnet, unde ne banează, Zeus e **eroare de rotunjire**. Pe prod, unde Zeus
chiar polează mult, IP-ul stă la **11% din plafon** — acolo nu e niciun pericol.

### ⚠️ CORECTEZ CE ȚI-AM RAPORTAT IERI

Ți-am escaladat R16 cu cifra *„5 banuri distincte pe 18 oct = 10,9h = 45% din zi"*. **Greșit.**
Fișierele rotite sunt numite după ziua în care au fost *rotite*, deci `pm2-error__2026-10-18` conține
datele de pe **17 octombrie**. Ziua cu 4 banuri a fost **17 oct**, nu 18.

Numărătoarea reală, din `binance_rate_state_log` (tranziții de stare) încrucișată cu valorile distincte
de `banned until` din logurile text:

| zi | banuri distincte | timp banat |
|---|---|---|
| 14 oct | 1 | — |
| 15 oct | 1 | — |
| 16 oct | **0** | 0 |
| 17 oct | **4** | 01:28→04:41, 05:06→08:40, 10:44→10:58, 14:48→18:21 = **10h34m (44%)** |
| 18 oct | 1 | 23:37→sfârșitul zilei = **22 min (1,5%)** |
| 19 oct | 1 | 00:00→03:34 și 04:01→08:19 = **7h52m**, apoi **8h curate** |

Deci media reală e **~1,3 banuri/zi** pe 6 zile, cu o zi rea (17 oct, 44%) și o zi complet curată (16 oct).
Cifra „45%" exista, dar pe altă zi. Lecția, pentru a nu se repeta: **numele fișierului rotit nu e ziua
conținutului** — verifică întotdeauna cu `head -1`.

### Ce rămâne din cele trei remedii

Remediul **C** pe care ți l-am recomandat (date de piață din producție, testnet doar pentru ordine)
**e deja arhitectura actuală** — 76 de cereri pe testnet față de 20 642 pe prod în 15,6h. Nu e o
îmbunătățire disponibilă, e starea de fapt. Deci decizia ta se reduce la **două** opțiuni:

- **A — nu facem nimic.** Costul: ~1,3 banuri/zi × ~4h, în care Zeus nu poate deschide sau închide
  poziții pe exchange. Pozițiile existente rămân protejate de SL-ul server-side. Bani reali: **zero**,
  totul e testnet/demo.
- **B — IP de egress dedicat** (**NU WARP** — un WARP a stricat VPS-ul o dată). Singurul remediu care
  atinge cauza, pentru că elimină vecinii de pe IP-ul nostru.

### Bonus măsurat azi: care WebSocket merge, de fapt

Test direct de pe VPS, 12 secunde fiecare:

```
PROD    fstream.binance.com      open=true  frames=0    ← blocat (P4, neschimbat din mai)
TESTNET stream.binancefuture.com open=true  frames=6    ← MERGE
SPOT    stream.binance.com:9443  open=true  frames=41   ← MERGE
```

Deci blocajul e **specific** pe WS-ul de futures de producție. `marketFeed.js` și `wsMarketProxy.js`
sunt hardcodate pe `fstream.binance.com` (zero conștiență de testnet), de unde `ALT_WS_FEEDS` și
pollingul REST la 10s care produce cele 20 642 de cereri. **Nu l-am schimbat**: a trece pe prețuri de
testnet sau de spot pentru un brain de futures e decizie de produs, nu de implementare — basis-ul
diferă. O las scrisă aici ca opțiune, nu ca recomandare.

---

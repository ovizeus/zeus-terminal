<!-- generat din docs/BOOK_OF_ALL.md linia 1971 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔴 R16 — banurile Binance sunt pe TESTNET, iar protecția noastră e oarbă acolo (2026-10-11)

**Al treilea ban la rând azi** (`consecutive_ban_count: 3`), ultimul la **20:19:20**.
**NU de la reload-uri** — n-am făcut niciunul azi (restarts rămâne 1092).

### Dovada
```
[BINANCE_RATE] HTTP 418 from testnet.binancefuture.com/fapi/v2/balance
               src=signer:GET /fapi/v2/balance  usedWeight=0/6000  — IP BAN response
[BINANCE IP-CB] Tripped — refusing all signed requests for ~340s
```
Și mai devreme, același tipar pe `/fapi/v2/positionRisk`.

### Mecanismul
1. Banurile vin de pe **`testnet.binancefuture.com`**, nu de pe producție. Testnet-ul Binance are
   limite mult mai strânse, și pe **număr de cereri semnate**, nu pe greutate.
2. **`usedWeight=0/6000`** — testnet nu raportează greutatea ca producția. `getQuotaPressure(host)`
   caută ultima citire de `usedWeight` **pentru acel host**; pe testnet nu găsește nimic util, deci
   presiunea iese **0**.
3. `QUOTA_CAP` e **6000** — plafonul de **producție**, aplicat și testnet-ului.
4. Rezultat: scheduler-ul crede că suntem la 0% presiune, nu frânează nimic, și intrăm direct în 418.

**Protecția e calibrată pentru producție și e practic oarbă pe testnet.** De-aia banurile escaladează
(`consecutive_ban_count` 1 → 3) deși traficul total e mic: acum **41 cereri/min**, mult sub plafon.

### 🙋 Ce propun (decizia lui — e cale de bani, nu ating singur)
1. **Un plafon separat pentru testnet** — `QUOTA_CAP` per host, mult mai mic pe testnet.
2. **Numărătoare de CERERI, nu doar greutate**, pentru host-urile care nu raportează `usedWeight`.
   Asta e reparația de fond: fără ea, orice host fără header de greutate e invizibil.
3. **Interval mai larg pentru recon/balance pe testnet** — când `userDataStream` e activ, recon-ul
   scade deja la 5 min; de verificat dacă chiar e activ pentru uid=1.

*(Separat de A2, care era despre endpoint-urile publice de pe producție. Astea sunt cereri semnate pe testnet — altă problemă, altă cauză.)*

---

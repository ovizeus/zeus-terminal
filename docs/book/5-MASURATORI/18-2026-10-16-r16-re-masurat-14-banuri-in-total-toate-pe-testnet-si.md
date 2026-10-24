<!-- generat din docs/BOOK_OF_ALL.md linia 2530 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 📉 2026-10-16 — R16 RE-MĂSURAT: 14 banuri în total, toate pe testnet, și tendința e ÎN SCĂDERE

Am reverificat R16 înainte de a propune remedii pe calea banilor. **Două rezultate, unul fiind o
corectură a mea.**

### ✅ Afirmația centrală a lui R16 e CONFIRMATĂ definitiv
```
banuri reale (component BINANCE_RATE, HTTP 418), pe host:  testnet 14  /  productie 0
```
**14 din 14 pe `testnet.binancefuture.com`.** Zero pe producție. Mecanismul rămâne cel descris:
testnet nu raportează `usedWeight`, deci `getQuotaPressure` citește 0, iar `QUOTA_CAP` 6000 e
plafonul de **producție** aplicat unde nu se potrivește.

### 🔴 CORECTURĂ: numărasem de ~100× prea mult
Raportasem „186 de banuri ieri", „409 pe 12 oct". **Greșit.** Numărasem linii de log care conțin
„418", dintre care:
- `LIQ-FEED` conținea `frames=8418` — număr de frame-uri, nu cod HTTP;
- `BRAIN` conținea `[C4180]` — un identificator;
- `RECON` (96) și `USERDATA` (16) **nu sunt banuri noi** — sunt subsisteme care raportează că
  întrerupătorul e **deja** pe pauză, din **același** ban.

Numărate corect, pe componenta care chiar înregistrează banul:
```
11 oct: 3   12 oct: 6   13 oct: 3   14 oct: 1   15 oct: 1   16 oct: 0
```

### 📉 Și asta schimbă recomandarea
Tendința e **în scădere abruptă**, ultimul ban a fost pe **15 oct 18:49** — acum ~23 de ore — iar
`consecutive_ban_count` e **0**, `banned_until` **0**, `warm_until` **0**.

Eram pe punctul de a recomanda schimbări pe calea banilor pentru o problemă care **se rezolvă
singură**. Recomandarea corectă nu mai e „repară acum", ci **„urmărește"**: dacă reapar banuri
peste 1-2/zi, atunci merită unul dintre cele trei remedii; până atunci, costul unei modificări pe
limitator depășește beneficiul.

**Lecția, a șaptea oară în campania asta:** o cifră alarmantă dintr-un `grep` larg e aproape sigur
greșită. Numără pe componenta care emite evenimentul, nu pe șirul care apare în el.

---

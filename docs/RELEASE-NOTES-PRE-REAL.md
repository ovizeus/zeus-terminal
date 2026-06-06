# Release Notes — schimbări de comportament de știut ÎNAINTE de trecerea pe REAL

> Actualizat 2026-06-06. Acest document listează schimbările care modifică
> comportamentul vizibil al sistemului față de ce era înainte de campania
> server-side (iunie 2026). Citește-l înainte de flip-ul `_SRV_POS_REAL_ENABLED`.

## 1. SL/TP declanșează pe MARK PRICE (nu pe last price)
**Din 2026-06-05 (`8759b000`).** Toate ordinele condiționale (STOP_MARKET /
TAKE_PROFIT_MARKET) plasate de Zeus — server-AT, recon re-placement, legacy
core ȘI **ordinele manuale Path-B** — trimit `workingType: MARK_PRICE`.

- **De ce:** anti-wick. Pe last price, un singur print sălbatic (carte subțire)
  declanșa SL-ul instant (dovedit pe testnet: stop-out în <11s la 2.5% de entry).
  Mark price e ancorat în indexul real.
- **Ce simți:** SL-ul NU se mai declanșează pe wick-uri de o secundă din order
  book; se declanșează când prețul "adevărat" (mark) atinge nivelul. La
  lichidări violente diferența e de obicei sub-secundă.

## 2. Jurnalul scrie PnL REAL la SL-uri de pe bursă
**Din 2026-06-05.** Când SL-ul de pe bursă execută, jurnalul scrie `HIT_SL` cu
prețul real de fill și PnL-ul realizat raportat de bursă (`o.rp`), nu
`EXTERNAL_CLOSE $0.00` ca înainte.

## 3. REAL e blocat dur la TOATE nivelurile până la flip
**Din 2026-06-06 (`0160b6cb`).** Pe lângă gate-urile existente
(`_realBlocked` în dispatch + `_resolveExecutionEnv`), acum și
`_executeLiveEntryCore` (ruta manuală/unificată) refuză creds non-testnet cât
timp `_SRV_POS_REAL_ENABLED !== true`.
- **Consecință la flip:** activarea REAL = `MF.set('_SRV_POS_REAL_ENABLED', true)`
  + reload deschide consistent TOATE căile (brain + manual). Nu există căi
  "uitate deschise" și nici căi "uitate închise".

## 4. Close-urile eșuate se reîncearcă automat (60s)
**Din 2026-06-05 (`a4bc1124`).** Dacă un close de piață eșuează după toate
retry-urile (ex. circuit breaker deschis), poziția intră în
`emergency_close_queue` și `emergencyCloseProcessor` reîncearcă la fiecare 60s
până bursa acceptă (închide TOATĂ cantitatea ținută, după adevărul de pe bursă).
Telegram anunță la rezolvare.

## 5. Protecțiile orfane se curăță singure
**Din 2026-06-06.** SL/TP-uri rămase pe simboluri flat (după close-uri
client-AT/manual) sunt anulate automat de sweep-ul periodic (~10 min, doar pe
simboluri FĂRĂ poziție pe bursă — protecțiile pozițiilor vii nu sunt atinse).

## 6. Boot-ul e eșalonat (anti-ban)
**Din 2026-06-05 (`c23cf854`).** La orice restart: pollerele pornesc cu jitter,
gate-ul de cotă presupune presiune conservatoare primele 2 min (cosmetica
așteaptă, money-path-ul nu), iar fiecare 429/418 real se loghează persistent
(`BINANCE_RATE` în pm2-error.log).

## 7. Limita de memorie PM2 = 1536M
**Din 2026-06-05 (`7af0119e`).** Auto-restarturile dese de memorie (cu risc de
ban la fiecare boot-burst) au dispărut; procesul crește ~30MB/h, deci restart
de memorie ≈ o dată la câteva zile.

## Scara de siguranță recomandată la flip-ul REAL (de discutat la momentul ăla)
1. Verificările obligatorii ale operatorului: review independent + phantom-check
   pe starea curentă (regulă stabilită 2026-06-02).
2. Size mic la început (cap per-trade redus în config) + kill-switch verificat.
3. Telegram configurat (alerte orfani/halt/catastrophic pe telefon).
4. Prima zi: monitorizare activă, nu telefon închis.

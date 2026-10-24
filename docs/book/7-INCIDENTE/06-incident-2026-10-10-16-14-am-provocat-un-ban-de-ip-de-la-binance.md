<!-- generat din docs/BOOK_OF_ALL.md linia 3970 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🚨 INCIDENT 2026-10-10 16:14 — am provocat un ban de IP de la Binance cu reload-uri prea dese

**Vina mea, direct și fără scuze.** Am făcut **8 reload-uri pm2 azi**, dintre care **5 în 50 de minute**
(15:27, 15:36, 15:48, 16:01, 16:17), deployând b265→b269 una după alta. Binance a răspuns la **16:14:31**:

> `HTTP 418: Way too many requests; IP(15.158.242.112) banned until ...`

**Fereastra banului:** 16:14:31 → **17:17:58** (~63 min). `consecutive_ban_count=1`, deci ban nou, nu escaladare.

**Există o regulă scrisă exact despre asta** — [[feedback_no_rapid_reloads_binance_burst]]: *fiecare reload =
rafală Binance 429*. Fiecare boot reface exchangeInfo, klines-init pe toate simbolurile, OI, funding,
24h tickers, markprice cache, watchlist. Patru rafale în 34 de minute, peste baza de ~345/min.
**Mi-am încălcat propria regulă înregistrată, de patru ori.**

### Efectul
- Zeus **nu primește niciun răspuns de la Binance** până la 17:17:58. Starea V6 trece în `SUPPRESSED`
  și respinge tot cu `503` sintetic — **comportament corect**, ne protejează, nu e defecțiune.
- Feed-urile **Bybit și OKX merg** (lichidități, heatmap), deci radarul nu e orb complet.
- Trei poziții OPEN, **toate pe demo** — **fără bani reali în risc**. Dacă ar fi fost pe live, recon-ul
  ar fi fost orb la poziții o oră, ceea ce ar fi fost grav.

### Notă de onestitate
`curl` direct de pe VPS la `fapi.binance.com` **răspunde 200** în timpul banului. Nu știu de ce și nu
inventez o explicație: fie banul e aplicat pe o parte din noduri, fie pe o clasă de greutate.
Zeus se auto-suprimă pe baza a ce i-a spus Binance, ceea ce e alegerea prudentă corectă.

### Ce fac diferit
1. **Nu mai fac niciun reload azi.**
2. **Un singur reload per sesiune de lucru**, la final — nu unul per build. Acumulez schimbările.
3. Schimbările **doar de client** (bundle) nu cer reload deloc; doar cele de server cer, și le grupez.
4. Înainte de orice reload: verific `binance_rate_state` — dacă nu e `NORMAL`, nu ating nimic.

*(Legătură cu diagnosticul A2: exact de asta pollingul REST e fragil — cu WS-ul blocat, orice rafală
suplimentară se adună peste o bază care deja există doar ca înlocuitor pentru WebSocket.)*

---

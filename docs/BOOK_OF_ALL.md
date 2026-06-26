# Book of All

> Monitorul tău personal. Aici trec EU tot ce facem: ce-i de făcut, ce-i de verificat, ce-i bug, ce-i plan. Când verificăm ceva împreună, îl scot de aici (și din memorie). Așa nu se pierde nimic.
> **Ultima actualizare:** 2026-06-26 · build b229 v1.7.203

---

## BUGS — nerezolvate

1. **Binance „Position side cannot be changed"** — intrări blocate intermitent (~3/zi, doar testnet uid=1). Diag SYMBOL_READY_DIAG e LIVE de azi (~11:30); **încă 0 capturi** (ultima eroare 07:27, înainte de deploy — n-a mai apărut). *De verificat:* la următoarea apariție `grep SYMBOL_READY_DIAG` → cod brut → fix idempotent. (pre-existent, fail-safe, zero bani pierduți)
2. **Chart gol la schimbare simbol** cu indicatori noi activi — cauza știută (`_indRenderHook` fără try/catch golește tot la o eroare). Fix agreat, AȘTEAPTĂ GO de la tine (cod chart sensibil).
3. **Quantitative Monitor pâlpâie verde** („instalație de Crăciun") — canvas particule dimensionat 1×1 la init → inundă verde. Fix propus (lazy-resize), AȘTEAPTĂ GO.
4. **Offsite backup picat** — rclone gdrive quota 403 (din 23-24 iun) → backup-ul local e singura copie. DE REPARAT (reconfigurat remote sau alt destinație).
5. **Findings securitate (MEDIU, gated pe acces repo)** — keystore în git + parolă slabă, backup creds 644, CSP unsafe-inline, `audit?userId` admin. Reparațiile AȘTEAPTĂ GO (nimic reparat încă).
6. **Arhivare tăcută → orfan pe bursă** — o poziție arhivată tăcut în `at_closed` lasă un orfan pe bursă (recon o re-adoptă lev1). Guard PASIV livrat (loghează WARN+stack la următoarea apariție), DAR cauza rădăcină (call-site-ul de arhivare tăcută) NU e izolată. *De urmărit:* `grep AT_ARCHIVE_GUARD` în loguri.

---

## TO MAKE / MONITORING — de făcut & de urmărit

1. **Soak ML-DSL Full Control** — flag APRINS, urmăresc poziții preluate + reversal-cuts + P&L. *Status azi:* 34 poziții luate, net ≈ +810, ZERO poziție ML a atins hard SL (scurgerea oprită). De monitorizat zilnic.
2. **Brain/AT flip la REAL — NU e gata.** Mutarea server-side e DEJA făcută (SP1+SP2): pe DEMO + TESTNET serverul decide, deschide, gestionează exituri/SL/DSL singur (merge cu telefonul închis). Gate-ul de execuție REAL e ON dar **inert** (uid=1 testnet, zero chei LIVE). Rămâne: (a) gard P&L testnet verde 2-3 săpt (acum NU verde), (b) SP1.5 sizing-parity proof, (c) flip `SERVER_BRAIN`+`SERVER_AT`=true pe live (SP3) + chei LIVE + GO. *De verificat:* track P&L testnet săptămânal.
11. **ARES server-side (faze 2-4) neimplementat** — singura bucată reală de cod de trading încă pe CLIENT (decizia + execuția ARES; `serverAresDecision/Execution/Wallet/Positions.js` nu există). Separat de AT principal (BTCUSDT, autonom), amânat post-SP2. *De decis:* dacă/când îl mutăm.
3. **DSL_ML_CUT = 0** — tăierea pe reversal n-a tras încă. De urmărit: dacă rămâne 0 mult timp, poate pragul de confirmare e prea strict (ca Lever B).
4. **P&L testnet track (cron 23:58)** — ultima linie din log e goală. *De verificat:* cronul chiar produce date noi (nu e mort).
5. **Lever B Smart Loss-Cut** — live testnet, 0 tăieri (puține poziții deschise). De monitorizat când crește volumul.
6. **Bybit — ZERO rulaje reale.** Cod matur dar nedovedit. *De făcut:* soak Bybit pe un user de test separat (așteaptă cheie testnet Bybit + GO).
7. **Chei LIVE pentru REAL ML-DSL** — când decizi tu (via MultiExchange UI). Atunci ML-DSL moștenește pe real automat; primele trade-uri reale MICI + vegheate (testnet ≠ real).
8. **Verificări vizuale restante de la tine:** kill-switch overlay (pe laptop), jurnal manual „jos" (după hard-refresh), widget Android gaming (cere rebuild + reinstall APK pe telefon).
9. **Radar top300 / OI la următorul ban Binance** — de verificat că banda trece pe sursa Bybit (fix livrat, neconfirmat la ban real).
10. **„Margin insufficient" testnet** — unele fill-uri AT pe uid=1 sunt blocate fiindcă contul testnet Binance e mic. Limitare de cont, nu bug — de urmărit dacă strânge prea mult volumul de soak.

---

## PLANS — pe viitor

1. **Hyperliquid (exchange backup)** — în caz că Binance are probleme de licență după 1 iulie. E DEX (auth = wallet Ethereum + EIP-712, nu key/secret). Plan complet scris, NU se construiește încă.
2. **Bybit proof-first** — dovedește Bybit întâi (e CEX, aproape gata) ca plasă de rezervă rapidă, înainte de efortul mare Hyperliquid.
3. **ML-DSL Faza 2 (measurement real)** — `simulateMlPath` conduce DSL live pe testnet, după ce edge-ul ML e dovedit cu date reale.
4. **Demo în fundal** — demo să tradeze în paralel cu live (nu doar engine=demo). Probabil în SP2.
5. **Roadmap server-side („telefon închis")** — SP1.5 sizing → SP2 cutover (lockout heartbeat pe intrări ȘI exituri) → REAL.

---

*Notă: cartea asta o țin eu la zi. Spune-mi „verificat X" și o scot de aici.*

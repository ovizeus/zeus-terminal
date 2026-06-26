# Book of All

> Monitorul tău personal. Aici trec EU tot ce facem: ce-i de făcut, ce-i de verificat, ce-i bug, ce-i plan. Când verificăm ceva împreună, îl scot de aici (și din memorie). Așa nu se pierde nimic.
> **Ultima actualizare:** 2026-06-26 · build b236 v1.7.210

---

## BUGS — nerezolvate

1. **Binance „Position side cannot be changed"** — intrări blocate intermitent (~3/zi, doar testnet uid=1). Diag SYMBOL_READY_DIAG e LIVE de azi (~11:30); **încă 0 capturi** (ultima eroare 07:27, înainte de deploy — n-a mai apărut). *De verificat:* la următoarea apariție `grep SYMBOL_READY_DIAG` → cod brut → fix idempotent. (pre-existent, fail-safe, zero bani pierduți)
2. **Offsite backup picat** — rclone NU mai e configurat (config lipsește pt user zeus) + ultimul backup local din 24 iun → local = singura copie ȘI veche. DE REPARAT (cere destinație: re-auth Google Drive sau alt cloud).
3. **Findings securitate (MEDIU, gated pe acces repo)** — keystore în git + parolă slabă, backup creds 644, CSP unsafe-inline, `audit?userId` admin. Reparațiile AȘTEAPTĂ GO (nimic reparat încă).
4. **Arhivare tăcută → orfan pe bursă** — o poziție arhivată tăcut în `at_closed` lasă un orfan pe bursă (recon o re-adoptă lev1). Guard PASIV livrat (loghează WARN+stack la următoarea apariție), DAR cauza rădăcină (call-site-ul de arhivare tăcută) NU e izolată. *De urmărit:* `grep AT_ARCHIVE_GUARD` în loguri.

---

## TO MAKE / MONITORING — de făcut & de urmărit

1. **Soak ML-DSL Full Control** — flag APRINS, urmăresc poziții preluate + reversal-cuts + P&L. *Status azi:* 34 poziții luate, net ≈ +810, ZERO poziție ML a atins hard SL (scurgerea oprită). De monitorizat zilnic.
2. **Brain/AT flip la REAL — NU e gata.** Mutarea server-side e DEJA făcută (SP1+SP2): pe DEMO + TESTNET serverul decide, deschide, gestionează exituri/SL/DSL singur (merge cu telefonul închis). Gate-ul de execuție REAL e ON dar **inert** (uid=1 testnet, zero chei LIVE). Rămâne: (a) gard P&L testnet verde 2-3 săpt (acum NU verde), (b) SP1.5 sizing-parity proof, (c) flip `SERVER_BRAIN`+`SERVER_AT`=true pe live (SP3) + chei LIVE + GO. *De verificat:* track P&L testnet săptămânal.
3. **DSL_ML_CUT = 0** — tăierea pe reversal n-a tras încă. De urmărit: dacă rămâne 0 mult timp, poate pragul de confirmare e prea strict (ca Lever B).
4. **P&L testnet track (cron 23:58)** — ultima linie din log e goală. *De verificat:* cronul chiar produce date noi (nu e mort).
5. **Lever B Smart Loss-Cut** — live testnet, 0 tăieri (puține poziții deschise). De monitorizat când crește volumul.
6. **Bybit — ZERO rulaje reale.** Cod matur dar nedovedit. *De făcut:* soak Bybit pe un user de test separat (așteaptă cheie testnet Bybit + GO).
7. **Chei LIVE pentru REAL ML-DSL** — când decizi tu (via MultiExchange UI). Atunci ML-DSL moștenește pe real automat; primele trade-uri reale MICI + vegheate (testnet ≠ real).
8. **Verificări vizuale restante de la tine:** kill-switch overlay (pe laptop), jurnal manual „jos" (după hard-refresh), widget Android gaming (cere rebuild + reinstall APK pe telefon).
9. **Radar top300 / OI la următorul ban Binance** — de verificat că banda trece pe sursa Bybit (fix livrat, neconfirmat la ban real).
10. **„Margin insufficient" testnet** — unele fill-uri AT pe uid=1 sunt blocate fiindcă contul testnet Binance e mic. Limitare de cont, nu bug — de urmărit dacă strânge prea mult volumul de soak.
11. **CI GitHub Actions roșu — CAUZĂ REALĂ = BILLING cont GitHub (de rezolvat de tine)** — workflow-ul pică în 2s cu `runner_name=""` + zero pași, indiferent de etichetă (testat ubuntu-22.04 + ubuntu-latest): **GitHub nu alocă NICIUN runner** pe cont = problemă de billing/Actions la nivel de cont, NU din cod. Dovedit via API public Actions. Am **oprit rularea automată** (commit d5853e99, `on: workflow_dispatch` — gata emailurile roșii); deploy-ul e manual oricum. *Ca să reactivezi CI:* GitHub → Settings → Billing (+ repo Settings → Actions), apoi restaurezi trigger-ele `push`/`pull_request`. (Restul curățat: deploy-job stricat scos, `test:ci` cu 107 teste core gata pt când merge.)
12. **Vault — confirmă DOWNLOAD-ul pe Chrome desktop** — seiful zero-knowledge LIVRAT + DOVEDIT LIVE (creare+descuiere+adăugare merg, confirmate de operator; înăuntru: backup FULL 394MB + .env + chei exchange + keystore + link-uri APK). Rămâne să confirmi o dată **download-ul unui fișier pe Chrome DESKTOP** (în app/WebView download-ul de blob nu merge → folosim share nativ; fișierele mari le iei de pe Chrome). ⚠️ Uiți parola seifului = pierdut definitiv (zero-knowledge).
13. **ML pre-REAL refinements — GATA (verificat 2026-06-26).** ✅ #1 teste attribution/phantom, ✅ #4 soak-scripts (s7-sanity/soak-track/sp1-check), ✅ #6 drawdown auto-halt (`ddAssess.locked`), ✅ #5 `/api/admin/ml/stage-promote` (construit b240, audit `ML_STAGE_PROMOTE`).
    - **CE-A RĂMAS = 2 OPȚIONALE low-value (decizie: amânate, nu merită efortul acum):**
      - **#2 rafinare digest-lookup** — aproximarea `ORDER BY DESC LIMIT 1` (serverAT:2644) funcționează deja; rafinarea = a lega digest-ul exact de poziție. Nuanță, nu blocant.
      - **#3 `evaluatePerformance` cron** — funcția nici nu există; era amânat „până se adună metrici". De făcut doar dacă vrem evaluare automată post-decizie.
    - *(Separat: CSP 4-faze în `docs/CSP-MIGRATION-PLAN.md`, leagă de bug securitate #3.)*

---

## PLANS — pe viitor

1. **Hyperliquid (exchange backup)** — în caz că Binance are probleme de licență după 1 iulie. E DEX (auth = wallet Ethereum + EIP-712, nu key/secret). Plan complet scris, NU se construiește încă.
2. **Bybit proof-first** — dovedește Bybit întâi (e CEX, aproape gata) ca plasă de rezervă rapidă, înainte de efortul mare Hyperliquid.
3. **ML-DSL Faza 2 (measurement real)** — `simulateMlPath` conduce DSL live pe testnet, după ce edge-ul ML e dovedit cu date reale.
4. **Demo în fundal** — demo să tradeze în paralel cu live (nu doar engine=demo). Probabil în SP2.
5. **Roadmap server-autonomy „telefon închis" (S8-S12 / SP1-SP3) — TABLOU COMPLET, ca să nu se piardă:**
   - ✅ **GATA (S2-S8 / SP1-SP2):** validare + shadow-parity + cutover testnet. Serverul tradează SINGUR pe DEMO + TESTNET fără telefon. Calea de execuție REAL e construită (`_SRV_POS_REAL_ENABLED=true`) dar **inertă** (0 chei LIVE).
   - ✅ **S9 reflection-blocking — GATA (b240 2026-06-26):** blocarea era deja implementată (serverBrain respinge intrarea pe `proceed:false`); am adăugat alertă Telegram (Telegram E configurat → ajunge la operator) + audit `REFLECTION_BLOCKED`; **rata măsurată 13.5%** (fix în ținta 10-20%, zero tuning necesar). Blocările sunt vizibile și în „gândurile" brain-ului (mesajul „second-guessed", UI existentă). ML refinements = majoritate gata (vezi monitoring #13; rămân doar #2/#3 opționale).
   - 📊 **Garduri de dovadă înainte de real:** P&L testnet verde 2-3 săpt (monitoring #2, acum NU verde) + SP1.5 sizing-parity proof (#13).
   - 🔴 **S10 — Flip LIVE uid=1 (decizia + cheile TALE):** conectezi chei LIVE (MultiExchange UI) + pre-flight safety + aprinzi `SERVER_BRAIN`+`SERVER_AT`=true pe live → primul trade pe bani reali condus de server → soak live 14 zile (SL 100%, PnL rezonabil, zero incidente).
   - ⚪ **S11 — Rollout global:** toți userii, în trepte 25%→50%→100% (DUPĂ ce uid=1 real e dovedit 14z). Infra multi-user + scale-monitoring.
   - ⚪ **S12 — Cleanup client:** ștergi codul client de execuție (serverul = singurul executor). Ultimul pas, opțional.
   - *Sursă:* `docs/superpowers/plans/2026-05-28-s8-s12-server-autonomy.md` + specs SP1/SP2. (Planul S8-S12 din 28 mai = re-etichetat SP1/SP2/SP3.)

---

*Notă: cartea asta o țin eu la zi. Spune-mi „verificat X" și o scot de aici.*

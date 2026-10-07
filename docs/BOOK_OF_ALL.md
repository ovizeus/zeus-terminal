# Book of All

> Monitorul tău personal. Aici trec EU tot ce facem: ce-i de făcut, ce-i de verificat, ce-i bug, ce-i plan. Când verificăm ceva împreună, îl scot de aici (și din memorie). Așa nu se pierde nimic.
> **Ultima actualizare:** 2026-06-26 · build b240 v1.7.214

---

## BUGS — nerezolvate

0. 🔴 **CRITIC — SISTEMUL NU MAI TRADEAZĂ DIN 5 AUGUST.** *(diagnosticat + reparat în cod 2026-10-07; aşteaptă reload + curăţenie DB)*

   **VINOVATUL DIRECT: `PRAGMA integrity_check` rula INLINE în tick-ul doctorului, o dată la 5 minute, pe un DB de 7,9 GB.** Pragma e o scanare completă a fişierului şi better-sqlite3 e sincron → **îngheţa tot event loop-ul 3-7 minute** din fiecare 5. Dovada: `_doctor_analyzer` latenţă medie **22,8 s**, maxim **424 s** (`ml_module_heartbeats`); în fereastra de îngheţ procesul stă în kernel pe `folio_wait_bit_common`, ~2.600 `pread`/s împrăştiate pe tot fişierul, 420 MB citiţi/10 s, disc 75% util (discul e SĂNĂTOS, r_await 0,15 ms — e volum, nu hardware). Autorul ştia că e scump („full DB scan", Day 22) şi l-a throttle-uit la 5 min — dar throttle-ul nu ajută când o rulare durează mai mult decât intervalul.
   - **→ heartbeat serverBrain stale** (prag 60 s, vedea 220-290 s) → `brainWatchdog` **arma GLOBAL_HALT ~200×/zi** → `Entry blocked uid=1/2 — GLOBAL_HALT active`. Brain-ul PROPUNEA intrări (`[PENDING] Created SHORT BTCUSDT uid=1`), toate blocate. De aici şi „se conectează greu în aplicaţie": event loop-ul îngheţat nu răspunde la HTTP (`/api/health` = `000` minute întregi).
   - **CAUZA CARE A FĂCUT-O FATALĂ: retenţie lipsă pe 6 tabele ML.** Auditul din 2026-06-11 (b128 F1/F2) a pus retenţie pe `ml_influence_audit` (30d) + `brain_parity_log` (60d) şi a notat „growth now caps" — dar **a ratat 6 scriitori mai mari**, care au crescut nelimitat ~5 luni: `ml_decision_snapshots` 2,53M, `ml_decision_light` 2,53M, `ml_pit_snapshots` 2,53M, `ml_module_heartbeats` 2,36M, `ml_thinking_traces` 1,67M, `ml_latency_measurements` 1,67M (+ `ml_voice_log` 1,48M). DB 2 GB (iunie) → **7,9 GB**. La 2 GB scanarea dura ~45 s (rău, dar sub pragul de 60 s); la 7,9 GB a trecut pragul şi a omorât tradingul.
   - **REPARAT ÎN COD (TDD, 135 teste verzi):** (a) `server/services/ml/_doctor/dbIntegrityMonitor.js` + `dbIntegrityWorker.js` — scanarea mutată pe **worker thread**, cadenţă 6 h, `quick_check`, verdict cache-uit; analyzer-ul doar îl citeşte (zero lucru pe DB în tick). Pe boot „fără verdict" = NU eşec (nu armează nimic pe lipsă de dovadă). (b) `server/cron/mlTelemetryRetention.js` — retenţie pe cele 10 tabele, **ştergere în loturi rowid cu buget de timp** (un `DELETE` nemărginit pe milioane de rânduri ar fi exact bug-ul pe care-l reparăm), zilnic 04:00 UTC. (c) `scripts/db-catchup-prune.js` — recuperarea celor ~12M rânduri istorice.
   - **RĂMAS:** `pm2 reload zeus` (deploy), catch-up prune, `VACUUM` (cere app oprit), dez-armat GLOBAL_HALT, verificat că intrările revin.

   **Context istoric (diagnosticul iniţial, dimineaţa):** credeam că dimensiunea DB-ului e cauza directă; e doar amplificatorul — fără pragma inline, 7,9 GB ar fi fost doar lent, nu fatal.
   - **DB-ul a crescut la 7,9 GB** (era ~2 GB în iunie) din telemetrie ML fără retenție: `ml_decision_snapshots` 2,53M rânduri, `ml_decision_light` 2,53M, `ml_pit_snapshots` 2,53M, `ml_module_heartbeats` 2,36M, `ml_thinking_traces` 1,67M, `ml_latency_measurements` 1,67M, `ml_voice_log` 1,48M, `brain_decisions` 849k. WAL = 105 MB.
   - **I/O saturat** → procesul stă blocat în kernel pe `folio_wait_bit_common` (așteaptă pagini de pe disc): ~2.600 `pread` pe secundă împrăștiate pe tot fișierul de 7,9 GB, **420 MB citiți la 10 secunde**, disc la 75% util. RAM: 7,7 GB total, doar 236 MB liberi — DB-ul nu încape în page cache.
   - **Event loop-ul întreg îngheață 3-4 minute** din ~5 (nu doar brain-ul: și WS_PROXY și LIQ-FEED sar peste tick-uri; `/api/health` nu răspunde deloc pe 2 min de eșantionare).
   - **→ `brainWatchdog` vede heartbeat stale (prag 60s, vede 220-290s) → armează GLOBAL_HALT** ~200×/zi (debounce 5 min). Loguri: `Entry blocked uid=1/2 — GLOBAL_HALT active`. Brain-ul chiar propune intrări (`[PENDING] Created SHORT BTCUSDT uid=1`) — sunt toate blocate.
   - **Rezultat:** ultima poziție deschisă = **2026-08-05 23:04**. CREATED pe lună: iun 321 → iul 66 → aug 11 → **sept/oct 0**. P&L track 21 zile = 2 trade-uri, ambele DEMO, zero testnet. ML influence: `accepted=0 rejected=0 skipped=347.782`.
   - **Agravant independent: 13 rânduri nerezolvabile în `emergency_close_queue`** (id 36-48, toate create 2026-08-18 04:08:00), toate simboluri **COIN-M** (`BTCUSD_PERP`, `ETHUSD_PERP`, `XRPUSD_PERP`…) pe care calea de închidere USDⓈ-M le respinge cu „Invalid symbol" → retry la fiecare tick **la infinit** (5.200 încercări doar azi) → `[BINANCE] Circuit breaker OPEN — 25 consecutive failures` → și `listenKey` nu se mai poate recrea.
   - *Reparație propusă (AȘTEAPTĂ GO, nimic atins):* (a) rezolvă/anulează cele 13 rânduri COIN-M + gardă de simbol ca să nu reintre în coadă, (b) retenție + prune pe tabelele ML uriașe + `VACUUM` (DB jos la ordin de mărime normal), (c) dez-armă GLOBAL_HALT, (d) verifică că intrările revin. Ordinea contează: fără (b) halt-ul se re-armează.
   - *De reținut:* soak-ul Bybit pe Mirela (pornit 26 iun) n-a avut cum să ruleze — e inclus în același blocaj.

0.1 🟠 **Plasa de siguranţă anti-orfani e DEZACTIVATĂ TĂCUT** *(găsit 2026-10-07, money-path — AŞTEAPTĂ GO, nereparat)*. `emergency_close_queue` are 13 rânduri (id 36-48) imposibil de rezolvat, toate din 2026-08-18 04:08. Trei defecte care se compun în `server/services/emergencyCloseProcessor.js`:
   - **(a) Erorile permanente sunt tratate ca tranzitorii.** Handler-ul pune „Invalid symbol" (Binance -1121) în acelaşi sac cu „CB open / rate-limit / timeout" → `retrying next tick` **la infinit** (5.200 încercări într-o zi). Fiecare încercare loveşte Binance → `Circuit breaker OPEN — 25 consecutive failures` → şi `listenKey` nu se mai poate recrea.
   - **(b) Blocaj de cap de coadă (cel grav).** `MAX_ROWS_PER_TICK = 10` + `ORDER BY id` → cele 10 rânduri otrăvite din frunte consumă fiecare tick; **rândurile 46, 47, 48 n-au fost încercate NICIODATĂ**. Dacă apare un orfan REAL, nu intră niciodată la rând. Pe testnet e inofensiv; cu chei LIVE ar însemna o poziţie neprotejată pe care coada nu o atinge.
   - **(c) Zero contor de încercări / dead-letter.** Nimic nu numără eşecurile şi nimic nu scoate un rând din rotaţie, deci starea e permanentă.
   - *Fix propus:* clasificare erori permanente → rezolvă rândul + alertă P0 (o poziţie neadministrabilă cere ochi de om); coloană `attempts` + dead-letter după N; `ORDER BY attempts ASC, id ASC` ca rândurile noi să prindă rând chiar şi cu otravă în coadă.

0.2 🟠 **Recon-ul adoptă poziţii COIN-M pe care sistemul nu le poate administra** *(găsit 2026-10-07, money-path — AŞTEAPTĂ GO, nereparat)*. Contul testnet uid=1 avea poziţii COIN-M reale (`SAT_RECON_ORPHAN_ADOPTED`: `{"symbol":"BTCUSD_PERP","side":"LONG","amt":778}`); recon-ul le-a adoptat ca orfani, dar **toată calea de administrare/închidere merge pe `/fapi` (USDⓈ-M)** → `Invalid symbol` pentru orice `*USD_PERP`. Sistemul nu suportă COIN-M nicăieri. Aşa s-au născut cele 13 rânduri de la 0.1 (`decision_key = closefail_<seq>_RECON_PHANTOM_STALE_EMPTY`). *Fix propus:* filtru la adopţie — simbolurile care nu există în `exchangeInfo` USDⓈ-M sunt ignorate (+ log/alertă o dată), nu adoptate.

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
6. **Bybit — SOAK PORNIT pe Mirela (uid=2), 2026-06-26.** Cheie testnet copiată de la uid=1 (criptare globală, cont activ), `BYBIT_DRY_RUN_ONLY`=OFF, Mirela = cutover user → serverul tradează Bybit testnet pe contul ei ($75.625 fake, cheie verificată live). **uid=1 Binance soak NEATINS.** `BYBIT_LIVE_ENABLED`=OFF (zero bani reali). *De urmărit:* (a) primele ordine Bybit chiar EXECUTĂ (e prima oară — cod nedovedit până azi), (b) gap-ul **polling** (Bybit n-are WS privat nativ → fills prin polling, log `[USERDATA] skip uid=2 ... Binance-only`), (c) câteva zile P&L + orfani. *Reversibil:* `BYBIT_DRY_RUN_ONLY`=ON + scot uid=2 din `data/sp2_cutover_users.json` + reload.
7. **Chei LIVE pentru REAL ML-DSL** — când decizi tu (via MultiExchange UI). Atunci ML-DSL moștenește pe real automat; primele trade-uri reale MICI + vegheate (testnet ≠ real).
8. **Verificări vizuale restante de la tine:** kill-switch overlay (pe laptop), jurnal manual „jos" (după hard-refresh), widget Android gaming (cere rebuild + reinstall APK pe telefon).
9. **Radar top300 / OI la următorul ban Binance** — de verificat că banda trece pe sursa Bybit (fix livrat, neconfirmat la ban real).
10. **„Margin insufficient" testnet** — unele fill-uri AT pe uid=1 sunt blocate fiindcă contul testnet Binance e mic. Limitare de cont, nu bug — de urmărit dacă strânge prea mult volumul de soak.
11. **CI GitHub Actions roșu — CAUZĂ REALĂ = BILLING cont GitHub (de rezolvat de tine)** — workflow-ul pică în 2s cu `runner_name=""` + zero pași, indiferent de etichetă (testat ubuntu-22.04 + ubuntu-latest): **GitHub nu alocă NICIUN runner** pe cont = problemă de billing/Actions la nivel de cont, NU din cod. Dovedit via API public Actions. Am **oprit rularea automată** (commit d5853e99, `on: workflow_dispatch` — gata emailurile roșii); deploy-ul e manual oricum. *Ca să reactivezi CI:* GitHub → Settings → Billing (+ repo Settings → Actions), apoi restaurezi trigger-ele `push`/`pull_request`. (Restul curățat: deploy-job stricat scos, `test:ci` cu 107 teste core gata pt când merge.)
12. **Vault — confirmă DOWNLOAD-ul pe Chrome desktop** — seiful zero-knowledge LIVRAT + DOVEDIT LIVE (creare+descuiere+adăugare merg, confirmate de operator; înăuntru: backup FULL 394MB + .env + chei exchange + keystore + link-uri APK). Rămâne să confirmi o dată **download-ul unui fișier pe Chrome DESKTOP** (în app/WebView download-ul de blob nu merge → folosim share nativ; fișierele mari le iei de pe Chrome). ⚠️ Uiți parola seifului = pierdut definitiv (zero-knowledge).
---

## PLANS — pe viitor

1. **Hyperliquid (exchange backup)** — în caz că Binance are probleme de licență după 1 iulie. E DEX (auth = wallet Ethereum + EIP-712, nu key/secret). Plan complet scris, NU se construiește încă.
2. **Bybit proof-first** — dovedește Bybit întâi (e CEX, aproape gata) ca plasă de rezervă rapidă, înainte de efortul mare Hyperliquid.
3. **ML-DSL Faza 2 (measurement real)** — `simulateMlPath` conduce DSL live pe testnet, după ce edge-ul ML e dovedit cu date reale.
4. **Demo în fundal** — demo să tradeze în paralel cu live (nu doar engine=demo). Probabil în SP2.
5. **Roadmap server-autonomy „telefon închis" (S8-S12 / SP1-SP3) — ce-a RĂMAS până la REAL:** *(făcut până la S9 = vezi FĂCUTE; serverul tradează singur pe DEMO+TESTNET, calea REAL e construită dar inertă — 0 chei LIVE)*
   - 📊 **Garduri de dovadă înainte de real:** P&L testnet verde 2-3 săpt (monitoring #2, acum NU verde) + SP1.5 sizing-parity proof.
   - 🔴 **S10 — Flip LIVE uid=1 (decizia + cheile TALE):** conectezi chei LIVE (MultiExchange UI) + pre-flight safety + aprinzi `SERVER_BRAIN`+`SERVER_AT`=true pe live → primul trade pe bani reali condus de server → soak live 14 zile (SL 100%, PnL rezonabil, zero incidente).
   - ⚪ **S11 — Rollout global:** toți userii, în trepte 25%→50%→100% (DUPĂ ce uid=1 real e dovedit 14z). Infra multi-user + scale-monitoring.
   - ⚪ **S12 — Cleanup client:** ștergi codul client de execuție (serverul = singurul executor). Ultimul pas, opțional.
   - *Sursă:* `docs/superpowers/plans/2026-05-28-s8-s12-server-autonomy.md` + specs SP1/SP2. (Planul S8-S12 din 28 mai = re-etichetat SP1/SP2/SP3.)

---

## ✅ FĂCUTE recent — ce-am livrat (arhivă, ca să vezi progresul)

> Aici cobor ce-i GATA + verificat, ca lista de sus să rămână doar activ. Git/changelog au detaliul complet.

**2026-06-26:**
- **S9 reflection-blocking** (b240) — brain-ul respinge singur deciziile proaste; am adăugat alertă Telegram + audit `REFLECTION_BLOCKED`; rată 13.5% (în ținta 10-20%, zero tuning). Efectul se vede pe Telegram + „gândurile" brain-ului.
- **ML pre-REAL refinements** (b240) — #5 endpoint `/api/admin/ml/stage-promote` construit; #1 teste / #4 soak-scripts / #6 drawdown-halt confirmate deja gata. *Rămase opționale (amânate deliberat, low-value):* #2 rafinare digest-lookup, #3 `evaluatePerformance` cron.
- **Vault zero-knowledge** (b236-b240) — seif criptat creat + umplut: backup FULL 394MB (DB+.env+restore) + .env + chei exchange + keystore + link-uri APK; streaming-encrypt pt fișiere mari. *(Confirmarea download-ului pe Chrome = monitoring #12, încă activă.)*
- **Book of All + roadmap** — roadmap server-autonomy S8-S12/SP1-SP3 capturat complet în Plans; 12 docuri vechi de audit scanate (toate închise/istorice).
- **Fix-uri UI** — chart gol la schimbare de simbol REPARAT (b234, try/catch per-indicator); particulele verzi QM scoase de tot (b235).

---

*Notă: cartea asta o țin eu la zi. Spune-mi „verificat X" și o scot de aici.*

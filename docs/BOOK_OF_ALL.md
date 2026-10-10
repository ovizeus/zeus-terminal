# Book of All

> Monitorul tău personal. Aici trec EU tot ce facem: ce-i de făcut, ce-i de verificat, ce-i bug, ce-i plan. Când verificăm ceva împreună, îl scot de aici (și din memorie). Așa nu se pierde nimic.
> **Ultima actualizare:** 2026-10-10 · build b264 v1.7.238
> **Ordinea de mai jos e ordinea în care le facem.** 🔧 = o fac eu · 🙋 = are nevoie de tine (decizie, chei, sau ochii tăi).

---

## 🔧 DE FĂCUT — în ordinea priorităţii

> *(**2026-10-10:** auditul de persistență la refresh a adăugat P11-P15 și constatările R1-R9. **Închise azi: P12** (tipul de lumânare, b265) **și P11** (cele opt chei care suprascriau, b266) — P12 era o instanță din clasa lui P11. Rămân 13, din care **2 sunt ale mele**: P14 Radar Lens și R9.)*

**P1 🔥 Rafala de rate-limit Binance** *(A2)*. 44 de intrări în SUPPRESSED, continuu din ora 08:00 ieri. Depăşeşte 6000/min pe `positionRisk`, declanşează întrerupătorul de IP (taie **toate** cererile semnate 61s) şi rupe reînnoirea `listenKey`. Backoff-ul escaladează şi nu se resetează. Pistă: `serverAT.js:5399` cere `positionRisk` **per poziţie**, deşi comentariul de la 5676 zice per user. N-am atins pollingul — cale de bani, vreau cauza dovedită. **Singurul lucru mare rămas care e al meu.**

**P2 🙋 Calibrarea auto-carantinei ML.** Pragul e `min_trades: 100` pe fereastră de **24h**, la ~11 evenimente/zi — matematic inaccesibil. *Decizia ta:* (a) fereastră 7-30 zile, prag 100 — **recomandarea mea**; (b) prag mai mic; (c) o lăsăm.

**P3 🙋 Cheia API Bybit testnet a uid=2 (Mirela) e expirată.** Regenerezi din UI (MultiExchange).

**P4 🙋 WebSocket-ul de futures Binance e blocat de reţea** *(A3)*. Nu e de reparat în cod — socket-ul se conectează dar primeşte zero cadre, în timp ce REST-ul merge. Soluţie de rutare, făcută împreună: un WARP pe VPS-ul ăsta a mai stricat lucruri o dată.

**P5 🙋 `nodemailer` 8.0.11 → 10.0.16**, breaking, pe calea de auth. Nu-l fac fără un test real de trimitere cu tine.

**P6 🙋 Keystore-ul de release Android e în git.** Scos din istoric **şi rotit**, sau mutat în Vault.

**P7 🙋 Precedenţa „plat vs per-mod" pe calea OFFLINE.** Decizie de produs: offline, care sursă câştigă?

**P8 🙋 Conectarea ML-ului neconectat — plan scris, aşteaptă GO.** 74 din 284 fişiere legate, 198 din 367 tabele goale, dar **209 din 210 module neconectate AU teste**. Se poate, dar nu în bloc. Etapa 0 e ieftină şi nu atinge nimic viu.

**P9 🙋 Cauza corupţiei WAL — rămâne deschisă.** Fără erori de disc, spaţiu suficient, proprietari corecţi, nimeni conectat. Auto-vindecarea acoperă repetarea; fişierele corupte sunt păstrate în `/root/zeus-recover/`.

**P10 🙋 Confirmări vizuale:** TERMINATOR pe chart, kill-switch overlay, jurnalul manual „jos", widget Android, Vault download pe Chrome desktop.

**P11 ✅ REZOLVAT (b266 v1.7.240) — cele opt chei care suprascriau valoarea salvată** *(R1)*. Am urmărit **fiecare cheie pe rând până la proprietarul ei real** înainte să ating ceva, și magazinul de setări nu era proprietarul niciuneia: `theme`/`soundEnabled` trăiesc în localStorage, `llvSettings`/`zsSettings` aparțin canalului user-context (verificat pe viu: 9 din 9 rânduri, respectiv `chartExtras` pe disc), `uiScale` e o funcție **scoasă în iunie**, `timezoneOffset` e duplicat mort, iar `liqSettings`/`srSettings` nu au proprietar deloc. Deci nu le-am inventat valori — **nu se mai trimit**, și o cheie absentă din payload lasă valoarea stocată neatinsă. **10 teste**, 9 picate prima dată pe cauza corectă și unul trecând de la început ca gardă că tot ce e deținut real se trimite în continuare. Client 720/720 (97 fișiere), paritate validator 4/4, tsc curat.

> ⚠️ **Ce NU am făcut, intenționat:** să fac tema și sunetul să te urmeze pe alt dispozitiv. Asta cere și aplicare-la-boot, iar să conectez doar jumătatea de salvare e exact greșeala care a făcut tipul de lumânare să pară reparat trei zile. **E decizie de produs, a ta.** Și încă ceva cinstit: reparaţia oprește suprascrierea de aici înainte — valorile deja pierdute nu sunt înregistrate nicăieri, deci nu pot fi recuperate.

**P12 ✅ REZOLVAT (b265 v1.7.239) — tipul de lumânare nu persista** *(R2)*. Lipsea `ch.candleType` din `_projectFromLegacy`. O linie de proiecție, **3 teste noi** picate toate prima dată pe cauza corectă, unul dintre ele parcurgând tot drumul hidratare → proiecție → salvare, ca să nu mai poată fi reparată doar o jumătate. Client 710/710, tsc curat. **De confirmat vizual la tine:** alege Heikin Ashi, refresh, trebuie să rămână.

**P13 🔧 `LIQ CHART SETTINGS` e un modal decorativ** *(R3)*. Nu are cititori nicăieri. Două variante: îl conectăm la overlay-ul de lichidări, sau îl scoatem din UI ca să nu mintă. 🙋 *Decizia ta — nu ştiu dacă vrei funcţia sau curăţenia.*

**P14 🔧 Radar Lens se resetează la refresh** *(R4)*. Serverul e gata (whitelist + validator); lipseşte doar partea de client. **Al meu.**

**P15 🙋 Desenele de pe chart nu urmează utilizatorul** *(R5)*. Supravieţuiesc refresh-ului, dar se pierd pe alt dispozitiv / la reinstalare APK. De dus în sincronizarea pe server — dar desenele pot fi mari, deci vreau să stabilim un plafon împreună înainte să le pun pe fir.

---
## 🔁 AUDIT DE PERSISTENŢĂ LA REFRESH 2026-10-10 — „ce nu se menţine"

> Cerut de operator: *„vreau sa mai cauti buguri la refresh de mentinere sa nu se reseteze... la indicatori chart etc tot"*.
> Metodă: am urmărit mecanic cele **patru verigi** (salvare → whitelist server → hidratare → aplicare la boot) pentru fiecare cheie, apoi am **confirmat pe baza vie** citind `user_settings` pentru toţi cei 9 utilizatori. Nimic de aici nu e presupunere: fiecare constatare are dovada lângă ea.
>
> Context care contează: Zeus are **două canale** de persistare, nu unul — `/api/user/settings` (chei plate, tabela `user_settings`) şi `/api/sync/user-context` (secţiuni, construite de `_buildAllSections`). Se suprapun parţial şi **nu sunt de acord între ele**. De acolo vin aproape toate constatările de mai jos.

### 🔴 GRAV

**R1. ✅ REPARAT (b266) — Opt chei erau scrise-din-oficiu și citite-de-nimeni: fiecare salvare suprascria copia din server cu valori hardcodate.**
`DEFAULT_SETTINGS` (`client/src/stores/settingsStore.ts:325-339`) declară `theme, uiScale, soundEnabled, chartType, timezoneOffset, liqSettings, llvSettings, zsSettings, srSettings`. `_projectFromLegacy()` (`settingsStore.ts:607`) **nu citeşte niciuna** din starea legacy, iar `_projectToLegacy()` / `_syncToWindow()` **nu scriu niciuna** înapoi. La fiecare `loadImpl` se face `merged = { ...DEFAULT_SETTINGS, ...projected }` — proiecţia nu le conţine, deci revin la default. Apoi `saveToServer` trimite `payload = { ...settings }`, iar serverul face `merged = { ...existing, ...clean }` (`server/routes/trading.js`), unde **un `null` suprascrie**.
*Dovada, pe baza vie — zero varianţă la 9 din 9 utilizatori:*

| cheie | valoare în DB la toţi | ce ar trebui |
|---|---|---|
| `theme` | `"native"` ×9 | alegerea userului |
| `uiScale` | `100` ×9 | alegerea userului |
| `soundEnabled` | `true` ×9 | alegerea userului |
| `chartType` | `"candle"` ×8, `"candles"` ×1 | tipul de lumânare ales |
| `timezoneOffset` | `null` ×9 | — |
| `liqSettings` / `llvSettings` / `zsSettings` / `srSettings` | `null` ×9 | setările de overlay |

`chartType` e dovada cea mai curată: 8 utilizatori încă ţin `"candle"` — valoarea despre care **comentariul propriu al codului** (`config.ts:1786`) spune că *nu e un id din `CANDLE_TYPES` şi nu putea fi aplicată niciodată*. Nimeni nu a scris vreodată valoarea aia; a pus-o salvarea. Zero varianţă la 9 utilizatori nu e coincidenţă — e semnătura unei chei pe care o scrie doar codul.
*Atenuare parţială:* valorile reale ale lui `uiScale`, `llvSettings` şi `zsSettings` trăiesc de fapt în celălalt canal (secţiunile UC), deci acelea chiar persistă — copia din `user_settings` e un fantomă care induce în eroare. Pentru `theme`, `chartType`, `liqSettings`, `srSettings` **nu există nicio copie care funcţionează** (vezi R2, R3, R4).

**R2. ✅ REPARAT (b265) — Tipul de lumânare NU putea persista; jumătatea de scriere a drumului lipsea.**
`candleTypeSwitcher.ts:196` scrie `USER_SETTINGS.chart.candleType = type` şi cheamă `_usScheduleSave`. Dar `_projectFromLegacy` **nu citeşte `ch.candleType`**, deci magazinul rămâne pe default-ul `'candles'`, salvarea trimite `chartType: 'candles'`, iar la boot `_usApplyFlatToUserSettings` (`config.ts:1784`) ia `flat.chartType` şi **scrie default-ul înapoi** în `chart.candleType`.
Ciclul e închis — doar că pe valoarea greşită. **Simptom: alegi Heikin Ashi, dai refresh, te întorci la candles.** Reparaţia din 2026-10-07 a rezolvat jumătatea de *citire* şi a lăsat-o pe cea de *scriere*, de aceea pare reparat şi nu e. Confirmat de DB: niciun utilizator nu are vreodată altceva decât default.
*Reparat:* `chartType: ch.candleType` în `_projectFromLegacy`; teste în `client/src/stores/__tests__/candleTypePersist.test.ts`.

### 🟠 MEDII

**R3. `LIQ CHART SETTINGS` nu face absolut nimic — nici în sesiune, nici după refresh.**
`client/src/components/modals/LiqSettingsModal.tsx`: cele patru `useState` au valori **hardcodate** (`'BTC'`, `'$500'`, `'24h'`, `'$USD'`) şi nu citesc niciodată din `w.S.liqSettings` — deci modalul arată default-urile chiar şi redeschis în aceeaşi sesiune. `saveAndApply()` scrie în `w.S.liqSettings`, dă `toast('Liq settings applied')` şi se închide. Căutat în tot `client/` şi `server/`: **zero cititori** ai lui `liqSettings`, nicio scriere în localStorage, nicio secţiune UC. Modalul e decorativ. `srSettings` e şi mai gol: whitelistat pe server, dar **nici writer, nici reader** nicăieri.

**R4. Radar Lens se resetează la fiecare refresh — jumătatea de client nu a fost scrisă niciodată.**
Whitelist-ul serverului are `'radarLens'` cu comentariul *„Radar Lens (D4 persistence)"* (`trading.js:807`) şi validatorul îl acceptă. Dar `RadarLensBar` (`client/src/components/brain/BrainCockpit.tsx:18-28`) ţine lentila şi timeframe-ul în `useState('hybrid')` / `useState('5m')` simple: fără localStorage, fără save, fără load. Nimic în tot clientul nu trimite vreodată cheia — **`radarLens` e ABSENT la toţi cei 9 utilizatori din DB**. Persistenţa a fost pregătită pe server şi nu a fost niciodată conectată în UI.

**R5. Desenele de pe chart, indicatorii cu stea şi tema sunt doar pe dispozitiv.**
`zeus_drawings_v1` + `zeus_drawings_vis` (trendlinii etc.), `zeus_ind_favorites` (★) şi `zeus_theme` sunt corect user-scoped în `_USER_KEYS`, deci **supravieţuiesc refresh-ului** şi nu se mai amestecă între conturi. Dar niciuna nu apare în `_buildAllSections()` şi niciuna nu ajunge în `user_settings`: se pierd la cache-clear, pe alt dispozitiv şi la reinstalarea APK-ului. Pentru un trader, desenele pierdute sunt cel mai scump element din listă.
*(Verificat mecanic: din cele 74 de chei user-scoped, 31 nu sunt în nicio secţiune UC. Majoritatea sunt corect locale — PIN, chei API, tab-leader, starea beacon-ului. Cele 4 de mai sus sunt cele care ar trebui să urmeze utilizatorul.)*

### 🟡 MICI

**R8. `public/app/assets` era root-owned** — de la un build rulat ca root la 05:47. Deploy-ul de azi a picat cu `EACCES` până l-am dat înapoi lui `zeus`. Aceeași familie cu incidentul `migration_flags.json`: ce lasă root în urmă blochează tăcut procesul zeus — și e greșeala mea. *Reparat la deploy; de verificat la fiecare build.*

**R9. Pull-ul user-context pune `fontSize` din `uiScale` — o funcție scoasă în iunie.** `config.ts:782` face `document.documentElement.style.fontSize = sec.uiScale.data + 'px'`. Dacă secţiunea ar purta `100`, rădăcina ar primi **font de 100px** și interfața ar exploda. **Nu e armată:** verificat pe viu — `uiScale.data` e `null` la uid=1 și nu există niciun rând în `user_ctx_data`, iar garda `data != null` blochează calea. Dar codul mort a rămas. *De șters, nu de reparat — n-am înlănțuit-o cu P11 ca să nu amestec două schimbări.*

**R6. `zeus_dsl_parity_shadow` nu e în `_USER_KEYS`** — singura cheie `zeus_*`/`zt_*` rămasă neizolată după reparaţia de ieri, deci se împarte între două conturi pe acelaşi browser. E un jurnal de diagnostic, nu o setare; impactul e doar date de paritate amestecate.

**R7. ✅ REPARAT (b266) — `timezoneOffset` era un duplicat mort** al lui `chartTz` (care chiar e proiectat, prin `ch.tz`). Nu se mai trimite. Rămâne whitelistat pe server intenționat, ca un client mai vechi să nu primească 400.

### ✅ Verificat şi NU e bug *(la fel de util)*
- **Paritatea whitelist ↔ validator** e ţinută de un test (`tests/unit/settingsValidatorParity.test.js`). Clientul nu trimite nicio cheie necunoscută: zero avertismente „not in the whitelist" în loguri.
- **Scoping-ul localStorage nu are asimetrie.** `localStorage.getItem/setItem/removeItem` sunt înlocuite global (`state.ts:149-151`), deci şi apelurile brute din `config.ts` sunt scope-uite. Am suspectat că `_indSettingsSave` scrie scope-uit şi `_indSettingsLoad` citeşte nescope-uit — **nu e aşa.**
- **Momentul în care se află uid-ul e corect.** `_zeusUserId` vine din cookie-ul `zeus_uid` sincron, în capul lui `state.ts`, înaintea lui `_indSettingsLoad()`. Dacă ar fi venit mai târziu, TOATE setările ar fi părut resetate la fiecare boot.
- **Cookie-urile `zeus_token` şi `zeus_uid` au acelaşi `maxAge`**, iar `/auth/me` reîmprospătează `zeus_uid`. Nu există fereastră în care eşti logat dar fără uid (care ar fi arătat exact ca o resetare totală).
- **Parametrii per-indicator (`zeus_ind_settings`) chiar fac dus-întors** prin secţiunea UC `indSettings`, inclusiv pull-ul care îi scrie înapoi.
- **Dubla sursă pentru timeframe** (`zeus_chart_tf` device-local vs `chartTf` din server) e deja cunoscută şi documentată în cod (`settingsStore.ts:96`).

---
## 🔍 AUDIT DE BUGURI 2026-10-09 — grave / medii / mici

> Metodă: **nimic pe bază de regex sau presupunere.** Am construit o bază în memorie cu schema reală (400 de tabele) şi am *preparat efectiv* toate cele 1522 de interogări statice din `server/`; am rulat tiparele suspecte pe baza vie (doar citire); iar pe ce se putea atinge din afară am testat cu `curl` de pe internet. Fiecare constatare de mai jos are dovada lângă ea. Ce am verificat şi **nu** e bug e listat la final — e la fel de util.

### 🔴 GRAVE

**A1. ✅ REPARAT (b258) — stratul ML de reflecţie („cold path") rula la 5 minute şi nu producea NIMIC.**
`ml_reflection_runs` arăta la **fiecare** rulare `modules_run=11`, `modules_failed=0`, **`total_insights=0`** — părea sănătos tocmai fiindcă eşecurile se numărau separat de insight-uri, iar toate analizele erau în `catch (_) {}`.
*Ce am găsit uitându-mă la fiecare din cele patru „analize":* erau apeluri către nimic.
- `computeCoherenceScore` — primea `{recentDecisions: []}`, dar cere obligatoriu un `thread`; şi **nu există nicio funcţie care să enumere thread-uri**, deci n-are cum să fie rulată periodic;
- `getAttributionStats` — **nu există**; modulul ăla exportă doar ajutoare per-eveniment (`recordAttribution`, `classifyDominantAttribution`), nimic periodic;
- `checkQuarantine` — **nu există** nici ea; scanarea reală e `scanAllFeatures`, pe care `mlScanCron` o deţine deja la 4h — rulată aici la 5 minute ar fi dublat, nu adăugat;
- `evaluateDominance` — **reală**, dar primea praguri în loc de tabloul `hypotheses` pe care îl cere.
*Fix:* singura analiză cu adevărat periodică (dominanţa între ipoteze concurente) primeşte acum date reale — descoperă perechile (user, mediu) cu probe recente, exact ca `mlScanCron`, ia ipotezele cu `getCompetingHypotheses` şi evaluează. Celelalte trei **le-am şters**, nu le-am lăsat să se prefacă: un strat de reflecţie care nu reflectă nimic e mai rău decât unul oprit, fiindcă pare că lucrează. Cronul raportează acum ce a făcut, iar „0 insights" e avertisment, nu tăcere.

**A2. 🔎 DIAGNOSTIC COMPLET — rate-limit-ul Binance: cauza e WebSocket-ul blocat, iar leacul mare e o singură cerere în loc de N.** *(măsurat 2026-10-10)*

*Starea acum:* **NORMAL, strikes=0.** Rafala a fost un episod mărginit: 08:00 → 17:50 ieri (ultimul a fost un **418**, ban de IP, nu 429). De atunci, curat.

*Măsurat pe sistemul viu* (`/api/diag/binance-rates`), consumul de bază e **345 cereri/minut — 6% din plafonul de 6000/min**. Deci ieri s-a ajuns la ~17× normalul. Clasamentul:

| sursă | cereri/min | ce e |
|---|---|---|
| `marketFeed:altPrice` | **139,8** | înlocuitorul REST al WS-ului blocat |
| `markprice-cache` | 60,0 | idem |
| `wsproxy-watchlist` | 48,1 | poll watchlist |
| `marketFeed:alt-klines` | 42,1 | înlocuitorul REST al WS-ului blocat |
| `marketRadar:oi` | 25,1 | open interest (n-are WS oricum) |

**A2 şi A3 sunt aceeaşi problemă.** Comentariul din cod o spune: pollerul de preţ merge „pe calea pe care ar fi mers bookTicker WS (blocat)". Datacenter-ul blochează WebSocket-ul de futures Binance → Zeus cade pe REST → **~70% din tot traficul către Binance există doar din cauza asta**.

*Mecanismul exact al exploziei:* `ALT_PRICE_POLL_MS = 3000` — o cerere **la 3 secunde, per simbol**. Azi, 7 simboluri = 140/min. Scalează **liniar**: 50 de simboluri = 1000/min, **300 de simboluri = 6000/min, adică fix plafonul**. De asta a fost burst, nu creştere lentă: când setul de simboluri urmărite creşte (radar/watchlist), pollerul de 3 secunde loveşte tavanul.

### Ce e de făcut, în ordinea raportului câştig/risc

1. **🔧 O singură cerere în loc de N (cel mai mare câştig, doar cod).** `/fapi/v1/ticker/price` **fără** parametrul `symbol` întoarce **toate simbolurile într-un singur apel** — testat acum: HTTP 200, **789 de simboluri**. Pollerul devine 1 cerere/tick indiferent de câte simboluri urmărim: azi **140/min → 20/min**, iar la scară diferenţa dintre „merge" şi „ban". Greutatea scade şi ea (7×1 → 2). *Cere grijă: e calea de preţ pe care o foloseşte tranzacţionarea, deci se face cu teste, nu pe repede înainte.*
2. **🙋 Deblocarea WebSocket-ului** *(A3)*. Ar scoate din ecuaţie ~70% din trafic, nu doar îl comprimă — şi ar readuce şi feed-ul de lichidări Binance. Dar e la nivel de reţea, iar un WARP pe VPS-ul ăsta a mai stricat lucruri o dată: **se face cu tine de faţă.**
3. **🔧 Plafon pe numărul de simboluri pollate.** Chiar cu (1), o listă nelimitată rămâne un risc. O limită explicită + un log când se atinge.
4. **🔧 Interval mai larg** (3s → 5s) — câştig liniar, mic. De făcut doar dacă (1) nu e suficient; 3 secunde e o prospeţime pe care o foloseşte tranzacţionarea.

⚠️ *Gaură de diagnostic:* telemetria apelurilor e **doar în memorie** — la repornire se pierde. De asta nu pot spune retroactiv cine a ars cota ieri; am putut măsura doar baza de azi. Merită persistat un rezumat orar.

**A3. ⚠️ RECLASIFICAT — NU e bug de cod: reţeaua datacenter-ului blochează WebSocket-ul de futures Binance.** *(reclasificat 2026-10-10)*
Raportasem „feed-ul de lichidări Binance e conectat dar nu primeşte nimic, 551 de raportări consecutive cu `frames=0`". Faptul e real, **dar cauza nu e în codul nostru** — iar aplicaţia o spune deja singură în log:
`[LIQ-FEED] BNB silent >2min — datacenter network appears to block fstream.binance.com WS data flow (REST+SPOT WS work; FUTURES WS silent)`
*Verificat independent de mine:* `wss://fstream.binance.com` **se conectează** (TCP+TLS în regulă) dar livrează **zero cadre în 20 de secunde**, în timp ce REST-ul pe `fapi.binance.com` răspunde HTTP 200. Deci nu e abonare greşită, nu e parser rupt: pachetele pur şi simplu nu vin.
*Ce rămâne adevărat:* harta de lichidări rulează fără cea mai mare bursă, iar Bybit şi OKX o acoperă parţial.
*Ce NU e de făcut în cod:* nimic — detecţia funcţionează deja. E o chestiune de rutare de reţea. **Atenţie:** un WARP instalat pe acest VPS a mai stricat lucruri o dată (vezi regula din memorie), deci orice soluţie de rutare se face cu tine de faţă, nu pe cont propriu.

**A4. ✅ REPARAT (b262) — ZEUS A FOST JOS 3 ORE ŞI JUMĂTATE PESTE NOAPTE; baza NU era problema.** *(2026-10-10, 00:34 → 04:04)*
La **00:34:08** write-ahead log-ul (WAL) s-a corupt şi orice citire de schemă a început să dea `malformed database schema (9054)`. Fiindcă prima citire se face la `require`, procesul murea înainte să apuce să reacţioneze: **1082 de reporniri**, 502 la fiecare vizitator, **şi nicio alertă**. Ai găsit-o tu, după ore.
*Diagnostic:* fişierul bazei era **intact tot timpul** — deschis fără WAL a pornit imediat (1192 obiecte), iar `PRAGMA integrity_check` complet a răspuns **ok**. Datele erau întregi: setările tale de aseară (20:12), ultima decizie brain 00:34, 401 tabele.
*Reparaţie:* oprit bucla, mutat `-wal` şi `-shm` deoparte (**păstrate**, nu şterse), repornit. Zeus a urcat în 25 de secunde.
*Prevenţie livrată:* deschiderea bazei sondează acum schema şi, la o eroare de corupţie, **pune WAL-ul în carantină (redenumit, niciodată şters) şi reîncearcă o dată**. SQLite nu poate citi oricum un WAL corupt, deci nu se pierde nimic recuperabil, iar fişierul rămâne pentru analiză. Corupţia bazei *propriu-zise* rămâne fatală intenţionat — a porni pe o bază stricată e mai rău decât a sta jos.
*Cauza corupţiei: NESTABILITĂ, şi n-o inventez.* Fără erori de kernel sau disc, 41 GB liberi, ambele fişiere deţinute corect de `zeus`, nimeni conectat la acea oră (shell-urile mele `sqlite3` fuseseră cu ore înainte şi n-au lăsat artefacte root). Rămâne deschisă.
*Backup:* cel de noapte eşuase pe baza coruptă (`VACUUM INTO failed`) — bine, fiindcă n-a suprascris unul bun. Am luat unul proaspăt imediat după reparaţie: `zeus-offsite-20261010-040952.db.enc` (2,7 G → 275 M).
⚠️ **Gaura rămasă, mai importantă decât bugul:** 1082 de prăbuşiri în 3,5 ore şi **zero alerte**. Auto-vindecarea acoperă acest caz; nu acoperă „Zeus e jos din orice alt motiv". *De făcut:* o alertă Telegram pe prăbuşire repetată.

### 🟡 MEDII

**B1. ✅ REPARAT (b257) — `POST /api/srv-pos/shadow-report` accepta scrieri NEAUTENTIFICATE de pe internet.** *(confirmat live, apoi închis şi reverificat live)*
Ruta e montată la linia 184 din `server.js`, **înainte** de autentificarea globală (linia 195), iar singura gardă era `x-zeus-request: 1` — o **constantă**. Comentariul din cod spunea „custom header = CSRF proof": adevărat pentru un browser cross-origin, inutil împotriva unui `curl`. Ruta vecină `/orphan-report` verifica JWT-ul şi dădea 401 — deci era scăpare, nu intenţie.
*Impact:* buffer de 100 de intrări, 5/minut pe IP → **~20 de minute** ca să scoţi afară toate rapoartele reale de divergenţă, adică exact dovezile pe care s-ar judeca migrarea pe poziţii server-side.
*Dovadă înainte:* `curl -X POST -H 'x-zeus-request: 1' -d '{"count":0}' .../shadow-report` → **HTTP 200**.
*Dovadă după:* aceeaşi cerere → **HTTP 401 `auth required`**; fără header → 403; `/orphan-report` neschimbat la 401.
*Fix:* apelanţii la distanţă au nevoie de sesiune; localhost rămâne liber pentru diagnosticul tău cu `curl`; verificarea de cookie e acum un helper comun. Testele vechi n-aveau cum s-o prindă — supertest vine de pe 127.0.0.1, unde se aplică ramura exceptată; cele noi conduc un apelant la distanţă prin `trust proxy`. 30/30 pe cele patru suite srvPos.

**B2. ✅ REPARAT (b258) — `parityShadowLogger` scrie în coloane care nu există — iar testul îşi inventează schema.**
`logDivergence` inserează în `dsl_parity_log` coloanele `cycle_no, decision, shadow_signal, diverged, details`. **Niciuna nu există** în tabela reală (care are `pos_id, source, phase, current_sl, pivot_*, impulse_val, entry_price, tick_price`). Şi `getDailyParity` cade pe `diverged`. Ambele sunt în `catch (_) {}`.
*Dovadă:* pregătit pe baza vie → `table dsl_parity_log has no column named cycle_no` şi `no such column: diverged`.
*De ce e doar mediu:* **n-are niciun apelant în `server/`** — doar testele îl cheamă, deci nu se pierd date live acum.
*Ce e de fapt problema:* `tests/integration/bybitIntegration.test.js` îşi creează **propria** `dsl_parity_log` cu exact coloanele pe care codul le aşteaptă. Testul trece verde pentru un cod care nu poate funcţiona în producţie. Cine conectează modulul mâine se va baza pe un test mincinos.
*Fix:* ori tabelă proprie pentru parity-shadow, ori aliniere la schema reală; testul să folosească schema reală.

**B3. ✅ REPARAT (b258) — Scrierea în `emergency_close_queue` e înghiţită tăcut, pe ambele burse.**
`binanceOps.js:284` şi `bybitOps.js:193` — `INSERT` în coada de reîncercare a închiderilor de urgenţă, ambele în `catch (_) {}`. Dacă scrierea pică (lock, constrângere), poziţia neprotejată **nu mai e reîncercată niciodată**.
*Atenuant real:* imediat după se armează halt-ul global şi pleacă alertă Telegram critică — deci nu e complet invizibil pentru tine; se pierde doar automatizarea.
*Fix:* logare + alertă pe eşecul inserării (e ultima plasă, merită zgomot).

**B4. ✅ REPARAT (b258) — Whitelist-ul de setări aruncă tăcut cheile necunoscute — ne-a costat deja de două ori.**
`server/routes/trading.js:837`: `if (SETTINGS_WHITELIST.has(key)) clean[key] = raw[key];` — restul dispar, **fără niciun log**. Exact aşa s-au pierdut `indicators` (reparat în b193) şi `overlays` (reparat în b248). Tiparul se va repeta la următoarea setare nouă.
*Fix:* un singur `logger.warn` cu cheile respinse. Ar fi prins ambele incidente în prima zi.

**B6. ✅ REPARAT (b260) — NIMIC nu se salva, fiindcă am stricat eu validatorul în b248.** *(găsit şi reparat 2026-10-09 seara)*
Operatorul a semnalat că la TERMINATOR „se duc culorile la refresh". Culorile erau doar simptomul.
*Dovada, din `access.log` — logurile aplicaţiei nu spuneau nimic:* **51 de POST-uri pe `/api/user/settings` azi, TOATE cu răspuns 400.**
*Cauza:* există **două liste** pe server, iar ele se desincronizaseră —
`routes/trading.js SETTINGS_WHITELIST` decide ce se **stochează**, iar `middleware/validate.js SETTINGS_SHAPE` **respinge tot payload-ul** dacă întâlneşte o singură cheie pe care n-o cunoaşte. Am adăugat `overlays` în whitelist în **b248** şi niciodată în shape (`radarLens` lipsea la fel). Din clipa în care b253 a deblocat salvarea pe client, fiecare salvare a fost respinsă în bloc. **Nu e pierdere parţială — nu s-a scris absolut nimic.**
*Deci cronologia reală a „nu persistă" e în două etape:* până pe 8 oct clientul nici nu încerca să salveze (garda reparată în b253); de pe 9 oct încearcă, iar serverul respinge — **regresie introdusă de mine în b248 şi scoasă la iveală de propriul meu fix din b253**.
*Reparat:* ambele chei declarate, plus un **test de paritate** care leagă cele două liste ca să nu mai poată aluneca. Dovedit pe fişierul livrat: payload-ul real (`overlays` + `indicators` + `chartTf`) e acceptat, iar o cheie inventată e în continuare respinsă cu 400.
*Lecţia, a treia oară azi:* două liste care trebuie să spună acelaşi lucru vor diverge; ori le legi cu un test, ori te muşcă.

**B7. ✅ REPARAT (b260) — TERMINATOR n-avea setări.** Era singurul indicator cu `hasGenericSettings: true` şi **fără intrare în `IND_SETTINGS`**, deci rotiţa cădea pe `toast('No settings for ...')`. Între timp `updateTerminator` **citea deja** `cfg.period` şi `cfg.mult` şi cădea tăcut pe 10 şi 3 — valori pe care nimic nu le putea schimba. Acum sunt expuse prin acelaşi modal generic ca la ceilalţi (etichetele existau deja).

**B8. ✅ REPARAT (b260) — chart-ul nu mai încărca istoric la derulare înapoi.** Serverul era sănătos: `/api/market/klines` răspunde 200 cu lumânări reale. Pe client, `initBackfill()` se abonează o singură dată la scara de timp a chart-ului, păzit de un boolean. Dar `TradingChart.tsx` îşi construieşte chart-ul într-un `useEffect` şi face `chart.remove()` la curăţare — deci **fiecare remontare creează un chart nou**, în timp ce garda rămâne pornită şi nimic nu mai e abonat la cel viu. Backfill-ul mergea până la prima remontare şi era mort după, **tăcut**, până la un reload complet de pagină. Acum se leagă de **instanţa** de chart şi se re-armează din `registerChart`, deci o remontare îl reabonează.

**B9. ✅ REPARAT (b264) — alerta de prăbuşire exista de mult; era doar armată prea târziu ca să tragă.** *(găsit 2026-10-10)*
`server.js` trimite de mult un Telegram pe `uncaughtException` („🔴 ZEUS CRASH"). **Era înregistrată la linia 2134, iar baza de date se încarcă la linia 19.** Deci orice eşec în timpul încărcării modulelor — exact tipul de eşec care produce o buclă de prăbuşire — murea cu **2115 linii înainte** ca cineva să asculte. Asta e motivul tăcerii de azi-noapte, prin 1082 de prăbuşiri.
*Reparat:* plasa e armată acum **la începutul fişierului**, înaintea primului `require` propriu. `logger` şi `telegram` se cer **leneş, din interiorul handler-elor** — la acel punct din fişier încă nu există, iar o prăbuşire la boot poate apărea înainte să existe vreodată; scrierea în consolă rămâne necondiţionată, deci ceva ajunge mereu în log.
*Dovedit, nu presupus:* un script izolat cu handler-ul pus primul **prinde** exact eroarea de azi-noapte aruncată la `require`; acelaşi script fără el moare mut. O repetare ar alerta **de la prima prăbuşire**, nu de la a 1082-a. Un test static fixează ordinea ca să nu alunece înapoi.
*Watchdog-ul din cron rămâne* — el acoperă cazul în care procesul e omorât direct şi niciun handler de-al nostru nu mai apucă să ruleze.

**B10. ✅ REPARAT (b264) — 14 chei de `localStorage` se vedeau între conturi pe acelaşi browser.**
Zeus scopează `localStorage` pe utilizator (`cheie:uid`) ca două conturi pe acelaşi browser să nu-şi citească setările. **Lista e întreţinută de mână**, iar 14 chei pe care aplicaţia chiar le scrie n-au fost adăugate niciodată — printre ele **`zeus_chart_tf`** (timeframe-ul) şi **`zeus_ind_favorites`** (indicatorii cu stea). Adică exact setările care se observă primele. Scoparea *părea* completă în timp ce tăcut nu era.
*Reparat:* toate 14 scopate; cele două care sunt într-adevăr per-dispozitiv (`zeus_app_version`, `zeus_dsl_parity_shadow`) rămân nescopate, intenţionat. Un test compară acum lista cu ce scrie efectiv codul, deci nu mai poate rămâne în urmă.
*Notă:* pentru tine singur pe browser nu schimbă nimic vizibil; contează dacă tu şi Mirela folosiţi vreodată acelaşi dispozitiv.

**Verificat în vânătoarea asta şi CURAT** *(merită notat, ca să nu le recăutăm)*: zero apeluri `async` lăsate fără `await` pe toată calea banilor (`serverAT`, `binanceOps`, `bybitOps`, `exchangeOps`, `recoveryBoot`, `emergencyCloseProcessor`, ruta de trading); zero indicatori cu rotiţă de setări care nu deschide nimic (88 cu modal generic, 5 cu modal dedicat, toate acoperite); `argus: {}` e gol intenţionat, cu rotiţa dezactivată — consecvent, nu bug.

### 🟢 MICI

**C1. ✅ ÎNCHIS prin revizuire — 40% din `catch`-urile serverului sunt mute** — 551 din 1384 nu loghează nimic (376 complet goale, 175 doar cu comentariu). 38 dintre ele învelesc scrieri în baza de date. Pe client: 648. Nu e de reparat în bloc, dar e solul în care cresc bugurile A1/B2/B3.

**C2. ✅ REPARAT (b258) — `coldPathCron` şi `r0SubstrateCron` nu scriu absolut nimic în loguri** — singurele două cron-uri fără nicio urmă. De aceea A1 a putut sta ascuns.

**C3. ✅ CONSTATARE GREŞITĂ DE-A MEA, corectată — `data/logs/offsite-backup-cron.log` e 0 bytes din 9 iunie.** Backup-urile **funcţionează** (verificat: `zeus-offsite-20261009-033001.db.enc`, 287 MB, azi la 03:30), dar nu lasă nicio urmă locală — dacă pică, n-ai unde să te uiţi.

### ✅ Verificat şi NU e bug (ca să nu le mai căutăm)

- **Fără secrete literale în cod** şi **fără injecţie SQL** din input de utilizator (cele 2 interogări cu interpolare primesc numele tabelei ca parametru intern, din migrări/prune).
- **Poarta „doar localhost" NU e spoofabilă**, deşi `trust proxy` e pornit: nginx foloseşte `$proxy_add_x_forwarded_for`, care adaugă mereu IP-ul real la coadă. Testat de pe internet cu `X-Forwarded-For: 127.0.0.1` → **403**. (`proxy-addr` e şi patchuit.)
- **Toate cele 7 cron-uri sunt chiar programate** din `server.js` — niciunul orfan.
- **1516 din 1522 de interogări sunt valide** faţă de schema reală; 4 din cele 6 semnalate erau artefacte ale extractorului meu, 2 erau reale (B2).
- **Backup offsite sănătos**, zilnic, comprimat ~10×.
- **Disc sănătos:** 46 GB liberi (69% ocupat).

---

## 🧠 ML — unde suntem (verificat azi, 2026-10-09)

**Ce merge, dovedit:**
- **Brain-ul e viu** — decizii la fiecare 30s, scrise în `brain_decisions` (ultima: acum). Nu e doar „pornit": în fiecare decizie se văd multiplicatorii ML din fuziune (`modStructure`, `modLiquidity`, `modKnn`, `modJournal`, `modSession`, `modTrapRisk`…), deci **influenţa ML chiar ajunge în decizie**, nu stă pe margine.
- **Ingest + pipeline + atribuire** — 755 evenimente în `ml_attribution_events`, 749 rânduri de evidenţă bandit, scrise chiar azi.
- **OMEGA** — Doctor-ul porneşte curat (64 module, DAG valid), cron-ul de memorie rulează zilnic la 02:00. Zero erori în loguri.
- **Opt-in LIVE** — uid=1 a dat opt-in (ultimul 2026-07-09), deci poarta `ML_LIVE_OPTIN_REQUIRED` e trecută.

**Aprinse:** `ML_INGEST_ENABLED`, `ML_PIPELINE_SHADOW`, `ML_DEMO_INFLUENCE_ENABLED`, `ML_TESTNET_INFLUENCE_ENABLED`, `ML_LIVE_INFLUENCE_ENABLED` (+ `ML_LIVE_OPTIN_REQUIRED` ca poartă), `ML_HYBRID_POOLING_ENABLED`, `ML_OVERRIDE_RESOLVER_ENABLED`, `ML_CRON_SCAN_ENABLED`.

**Stinse — toată familia DSL:** `ML_DSL_SHADOW_ENABLED`, `ML_DSL_LEARN_ENABLED`, `ML_DSL_LOSSSIDE_SHADOW`, `ML_DSL_LOSSSIDE_ACTIVE`, `ML_DSL_FULL_CONTROL`, `DSL_PARITY_SHADOW_ENABLED`, plus `ML_BANDIT_AUTO_APPLY_MINOR`. La fel `SERVER_BRAIN` şi `SERVER_AT` globale (variantele DEMO/TESTNET sunt aprinse — de-asta serverul tradează singur pe demo).

**Ce mai trebuie activat, concret:**
1. **Nimic, ca să meargă ML-ul de bază** — merge deja. Singurul lucru care-l ţinea inert era cronul de carantină, reparat azi.
2. **P2 de mai sus** (calibrarea) — altfel stratul de guvernanţă rulează, dar nu decide nimic.
3. **ML-DSL** — dacă vrei să revii la el, ordinea e `ML_DSL_SHADOW_ENABLED` → `LEARN` → `LOSSSIDE_SHADOW` → `LOSSSIDE_ACTIVE` → `FULL_CONTROL`, cu soak între trepte. **Atenţie:** Book-ul scria „flag APRINS, 34 poziţii, net +810" — flag-ul e **stins** acum. Nu ştiu când/de ce s-a stins; nota aia era depăşită.
4. **REAL** — rămâne decizia ta (chei LIVE + flip `SERVER_BRAIN`/`SERVER_AT`), gated pe P&L testnet verde şi pe SP1.5 sizing-parity. Nimic de aprins din partea mea.

---

### 📏 CÂT DIN ML E CHIAR CONECTAT — măsurat 2026-10-09

> Întrebarea ta: „funcţionează tot, toate ringurile cu toate punctele?" Răspunsul scurt: **nu — un nucleu lucrează, restul e schelă.** Mai jos sunt cifrele, nu impresii.

**Dimensiune:** 284 de fişiere, **68.392 de linii**, 367 de tabele `ml_`.

**Cod — cât se atinge pornind de la `server.js`** *(graful complet de `require`; în tot serverul există un singur `require` dinamic, în `coldPathCron`, deci graful e exact)*:
- **74 din 284 de fişiere sunt conectate. 210 nu.**

**Date — ce scrie efectiv** *(ultimul rând din fiecare tabelă)*:
- **198 din 367 de tabele sunt GOALE** — n-au avut niciun rând vreodată (54%)
- **30 sunt scrise în ultimele 7 zile** (8%)
- 105 au date vechi de peste 7 zile · 34 n-au coloană de timp

**Ringurile care chiar lucrează** (au şi cod conectat, şi tabele scrise recent): `R0_substrate` (9/9 conectate), `R1_constitution` (3/3), `R3B_safety` (3/3), `_doctor` (18/20), `_ring5` (10/11, bandit-ul scrie), `_voice` (9/10), `R7_meta`, `R7_communication`. Plus nucleul de decizii: `ml_decision_snapshots`, `ml_decision_light`, `ml_attribution_events`, `ml_bandit_posteriors`, `ml_diagnostic_events`.

**Zonele moarte, în ordinea mărimii:**
- **`_meta` — 70 de fişiere, 16.494 de linii, ZERO conectate.** Nimic din server nu-l referenţiază. E cel mai mare bloc din tot ML-ul. *(Atenţie la confuzie: `R7_meta` e alt director şi ĂLA e viu.)*
- **`_operator` — 10 fişiere, 1.920 de linii, ZERO conectate.** Nimic nu-l referenţiază.
- `R3A_safety` — 25 din 26 neconectate (7.418 linii)
- `R2_cognition` — 26 din 30 neconectate (9.028 linii)
- `R5A_learning` — 25 din 28 neconectate (7.478 linii)
- `R5B_governance` 10/13 · `R4_execution` 12/15 · `R6_shadowMeta` 8/9 · `_crosscutting` 9/10
- `R2_brain` şi `R3B_validation` — **directoare complet goale**

**De ce contează:** cele două subsisteme moarte găsite azi (cronul de auto-carantină, inert de când există; cold path-ul care apela funcţii inexistente) **nu erau accidente izolate** — sunt simptomele aceluiaşi lucru: un strat scris după specificaţie, din care o mare parte n-a fost niciodată legată la sistem. Iar cele 11 module pe care cold path-ul le „rula" erau doar *încărcate*, nu apelate — de aceea raporta `11 modules, 0 failed` cu rezultat zero.

**Ce NU spun cifrele astea:** că e cod greşit sau de aruncat. Spun doar că **nu rulează**. Înainte de a decide ceva — conectăm, tăiem, sau lăsăm ca referinţă — ar trebui să ştim care bucăţi au fost testate vreodată pe date reale. Asta cere o sesiune separată, pe ringuri, nu o măturare.

### 🩺 DOCTORUL OMEGA — verificat cap-coadă 2026-10-09

**Verdict: funcţionează.** 61.501 evenimente de diagnostic, scrise activ; 64 de module înregistrate, DAG valid la fiecare boot.

**Ce raportează, pe severităţi:**
- **P0 — 10.786**, din care **10.775 sunt alerte `serverAT.globalHalt`**, aproape toate istorice (oprirea de 2 luni şi incidentul demo-opreşte-live din 8 octombrie). Nu e o avalanşă nouă.
- **P2 — 50.682**, iar cele recente sunt `serverBrain.reflection`: brain-ul îşi blochează singur intrările (`anti_pattern`), adică exact funcţia S9 livrată în b240. **51 azi**, toate pe XRPUSDT LONG. Funcţionează cum trebuie. *(Cosmetic: lista de motive apare duplicată — `["anti_pattern","anti_pattern"]`.)*
- P1 — 2, P3 — 31.

**Ce pare gol dar NU e bug:**
- **coloana `verdict` e goală la toate cele 61.501** — se scrie exclusiv din `falsePositiveAuditor.setVerdict`, accesibil doar prin ruta ta de operator (`/api/omega/doctor/...`). Înseamnă că n-ai triat niciodată manual o alertă ca fals-pozitiv. Unealtă neapăsată, nu cod mort.
- **`ml_cognitive_checkpoints` = 0** şi **`ml_doctor_override_journal` = 0** — la fel, declanşate doar manual din rutele doctorului.

**Un incident real, provocat de mine:** la **05:16** doctorul a trecut singur `HEALTHY → COMPROMISED` („self-heartbeat stale >30s"), iar la **05:19:15** s-a armat halt global prin dead-man switch (`brain_heartbeat_stale_63s`). Cauza: rulam suitele de teste complete pe VPS-ul viu şi am înfometat event loop-ul (acelaşi lucru a produs şi falsa derivă de ceas de -15,7s). **Şi-a revenit singur la 05:20:15** — `brain_recovered_after_6_healthy_checks`, exact plasa de auto-recovery construită pe 7 octombrie. A durat un minut, pe demo. Dovadă că mecanismul e bun, şi încă un motiv să nu rulez suita completă pe maşina vie.

---

## 👀 DE URMĂRIT — monitorizare

> Am verificat fiecare punct pe starea vie azi. Unde nota veche contrazicea realitatea, am corectat şi am spus ce.

1. ⚠️ **ML-DSL Full Control — nota veche era greşită.** Scria „flag APRINS, 34 poziţii, net ≈ +810". Verificat azi: `ML_DSL_FULL_CONTROL` = **stins**, ca toată familia DSL. Cifrele alea rămân istorice, nu curente.
2. **Brain/AT flip la REAL — nu e gata, prin proiectare.** Server-side e făcut (SP1+SP2): pe DEMO+TESTNET serverul decide şi gestionează singur, cu telefonul închis. Calea REAL e construită dar inertă (zero chei LIVE). Rămâne: P&L testnet verde 2-3 săpt + SP1.5 sizing-parity + flip-ul tău.
3. **DSL_ML_CUT = 0** — n-a tras încă. Irelevant cât DSL e stins (vezi 1); redevine de urmărit când îl reaprinzi.
4. ⚠️ **Cron P&L testnet (23:58)** — tot fără urmă în loguri. Neconfirmat că produce date; de verificat la următoarea fereastră.
5. **Lever B Smart Loss-Cut** — testnet, 0 tăieri (volum mic). De urmărit când creşte.
6. ⚠️ **Bybit soak — nota veche era greşită.** Scria `BYBIT_DRY_RUN_ONLY`=OFF. Verificat azi: e **ON**, deci Bybit nu trimite HTTP real; plus cheia uid=2 e expirată (P3). Soak-ul Bybit **nu rulează**.
7. **Chei LIVE pentru REAL ML-DSL** — când decizi tu (MultiExchange UI). Primele trade-uri reale mici şi vegheate.
8. **Radar top300 / OI la următorul ban Binance** — fix livrat, neconfirmat la un ban real.
9. **„Margin insufficient" testnet uid=1** — limitare de cont, nu bug. De urmărit dacă strânge volumul de soak.
10. **CI GitHub Actions roşu = billing-ul contului GitHub** — de rezolvat de tine. (N-am putut reverifica azi: `gh` nu e autentificat pe VPS.)
11. ✅ **„Position side cannot be changed"** — zero apariţii în ultimele 5000 de linii. Pare stins; îl las sub observaţie încă o rundă înainte să-l scot.
12. ✅ **Arhivare tăcută → orfan** — zero orfani reali în loguri; `RECOVERY_BOOT` raportează `1/1 users OK, 0 orphaned`. Garda pasivă rămâne pusă.
13. **Vault — confirmă download-ul pe Chrome desktop** (creare + descuiere + adăugare sunt deja confirmate de tine).

---

## 🔌 PLAN: conectarea ML-ului neconectat *(cerut 2026-10-09, de făcut mai târziu)*

**Se poate? DA.** Şi e mai realist decât părea: cele 210 module neconectate **nu sunt cod abandonat**. 209 din 210 sunt chiar `require`-uite de un test; sunt 313 fişiere de test care ating ML-ul, 6816 teste, toate verzi. Un singur modul din `_meta` (`autobiographicalContinuity`) are 36 de teste. Codul a fost scris modul cu modul, cu teste, şi pur şi simplu n-a fost legat niciodată la sistem.

**Dar NU „pe toate deodată", şi iată de ce — cu dovada din ziua asta:**
Testele unitare dovedesc că o piesă merge **singură**. Nu dovedesc că **legătura** e corectă. Exact asta ne-a muşcat azi, de două ori, cu teste verzi:
- `autoQuarantine.scanAllFeatures` funcţionează perfect izolat — dar cronul care o chema cerea o coloană inexistentă, iar un `catch` gol înghiţea eroarea. Inert de când există.
- `parityShadowLogger` avea test verde — fiindcă **testul îşi inventa schema**. În producţie arunca la fiecare apel.
Ambele erau buguri **de conectare**, nu de logică. A lega 210 module deodată înseamnă a multiplica fix clasa asta de 210 ori, direct în calea banilor.

**Şi o întrebare care trebuie pusă înainte de orice fir:** „să gândească mai bine" nu se obţine adăugând module. Mai multe module ≠ decizii mai bune — unele pot înrăutăţi. Fiecare ring trebuie să **arate** că schimbă ceva în bine, altfel adăugăm doar zgomot şi suprafaţă de eroare.

### Cum aş face-o, pe etape

**Etapa 0 — verificare de contract, automată (ieftină, o pot face oricând).**
Un script care, pentru fiecare din cele 210 module, verifică **static** că funcţia pe care ar chema-o chiar există, cu semnătura aşteptată, şi că tabelele/coloanele pe care le scrie există în schema reală. Asta prinde dinainte exact clasa A1/B2 — fără să conectăm nimic. *Rezultatul e o listă: ce se poate lega curat vs. ce e rupt înainte de a începe.*

**Etapa 1 — un ring, în UMBRĂ.** Se alege un ring (propun `R2_cognition` — e aproape de decizie şi are 9.028 de linii), se leagă astfel încât **calculează şi înregistrează, dar NU influenţează** nimic. Zeus are deja tiparul ăsta (`ML_PIPELINE_SHADOW`, parity shadow), deci nu inventăm infrastructură.

**Etapa 2 — măsurare, nu impresie.** Pe N decizii reale: ieşirea ringului se corelează cu rezultate mai bune? Dacă da, cât? Dacă nu se poate măsura, nu se promovează. Aici se vede dacă un modul merită locul lui.

**Etapa 3 — promovare pe trepte, în spatele unui flag:** DEMO → TESTNET → REAL, cu soak între ele, exact disciplina pe care o folosim deja la brain.

**Etapa 4 — verdict onest pe ce rămâne:** ce nu arată valoare rămâne în umbră sau se şterge. Un modul care nu schimbă nicio decizie e datorie, nu capital.

### Ce te costă, realist
Nu e muncă de o sesiune. 210 module, 7-8 ringuri, fiecare cu umbră + măsurare + promovare înseamnă **săptămâni**, nu ore. Etapa 0 e singura ieftină şi se poate face oricând — şi merită făcută prima, fiindcă poate arăta că o parte din cod e rupt la legătură şi scuteşte tot restul efortului.

### Ce NU fac fără să-mi ceri explicit
Nu leg nimic la calea de decizie „ca să vedem". Dacă vrei să începem, începem cu **Etapa 0**, care nu atinge nimic viu.

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

---

## ✅ REZOLVATE — arhivă

> Aici cobor tot ce-i gata, ca lista de sus să rămână doar activ. Git + changelog au detaliul complet.

### 2026-10-10 (b262-b263)

- ✅ **VACUUM făcut** *(2026-10-10 05:01, fostul P2)*. **7,859,118,080 → 2,833,174,528 bytes** (7,3 GB → 2,6 GB), adică **~4,7 GB recuperaţi** în fişier. Oprire totală: **62 de secunde** (05:01:09 → 05:02:11).
*Cum, ca să nu fie risc:* nu VACUUM pe loc, ci `VACUUM INTO` într-un fişier nou (6 secunde), **verificat înainte de schimb** — `integrity_check` ok, 401 tabele, 791 indexuri, aceleaşi numere de rânduri (884.745 decizii brain, 763 evenimente de atribuire, 9 setări), setările tale intacte. Originalul a rămas neatins până în ultima clipă; dacă ceva nu se potrivea, pur şi simplu nu schimbam.
*După:* brain activ, poziţia deschisă intactă, WAL nou sănătos, zero erori noi.
⚠️ **Spaţiul pe disc NU s-a eliberat încă** — vechea bază de 7,4 GB stă lângă cea nouă, ca plasă de siguranţă. Copii vechi pe disc: `pre-vacuum-20261010` 7,4 GB (de azi), `pre-vacuum-20261007` 7,4 GB (3 zile), plus două `.bak` din iunie (2,0 + 1,8 GB). **Toate sunt acoperite de backup-urile offsite** (cel mai recent: azi 04:09). *Decizia ta:* ce ştergem. Recomandarea mea: cele din iunie şi cea din 7 octombrie acum (~11 GB), iar cea de azi după o zi de rulare liniştită.


- ✅ **Alertă când Zeus cade** *(b263, fostul P1)*. Ce a lipsit azi-noapte: 1082 de prăbuşiri în 3,5 ore şi niciun semn. O aplicaţie căzută nu poate anunţa că e căzută, deci watchdog-ul rulează din cron, **în afara ei**, la fiecare minut. pm2 raporta „online" între prăbuşiri toată noaptea — de aia starea singură nu e semnal, ci **numărul de reporniri care urcă**. Vorbeşte când procesul nu e online, când lipseşte din pm2, şi la **peste 3 reporniri între verificări** (buclă, nu deploy). Nu se repetă în fiecare minut, revine după 30 de minute dacă tot e stricat, anunţă revenirea **o dată** şi apoi tace. Prima rulare doar învaţă numărul curent — altfel un server sănătos ar raporta „1083 de reporniri". **Dovedit pe botul real**, nu doar în teste; iar la reload-ul de deploy de după a tăcut, cum trebuie.
- ✅ **Alertele de reflection spun acum CE a blocat tranzacţia** *(b263)*. Toate citeau `["anti_pattern","anti_pattern"]`, ca şi cum acelaşi motiv ar fi listat de două ori. Erau **două anti-pattern-uri diferite**, dar payload-ul păstra doar tipul şi arunca numele — exact câmpul care spune care. 51 de alerte ieri, niciuna lizibilă. Acum se păstrează amândouă, printr-un singur helper folosit de payload, de textul alertei şi de jurnalul de gânduri, ca să nu se mai despartă.


### 2026-10-09 (b255)

- **Suita serverului e VERDE: 9465 trecute, 3 sărite, 0 picate** *(fostul P1, închis 2026-10-09)*. Era 26 picate în 7 suite. Niciuna nu era regresie în producţie — toate erau harness-uri rămase în urma codului. Cele două de money-path testau o arhitectură care se mutase: `executeLiveEntryCore` conducea 7 răspunsuri secvenţiale de semnare şi verifica secvenţa atomică local, dar Task 40 a rutat plasarea prin `exchangeOps.placeEntry`, care face toată secvenţa intern — aşa că routerul real rula într-un test unitar şi TOT, inclusiv happy-path-ul, ieşea `ENTRY_FAILED`. Secvenţa e acoperită acolo unde trăieşte acum (`binanceOps.test.js`, 70 teste verzi); aici au rămas traducerile pe care funcţia chiar le deţine. `order-place-flow` cădea pe o gardă de proprietate fără metodă în mock şi pe garda de date stale, ambele fail-closed. Ambele dovedite ne-goale prin **mutaţie**: forţarea stării la `LIVE` rupe exact cele două teste despre poziţii neprotejate; scoaterea verificării de SL rupe cinci. Codul restaurat identic după fiecare.
- **Un test putea rescrie fişierul VIU de flaguri** *(găsit şi reparat 2026-10-09)*. S-a şi întâmplat: `data/migration_flags.json` a rămas deţinut de root, iar serverul rulează ca `zeus` — deci aplicaţia nu mai putea salva niciun flag, **tăcut**. Valorile au ieşit identice (verificate faţă de dump-ul luat înainte: aceleaşi 34 aprinse, inclusiv cele două `_REAL_` protejate, care erau deja aprinse şi n-au fost atinse — `set()` aruncă înainte de orice scriere pentru ele). Proprietarul restaurat. Cauza: `migrationFlags` citeşte şi scrie un fişier real la `require`, iar multe suite îl încarcă pe bune şi apelează `set()`. Sub test acum nici nu citeşte, nici nu scrie — fiecare suită porneşte de la default-urile declarate (un fişier temporar per-PID nu era de ajuns: se scurgea între fişierele de test din acelaşi worker).
- **Izolarea a demascat 6 suite care treceau citind configuraţia ta**, nu codul: `omegaFlags`, `migrationFlags-protected-set`, `influenceEligibility`, `ring5Routes`, cele două `sp1-*` şi `positions-ws-flag`. Fiecare îşi declară acum premisa sau verifică contractul codului (fiecare flag de influenţă ML pleacă STINS, poarta de consimţământ REAL pleacă APRINSĂ, `set()` refuză aprinderea unui flag protejat indiferent de valoarea curentă).
- ⚠️ **O „reparaţie" de-a mea a fost de fapt o regresie, retrasă** — `_aggregateUsage` avea parametrul `now` nefolosit şi un test care cerea fereastră de 30 de zile, aşa că am implementat-o. **Greşit:** b167 (`4d35cc2a`) o eliminase *deliberat* — un rând e configuraţia PERSISTATĂ a userului, rescrisă la fiecare `POST /active`, nu un semnal de prezenţă, deci badge-ul trebuie să arate pe toţi cei care au indicatorul configurat, oricât de demult au fost văzuţi. Alt test spunea exact asta, iar contradicţia dintre ele e ce a făcut reparaţia greşită să pară corectă. Cod revenit identic, ambele teste acordate, motivul scris în sursă. *Lecţia:* un test care descrie un comportament nu e dovadă că acel comportament e dorit — verifică data lui faţă de data codului.

- **Auto-carantina ML era inertă de când a fost livrată** *(commit `699d3e20`)*. `ML_SCAN_CRON` loga „0 users, evaluated=0" la fiecare tick, cu flag-ul aprins. Descoperea userii cu `SELECT DISTINCT user_id FROM ml_bandit_evidence` — tabelă care **n-are** coloana `user_id` (userul e primul segment din `cell_key`). `prepare()` arunca, un `catch` gol transforma asta în `users = []`, şi stratul de guvernanţă ML n-a evaluat nimic niciodată, în timp ce 755 de evenimente de atribuire stăteau necitite. Acum descoperirea se face din `ml_attribution_events` — tabela pe care `scanAllFeatures` chiar o citeşte — iar eroarea înghiţită se loghează. Testul vechi nu putea prinde asta: mock-uia `db.prepare` să întoarcă useri indiferent de SQL. Testul nou foloseşte **SQLite real cu schema reală**, deci o coloană inexistentă pică acolo cum pică în producţie.
- **Cele 3 teste „pre-existente" din `recoveryBoot` erau teste vechi, nu cod stricat** *(commit `699d3e20`)*. Toate trei reconciliau pe bybit, iar `recoveryBoot` sare peste orice bursă respinsă de `shouldReconcileExchange` — şi `BYBIT_DRY_RUN_ONLY` e `true` implicit, deci fiecare caz bybit era sărit tăcut şi `totalReconciled` rămânea 0. **Codul era corect.** Am mockat flag-ul ca testele să exercite ce vor, şi am adăugat testul pe care zăvorul nu-l avea: sub dry-run, bybit e sărit **şi** userul e totuşi dezarmat pe baza bursei vii — exact proprietatea de siguranţă pentru care există filtrul. 20/20.
- **Iconiţa TERMINATOR + itemul „19 emoji refolosite"** — vezi mai jos, intrarea detaliată (fostul 0.025).
- **`offsite-backup.conf` era 644** → acum 600, ca restul fişierelor sensibile.
- **Cele 2 poziţii malformate la fiecare sync — nu mai apar** *(deschis 2026-10-07, verificat închis 2026-10-09)*. Logul `[SYNC] [WS-4] Dropped 2 malformed position(s)` se repeta la fiecare sincronizare. **Zero apariţii** în ultimele 3000 de linii: le-a reparat fix-ul din `_isValidPositionEntry`, care acceptă acum `p.sym || p.symbol` (clientul trimitea mereu `sym`, iar garda arunca din cauza asta 100% din poziţii). Nu mai e nimic de decis — rândurile vechi nu mai sunt trimise.
- **Oprirea critică „sistemul nu mai tradează din 5 august"** — închisă; dovada e intrarea `0.03` de mai jos (trading dovedit live 2026-10-08 16:35). Antetul vechi rămăsese în listă deşi fusese deja rezolvat.

### 2026-10-07 → 2026-10-08 (b241–b254)

0.01 🔴 **NIMIC NU S-A MAI SALVAT DIN 11 IULIE — REPARAT** *(găsit + reparat 2026-10-08, b253, commit `ce37101f`)*. **Asta e cauza de fond pentru TOT ce reclamai la persistenţă.**

0.05 🔴 **DEMO OPREA TRADINGUL LIVE — REPARAT** *(găsit + reparat 2026-10-08, b249, commit `c208acbc`)*. **Asta a ţinut Zeus oprit toată ziua de 8 octombrie, DUPĂ ce reparasem îngheţul de noaptea trecută.**

0.06 🔐 **Securitate dependenţe: 17 vulnerabilităţi, nu 3 — 16 reparate** *(2026-10-08, commit `e2dcadb8`)*. ⚠️ **Corecţie la ce am raportat eu mai devreme:** spusesem „3 moderate, prioritate mică" — filtrasem greşit ieşirea din `npm audit` şi am subraportat. Realitatea: **1 critică, 3 înalte, 12 moderate, 1 mică**.

0.0 ✅ **Spam-ul de alerte „GLOBAL HALT ARMED" — REPARAT** *(2026-10-07, commit `67a75811`)*. Două defecte în aceeaşi cale:

0.7 ✅ **Timeframe + indicatori nu persistau — REPARAT** *(2026-10-07, commits `5b0894a7`, `ab4afee4`, b241/b242)*. **Setările se salvau corect tot timpul** (rândul tău avea `chartTf=15m` şi exact cei 7 indicatori activi: charon, nyx, morpheus, hyperion, mentor, eunomia, astrape). Lipsea **aplicarea lor pe stratul de randare**. Patru găuri, aceeaşi rădăcină:

0.8 ✅ **OMEGA nu mai vorbea — REPARAT, şi NU era cheia** *(2026-10-07, commit `3fa7fe87`, b241)*. Verificat live cu cheia ta: `GET /models` → **HTTP 200 cu 11 modele** (deci cheia se autentifică; o cheie greşită dă 401), dar apelul de chat către `llama-3.3-70b-versatile` → **HTTP 404 `model_not_found`**. Groq a **retras linia Llama 3.x** pentru contul tău — niciunul din cele 11 modele rămase nu e Llama de chat. **Schimbarea cheii nu rezolva nimic.** Dintre cele disponibile, doar `openai/gpt-oss-120b`, `gpt-oss-20b` şi `qwen/qwen3.8-27b` sunt modele de chat. Ales **`openai/gpt-oss-120b`** (cel mai capabil, 487ms-1,1s faţă de timeout-ul de 8s). E model de raţionament, deci consumă token-i gândind: la `maxTokens` 320 răspunsul venea **tăiat la mijloc** (`finish_reason: length`); ridicat la 700 → complet în 939ms. Fără asta OMEGA ar fi „mers" trunchiind fiecare răspuns. `GROQ_MODEL` din `.env` suprascrie, deci următoarea retragere e o schimbare de config, nu un deploy. **Verificat end-to-end prin codul real:** `ok:true`, 487ms, răspuns corect în română.

0.9 ✅ **Indicator nou: TERMINATOR** *(2026-10-07, commit `b4426515`, b243)*. Construit din cele 2 capturi din Uploads. Scară ATR de trailing-stop care se mişcă **doar CU trendul** (sub preţ pe bull, deasupra pe bear, ţine nivelul în pullback-uri — de aici treptele); o închidere prin ea întoarce trendul, linia sare de partea cealaltă, bara primeşte marcaj pătrat, iar nivelul de flip rămâne punctat. **Culorile NU sunt ghicite** — extrase din pozele tale (mascând interfaţa TikTok), aceleaşi clustere în ambele cadre: **verde `#05E17F`**, **magenta `#E547FC`**. Toate valorile din lumânările reale, zero date sintetice. Rulează în `_indRenderHook` (izolat — dacă aruncă, nu goleşte restul chart-ului), marcajele pe seria proprie (nu peste marcajele de tranzacţii). Oprit implicit, categoria Trend. 11 teste.

1.7 ✅ **Ciocnire de nume REPARATĂ** *(2026-10-08)*: `ConfirmDialog.tsx` → `ConfirmDialogView.tsx` (+ importul din `App.tsx`), deci nu mai există două fişiere care diferă doar prin majuscule. *Context:* `client/src/components/common/` conţine ambele. Pe Linux (case-sensitive) merge; pe un sistem de fişiere **case-insensitive** (macOS, Windows) cele două se ciocnesc şi build-ul ia fişierul greşit. M-am lovit de asta randând: esbuild a încercat să citească un `confirmDialog.tsx` inexistent şi a picat până am pus `.ts` înaintea lui `.tsx` în ordinea de rezolvare. Vite merge doar fiindcă are implicit `.ts` înainte de `.tsx`. *Fix:* redenumeşte unul (ex. `ConfirmDialog.tsx` → `ConfirmDialogView.tsx`) ca numele să nu mai difere doar prin majuscule.

1.0 ✅ **Sincronizarea poziţiilor client→server era ruptă — REPARAT** *(commit `aa87f3b0`)*. **Dovedit stins:** ultimul `Dropped 2 malformed` la 21:13, zero după deploy. *(găsit 2026-10-07)*. Clientul trimite câmpul **`sym`** (`core/state.ts` ~433: `id: p.id, side: p.side, sym: p.sym, …`), dar validatorul serverului cere **`symbol`** (`server/routes/sync.js:104`: `typeof p.symbol === 'string'`). Nepotrivire de nume → **TOATE** poziţiile sincronizate sunt aruncate. Dovadă live: ai 2 poziţii demo deschise, iar logul repetă `[SYNC] [WS-4] Dropped 2 malformed position(s) from sync payload uid=1` la fiecare sync — adică 100%. `sync.js` nu foloseşte `p.symbol` **nicăieri altundeva**; garda „structural sanity" a inventat o cerinţă pe care payload-ul n-a avut-o. **Efect:** snapshot-ul poziţiilor demo nu se mai salvează — încă un simptom de „nu persistă". *Fix:* validatorul să accepte `p.sym || p.symbol` (+ test). Mic, dar e pe calea poziţiilor, aşa că îl aplic cu TDD când reiau.

1.3 ✅ **Backup-ul offsite era mort de 101 zile — REPARAT NEDISTRUCTIV** *(găsit + reparat 2026-10-07)*.

1.1 ✅ **Overlay-urile nu persistau deloc — REPARAT** *(2026-10-08, b248)*. Patru goluri, toate închise: (a) `togOvr` nu chema niciun save, deşi `togInd` o face dintotdeauna; (b) `overlays` **lipsea din whitelist-ul serverului**, deci chiar şi un save ar fi fost aruncat; (c) nimic nu hidrata harta la încărcare; (d) nimic nu le re-desena la boot. Acum: toggle-ul salvează, serverul acceptă cheia, harta încărcată ajunge ŞI în `w.S.overlays` (de unde citesc randerele) ŞI în marketStore (de unde se desenează butoanele din bară, deci îşi recapătă starea activă), iar `applyOverlays()` desenează la boot ce e aprins. **Aceeaşi formă ca timeframe-ul şi indicatorii: starea se restaura, dar nu se aplica.** Am adăugat şi `overlays` + `manualTestnet` în contractul de tipuri al clientului (erau persistate şi whitelistate, dar lipseau din tip). 4 teste; suita **673/673**. *Neverificat vizual:* desenul propriu-zis al overlay-urilor cere date WS live — logica e testată, aspectul îl confirmi tu.

1.2 ✅ **Suita de teste a clientului — CURĂŢATĂ** *(2026-10-08)*. Era **11 fişiere picate / 6 teste roşii**; acum **1 / 1**. Ce am făcut:

0.02 ✅ **TERMINATOR nu apărea în lista de indicatori — REPARAT** *(2026-10-08, b251, commit `ca066716`)*. Operatorul: „nu îl văd în lista de indicatoare" — **avea dreptate**.

0.025 ✅ **REZOLVAT 2026-10-09 — dar nu era bugul pe care îl notasem** *(găsit 2026-10-08, închis 2026-10-09, b255)*. Notasem „19 emoji refolosite între ~41 de indicatori, cosmetic, de curăţat”. **Citisem câmpul greşit.** Din 2026-06-16 iconiţa randată efectiv în panel NU e emoji-ul din `IND_LIST.ico`, ci glyph-ul SVG line-art din `client/src/constants/indicatorIcons.ts`; `ico` e doar *fallback* pentru un id absent din acea hartă (`ChartControls.tsx:1266`, `engine/indicators.ts:3655`). **95 din 96 de indicatori aveau glyph**, deci cele 19 emoji duplicate sunt fallback-uri moarte care nu ajung niciodată pe ecran — nu era nimic de curăţat. Singurul fără glyph era **TERMINATOR**, motiv pentru care el singur apărea ca emoji într-un panel de line-art — exact reclamaţia operatorului („emojiul ăla nu e bun, uită-te la celelalte cum sunt”). Nici 🎯, nici 🤖, nici 🪜 n-aveau cum să arate bine: problema nu era *care* emoji, ci că era emoji. A primit glyph propriu: trepte de flip SuperTrend în colţuri de target-lock — deliberat diferit de `st` (treaptă simplă), `kratos` (crosshair diagonal) şi `argus` (ochi). Forma a fost aleasă **randând 5 variante la 15px**, mărimea reală din panel, nu citind codul: prima variantă era lizibilă doar mărită. Testul care consemna scuza („nu se poate impune global”) impune acum contractul real: **orice indicator din panel trebuie să aibă glyph propriu** — ceea ce ar fi prins asta de la început. Suita 695/695.

0.03 ✅ **TRADINGUL FUNCŢIONEAZĂ DIN NOU — dovedit live 2026-10-08 16:35** — ⚠️ **dar pe DEMO, nu pe testnet.**

0.04 ✅ **WAL-ul ţinea 5 GB degeaba — REPARAT** *(găsit + reparat 2026-10-08, b250)*. Verificând starea de după reparaţiile de aseară am găsit `zeus.db` = **7.495 MB** pe disc şi `zeus.db-wal` = **4.908 MB**, deşi `PRAGMA page_count` arată doar **2.675 MB** de pagini reale (310k rânduri — retenţia funcţionează). Ştergerea a milioane de rânduri scrie enorm în WAL, iar SQLite **nu micşorează niciodată** acel fişier singur — păstrează vârful maxim pe veci. `wal_checkpoint(TRUNCATE)` l-a dat înapoi: **4.908 → 0 MB în 0,5 s**, disc de la 91 GB la 87 GB folosiţi. Ca să nu recrească, **cronul de retenţie face acum singur checkpoint-ul** după orice rulare care chiar a şters ceva (o rulare goală rămâne gratuită). 2 teste.

0.1 ✅ **Plasa de siguranţă anti-orfani — REPARATĂ** *(găsit + reparat 2026-10-07, commit `5d32239a`, GO de la operator)*. `emergency_close_queue` are 13 rânduri (id 36-48) imposibil de rezolvat, toate din 2026-08-18 04:08. Trei defecte care se compun în `server/services/emergencyCloseProcessor.js`:

0.2 ✅ **Recon-ul adopta poziţii COIN-M pe care sistemul nu le poate administra — REPARAT** *(găsit + reparat 2026-10-07, commit `5d32239a`)*. Contul testnet uid=1 avea poziţii COIN-M reale (`SAT_RECON_ORPHAN_ADOPTED`: `{"symbol":"BTCUSD_PERP","side":"LONG","amt":778}`); recon-ul le-a adoptat ca orfani, dar **toată calea de administrare/închidere merge pe `/fapi` (USDⓈ-M)** → `Invalid symbol` pentru orice `*USD_PERP`. Sistemul nu suportă COIN-M nicăieri. Aşa s-au născut cele 13 rânduri de la 0.1 (`decision_key = closefail_<seq>_RECON_PHANTOM_STALE_EMPTY`). **LIVRAT:** `reconHelpers.isUnmanageableSymbol()` — recon-ul refuză astfel de simboluri la uşă: nici adoptate, nici auto-închise, lăsate în pace cu un rând de audit (`SAT_RECON_UNMANAGEABLE_SYMBOL`) + o alertă. Regula: contractele COIN-M sunt singurele simboluri futures Binance cu underscore (`BTCUSD_PERP`, `BTCUSD_250926`), iar cele USDⓈ-M n-au niciodată (`BTCUSDT`, `1000PEPEUSDT`, `BTCUSDC`) — deci testul e şi suficient, şi conservator; un simbol lipsă/gol e tratat ca neadministrabil (nu acţionăm pe o poziţie pe care nu o putem nici numi). 6 teste.

0.4 ✅ **Dead-man switch-ul n-avea drum de întoarcere — REPARAT** *(2026-10-07, commit `5d32239a`, GO de la operator)*. Arma GLOBAL_HALT la heartbeat stale şi **nimic nu-l dez-arma vreodată**. Îngheţul era trecător (la 5 min), dar halt-ul era permanent — doar un restart (`RECOVERY_BOOT_COMPLETE`) îl curăţa. Exact această asimetrie a transformat un bug de performanţă în 2 luni de oprire silenţioasă. **LIVRAT:** 6 verificări sănătoase consecutive (~1 min) îl dez-armează, cu Telegram + audit. **Constrângere dură:** dez-armează DOAR un halt cu prefixul `DEAD_MAN_SWITCH:` — un halt pus de operator sau `EMERGENCY_CLOSE_CATASTROPHIC` supravieţuieşte, fiindcă a anula tăcut un halt de siguranţă real ar fi mult mai rău decât oprirea pe care o reparăm. Lipsa heartbeat-ului resetează seria (nu dez-armăm niciodată pe lipsă de dovadă). 10 teste, inclusiv ambele cazuri de refuz.


**2026-06-26:**
- **S9 reflection-blocking** (b240) — brain-ul respinge singur deciziile proaste; am adăugat alertă Telegram + audit `REFLECTION_BLOCKED`; rată 13.5% (în ținta 10-20%, zero tuning). Efectul se vede pe Telegram + „gândurile" brain-ului.
- **ML pre-REAL refinements** (b240) — #5 endpoint `/api/admin/ml/stage-promote` construit; #1 teste / #4 soak-scripts / #6 drawdown-halt confirmate deja gata. *Rămase opționale (amânate deliberat, low-value):* #2 rafinare digest-lookup, #3 `evaluatePerformance` cron.
- **Vault zero-knowledge** (b236-b240) — seif criptat creat + umplut: backup FULL 394MB (DB+.env+restore) + .env + chei exchange + keystore + link-uri APK; streaming-encrypt pt fișiere mari. *(Confirmarea download-ului pe Chrome = monitoring #12, încă activă.)*
- **Book of All + roadmap** — roadmap server-autonomy S8-S12/SP1-SP3 capturat complet în Plans; 12 docuri vechi de audit scanate (toate închise/istorice).
- **Fix-uri UI** — chart gol la schimbare de simbol REPARAT (b234, try/catch per-indicator); particulele verzi QM scoase de tot (b235).

---

---

*Notă: cartea asta o ţin eu la zi. Spune-mi „verificat X" şi o scot de aici.*

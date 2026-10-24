<!-- generat din docs/BOOK_OF_ALL.md linia 1874 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔧 DE FĂCUT — în ordinea priorităţii

> *(**2026-10-10:** auditul de persistență la refresh → P11-P15 și constatările R1-R10. **Închise azi: P11, P12, P13, P14** și **R1, R2, R3, R4, R7, R9, R10** — b265 → b268. Rămân 10, și **niciunul nu e al meu**: toate așteaptă o decizie sau o acțiune de la tine.)*

**P1 ✅ ÎNCHIS 2026-10-19 — era o atribuire greșită, nu un bug al nostru.** Vezi secțiunea *„P1 era o atribuire greșită”* de la finalul Book-ului: 418-ul vine pe `testnet.binancefuture.com` **cu `usedWeight=0/6000`**, iar ipoteza din textul de mai jos (`serverAT.js:5399` cere `positionRisk` per poziție) e falsă — linia aia e în calea de **addon**, o dată per addon, nu în bucla de recon. Fuzionat în **R16**, iar R16 e **decis de operator pe 19 oct: A, nu facem nimic (provizoriu)**. Textul original, păstrat pentru istoric:

> ~~**Rafala de rate-limit Binance** *(A2)*. 44 de intrări în SUPPRESSED, continuu din ora 08:00 ieri. Depăşeşte 6000/min pe `positionRisk`, declanşează întrerupătorul de IP (taie **toate** cererile semnate 61s) şi rupe reînnoirea `listenKey`. Backoff-ul escaladează şi nu se resetează. Pistă: `serverAT.js:5399` cere `positionRisk` **per poziţie**, deşi comentariul de la 5676 zice per user. N-am atins pollingul — cale de bani, vreau cauza dovedită. **Singurul lucru mare rămas care e al meu.**~~

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

**P13 ✅ REZOLVAT (b267 v1.7.241) — `LIQ CHART SETTINGS` scos** *(R3)*. Decizia ta: *„scoate-l ca să nu mintă”*. Gata — 23 de controale, zero cititori, dus. **Overlay-ul de lichidări rămâne neatins** și persistă în continuare prin `overlays`; a dispărut doar rotita și panoul. 4 teste care fixează ștergerea, inclusiv o gardă că overlay-ul n-a plecat cu el.

**P14 ✅ REZOLVAT (b267 v1.7.241) — Radar Lens ține minte** *(R4)*. Conectat ca **buclă completă** — restaurare la montare **și** salvare la click — pentru că jumătatea de salvare singură e exact greșeala care a făcut tipul de lumânare să pară reparat trei zile. Cheia **nu primeste niciodată un default**, deci nu poate suprascrie o alegere stocată cum făceau cele opt din b266; un id nerecunoscut e ignorat, nu dat randerului. **9 teste** (5 pe sârmă + 4 pe componentă).

**P15 ✅ REZOLVAT (b269 v1.7.243) — desenele urmează utilizatorul** *(R5)*. Secțiune nouă `drawings` în canalul user-context (SQLite), cu plafon la **300** (`drawingScope.SYNC_MAX_DRAWINGS`). Setul local **nu e niciodată tăiat** — doar copia care călătorește — iar o tăiere o spune în consolă, ca să nu existe divergență tăcută între dispozitiv și server. Măsurat, nu estimat: 77 bytes o linie orizontală, 144 un trendline, deci 200 de desene = 21,6 KB din plafonul de 64 KB — **grija mea cu mărimea era nefondată și mi-am retras-o**. La pull desenele se re-randează imediat, fără refresh.

---

### ✅ VERIFICARE LA SÂNGE PE LOGICĂ — redesignul NU a rupt nimic (2026-10-10)

Codul legacy citește setările **după id din DOM**, iar `_iv()` cade pe DEFAULT când elementul lipsește.
Dacă rescrierea pierdea un id, salvarea ar fi scris default-uri peste valorile reale — tăcut.
Am extras **toate cele 50 de id-uri** pe care `config.ts`, `state.ts`, `autotrade.ts`, `bootstrapInit.ts`
și `pageview.ts` le caută în DOM, și le-am verificat una câte una.

**Rezultat: niciun id pierdut de redesign.** Cele 7 care nu se găsesc în componente lipseau **și la tag-ul
`pre-institutional-redesign`**, deci sunt preexistente.

### 🔴 R12 — `manualLive` nu s-a salvat NICIODATĂ (preexistent, găsit de auditul de id-uri)

`config.ts:2001` construiește `USER_SETTINGS.manualLive` din trei id-uri:
```js
manualLive = { size: _iv('liveSize', null), sl: _iv('liveSL', null), tp: _iv('liveTP', null) }
```
**Niciunul dintre cele trei id-uri nu există nicăieri în aplicație** — nici acum, nici înainte de redesign.
Deci `_iv()` returnează `null` de fiecare dată, iar fiecare salvare scrie `null` peste ce era stocat.

**Dovada, aceeași semnătură ca la cele 8 chei din b266 — zero varianță:**
```
9 din 9 utilizatori:  manualLive = {"size": null, "sl": null, "tp": null}
```
E **a zecea instanță** din clasa R-C-6. Mărimea, SL-ul și TP-ul implicite ale panoului manual LIVE
n-au persistat niciodată.

🙋 **Nu am reparat-o** — e în afara redesignului și atinge calea de salvare. Reparația e mică
(nu mai trimite cheia când câmpurile nu există, exact ca la b266) dar o fac doar cu acordul tău.

---

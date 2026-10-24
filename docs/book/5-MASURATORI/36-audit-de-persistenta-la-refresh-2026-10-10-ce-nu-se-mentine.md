<!-- generat din docs/BOOK_OF_ALL.md linia 4010 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

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

**R3. ✅ SCOS (b267) — `LIQ CHART SETTINGS` nu făcea absolut nimic — nici în sesiune, nici după refresh.**
`client/src/components/modals/LiqSettingsModal.tsx`: cele patru `useState` au valori **hardcodate** (`'BTC'`, `'$500'`, `'24h'`, `'$USD'`) şi nu citesc niciodată din `w.S.liqSettings` — deci modalul arată default-urile chiar şi redeschis în aceeaşi sesiune. `saveAndApply()` scrie în `w.S.liqSettings`, dă `toast('Liq settings applied')` şi se închide. Căutat în tot `client/` şi `server/`: **zero cititori** ai lui `liqSettings`, nicio scriere în localStorage, nicio secţiune UC. Modalul e decorativ. `srSettings` e şi mai gol: whitelistat pe server, dar **nici writer, nici reader** nicăieri.

**R4. ✅ REPARAT (b267) — Radar Lens se reseta la fiecare refresh; jumătatea de client nu fusese scrisă niciodată.**
Whitelist-ul serverului are `'radarLens'` cu comentariul *„Radar Lens (D4 persistence)"* (`trading.js:807`) şi validatorul îl acceptă. Dar `RadarLensBar` (`client/src/components/brain/BrainCockpit.tsx:18-28`) ţine lentila şi timeframe-ul în `useState('hybrid')` / `useState('5m')` simple: fără localStorage, fără save, fără load. Nimic în tot clientul nu trimite vreodată cheia — **`radarLens` e ABSENT la toţi cei 9 utilizatori din DB**. Persistenţa a fost pregătită pe server şi nu a fost niciodată conectată în UI.

**R5. Desenele de pe chart, indicatorii cu stea şi tema sunt doar pe dispozitiv.**
`zeus_drawings_v1` + `zeus_drawings_vis` (trendlinii etc.), `zeus_ind_favorites` (★) şi `zeus_theme` sunt corect user-scoped în `_USER_KEYS`, deci **supravieţuiesc refresh-ului** şi nu se mai amestecă între conturi. Dar niciuna nu apare în `_buildAllSections()` şi niciuna nu ajunge în `user_settings`: se pierd la cache-clear, pe alt dispozitiv şi la reinstalarea APK-ului. Pentru un trader, desenele pierdute sunt cel mai scump element din listă.
*(Verificat mecanic: din cele 74 de chei user-scoped, 31 nu sunt în nicio secţiune UC. Majoritatea sunt corect locale — PIN, chei API, tab-leader, starea beacon-ului. Cele 4 de mai sus sunt cele care ar trebui să urmeze utilizatorul.)*

### 🟡 MICI

**R8. `public/app/assets` era root-owned** — de la un build rulat ca root la 05:47. Deploy-ul de azi a picat cu `EACCES` până l-am dat înapoi lui `zeus`. Aceeași familie cu incidentul `migration_flags.json`: ce lasă root în urmă blochează tăcut procesul zeus — și e greșeala mea. *Reparat la deploy; de verificat la fiecare build.*

**R9. ✅ ȘTERS (b267) — Pull-ul user-context punea `fontSize` din `uiScale`, o funcție scoasă în iunie.** Aplica o valoare în **procente** ca **pixeli**: o secțiune cu `100` dădea documentului **font de 100px**. Nu era armată în producție — verificat pe viu, nu presupus: `data` e `null` și `user_ctx_data` n-are rânduri. Dar o valoare rămasă de dinainte de iunie pe un singur dispozitiv era tot ce trebuia. Testul pică cu **`expected '100px' to be ''`** — grenada spusă cât se poate de clar.

**R10. ✅ REZOLVAT (b268 v1.7.242) — Panoul `ZEUS S/R SETTINGS` avea 21 de controale și putea livra 2.** Decizia ta: păstrăm **Enable + SAVE**, scoatem celelalte **20**. Făcut. Nu s-a pierdut nimic, pentru că nimic din ce promiteau cele 20 n-a fost livrat vreodată: motorul `renderSROverlay()` (`marketDataOverlays.ts:408`) are **17 linii** și face doar *top 3 maxime / 3 minime pe ultimele 50 de lumânări*, cu culoare, lățime și opacitate hardcodate — fără pivoți, fără zone, fără etichete, fără forță, fără filtru de volum. *Cât de bine era ascuns:* panoul zicea „Max Levels: 8” când motorul desenea mereu 6, iar color-pickerele aveau exact culorile hardcodate ale motorului, deci **păreau** legate. **Întrebarea ta — „nu se scot timeframe-urile de la chart?” — răspuns: NU**, și acum e fixat de un test, nu de vorba mea. Rândul Timeframe de acolo era `useState` privat, citit doar ca să colorezi butonul; timeframe-urile chartului trăiesc în `marketDataFeeds.setTF` + butoanele `.tfb`, iar fișierul ăla nu le-a atins niciodată. 5 teste. Client 740/740. *Ce rămâne o lucrare separată, dacă o vrei vreodată:* un motor S/R adevărat (pivoți, zone, forță) — nu e reparație, și și-ar aduce propriile setări cu el.

**R11. ✅ REPARAT (b269 v1.7.243) — Desenele de pe chart nu erau legate de simbol; un trendline tras pe BTC rămânea desenat pe ETH.** Acum un desen nou reține chartul pe care a fost tras, restaurarea randează doar ce aparține, iar `setSymbol` re-randează din storage. **Migrarea aleasă de tine (varianta 1):** desenele existente n-au simbol și rămân vizibile pe toate charturile — nu dispare nimic din ce ai desenat. *Regula care susține totul:* o salvare **nu trebuie niciodată** să ștampileze simbolul curent pe un desen vechi, altfel prima salvare pe ETH i-ar revendica toate liniile și ar dispărea de pe celelalte charturi. *Și capcana pe care o creează scoparea:* odată ce se randează un singur simbol, lista din memorie e o **vedere**, nu tot setul — o salvare care ar serializa doar vederea ar **șterge desenele tuturor celorlalte simboluri** (o linie trasată pe ETH ar fi distrus tot ce ai pe BTC). Salvarea face merge cu ce e în afara ecranului. Ambele reguli sunt fixate de teste pe care **le-am stricat intenționat ca să văd că mușcă**. **20 de teste** pe modulul pur `ui/drawingScope.ts` (extras ca să fie testabil — `drawingTools.ts` e un IIFE care cere chart viu).

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

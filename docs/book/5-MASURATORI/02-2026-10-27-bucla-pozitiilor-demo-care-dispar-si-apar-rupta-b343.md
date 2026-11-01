<!-- generat din docs/BOOK_OF_ALL.md linia 9548 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔁 2026-10-27 — Bucla poziţiilor demo care dispar şi apar: RUPTĂ (b343)

Urmărită cap-coadă — şi **n-a fost nevoie de niciun flip de steag pe calea banilor.**

### Bucla

1. La fiecare pornire, clientul îşi **restaurează poziţiile demo din starea salvată pe telefon** (`bootstrapStartApp`, late-restore) — fiindcă în acel moment `window._serverATDemoEnabled` e încă **`false`**: răspunsul serverului n-a ajuns.
2. Apoi vine **instantaneul autoritar** al serverului, care are **zero** poziţii demo (le închisese pe toate la 14:01), şi le şterge → **dispar**.
3. La următorul refresh se restaurează din nou → **apar**.

**Nici măcar nu era nevoie ca motorul din browser să deschidă ceva nou.**

### Garda exista deja — şi era corectă

`placeAutoTrade` refuză din **S6-B5** să deschidă demo când serverul deţine demo-ul. **Problema nu era deschiderea, era restaurarea.**

### Leacul era deja scris în casă, pentru exact cursa asta

`serverATCache` (**S8-P0-3**) ţine minte între sesiuni autoritatea serverului, tocmai ca să nu existe fereastra dintre boot şi primul răspuns. **Doar că flagul de DEMO n-avea memorie.**

Extins cu `readCachedDemo` / `writeCachedDemo`, semănat la boot în loc de `false` orb, scris la fiecare răspuns al serverului. Şi restaurarea se opreşte când serverul deţine demo-ul: **goleşte lista locală şi SPUNE în consolă** câte a sărit, ca poziţiile să nu dispară fără explicaţie. Garda e strictă pe `=== true`, deci cine rulează chiar pe client nu e atins.

### 🔒 O gaură în testul de scopare, găsită punând cheia nouă

`lsUserScoping` scana **doar chei scrise literal** în apelul `getItem`. Cheile ţinute într-o **constantă de modul** erau invizibile.

Lărgit scanarea → **şapte chei nescopate**, toate preexistente, dintre care **două de securitate**:

| cheie | de ce contează |
|---|---|
| **`zeus_pin_unlocked`** | pe un dispozitiv comun, un cont deblocat cu PIN poate lăsa deblocat şi celălalt |
| **`zeus_biometric_enabled`** | preferinţa de biometrie e per CONT |
| `zeus._serverATEnabled.v1` | gardă de autoritate AT; scoparea ei pierde cache-ul o dată |
| `zeus_security_nudge_snooze_ts`, `zeus_doctor_audio_ping`, `zt:qmLiq:v1` | date per user |

**NU le-am schimbat în treacăt în mijlocul altei lucrări.** Sunt încuiate ca **datorie cunoscută care poate doar să scadă**: un test cade dacă apare o cheie nouă nescopată, altul cade dacă lista devine un cimitir. **Raportate.**

`zeus_tab_leader` mutată la *device-wide* — alegerea tabului lider chiar e despre dispozitiv, nu despre cont.

**15 teste noi, 8 mutaţii moarte** — inclusiv garda scoasă (adică exact bugul lui), boot cu `false` orb şi cheia nescopată.

### ✅ Lanţul dovedit cap-coadă şi încuiat cu teste de ordine (b344)

După ce am rupt bucla la b343, am verificat că reparaţia chiar ţine — **şi am găsit că era mai curată decât credeam.**

**O corecţie la mine:** crezusem că flagul de autoritate pe demo ajunge *prea târziu* şi de aceea se restaurau fantomele. **Greşit.** `_applyPreboot` **ESTE** `_applyServerATState` — exact funcţia care oglindeşte `serverATDemoEnabled` — şi rulează la **linia 93**, înainte de restaurarea de la **189**.

**Flagul era corect tot timpul. Restaurarea pur şi simplu nu-l întreba.** Cache-ul adăugat la b343 rămâne ca plasă (dacă `/api/at/state` pică), dar **nu el era leacul.**

**Lanţul verificat pe date vii:** `SERVER_AT_DEMO` = true, `engine:1` are `mode: 'demo'` ⇒ serverul chiar trimite `serverATDemoEnabled: true`. **Măsurat, nu presupus.**

**Încuiat cu teste de ordine**, fiindcă tot fixul depinde de ea:

| ce se verifică | linia |
|---|---|
| aplicarea preboot | **93** |
| blocul de restaurare | 189 |
| **garda** | **203** |
| bucla care restaurează | 213 |

Plus: preboot-ul chiar oglindeşte flagul, şi cererea de stare chiar e **aşteptată cu `await`** — altfel ordinea din fişier n-ar însemna nimic. Două mutaţii le omoară: garda mutată după buclă, preboot-ul redenumit.

**Şi încă o greşeală a mea:** prima măsurătoare de ordine mi-a ieşit **falsă** — comparasem linia gărzii cu linia *blocului*, nu cu a *buclei*. Recalculat corect.

### 🔧 CORECŢIE LA MINE: mesajul de execuţie dublă spunea mai mult decât era adevărat (b345)

La **b342** scrisesem că pe demo *„rulează două motoare care deschid poziţii în acelaşi timp"*. Verificat în cod şi pe date vii: **nu e adevărat azi.**

| verificare | rezultat |
|---|---|
| `computeFullOwnership` cere `engineMode === 'live'`; al lui e `demo` | ⇒ blocarea **generală** a clientului **nu** se aplică |
| garda de **DEMO** (S6-B5): `serverATDemoEnabled && mode==='demo'` | **true && true** ⇒ `placeAutoTrade` **refuză** să deschidă demo din browser |

**Deci pâlpâirea e structural imposibilă acum, fără niciun flip de steag:**
- serverul deschide demo;
- clientul **nu poate** (S6-B5);
- şi de la b343 **nici nu mai restaurează** fantomele din memoria telefonului.

**Ambele căi pe care puteau apărea poziţii în browser sunt închise.**

**Riscul real**, pe care mesajul îl spune acum corect: garda S6-B5 e **singurul** lucru care opreşte al doilea motor. Dacă devine vreodată inertă, ambele părţi deschid demo deodată. De aceea steagurile **tot** ar trebui curăţate — dar e **igienă, nu urgenţă**, şi rămâne decizia lui.

Un test cade dacă garda dispare din `placeAutoTrade`; altul dacă mesajul redevine prea tare.

### 🧹 Fantomele se şterg de pe telefon IMEDIAT (b346)

Ultimul fir rămas nelegat din b343: garda golea lista **în memorie**, dar cele 27 rămâneau **pe disc** până când apuca să ruleze salvarea periodică — adică **curăţenia depindea de noroc**.

Acum, pe ramura care sare restaurarea, se cere o salvare locală **imediat după golire**. Trei lucruri păzite de teste:

1. **Ordinea** — dacă salvarea ar veni înainte de golire, ar scrie exact conţinutul vechi înapoi.
2. **Doar pe ramura aia** — în afara gărzii, am scrie peste starea bună a cuiva care chiar rulează pe client.
3. **Într-un `try`** — o salvare care aruncă nu are voie să rupă boot-ul.

**Un test al meu a căzut pe cod corect:** citea doar primele 500 de caractere din gardă, iar salvarea adăugată împinsese `return`-ul dincolo. Fereastră lărgită, cu motivul scris în test. **A şaptea oară** când un test al meu se înşală, nu codul.

**3 teste noi, 2 mutaţii moarte.**

### 🎚️ Ce ar însemna CHIAR flipul `CLIENT_AT=false` — analiza, ca să nu fie refăcută

Întrebarea rămasă din b342–b346: să stingem motorul din browser? **Măsurat, nu presupus.**

**Pentru contul lui (user 1), `CLIENT_AT` e deja INERT în toate modurile:**

| mod | cine deţine execuţia |
|---|---|
| `demo` | **serverul** (`SERVER_AT_DEMO`), iar clientul e blocat de garda S6-B5 |
| `live` + testnet | **serverul** (e user de cutover, `SERVER_AT_TESTNET_EXEC` on) |
| `live` + real | **serverul** (`_SRV_POS_REAL_ENABLED` on) |

**Dar steagul e GLOBAL.** Starea tuturor conturilor:

- toţi cei 8 useri cu stare de motor sunt pe **`demo`** ⇒ garda S6-B5 îi blochează pe toţi ⇒ **flipul nu schimbă nimic azi, pentru nimeni**
- activi în 30 de zile: doar **user 1** (196 tranzacţii) şi user 2 (una)
- **cutover: doar 1 şi 2.** Users 5, 11–15 **NU** sunt

⚠️ **Capcana, singura:** dacă un user NEcutover (5, 11–15) ar trece vreodată pe `live`, cu `CLIENT_AT=false` **n-ar mai avea niciun motor** — nici clientul, nici serverul (`SERVER_AT` e false, iar full-ownership cere cutover). **Eşec tăcut**, nu eroare.

**Concluzie:** flipul e **sigur azi pentru toţi**, cu o capcană viitoare pentru conturile necutover care ar trece pe live. Decizia rămâne a lui, acum pe cifre. Alternativa curată: flip **plus** adăugarea celorlalţi la cutover, sau o gardă care refuză trecerea pe live fără motor.

---

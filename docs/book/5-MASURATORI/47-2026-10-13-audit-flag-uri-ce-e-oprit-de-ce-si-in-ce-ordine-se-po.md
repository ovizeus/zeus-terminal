<!-- generat din docs/BOOK_OF_ALL.md linia 3507 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🚩 2026-10-13 — AUDIT FLAG-URI: ce e oprit, de ce, și în ce ordine se pornește

Cerut de operator (*„am multe chestii off vreau sa le activam in ordine ... de la mic la mare ...
vreau tot full active"*), pe baza a 4 capturi din **Settings / Flags**. **PLAN — nimic executat
încă; pornim diseară.**

### ⚠️ Corectare a mea, înainte de orice

Prima numărătoare a dat **10 flag-uri oprite**. Era greșită: scriptul meu încărca
`server/migrationFlags.js` **fără `dotenv`**, iar 6 dintre flag-uri se citesc din `process.env`.
În producție `server/config.js` (care cheamă `dotenv`) se încarcă la linia 41, înaintea modulului
de flag-uri la 53, deci sunt **toate 6 PORNITE**. Dovada nu e lecturarea codului, ci datele:
`ml_dsl_outcome` are **949 de rânduri** pe trei cohorte — `shadow` 344, `lossside` 319,
`mlctl` 286 — ultimele din 13 oct 01:02.

**De reținut operațional:** `DSL_PARITY_SHADOW_ENABLED`, `ML_DSL_SHADOW_ENABLED`,
`ML_DSL_LEARN_ENABLED`, `ML_DSL_LOSSSIDE_SHADOW`, `ML_DSL_LOSSSIDE_ACTIVE`, `ML_DSL_FULL_CONTROL`
sunt **getters fără setter**, citite o dată la boot din `.env`. **Nu apar în pagina de Flags**
(API-ul întoarce 38 de flag-uri, nu 44) și **nu pot fi schimbate din UI** — cer editare `.env` +
restart. Cine se uită doar în UI crede că nu există.

### 🔴 „Tot full active" este IMPOSIBIL prin construcție

`_enforceMutexStrict()` **aruncă la încărcarea modulului** dacă flag-urile sunt în conflict — adică
**procesul moare la boot**, exact bucla de 1082 de restarturi din 10 octombrie. Pornirea tuturor
celor 4 ar încălca **cinci** reguli deodată:

| conflict | starea actuală care-l provoacă |
|---|---|
| `SERVER_AT && CLIENT_AT` | `CLIENT_AT` = ON |
| `SERVER_BRAIN && CLIENT_BRAIN` | `CLIENT_BRAIN` = ON |
| `SERVER_AT && SERVER_AT_DEMO` | `SERVER_AT_DEMO` = ON |
| `BYBIT_LIVE && BYBIT_TESTNET` | `BYBIT_TESTNET_ENABLED` = ON |
| `BYBIT_LIVE && BYBIT_DRY_RUN_ONLY` | `BYBIT_DRY_RUN_ONLY` = ON (latch-ul de siguranță) |

Flag-urile astea **nu sunt întrerupătoare uitate** — sunt capetele opuse ale unor migrări. Fiecare
cere să **stingi** altceva întâi. „Full active" nu e o stare care există.

### 📶 Ordinea, de la mic la mare (34 ON / 4 OFF din 44)

| # | flag | ce cere | stare |
|---|---|---|---|
| 1 | `ML_BANDIT_AUTO_APPLY_MINOR` | nimic — se poate porni liber | ⚠️ **nu încă** |
| 2 | `SERVER_BRAIN` | stingi `CLIENT_BRAIN` + `SERVER_BRAIN_DEMO` | 🔴 blocat |
| 3 | `SERVER_AT` | stingi `CLIENT_AT` + `SERVER_AT_DEMO` | 🔴 blocat |
| 4 | `BYBIT_LIVE_ENABLED` | stingi `TESTNET` **și** `DRY_RUN_ONLY` | 🔴 bani reali — ultimul |

**#1 — de ce „nu încă".** Face ca ML-ul să aplice singur propuneri MINOR fără acordul operatorului.
Comentariul din cod: *„Default OFF until R5B governance proven in shadow"*. În baza vie:
`ml_primitive_proposals` = **o singură propunere**, status `PROPOSED`, niciodată aprobată. Nu există
istoric pe care să se sprijine decizia. Se pornește **după** ce există propuneri aprobate manual din
care se vede că tier-ul MINOR e judecat corect.

**#4 — de reținut.** Pe lângă cele două stingeri, cheia Bybit testnet pentru uid=2 e expirată
(punct deschis mai vechi). Și `BYBIT_DRY_RUN_ONLY` e latch-ul care garantează că **niciun** HTTP
Bybit nu pleacă din proces. Coborârea lui e o decizie separată de pornirea LIVE.

### 🔑 BLOCAJUL REAL — harnașamentul de paritate scrie doar pe jumătate

Poarta pentru #2 și #3 e paritatea: compari decizia clientului cu a serverului pe același tick.
`PARITY_SHADOW_ENABLED` e **ON**, dar în `brain_parity_log`:

```
client : 1163 randuri, ultimul 2026-10-13 16:35:43 UTC  (scrie continuu)
server :    7 randuri, TOATE in 2026-10-10 20:42:03 UTC  (apoi nimic, 3 zile)
```

Șapte rânduri într-o singură secundă acum trei zile, apoi tăcere. **Fără jumătatea de server nu
există cu ce compara**, deci flip-ul pe SERVER_BRAIN/SERVER_AT ar fi pe orbește — exact ce interzice
planul de migrare.

E **al treilea** caz din aceeași familie în două săptămâni: bucla închisă pe jumătate, care *pare*
pornită (tipul de candelă care se citea dar nu se scria; Radar Lens cu serverul gata și clientul
nelegat; acum paritatea cu clientul viu și serverul mut). Merită tratat ca tipar, nu ca accident.

### 🔬 DIAGNOSTIC GATA — de ce tace paritatea pe server (cauză găsită, NIMIC reparat încă)

`serverBrain.js:445-462`. Scriitorul `source='server'` e pe ramura **`else`**:

```js
if (_shouldRunMainCycle()) {          // SERVER_BRAIN || SERVER_BRAIN_DEMO
    _timer = setInterval(_runCycle, ...)
} else if (MF.PARITY_SHADOW_ENABLED) {        // ← NU se ajunge niciodata aici
    _shadowTimer = setInterval(_runShadowCycle, ...)   // scriitorul de paritate
}
```

`_shouldRunMainCycle()` (linia 346) = `SERVER_BRAIN === true || SERVER_BRAIN_DEMO === true`.
**`SERVER_BRAIN_DEMO` este ON** → ramura principală câștigă → `_runShadowCycle` **nu e programat
niciodată**. `PARITY_SHADOW_ENABLED` e aprins și **nu poate produce nimic** în configurația lui.

Codul **știe**: comentariul imediat următor spune *„The demo main cycle suppresses `_runShadowCycle`
→ testnet users get no parity rows"*, și adaugă `_runTestnetShadowCycle` ca să compenseze. Dar acela
scrie doar pentru userii trecuți de `_isTestnetShadowTarget` (linia 375):

```js
if (serverAT.getMode(userId) !== 'live') return false;     // cere mod LIVE
return execEnv.env === 'TESTNET';                          // SI mediu TESTNET
```

**Operatorul tranzacționează pe DEMO.** Dovada, din poziții reale închise: `mode=demo, env=DEMO`,
**38 din 38**. Deci nu e țintă, deci nu se scrie niciun rând. Cele 7 rânduri din 10 oct 20:42:03
sunt o fereastră scurtă în care a existat o țintă; de atunci, tăcere structurală.

**Nu e defecțiune — e configurație.** Dar efectul e că poarta de dovezi pentru SERVER_BRAIN/SERVER_AT
**nu se poate umple niciodată** cât timp el stă pe demo. Este **a patra** instanță a tiparului
„flag aprins care nu face nimic" în două săptămâni.

**Trei ieșiri, în ordinea preferinței mele:**
1. 🟢 **Lărgește `_isTestnetShadowTarget` să includă și DEMO.** Shadow-ul e prin definiție fără
   execuție (comentariul: *„NEVER touch serverAT, Telegram, regime history, reflection"*), deci
   adaugă dovezi fără să schimbe nimic în felul în care se tranzacționează. Aditiv, reversibil.
2. 🟡 Stingi temporar `SERVER_BRAIN_DEMO` ca să cadă pe ramura shadow — dar asta **schimbă**
   cine decide pe demo. Nu e gratis.
3. 🔴 Renunți la paritate și flipuiești pe încredere — exact ce interzice planul.

### ▶️ CE FACEM DISEARĂ, în ordine

1. **Reparăm jumătatea de server a parității.** Muncă mică, doar logare, **zero influență pe
   execuție**. E singura care **deblochează** treptele mari. De aflat întâi *de ce* s-a oprit după
   7 rânduri — nu de pornit ceva la nimereală.
2. **Lăsăm paritatea să adune** date reale pe DEMO. Fără volum, pasul 3 n-are temei.
3. **Abia apoi** SERVER_BRAIN (pereche: stingi `CLIENT_BRAIN` + `SERVER_BRAIN_DEMO`), ca **o
   singură** schimbare pe care o putem întoarce dintr-o mișcare.
4. **Separat și mult mai târziu**, SERVER_AT. Niciodată în aceeași sesiune cu #3 — regula
   „nu înlănțui schimbări riscante".
5. `ML_BANDIT_AUTO_APPLY_MINOR` după ce există propuneri aprobate manual.
6. `BYBIT_LIVE_ENABLED` — decizie separată, cu cheie validă și opt-in.

**Înainte de ORICE flip:** `banned_until` din `binance_rate_state`, și un singur restart pe sesiune.
Un flag greșit aici nu dă eroare în UI — **omoară procesul la boot**.

---

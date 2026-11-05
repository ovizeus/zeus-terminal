<!-- generat din docs/BOOK_OF_ALL.md linia 78 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🩸 DE CE NU IESE PE CÂȘTIG — auditul cerut de operator (2026-10-21, fără schimbări de cod)

Audit pe date vii, 3 441 de tranzacții închise. **Net istoric: −8 459,4.** Nimic nu a fost
modificat; mai jos e doar ce am dovedit, cu cifra lângă fiecare afirmație.

### 1. Geometria ieșirii — cauza principală a pierderii

DSL se activează abia după ce prețul merge în favoarea ta cu `openDslPct` (0,35% pe presetul
`fast`, cel folosit). Consecința, măsurată pe `dslProgress` al fiecărei poziții închise:

| ieșire | n | DSL era activ | PnL mediu | total |
|---|---|---|---|---|
| **HIT_SL** | 103 | **0 %** (`active:false`, `phaseChanges:0`) | −104,07 | **−10 718,9** |
| **DSL** | 440 | **100 %** | +16,29 | +7 169,4 |

Împărțirea e perfectă, 0% / 100%. **DSL taie numai câștigătorii.** Dacă tranzacția merge
împotrivă din prima secundă, DSL nu pornește niciodată, iar pierderea curge până la stopul
întreg. Dacă merge în favoare, urmărirea de 0,5% o închide la **3,4% din ținta TP**
(+16 din ~220 medie).

Rata de reușită e **bună: 81%**. Dar raportul câștig/pierdere e **1:6,4**, iar pragul de
rentabilitate la 1:6,4 cere **86%**. Pierde din geometrie, nu din direcție.

Pe presetul `fast`, prețul trebuie să parcurgă **8,2 lățimi de urmărire** fără o singură
retragere de 0,5% ca să atingă ținta.

### 2. LONG + SHORT în același timp — DOUĂ cauze independente, ambele dovedite

**739 de conflicte direcționale** în istoric, **352 provocate de brain**, ultimul
**2026-10-20 13:03**. Inclusiv 2026-10-20 05:27: brain a intrat SHORT SOLUSDT având
**LONG SOLUSDT deschis** — același simbol.

**(a) Garda e oarbă la poziții-fantomă.** `_findSameModeOpposite` (serverAT.js:1150) compară
`p.userId === userId`. Există **466 de poziții la care `userId` lipsește din obiect**, deși
coloana `user_id` îl are. Garda nu le vede → brain deschide opusul. **64,3% din conflicte sunt CAUZATE de aceasta** (rejucat prin garda reală — vezi 10;
cifra de ~93% din prima citire era o corelaţie, nu o cauză). Fantomele au și `sl:0, tp:0` și **zero `dslParams`** (100% din
466), deci nimic nu le poate închide:

| | n | durată medie | închise cu mâna |
|---|---|---|---|
| fără `userId` în obiect | 466 | **18,2 h** | 69% |
| cu `userId` | 2 951 | **1,0 h** | 6% |

Una a stat deschisă **9,96 zile** (XRPUSDT, −384,88). Un scriitor identificat:
`_buildPendingPositionData` (binanceOps.js:160) omite `userId` — comentariul lui chiar spune
„ar confuza garda direcțională", au reparat `mode` și au ratat exact câmpul testat primul.
27 din fantome sunt din octombrie și **nu** sunt din backfill, deci mecanismul e viu.

**(b) Constituția știe și tace.** Principiul `NO_OPPOSITE_ENTRY_ON_OPEN` a fost încălcat
**31 161 de ori**, severitate **`hard`**, ultima **azi 14:48**. `enforcementEngine.evaluate()`
întoarce `allowed:false`, dar singurul apelant (serverBrain.js:1582) scrie
`enforcementMode: 'advisory'` **ca șir literal** și **nu citește niciodată `_r1Result.allowed`**.
Comentariul promite „un flag de env" care nu există.

Garda de la (a) **funcționează** când vede poziția: 878 de blocaje `mixed_bias_skip`, ultimul azi.

### 3. ML — învață, nu atinge nimic

- **`ml_influence_audit`: `gate_status='skipped'` la 100% din 413 845 de rânduri.** Nicio
  influență ML nu a fost aplicată niciodată. În plus `proposed_dir <> phase2_dir` de **0 ori** —
  propunerea nici n-a diferit vreodată.
- **198 din 367 de tabele ML (54%) sunt complet goale** — construite, niciodată conectate.
- **`ml_dsl_optin` e gol.** DSL Drive învață (1 129 rezultate, 276 posteriori) cu **zero autoritate**.

### 4. R7 („N7") — gândește, dar 99,7% e umplutură

`ml_voice_log`: **951 144** rostiri. Doar **2 814 (0,3%)** sunt substanțiale (decizie, blocaj,
acțiune). Restul: `neutral_watch` 317k, `conf_mid` 180k, `conf_low` 155k, `reflection_block` 130k.
Nu e un creier care raționează; e un debit de stare.

### 5. Sincronizarea — monitoarele compară cu nimic

- **`dsl_parity_log`: 649 833 de rânduri, TOATE `source='server'`.** Zero de la client. Un
  jurnal de paritate cu o singură parte nu poate detecta nicio nepotrivire, oricât crește.
- **`brain_parity_log`**: server 319 795 de decizii la încredere medie **26,4**; client
  2 292 la **3,8**. Pe ultimele 24 h: server 4 914 @ 28,3 · client 264 @ 3,9. Cel care
  tranzacționează și cel pe care îl vezi tu **nu sunt același creier**.
- Coloana `dir` din `brain_parity_log` e **NULL la toate** — paritatea nu poate compara nici
  direcția, fiindcă nimeni nu scrie câmpul.

### 6. CORECŢIE IMPORTANTĂ — ce e istoric şi ce e viu (adăugat după trasarea completă)

Prima citire a acestui audit a pus hemoragia de **−20 548 pe HIT_SL** ca problemă vie. Nu este.
**Ultima atingere de stop hard a fost 2026-07-06.** Iar **octombrie e NET POZITIV: +2 730.**

Dar adevărata dovadă e asta — aceleaşi intrări, două mâini diferite pe ieşire, luna curentă:

| cine închide | n | câştiguri | total | mediu | mediana |
|---|---|---|---|---|---|
| **operatorul, cu mâna** | 21 | **21 / 21 = 100%** | **+2 963,3** | **+141,11** | +80,4 |
| **automatul (DSL)** | 86 | 32 / 86 = 37% | +382,5 | **+4,45** | — |

Zero pierderi la mână; cea mai slabă ieşire manuală: **+12,6**. Distribuţia e densă
(12,6 · 19,7 · 20,6 … 388,7 · 534,6), deci **nu sunt doi outlieri care trag media**.

**Concluzia corectată:** sistemul nu mai explodează, dar nici nu mai poate câştiga. Automatul
scoate **+4,45** din exact aceleaşi poziţii din care mâna operatorului scoate **+141,11** —
de **32 de ori** mai puţin. Intrările brain-ului sunt bune; el o dovedeşte luând aceleaşi
poziţii. **Ieşirea e singura diferenţă.** Asta e „de ce nu iese pe câştig", în cifre.

### 7. Leacul EXISTĂ deja, construit în iunie, şi e îngrădit greşit

Changelog-ul **b161 (2026-06-22)** descrie exact ce am redescoperit independent azi:
*„when DSL manages the exit the system wins (+2765, R:R 2.1), but trades that escape DSL and
die at the wide hard SL bleed (HIT_SL −6024 avgLoss −134)"*. S-a construit **`SMART_CUT`** —
taie pierzătorul la 0,75% advers susţinut (K=2), înaintea stopului larg. Flagul
`ML_DSL_LOSSSIDE_ACTIVE=true` **e aprins în `.env`**.

Dar poarta e `MF.ML_DSL_LOSSSIDE_ACTIVE && pos.env === 'TESTNET'` (serverAT.js:3600), iar
pierderea pe stop stă aproape toată în afara ei:

| mediu | n | total | leacul are drept? |
|---|---|---|---|
| `TESTNET` | 65 | −4 857 | **da** |
| `DEMO` | 32 | −5 218 | nu |
| **`env` LIPSEŞTE din obiect** | **16** | **−10 057** | **nu — câmpul nu există** |

Doar **24%** din hemoragie e în mediul permis. Cea mai mare gaură din tot sistemul —
**−10 057 în 16 tranzacţii** — e invizibilă leacului fiindcă `pos.env` lipseşte: **exact
aceeaşi clasă de bug ca `userId`-ul lipsă de la punctul 2.** Un câmp nescris dezarmează
simultan garda direcţională ŞI tăietorul de pierderi.

### 7b. REZOLVAT — `SMART_CUT` este COD MORT de la livrare

`SMART_CUT` n-a închis **niciodată** nimic: 0 rânduri în istoric, 0 apariţii în jurnale,
deşi a avut 14 ocazii permise pe TESTNET după 22 iunie. Cauza e o greşeală de domeniu,
ascunsă de un `catch` gol:

- `const _dslRrSim = require('./dslRrSim')` e declarat la **linia 2586, în `_closePosition()`**
  (care începe la 2537).
- E folosit la **linia 3602, în `onPriceUpdate()`** (care începe la 3352).
- Ambele încep în **coloana 1** → funcţii surori, **nicio închidere** între ele. Nu există
  nicio declaraţie la nivel de modul (doar 3 apariţii în tot fişierul: 1 declaraţie + 2 folosiri).

Deci linia 3602 aruncă `ReferenceError: _dslRrSim is not defined` la **fiecare tick**, iar
`catch (e) { /* fail-closed */ }` de la 3612 o înghite în linişte.

**Dovadă empirică** (reproducere cu structura exactă, 200 de tickuri advers-susţinute):

```
modulul se incarca si functia EXISTA : true
tickuri rulate                      : 200
tăieri SMART_CUT                    : 0
excepţii inghitite de catch-ul gol  : 200
eroarea reala, invizibila in prod   : ReferenceError: _dslRrSim is not defined
CONTROL, import in domeniul corect  : a tăiat = true
```

Cu importul în domeniul corect, **acelaşi cod taie**. Reparaţia e o linie (mută `require`
la nivel de modul sau în `onPriceUpdate`) — dar aprinderea ei schimbă ieşirile pe bani, iar
b161 a pus intenţionat un gard de probe (`n>=30-50`). **Decizia e a operatorului**, nu o fac
singur. Notat şi că fixul nu e suficient: poarta `pos.env === 'TESTNET'` lasă tot 76% din
hemoragie afară (punctul 7).

**Regulă nouă — R-C-14. Un `catch` gol pe o cale de bani ascunde o cădere, nu o tratează.**
Patru luni de `ReferenceError` pe fiecare tick, zero semnal. Orice `catch` pe calea banilor
înregistrează măcar o dată eroarea (contor sau log cu limitare), altfel „fail-closed" nu e
siguranţă, e orbire.

### 8. „N7" — lămurit

Nu există ca identificator nicăieri (cele 5 potriviri din `grep` sunt coincidenţe în blocuri
base64 din `pwa.js`/`index.html`). Arhitectura ML are inelele **R0–R7**, iar R7 e
`communication`/`meta`. Citirea corectă a mesajului operatorului este însă **„n7" = „nu"**
(pe tastatură `7` e deasupra lui `u`; în acelaşi mesaj a scris „trwbuie" cu `w` lângă `e`).
Propoziţia devine: *„ce face ML în asta, de ce **nu** gândeşte cum trebuie să gândească"* —
răspuns la punctele 3 şi 4. Nu era un modul.

### 9. Paritatea DSL — analiza dusă până la capăt

Interogarea de alăturare pe 649 833 de rânduri a fost oprită de mine (încărca baza vie), dar
răspunsul e determinat fără ea: **`SELECT source, COUNT(*) ... GROUP BY source` întoarce un
singur rând, `server` = 649 833.** Nu există nicio linie cu `source` de client, deci alăturarea
client↔server are **exact 0 perechi** şi „faza identică" / „stop identic" sunt nedefinite, nu
mici. Un jurnal de paritate alimentat de o singură parte nu poate raporta niciodată o
nepotrivire, oricât creşte. La fel, `brain_parity_log.dir` e NULL pe toate cele 322 087 de
rânduri, deci nici direcţia nu se compară.

### 10. De la CORELAŢIE la CAUZALITATE — conflictele rejucate prin garda reală

Afirmaţia „~93% din conflicte implică o fantomă" era o **corelaţie**. Am rejucat fiecare
conflict prin garda **extrasă verbatim** din `serverAT.js:1149` (funcţie pură, rulată izolat,
fără să atingem baza vie ca scriitor). Cifra corectă e **mai mică şi dovedită**:

**Dovadă unitară, deterministă** — aceeaşi carte, aceeaşi gardă, un singur câmp schimbat:

| carte de poziţii | verdictul gărzii reale |
|---|---|
| opus LONG cu `userId=1` | **BLOCHEAZĂ** |
| opus LONG cu `userId=null` | **LASĂ SĂ TREACĂ** |
| ambele în carte | BLOCHEAZĂ |

**Rejucarea istoricului** (143 de conflicte reale provocate de brain, grupate pe coloana
`user_id` care e sursa de adevăr):

| | n | |
|---|---|---|
| garda reală **ar fi blocat** | **51** | → au intrat pe **ALTĂ cale** |
| garda reală **a fost oarbă** | **92** | → **100% pentru că toate poziţiile opuse aveau `userId` lipsă** |

**Deci 64,3% din conflicte sunt CAUZATE de `userId` lipsă** — nu 93%. Corecţie asumată.

**Şi o cauză a treia, pe care nu o aveam — deja reparată.** Cele 51 pe care garda le-ar fi
blocat: **49 din 51 n-au `decisionId`** şi **50 din 51 n-au `owner`** → n-au trecut prin
`processBrainDecision` deloc, au intrat pe calea de adopţie/recon/stream. Distribuţia în timp:
**43 în aprilie, 7 în mai, 1 în iunie, ZERO după.** Se potriveşte exact cu
`[PHANTOM-SHORT FIX 2026-06-08]`, care a cablat aceeaşi gardă pe calea de adopţie
(`serverAT.js:6565` şi `6576`, cu log-ul „DEFERRED (would create same-mode opposite book…)").
**ATENŢIE — afirmaţia asta e CORECTATĂ la punctul 13: cauza B NU e închisă.** Reparaţia din
iunie a acoperit doar calea `userDataStream`; adopţia recon şi ruta de înregistrare a clientului
sunt tot fără gardă, iar ocolirea a tras ultima dată în august 2026.

### 11. DSL Drive pe o poziţie în pierdere — lanţul închis în cod

Nu există nicio comandă DSL Drive pe o poziţie în pierdere, şi se poate arăta de ce fără
niciun test sintetic. `serverDSL.js:236`:

```js
const activationHit = isLong ? (price >= s.activationPrice) : (price <= s.activationPrice);
if (!s.active && activationHit) { s.active = true; ... }
```

`activationPrice` e intrarea deplasată cu `openDslPct` în direcţia **favorabilă**. Pe un LONG
care pierde, preţul nu urcă niciodată până acolo → `s.active` rămâne `false` şi `progress`
rămâne 0. Iar `if (s.active)` (linia 285) păzeşte TOT mecanismul de ieşire DSL, exact ca poarta
`_ds.active && _ds.mlActiveFromEntry` a lui DSL Drive (`serverAT.js:3414`).

**Confirmat în producţie pe 103 din 103**: fiecare poziţie ieşită pe HIT_SL are
`{"active": false, "progress": 0, "phaseChanges": 0}`. Lanţul cauzal e complet:
*poziţie în pierdere → `activationHit` fals → `active` fals → se sare ŞI blocul de ieşire DSL
ŞI blocul DSL Drive → poziţia curge până la stopul hard original.*

### 12. De ce clientul nu raportează paritate — câmp cu cititor şi zero scriitori

Serverul e gata: `POST /api/brain/parity/dsl/client` → `db.logDslParityRow(..., 'client', ...)`
(`routes/brainParity.js:107`). Clientul chiar îl cheamă (`client/src/trading/dsl.ts:796`).
Dar emisia e păzită de:

```js
localStorage.getItem('zeus_dsl_parity_shadow') === 'true'
```

**Căutat în tot codul: un cititor (`dsl.ts:786`), ZERO scriitori** — nici client, nici server,
nici legacy — şi **niciun comutator în interfaţă**. Apare doar în `DEVICE_WIDE` al unui test şi
la **R6** din această carte. Ca să existe jumătatea de client a parităţii, operatorul ar trebui
să scrie semaforul de mână în consola browserului.

Acelaşi tipar ca la auditul Quant (71 din 157 de câmpuri citite fără scriitor): **monitorul nu
e stricat, e nealimentat.** De aceea cele 649 833 de rânduri sunt toate `source='server'` şi
alăturarea client↔server are exact 0 perechi — determinat, nu estimat.

### 13. CORECŢIE + atribuire COMPLETĂ: patru căi în carte, doar două consultă garda

**Corectez ce am scris la punctul 10:** „cauza B e închisă din iunie" este **GREŞIT**. Reparaţia
din iunie a cablat garda pe calea `userDataStream`, **nu** pe celelalte două. Greşeala mea a venit
dintr-un filtru propriu: rejucasem doar intrările cu `src === 'auto'`, ceea ce a ascuns adopţiile.

`SAT_RECON_ORPHAN_ADOPTED` a tras **14 ori, ultima 2026-08-18 01:29**, cu 96 de poziţii
`source='external'` — iar pe 2026-08-18 01:29 au apărut două conflicte direcţionale reale
(SHORT NEARUSD_PERP şi SHORT ETCUSD_PERP peste un registru LONG).

**Atribuirea completă — toate 460 de conflicte, pe calea de intrare:**

| cale | total | garda ar fi blocat | garda oarbă | ultima |
|---|---|---|---|---|
| MANUAL | 278 | 55 | 223 | 2026-10-11 |
| **BRAIN (`src=auto`)** | **143** | **51** | **92** | **2026-10-20** |
| altă/necunoscută | 31 | 7 | 24 | 2026-04-26 |
| **ADOPŢIE (`source=external`)** | **8** | **8 = 100%** | 0 | **2026-08-18** |

Cele **278 manuale sunt prin politica operatorului** ([[no-mixed-bias-per-mode]]: intrările
manuale NU îi sunt supuse, cartea mixtă pentru hedge e decizia lui) — **nu sunt bug**.

**Dovada curată de ocolire: adopţia, 8 din 8.** Garda le-ar fi blocat pe toate, iar
`_registerExternalPosition` (`serverAT.js:5032`) **nu o cheamă niciodată** — verificat: zero
apeluri `_findSameModeOpposite` în corpul funcţiei; verifică doar `_findSameSideOpenDup`
(aceeaşi parte).

**Garda există în DOAR două locuri vii** (`grep` pe tot fişierul dă 1373, 6565, 6576 + definiţia):

| cale în carte | consultă garda? | accesibilă din |
|---|---|---|
| `processBrainDecision` (1373) | **DA** | brain-ul serverului |
| `userDataStream` fast-path (6565/6576) | **DA** (adăugat 2026-06-08) | evenimente bursă |
| `_registerManualPositionLegacy` (4782) | **NU** | **client, `POST /api/trading/…` → `trading.js:241`** |
| `_registerExternalPosition` (5032) | **NU** | adopţie recon |

### 13b. RETRACTARE — cele 51 NU sunt de origine client

La punctul 13 am scris că cele 51 vin de la autotrade-ul clientului şi că „long+short" şi
„nesincronizat" sunt aceeaşi cauză. **Am verificat prin amprentă pozitivă şi e GREŞIT. Retrag.**

`brainModeAtOpen` şi `label` sunt scrise **exclusiv de client** (`grep` pe serverAT.js +
serverBrain.js = **0 apariţii**). În cele 51:

| amprentă | prezenţă |
|---|---|
| `brainModeAtOpen` (doar clientul) | **0 / 51** |
| `label` (doar clientul) | **0 / 51** |
| `cycle` (doar brain-ul serverului) | 17 / 51 (33%) |
| `fusionMult` (doar brain-ul serverului) | 17 / 51 (33%) |
| `decisionId` (doar `processBrainDecision`) | 2 / 51 |
| `owner` | 1 / 51 |

Control: 579 de poziţii sigur de la brain-ul serverului (`decisionId`+`cycle`) au
`brainModeAtOpen` în **0** cazuri — amprenta e curată, deci absenţa ei în cele 51 e concluzivă.

*(Prima rulare a dat 0/0: uitasem să încarc câmpul `userId` în obiectele sondei, deci garda
compara cu `undefined` la toate. Am adăugat o **auto-verificare a instrumentului** înainte de
orice raportare — R-V-11 aplicat pe mine.)*

**Deci calea celor 51 NU se poate determina din obiectul stocat**: o treime poartă câmpuri de
decizie ale serverului **fără `decisionId`**, iar restul n-au niciun marcaj de provenienţă.

**Unificarea CORECTĂ** — şi e mai simplă decât cea pe care am retras-o:

> Boala e una singură: **obiectul poziţiei e persistat incomplet pe mai multe căi.** Acelaşi
> defect, în trei câmpuri diferite, produce trei simptome fără legătură aparentă:
> `userId` lipsă → **orbeşte garda direcţională** (92 de conflicte);
> `env` lipsă → **dezarmează tăietorul de pierderi** (−10 057 în 16 tranzacţii);
> `decisionId`/`owner` lipsă → **distruge trasabilitatea**, aşa că nici post-mortem nu se poate
> numi calea (cele 51).

**Atribuirea celor 143 de conflicte ale brain-ului, 100% explicată:**
- **92 (64,3%)** — brain-ul serverului; garda a rulat dar a fost **oarbă** (`userId` lipsă) → **VIE**
- **51 (35,7%)** — garda **nu a rulat**: intrate pe una din cele două căi fără gardă
  (`_registerManualPositionLegacy` 4782 / `_registerExternalPosition` 5032). Calea exactă **nu
  se poate stabili** — vezi 13b: le lipseşte provenienţa. → **VIE**

Niciuna din cele două nu e închisă. Plus cauza constituţiei în `advisory` (31 161 de încălcări
`hard`, necitite) şi ocolirea prin adopţie (8/8, ultima în august). **Patru cauze, toate vii
în afară de cea din iunie.**

### 14. ÎNCHEIERE — separarea în timp decide totul; cauza vie e UNA

Am epuizat toate cele trei surse de provenienţă pentru cele 51 (obiectul stocat; `audit_log` —
are doar 10 înregistrări de intrare, toate din august; `position_events` — `CREATED` începe
**2 iunie 2026**, după ce ele se întâmplaseră). Calea lor exactă e **necunoscibilă din datele
păstrate**, şi acum se vede şi de ce nu mai conteaza: **separarea în timp le rezolvă.**

| cauză | n | distribuţie | ultima | stare |
|---|---|---|---|---|
| **A — garda OARBĂ (`userId` lipsă)** | **92** | 2026-04: 20 · **2026-10: 72** | **2026-10-20 13:03** | **VIE, DOMINANTĂ** |
| **B — intrare brain pe cale fără gardă** | 51 | 04: 43 · 05: 7 · 06: 1 | **2026-06-07 22:17** | **ÎNCHISĂ** |
| C — adopţie recon fără gardă | 8 | 2026-08: 8 | 2026-08-18 01:29 | **latentă, deschisă** |
| D — constituţia în `advisory` | 31 161 | continuu | **azi 14:48** | **VIE** |

**Îmi rafinez retractarea de la 13b.** Conflatasem două căi distincte. Ultimul conflict de tip B
este **2026-06-07 22:17**, iar reparaţia e datată `[PHANTOM-SHORT FIX 2026-06-08]` — **ziua
următoare**. Potrivire perfectă: afirmaţia mea iniţială („închisă în iunie") era **corectă pentru
calea brain-ului**. Ce am descoperit nepăzit e **adopţia recon** (`_registerExternalPosition`,
8/8 ar fi fost blocate, ultima în august) — latentă, nu aceeaşi cauză.

**Deci răspunsul final la „de ce brain deschide long şi short în acelaşi timp":**

> **O singură cauză vie o explică: `userId` lipseşte din obiectul poziţiei, aşa că garda —
> care este corectă şi chiar trage (878 de blocaje, ultimul azi) — nu vede poziţia opusă.
> 72 din cele 92 de apariţii sunt din luna asta, ultima ieri la 13:03.**
> A doua cauză vie nu creează conflicte singură, dar le lasă să treacă: constituţia detectează
> încălcarea de 31 161 de ori ca `hard` şi nu-şi citeşte niciodată propriul verdict `allowed`.
> Restul (B închisă în iunie, C latentă prin adopţie) sunt istorie şi risc, nu explicaţia.

Şi rămâne valabilă unificarea de la 13b: acelaşi câmp nescris care orbeşte garda (`userId`) are
un frate (`env`) care dezarmează tăietorul de pierderi, şi alţi doi (`decisionId`, `owner`) care
distrug trasabilitatea. **O singură reparaţie, trei simptome.**

### 15. Sincronizarea — ţeava DOVEDITĂ funcţională; lipseşte doar semaforul

Am construit ţeava întreagă pe o bază de unică folosinţă (nicio atingere a bazei vii), cu toate
piesele **copiate verbatim** din codul real: schema din migrarea `031` (`database.js:764`),
`INSERT`-ul din `_stmtLogDslParity` (`database.js:11577`), corpul lui `logDslParityRow`
(`database.js:11581`) şi alăturarea client↔server — exact interogarea care pe baza vie dă 0 perechi.

Am scris două rânduri de server şi două de client, dintre care unul cu divergenţă injectată:

```
randuri scrise: client = 2   server = 2
ALATURAREA client-server (aceeasi interogare ca pe baza vie):
   perechi        : 2
   faza identica  : 1 / 2
   stop identic   : 1 / 2
   divergenţe detectate: 1   (am injectat intenţionat 1)
```

**Verdict: lanţul `server → tabel → alăturare → detecţie de divergenţă` FUNCŢIONEAZĂ**, şi prinde
divergenţa când există. Pe baza vie dă 0 perechi **dintr-un singur motiv**: nu soseşte niciun
rând de client, fiindcă emisia e păzită de `localStorage.zeus_dsl_parity_shadow`, care are
**un cititor (`client/src/trading/dsl.ts:786`) şi ZERO scriitori** în tot codul, fără comutator
în interfaţă.

Deci monitorul **nu e stricat şi nu e greşit construit — e doar nealimentat.** Reparaţia e să i se
dea o cale de aprindere (comutator în UI sau pornit implicit), nu o rescriere. Rămâne decizia
operatorului, fiind o schimbare de comportament în client.

### Ce NU e vinovat (verificat, ca să nu căutăm acolo)

- **SL-ul funcționează.** Per tranzacție realizează **0,971** din stopul planificat (80 de
  cazuri); doar 13 îl depășesc, cu alunecare normală. *Prima mea citire pe medii sugerase o
  depășire de 56% — era o comparație între rânduri diferite, nu per tranzacție.*
- **`ENTRY_FAILED_INSUFFICIENT_MARGIN` (1 199)** e istoric: ultima în iunie 2026.
- **Cartea de poziții e coerentă ACUM**: 3× LONG demo, zero mixt.

### Ordinea reparațiilor, dacă vrei să le facem

1. **Geometria DSL** — singura care schimbă semnul. Două sub-puncte, acum că leacul e trasat:
   (a) `SMART_CUT` e COD MORT — `_dslRrSim` nedefinit in `onPriceUpdate`, dovedit (7b); (b) poarta `pos.env === 'TESTNET'`
   lasă 76% din hemoragie afară. Atinge bani; separat, cu teste, nu înlănțuită.
2. **`userId` în obiectul poziției** — reparație mică, deblochează garda *și* DSL-ul pe fantome.
3. **`allowed` citit, sau `blocking` pe `NO_OPPOSITE_ENTRY_ON_OPEN`** — o linie, dar schimbă
   ce intră; separat de 1 și 2.
4. **`dir` scris în paritate + clientul să raporteze** — altfel nu putem măsura 1-3.

**Nu am atins nimic.** Procesul e online, 19 h, fără reload; arborele git e curat.


---

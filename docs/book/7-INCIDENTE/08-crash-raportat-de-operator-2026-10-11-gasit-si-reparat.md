<!-- generat din docs/BOOK_OF_ALL.md linia 2023 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🚨 CRASH RAPORTAT DE OPERATOR 2026-10-11 — găsit și reparat

*„am deschis o pozitie manuala demo si am o eroare: Cannot read properties of null (reading 'toFixed')"* — mesaj roșu cu **Retry**, adică `ErrorBoundary`.

### R13. `PositionCard` cădea pe un număr lipsă *(preexistent, NU de la redesign)*

`components/dock/ares/PositionsList.tsx` formatează **șase** numere. Două (`markPrice`, `liqPrice`)
treceau prin `fmt1()` cu gardă. **Celelalte patru, nu:**
```
pos.size.toFixed(1)     pos.entry.toFixed(1)
pos.pnlPct.toFixed(2)   pos.pnl.toFixed(2)
```
Tipul `AresPositionCard` le declară pe toate șase `number`, de-aia n-a prins nimic. Dar sunt date de
runtime, iar **baza vie nu e de acord**: rândurile lui deschise din `at_positions` au `entryPrice: null`,
iar o poziție proaspăt deschisă n-are `pnl` până la primul tick. Garda a fost scrisă pentru două
câmpuri și uitată pentru patru. **Identice la tag** → preexistent.

**Reparat cu `fmtNum()`, care diferă de `fmt1` în două feluri care contează:**
1. **păstrează un zero real** — o poziție la break-even are P&L `0.00`, iar o liniuță ar ascunde un număr pe care îl avem;
2. **respinge `null`/`undefined`/`''` î**nainte** de conversie** — `Number(null)` e `0`, deci altfel ar tipări un `0.00`
   încrezător pentru o valoare pe care n-o avem. Pe o suprafață de bani, exact asta nu are voie să se întâmple (**R-C-9**).

6 teste, dovedite prin mutație: pun la loc un singur apel nepăzit → 3 pică.

### R14. Un panou putea crăpa fără să lase urmă — reparat

Crash-ul a ajuns în loguri ca **`[CLIENT_ERR] unknown`**: fără mesaj, fără fișier, fără linie. Două cauze:

1. **`ErrorBoundary.componentDidCatch` doar făcea `console.error`.** Un panou putea crăpa în fața
   operatorului pe telefon și serverul nu afla nimic. Acum trimite mesaj + stack + **component stack**
   (partea care contează: mesajul singur nu distinge Auto Trade de Manual Trade de un card THEIA).
2. **Raportorul global filtra după calea fișierului** (`/trading/`, `/core/`…). În producție orice script
   e `index-<hash>.js`, deci condiția **nu e adevărată niciodată** — nicio eroare de motor n-a mai fost
   raportată cu detalii de când aplicația e bundle-uită. Regula e inversată: raportează orice are mesaj,
   cu două excepții numite (zgomot ResizeObserver, și `Script error.` cross-origin care n-are detalii).

11 teste, inclusiv reproducerea exactă a erorii lui într-un boundary și garda că un raport eșuat nu doboără aplicația.

### R15. `BrainPulseCard` citea 4 din 5 câmpuri de la nivelul greșit *(preexistent)*
`regimeEngine`, `entryReady`, `entryScore`, `gates` stau sub `brain`, nu la rădăcina store-ului →
Regime, Entry ready, Entry score și Gates arătau `—` permanent. Invizibil pentru compilator
(selectoare tipate `(s: any)`) și pentru ochi (liniuța arată ca „nu sunt date încă”).
*Un test al meu trecea degeaba la prima scriere — potrivea cuvântul din etichetă; strâns și dovedit prin mutație.*

**870 teste / 120 fișiere**, typecheck 67 neschimbat, bundle reconstruit **fără reload** (doar client, R-OP-2).

---

### 🔴 R17. **Crash-ul lui NU era R13.** Adevăratul vinovat: `DslDrivePanel` *(b271 v1.7.245)*

R13 era un bug real de aceeași formă, dar **nu al lui**. Dovada: crash-ul a continuat să vină
**după** 07:14, adică **din chiar bundle-ul care conținea reparația R13** (`index-CorJ7oIn.js`,
confirmat în access log). Deci alt loc.

**Nu o dată — de NOUĂ ori doar pe 11 oct:** 07:09:10, 07:11:53, 07:14:53, 07:15:02, 07:15:07,
11:40:10, 11:40:15, 11:40:22, 13:58:13. Toate din aplicația lui Android (SM-S938B).

**Locul:** `components/dock/DslDrivePanel.tsx:54`. Ruta trimite poziția **brută**:
```js
entry: p.price, sl: p.sl        // server/routes/dslDrive.js:37
```
iar panoul formata ambele cu un helper **fără nicio gardă**, în timp ce fratele lui, **o linie mai jos**,
are gardă corectă:
```ts
const fmt = (x: number) => (Math.abs(x) >= 1000 ? x.toFixed(1) : x.toFixed(2))   // ❌ nepăzit
const pct = (x?: number | null) => (Number.isFinite(x as number) ? ... : '—')     // ✅ păzit
```
O poziție deschisă **fără stop loss** stochează `sl: null`. Nu e caz-limită: din **3367** rânduri în
`at_closed`, **303 au `sl` literal `null`** — cam 1 din 11. Cât timp o astfel de poziție e deschisă,
panoul face poll **la fiecare 1500 ms** și crapă la **fiecare** randare — de aia o singură poziție a
produs o zi întreagă de rapoarte. `Math.abs(null)` e `0`, deci ramura `>= 1000` nu salvează nimic:
**ambele** ramuri cheamă `.toFixed` pe `null`.

**Reparat** cu exact idiomul fratelui (`Number.isFinite` respinge `null` fără să-l convertească → un
zero real rămâne `0.00`, doar un număr absent devine `—`). Acoperă toate 3 call-site-urile, inclusiv
`cockpit.pivotLeft`. **6 teste**; înainte de fix testul reproduce **exact** mesajul lui, la **exact**
linia 54.

### 🔴 R18. De ce a durat o zi: serverul citea nume de câmpuri pe care **niciun client nu le trimite**

R14 (de dimineață) era doar **jumătate** de reparație. Două raportoare diferite postează la **același**
endpoint cu **nume diferite**:

| raportor | trimite |
|---|---|
| `utils/guards.ts` (`w.onerror`) | `msg`, `src`, `line`, `col` |
| `ErrorBoundary.tsx` | `reason`, `stack`, `componentStack`, `url` |

Handler-ul live citea **doar al doilea set** → **orice** eroare necaptată de window se loga ca
**cuvântul gol `unknown`**, fără mesaj, fără fișier, fără linie.

**Și exista un AL DOILEA handler** pentru `/api/client-error`, la linia 1304, care citea corect
`msg`/`src`/`line` — **mort din ziua în care a fost scris**, fiindcă Express răspunde cu **prima** rută
care potrivește, iar aceea e înregistrată ~1000 de linii mai sus. Ruta duplicat e scoasă (zero
schimbare la runtime — nu rula niciodată), cu un comentariu care păstrează lecția.

**Reparat:** ambele forme sunt înțelese acum, într-o funcție de normalizare cu teste proprii
(`server/utils/clientErrorReport.js`), iar `stack` + `componentStack` se scriu în log.
**Dovedit live după reload**, pe sistemul viu:
```
msg:"VERIFY window shape probe"  filename:".../index-CnsB7JyC.js"  lineno:54  colno:70  stack:"..."
```
(înainte: `msg:"unknown"`, restul gol).

### 🟠 R19. Throttle-ul de rapoarte de eroare era **GLOBAL**, nu per client

`/api/client-error` e intenționat în `publicPaths` (ca să se poată raporta un crash chiar de pe pagina
de login) → `req.user` **nu se populează niciodată** → cheia de throttle era **constanta `'anon'`
pentru toți clienții de pe planetă**. Deci throttle-ul de 5s era **global**: un telefon într-o buclă de
randare **stingea tăcut** rapoartele de crash ale **tuturor** celorlalți utilizatori, răspunzându-le
`{ok:true, throttled:true}`. Exact asta explică logul rărit (intrările de la 07:15 sunt la >5s una de
alta; tot ce cădea în interval s-a pierdut). Acum cheia e adresa clientului.

### 🟡 R20. Sentry pe client **n-a rulat niciodată** — așteaptă decizia lui 🙋

Singurul forward client→Sentry din toată aplicația trăia **în blocul mort** de la R18. Deci nu s-a
executat niciodată. (Pe deasupra, `SENTRY_DSN` nici nu e setat — e dublu mort.) **NU l-am activat**:
a trimite date de client către un terț e o decizie deliberată, nu un efect secundar al unei reparații
de bug. 🙋 **Dacă vrei Sentry pe client, spune și îl conectez.**

### ✅ R21. Baleiere EXHAUSTIVĂ a clasei — `DslDrivePanel` era **singura** instanță neconținută

Nu m-am oprit la bugul găsit. Am profilat întâi **ce e null în datele reale** (400 de rânduri din
`at_closed`): nullabile sunt `sl`, `tp`, `closePnl`, `tpOrderId`, `tier`, `_slQueuedSL`. Apoi audit
automat pe tot clientul: fiecare `obj.camp.toFixed(` unde `camp` e declarat nullable undeva ȘI linia
n-are gardă → **29 de locuri**. Triate unul câte unul:

| loc | verdict |
|---|---|
| `DslDrivePanel.tsx:54` | 🔴 **BUGUL REAL** — reparat (R17) |
| `PositionTable.tsx:32,34,37` | ✅ cod mort (nerandat nicăieri) + `null > 0` e `false`, deci cade pe `—` |
| `ARIAPanel.tsx:132-134` | ✅ `st.levels &&` păzește; `computePatternLevels` dă `null` (păzit) sau obiect complet din aritmetică pe klines |
| `BrainCockpit.tsx:205-206` | ✅ default-ul store-ului e `{buyPct:50,sellPct:50}`; writer-ul face aritmetică → cel mult `NaN`, iar **`NaN.toFixed()` nu aruncă** |
| `bootstrapPanels.ts:24,49` (Exposure) | ✅ **conținut** — e în `.then()` cu `.catch()` care scrie „Failed to load" în panou |
| `ui/panels.ts:1121,1137` (PnL Lab) | ✅ **conținut** — tot corpul e în `try/catch` (linia 1144); datele vin local, nu din API |
| restul (`autotrade.ts`, `orderflow.ts`, `quantmonitor/*`, `indicators.ts`) | ✅ fals-pozitive heuristice (nume de câmp împrumutat de la alt tip) sau în motor cu gardă |

**Concluzia, care e partea care contează:** din toată aplicația, **un singur** loc din această clasă
putea dobora un panou în fața operatorului, și acela era cel care chiar o făcea. Celelalte ori sunt
păzite, ori sunt cod mort, ori dau `NaN` (care nu aruncă), ori sunt prinse de un `catch` care
degradează vizibil în loc să crape.

**O capcană găsită pe drum, meritoasă de ținut minte:** serverul face `+x.toFixed(2)` înainte de
`res.json`. Dacă `x` ajunge `NaN`, **`JSON.stringify(NaN)` dă `null`** — deci contractul API **poate**
livra `null` pe un câmp tipat `number`, chiar dacă serverul „garantează" un număr. Dovedit:
`JSON.stringify({a:+(NaN).toFixed(2)})` → `{"a":null}`. De-aia garda pe client nu e paranoia.

### ⚪ Rămase, aceeași clasă, **neatinse** (tipul zice `number`, realitatea nu)
- `DslDrivePanel.tsx:150` — `ml.momentum.toFixed(2)` nepăzit. Producătorul (`serverAT.js:3541`)
  pornește de la `_mom = 0` și rămâne finit pe acea cale, deci **nu e exploatabil azi**.
- `brain/BrainCockpit.tsx:205-206` — `s.buyPct.toFixed(0)` / `s.sellPct.toFixed(0)` nepăzite.
  Nu am dovedit că pot fi `null`; **nu le-am atins** ca să nu înlănțui schimbări (R-P).

**879 teste / 121 fișiere**, typecheck **67 neschimbat**, **UN** reload (21:06, restart 1093),
ban Binance `0` înainte și după.

---

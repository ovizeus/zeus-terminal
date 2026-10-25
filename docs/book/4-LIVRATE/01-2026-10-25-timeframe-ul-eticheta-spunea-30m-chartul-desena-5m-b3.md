<!-- generat din docs/BOOK_OF_ALL.md linia 8286 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ⏱️ 2026-10-25 — TIMEFRAME-UL: eticheta spunea 30m, chartul desena 5m (b320 v1.7.294)

> Raport operator: *„eu setez pe 30 min sau 1h sau 15 etc ies din zeus si cand intru starea e la fel pe
> 30 min sau 1h dar chartul nu e dece pacaleste ca ar fi dau refres si dupa aia se schimba la cat e"*.

**Descrierea lui conţine diagnosticul**, ca şi la trendline: **eticheta e corectă şi desenul nu.** Deci
restaurarea **rulase** — `setTF()` e singurul loc care scrie eticheta — dar lumânările de pe ecran erau
ale altui timeframe. Şi *„dau refresh şi după aia se schimbă"* spune că e o **cursă**, nu o setare
pierdută: o setare pierdută nu se repară singură la a doua încercare.

### Lanţul, cu trei verigi

**1. Pornirea cerea un timeframe inventat.** `core/bootstrapStartApp.ts:228`:

```js
w.fetchKlines('5m')      // literal, la FIECARE pornire, orice ai avea salvat
```

**2. `setTF` eliberează un lacăt care nu e al lui.** `FetchLock.release` e un `delete` pe o mapă, fără
nicio verificare de proprietar:

```js
release: function (name) { delete _locks[name] }
```

Deci când restaurarea cheamă `setTF('30m')`, cererea de 5m **încă în zbor** îşi pierde lacătul şi a doua
cerere porneşte peste ea. **Două cereri de lumânări în aer deodată.**

**3. Şi garda de răspuns învechit se uita doar la SIMBOL:**

```js
if (w.S.symbol !== sym) { console.warn('[fetchKlines] stale response for ' + sym); return }
// ...nimic despre timeframe
```

Amândouă răspunsurile scriu `w.S.klines` şi cheamă `renderChart()`. **Cine ajunge ULTIMUL câştigă.** Când
răspunsul de 5m întârzie mai mult decât cel de 30m, chartul rămâne pe 5m cu eticheta pe 30m. Un refresh
schimbă ordinea — şi de aia *„după aia se face"*, şi de aia părea intermitent.

### Bugul, reprodus într-un test ÎNAINTE de a fi reparat

Nu l-am dedus doar din citit. Testul care îl prinde porneşte cererea de 5m prima, o face să răspundă
**lent**, mută timeframe-ul pe 30m, aduce lumânările de 30m, şi abia apoi lasă răspunsul de 5m să ajungă:

```
AssertionError: expected [ ...5 items ] to have a length of 20 but got 5
```

**Cele 5 lumânări de 5m au înlocuit cele 20 de 30m.** Exact ce vede el pe telefon, într-o aserţiune.

### Reparaţia, pe clasă

> **Un răspuns trebuie să DOVEDEASCĂ faptul că mai e dorit înainte să scrie — pe toate axele care îl
> pot învechi, nu doar pe cea de care ne-am lovit prima oară.**

Garda primeşte şi timeframe-ul, lângă cea de simbol, în aceeaşi formă. **Nu am înlocuit-o pe cea veche
— am adăugat-o**, şi un test ţine minte asta. Aceeaşi pereche şi pe calea de poll a barelor vii, unde
calea `WS_PROXY` verifica deja `msg.tf !== tf` şi calea veche nu — **două implementări ale aceleiaşi
reguli care nu erau de acord**, [[R-C-23]] încă o dată.

Şi pornirea nu mai inventează: `fetchKlines(w.S.chartTf || '5m')`. `config.ts` pune deja `S.chartTf` din
`USER_SETTINGS` înainte de punctul ăla, deci **cererea de pornire poate fi direct cea bună** — una
singură, pe timeframe-ul corect, în loc de două care se bat pe aceeaşi serie. Asta scoate cursa din
rădăcină; garda rămâne centura, pentru schimbări rapide de simbol sau de timeframe făcute cu degetul.

### Dovada

**5 teste noi**, dintre care unul e **cursa exactă din raport**. **4 mutaţii, toate moarte:**

| Mutaţia | Rezultat |
|---|---|
| scot garda de timeframe (bugul lui) | **2 teste pică** |
| garda se compară cu ea însăşi (`tf !== tf`) | **2 teste pică** |
| scot garda de SIMBOL (să nu fi rupt-o) | **1 test pică** |
| pornirea revine la literalul `5m` | **1 test pică** |

**Şi un test al meu a fost greşit, nu codul:** verificaţia că literalul a dispărut citea **tot fişierul**
şi se agăţa de propriul meu comentariu, care citează `fetchKlines('5m')` ca să explice de ce nu mai e.
**Un test care cade pe explicaţia fixului, nu pe fix.** Corectat să citească doar codul.

**Client: 151 de fişiere, 1 281 de teste verzi. `tsc --noEmit` complet curat, 0 erori.**
**Verificat în BUNDLE-UL SERVIT**, nu în sursă, în formă minificată:

```js
if(L.S.chartTf!==e){console.warn(`[fetchKlines] stale response for tf `+e+` (now `+L.S.chartTf+`)`);return}
```

şi literalul `fetchKlines("5m")` **nu mai există nicăieri în bundle**.

**Backup înainte de lucru:** `/root/zeus-backups/timeframe-boot_20261025_194900` plus tag git
`pre-timeframe-fix`.

### 🔶 Ce NU am verificat ([[R-V-18]])

- **nu l-am văzut cu ochii pe telefonul tău.** Testele dovedesc că răspunsul învechit nu mai scrie, şi
  bundle-ul servit conţine garda — dar confirmarea adevărată e să pui 30m, să ieşi, să intri, şi să vezi
  chartul pe 30m **fără refresh**. Asta rămâne de făcut de tine;
- **n-am atins `FetchLock.release`**, deşi eliberarea unui lacăt de către cine nu-l deţine e o problemă
  de clasă, nu doar aici. Un lacăt cu proprietar ar fi o schimbare mai mare, pe o bucată folosită de
  multe aduceri de date; am preferat să scot cursa din rădăcină şi să pun garda. **E scris aici ca să
  nu se piardă**;
- reparaţia e **doar de client**, deci nu cere reload ([[R-OP-2]]) — intră la un refresh. **Numărul de
  build servit va arăta b319 până la următoarea repornire naturală**, deşi codul de client e deja b320.

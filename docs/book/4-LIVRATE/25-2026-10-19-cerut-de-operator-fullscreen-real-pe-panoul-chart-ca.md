<!-- generat din docs/BOOK_OF_ALL.md linia 4763 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🖥️ 2026-10-19 — CERUT DE OPERATOR: fullscreen real pe panoul chart, „ca TradingView" (b278 v1.7.252)

> *„butonul de fullscreen de la chart cand il apas vreau ca chartul sa devina singur pe ecran exact ca si
> cum ar fi trading view … adica sa se afiseze ca si cum ar fi alta aplicatie tot ce e chart indicatori
> adica tot panoul chart dar grija mare sa nul strici"*

**Backup înainte de orice atingere**, cum ai cerut: tag `pre-chart-fullscreen-20261019` + copii `.bak` ale
celor patru fișiere. Revenire instantanee:

```
git checkout pre-chart-fullscreen-20261019 -- client/
```

### De ce nu arăta așa — patru cauze distincte, nu una

Butonul *făcea* ceva (punea clasa `fsm` pe `#csec`, care e `position: fixed; inset: 0`), deci părea
implementat. Nu era:

1. **Fără API nativ de fullscreen.** Doar clasa CSS. Acoperea pagina, dar **bara de browser rămânea** —
   exact diferența dintre „panou mare" și „altă aplicație", care e chiar ce ai cerut.
2. **`window.innerHeight - 100`** — o constantă ghicită. Nu scădea toolbar-ul, legenda și panourile de
   indicatori aprinse. Cu indicatori pornite, suma depășea ecranul și `overflow: hidden` **tăia ultimele
   panouri**. Cu cât aveai mai mulți indicatori, cu atât se vedea mai puțin.
3. **Ascundea panoul CVD** (`#cc`) în fullscreen — opusul cerinței „tot ce e chart indicatori". Și trata
   **numai** `#cc`: celelalte ~40 de panouri nu erau atinse deloc. Inconsecvență, nu decizie.
4. **`_resizeCharts()` folosea `getChartH()`**, care întoarce **400px fix** și nu știa de fullscreen. Deci
   orice redimensionare, `orientationchange`, sau colapsul barei de browser pe Android **readucea chartul
   la 400px în mijlocul ecranului plin**. Fullscreen-ul se auto-anula.

### Ce am făcut

Modul nou **`client/src/data/chartFullscreen.ts`**, care ține aritmetica și contractul cu API-ul nativ:

- **`measureOccupiedHeight`** citește DOM-ul în loc să țină o listă de id-uri. Un indicator adăugat mâine
  intră automat în socoteală. Lista hardcodată era exact felul în care codul vechi ajungea să trateze doar
  `#cc` și să uite restul.
- **`computeFullscreenChartHeight`** dă chartului exact ce rămâne din viewport, deci **suma e chiar
  ecranul** — nimic nu mai iese ca să fie tăiat. Cu clamp la 160px, ca să nu primească bibliotecia o
  înălțime negativă când ai foarte multe panouri.
- **`resolveChartHeight`** e **singurul** loc care decide înălțimea, folosit **și** de `toggleFS` **și** de
  `_resizeCharts` — ca a doua să nu mai poată anula prima. Asta e reparația cauzei 4.
- **Fullscreen nativ** cu toate prefixele. Un refuz al browserului **nu rupe nimic**: clasa CSS acoperă
  oricum tot viewportul paginii, deci degradează, nu cade.
- **Ieșirea cu Esc sau F11** e prinsă prin `fullscreenchange`, plus un `keydown` de rezervă pentru cazul în
  care API-ul nativ a fost refuzat (atunci nu există eveniment nativ). Butonul React află prin evenimentul
  `zeusChartFullscreen`, ca să nu rămână glifa pe „ieși din fullscreen" într-o fereastră deja normală.
- **Gardă de înregistrare unică** pe listeneri, ca un re-import să nu lege Esc de două ori.
- CSS: reguli `:fullscreen` și `-webkit-full-screen`, `#mc` pe `flex: 1` cu `min-height: 0`, zero colțuri
  rotunde pe ecran plin.

**Panourile de indicatori nu mai sunt ascunse în fullscreen** — rămân exact cum le-ai lăsat, pentru că sunt
parte din „tot panoul chart".

### 🔌 Și un bug preexistent, găsit pe drum

Tasta **F** chema `window.toggleFS` prin `_call()`. **`window.toggleFS` nu a existat niciodată** —
`toggleFS` e un export de modul, nu un global. Deci scurtătura de fullscreen era **moartă**, probabil de la
migrarea la module. Acum cheamă direct funcția, și `_call` rămâne doar ca punte pentru un eventual global
din bundle-ul legacy.

### Dovezi

**16 teste noi**, toate picate prima dată (modulul nu exista). **Șase mutanți omorâți**, fiecare pe o gardă
reală:

| mutant | ce pică |
|---|---|
| `resolveChartHeight` ignoră fullscreen (cauza 4 reintrodusă) | 1 test |
| măsurarea nu mai sare peste copiii ascunși | 1 test |
| măsurarea nu mai sare peste gazda chartului | 2 teste |
| fără clamp la minim (înălțime negativă) | 1 test |
| fără protecție NaN | 1 test |
| `enterNativeFullscreen` nu mai prinde refuzul browserului | 1 test |

**Client 927 teste / 125 fișiere** (baseline 911 / 124), **typecheck 67 neschimbat**, **build curat**.
Zero atingeri pe calea de bani sau de ordine — e strict layout client-side.

**Ce rămâne de confirmat de tine, pe ecran:** apasă butonul cu câțiva indicatori aprinși și spune-mi dacă
se vede tot și dacă iese curat cu Esc. Aritmetica e dovedită în teste, dar cum arată la tine pe ecran e
singurul lucru pe care nu îl pot verifica din afară.

### 👀 Observat în timpul lucrului, nereparat: trei 429-uri de alt tip (19 oct, 17:30–17:57)

Nu sunt ban-urile de 4 ore din R16 și **nu sunt de la reload-urile mele** (au venit la 37–53 de minute
după ele). Sunt `HTTP 429: Too many requests; current limit of IP(15.158.242.112) is 60` — limitări de
**60 de secunde**, auto-recuperate, trei în 16 minute, apoi liniște.

Mesajul spune *„limit ... is 60"*, adică un plafon pe **număr de cereri**, nu pe greutate — alt contor
decât cel de 6000 pe care îl urmărim. Nu l-am investigat: ar fi însemnat să înlănțuiesc o investigație
peste o livrare, exact ce interzice regula. **De urmărit** dacă revine; dacă da, merită aflat care endpoint
are plafon 60.

---

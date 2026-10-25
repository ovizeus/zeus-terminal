<!-- generat din docs/BOOK_OF_ALL.md linia 6451 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🖐️ 2026-10-24 — „nu merge să trag dungi": chartul se muta sub tine (b307 v1.7.281)

După b306 operatorul a raportat în continuare: *„nu merge sa trag dungi"*. b306 a
reparat armarea — era reală şi dovedită — dar **nu era tot**. Nu am pus un fix peste
altul: m-am întors la investigaţie cu informaţia nouă, care e cuvântul **„trag"**.

Notă de limbă pe care am verificat-o, nu am presupus-o: „a trage o dungă" în română
înseamnă şi pur şi simplu „a desena o linie", deci nu m-am sprijinit doar pe gestul de
tragere. Am căutat şi cauze care ar opri desenul cu totul.

### Ipoteze eliminate prin verificare

- **`_mc()` nu găseşte containerul** → FALS, `id="mc"` e în `PanelShell.tsx:468`.
- **API de chart schimbat** → FALS, `lightweight-charts` instalat e **4.1.3** şi
  `addLineSeries` există în build.
- **Coordonate decalate**, fiindcă structura e `#mc` → `.zr-chart-container` → pânză,
  iar `_priceAtY` scade marginea lui `#mc`, nu a containerului → FALS:
  `.zr-panel__body--chart` are `padding: 0` şi containerul e `100%/100%`, deci
  dreptunghiurile coincid.
- **Modulul nu se încarcă** → FALS: `legacyLoader` importă `phase1Adapters`, care
  importă `ui/drawingTools`, iar şirurile lui (`__ZEUS_DRAW__`, `zeus_drawings_v1`)
  sunt în bundle-ul servit.

### Cauza 1: panoramarea chartului nu era suspendată niciodată

`marketDataChart.ts:43-44`:

```
handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
handleScale:  { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
```

Şi în tot clientul **nu există niciun `handleScroll: false`**. Deci când tragi cu
unealta armată, lightweight-charts **panoramează chartul sub tine**:

- pe mouse nu se desenează nimic, pentru că gestul e consumat de chart;
- pe atingere, punctul 2 se calculează pe scala **deja mutată**, deci linia
  aterizează altundeva decât ai tras.

Asta e exact comportamentul pe care TradingView îl suspendă cât timp o unealtă de
desen e activă. Acum, cât timp o unealtă e armată, se sting toate gesturile de
tragere şi se pun la loc la dezarmare — **calculate din opţiunile vii prin
`chart.options()`**, nu hardcodate, ca restaurarea să nu reaprindă ceva ce era stins
şi să nu dubleze valorile din `marketDataChart.ts`. Zoom-ul pe rotiţă şi pinch rămâne
aprins, ca în TradingView.

### Cauza 2: pe mouse nu exista deloc desen prin tragere

Fluxul apasă-trage-ridică exista **doar pe atingere**, de la Pack G.3. Pe mouse se
putea **numai clic-clic**: o tragere punea cel mult punctul 1 şi lăsa o previzualizare
punctată care urma cursorul la nesfârşit. Adăugat `mousedown`/`mousemove`/`mouseup`
care oglindesc fluxul de atingere, cu **acelaşi prag de 8px** pe suma deplasărilor.

Grija care conta: **sub prag nu se întâmplă nimic** în noul flux, deci clic-clic
rămâne exact cum era. Altfel un simplu clic ar fi pornit tragerea şi ar fi pus punctul
2 peste punctul 1 — adică exact linia de lungime zero pe care o interzisesem la b306.
Un `mousedown`+`mouseup` produce **şi** un `click`, deci se suprimă acţiunea
următoare, ca să nu cadă pe ramura de selectare imediat după ce s-a desenat.

### Şi o minciună introdusă de propriul meu fix de la b306

Garda pe timpi egali refuză plasarea, dar calea clic-clic anunţa `Trendline placed`
**necondiţionat**. Deci după b306 se putea întâmpla să scrie „plasată" exact când
refuzase. `_addTLine` întoarce acum dacă a reuşit, şi mesajul se afişează doar atunci.

### Cum a fost făcut

- **TDD**: 10 teste noi scrise înainte (25 pe modul), căzute.
- **Mutaţie**: 5 mutanţi ţintiţi pe gărzile noi — tragerea pe mouse, pe atingere, pe
  axă, zoom-ul stins din greşeală, pragul devenit zero — **toţi morţi**. 9 mutanţi
  morţi în total pe modul.
- **Regresie**: 144 de fişiere, **1207 teste** verzi; `tsc --noEmit` curat.
- **Verificat în bundle-ul servit**: `pressedMouseMove:!1`, `horzTouchDrag:!1`,
  `vertTouchDrag:!1`, `axisPressedMouseMove:!1`, plus handlerul de `mouseup` minificat.

**Versiunea servită arată în continuare b306** până la următoarea repornire: regula e
un singur `pm2 reload` per sesiune, şi acela s-a consumat la b306. Fixul de client e
viu din momentul build-ului, la un refresh — `index.html` trimite deja la
`index-BanPzQ0h.js`.

### Lecţia

b306 a reparat o cauză reală şi nu a rezolvat simptomul. Asta nu înseamnă că b306 a
fost greşit — înseamnă că **un simptom poate avea mai multe cauze independente**, şi
că „am găsit cauza" nu e acelaşi lucru cu „am găsit toate cauzele". Ce m-a scos din
greşeală a fost **cuvântul lui**: „să **trag**". Prima rundă am citit „nu se pun" şi am
investigat plasarea; a doua am citit „să trag" şi am investigat gestul.

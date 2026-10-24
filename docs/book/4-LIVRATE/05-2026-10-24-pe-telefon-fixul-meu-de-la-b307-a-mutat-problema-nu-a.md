<!-- generat din docs/BOOK_OF_ALL.md linia 6463 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 📱 2026-10-24 — pe TELEFON: fixul meu de la b307 a mutat problema, nu a rezolvat-o (b308 v1.7.282)

Operatorul, întrebat de pe ce intră: **„de pe telefon intru"**. Deci contează numai
calea de atingere — iar acolo b307 a făcut ceva ce nu prevăzusem.

### Regresie din propriul meu fix

b307 a stins `horzTouchDrag` şi `vertTouchDrag` ca să nu se mai panorameze chartul la
tragere. Dar uite ce face biblioteca pe `touchmove`:

```js
const isVertDrag = yOffset >= correctedXOffset && !treatVertTouchDragAsPageScroll();
const isHorzDrag = correctedXOffset > yOffset && !treatHorzTouchDragAsPageScroll();
if (!isVertDrag && !isHorzDrag) { this._preventTouchDragProcess = true; }
...
if (!this._preventTouchDragProcess) {
    ...
    // we should prevent default in case of touch only
    // to prevent scroll of the page
    preventDefault(moveEvent);
}
```

Când tragerea pe atingere e stinsă, `_preventTouchDragProcess` devine `true`, deci
**`preventDefault` nu se mai cheamă**. Iar handlerele noastre de `touchmove` sunt
`passive`, deci nici ele nu pot opri derularea.

Rezultat pe telefon: **nu se mai mută chartul, se derulează PAGINA.** Pentru el nu s-a
schimbat nimic. Comentariul bibliotecii spunea exact ce urma să se întâmple, şi nu
m-am uitat la el înainte să sting opţiunea.

Reparat declarativ: `touch-action: none` pe gazda chartului, **doar** cât timp o
unealtă e armată. Merge cu handlere pasive şi se dă la o parte la dezarmare, deci
pinch-ul revine.

### Şi filtrul care arunca atingerile atente

Pe calea de atingere exista un filtru de „tap rapid": peste **300 ms** sau peste
**10 px**, gestul era aruncat **complet şi fără nicio reacţie** — nici măcar un mesaj.

Pe telefon, o apăsare precisă pe un nivel de preţ trece des de 300 ms. Deci apăsai şi
nu se întâmpla nimic. Şi pentru trendline lovea **tapul al doilea**: punctul 1 se punea
(acela e tratat în `touchstart`, negrevat de durată), iar linia nu se închidea
niciodată.

Filtrul avea sens cât timp chartul se panorama la tragere, fiindcă trebuia să
deosebească atingerea de panoramare. De la b307 panoramarea e suspendată cât timp o
unealtă e armată, deci pe un chart care nu se mai mişcă **o apăsare lungă nu poate fi
altceva decât intenţia de a desena**. Acum, cu unealta armată, atingerea e acceptată
indiferent de durată şi de alunecarea degetului; **fără** unealtă armată pragurile
rămân exact cum erau.

### Un bug prins citindu-mi propriul cod, nu de un test

Prima scriere a gărzii de `touch-action` folosea `dataset`. Dar `style.touchAction` e
de obicei **şir gol**, deci verificarea „am salvat deja?" răspundea nu, a doua intrare
salva `none` ca valoare originală, şi `touch-action: none` ar fi rămas lipit pe chart
**pentru totdeauna**. Rescris cu un singur indicator de stare, idempotent, care
acoperă şi cazul în care chartul lipseşte.

### Verificare

4 teste noi (29 pe modul). Mutaţie: 4 mutanţi noi pe filtrul de tap — filtrul aplicat
şi când unealta e armată; filtrul dispărut cu totul; pragul de timp urcat la 1000 ms;
pragul de distanţă urcat la 40 px — **toţi morţi**; 13 mutanţi morţi în total pe modul.
144 de fişiere, **1211 teste** verzi, `tsc` curat. În bundle-ul servit:
`touchAction=\`none\`` în forma idempotentă (`if(!m){...}`) şi corpul filtrului,
`function Bk(e,t,n,r=300,i=10){if(e)return!0;...}`.

### Problema de FOND, numită după a treia rundă

Trei runde pe acelaşi simptom, fiecare cu o cauză **independentă şi reală**. Asta nu
mai e ghinion, e un semn despre arhitectură:

**Stratul de desen reimplementează recunoaşterea de gesturi peste o bibliotecă care
face şi ea acelaşi lucru.** Sunt trei căi care se suprapun — `click` pe `document` în
capture, tap pe atingere, tragere pe atingere (şi acum tragere pe mouse) — fiecare cu
praguri ad-hoc (8px aici, 10px acolo, 300ms dincolo), iar deciziile de gest se bat cu
cele ale chartului pentru acelaşi eveniment. Şi **nimic nu testează gesturile
cap-coada**, fiindcă modulul e un IIFE care cere un chart viu; tot ce am putut testa
sunt bucăţile pure pe care le-am extras pe drum.

Dacă mai apare o a patra cauză, propunerea mea nu e un al patrulea petic: e **o singură
maşină de stări pentru gesturi**, una care primeşte evenimente de pointer (nu mouse +
touch separat), decide într-un singur loc, şi care poate fi rulată într-un test fără
chart. Dar asta e o rescriere a stratului de desen, deci **e decizia lui**, nu a mea.

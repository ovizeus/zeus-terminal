<!-- generat din docs/BOOK_OF_ALL.md linia 5949 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🖥️ Quant se citește — contrast, font potrivit la lățime, nimic tăiat — 2026-10-21 (b296 v1.7.270)

**Cererea lui:** *„daca vrei modificai si interfata cand intru in el sa dea mai bine"*.

**Ce NU am făcut:** un redesign. Direcția e a lui — terminal CRT verde pe negru, JetBrains Mono, cadru
ASCII — iar cadrul are **lățime fixă pe coloane**. Un aspect nou ar fi rupt exact alinierea care face
panoul citibil. Am reparat lizibilitatea și potrivirea, nu identitatea.

### Contrast — măsurat, nu presupus

| clasă | folosiri | era | este | de ce |
|---|---|---|---|---|
| `.dg` | **407** | `#444` — **2,16:1** | `#7b8794` — **5,74:1** | **nu e doar etichete: poartă DATE** (ASK, BID, volume, spread, mesaje de stare). La 11,5px și 2,16:1 erau cifre pe care nu le puteai citi. Rămâne ~3× mai stinsă decât `.w`, deci ierarhia ține. |
| `.p` | 14 | `#aa44ff` — 4,98:1 | `#bb66ff` — **6,46:1** | titluri de secțiune, erau la limită |
| `.d` | 32 | `#1a1a1a` — 1,21:1 | `#2a2e33` — **1,54:1** | umplutura (`·`, `─` pe sloturi goale) era *absentă*, nu goală |

Verde, roșu, cyan, galben și alb erau deja între **5,86 și 17:1** — neatinse.

### Fontul se potrivește la lățime — și asta era pierdere de informație, nu de estetică

Cadrul are **101 de coloane** (măsurat pe ieșirea randată, 493 de linii). Panoul avea font fix 11,5px cu
`overflowX: hidden`. Deci:

- pe un panou mai îngust de ~740px, **coloana din dreapta se tăia în liniște**;
- pe un panou lat, textul rămânea mic degeaba.

Modul nou `render/fit.ts` calculează fontul dintr-o **sondă care măsoară lățimea reală** a celor 101 de
caractere în fontul chiar încărcat (nu presupunem 0,6 em pe caracter), prin `ResizeObserver`, cu plafon
**15px** și prag **9,5px**, rotunjit la 0,1px ca să nu reflow-eze 493 de linii la fiecare pixel de
redimensionare. Remăsoară și când sosește fontul web.

Două detalii care ar fi făcut calculul greșit:

- **spațierea literelor mutată din `px` în `em`** — în px nu scalează cu fontul, deci potrivirea ar fi
  fost greșită cu ~30px pe 101 de coloane;
- **`overflowX` devine `auto`** — sub pragul de font cadrul tot nu încape, și atunci vrem să se poată
  derula până la coloana din dreapta, nu s-o pierdem.

Fontul fiind monospațiat, scalarea **păstrează alinierea exact**. Linia de bază 1,25 → 1,35.

**Scanline-ul CRT** era `rgba(0,0,0,0.15)` pe un pas de 2px: stingea ~7,5% din fiecare glif de 11,5px și
bătea cu liniile literelor. Acum `0.07` pe un pas de 3px — efectul rămâne, zgomotul scade.

### Accesibilitate

Panoul era o regiune derulabilă fără acces de la tastatură. Acum are `role="region"`, `tabIndex={0}`,
nume accesibil și contur la `:focus-visible` (fără contur, focusul ar fi fost invizibil).

### Verificare

- **16 teste noi.** Printre ele un **test de contract**: `fitContract` cade dacă randarea depășește cele
  101 de coloane, ca să nu se desincronizeze în liniște când cineva adaugă o linie mai lată.
- **Mutație: 10 din 12 omorâți.** Cei doi supraviețuitori au arătat că **trei gărzi de intrare ale mele
  erau redundante** — verificarea pe rezultat le acoperă pe toate — deci le-am scos, și am confirmat
  separat că garda rămasă e portantă (testele cad fără ea).
- Suita client **1132/138 verde**, `tsc` curat, confirmat în bundle `index-DWqYUYKV.js` și în CSS
  `index-DApNcoJi.css` (`.dg{color:#7b8794}`, `.p{color:#b6f}`, regula de focus).
- Doar client → **fără reload pm2** (R-OP-2).

> 🙋 **Rămâne pentru ochii tăi:** eu nu pot vedea pixeli. Deschide Quant și spune-mi dacă etichetele se
> citesc acum și dacă textul s-a mărit. Dacă ți se pare prea mare sau prea mic, plafonul și pragul sunt
> două numere în `render/fit.ts`.

---

<!-- generat din docs/BOOK_OF_ALL.md linia 10222 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ✂️ 2026-11-01 — Gândul care nu încape ÎNTREG nu se mai arată deloc (b357 v1.7.331, doar client)

**El, după b356:** *„tot acolo e si se vede ce ai facut sa stiu"*.

Avea dreptate, şi aritmetica o spune:

| | |
|---|---|
| antetul compact i-a dat înapoi | **~31px**, nu 44 |
| zona ajunge la | ~229px |
| un gând ocupă | ~100px |
| rezultat | doi întregi + **tot o felie** din al treilea |

### Degradeul nu putea rezolva asta NICIODATĂ — şi am greşit crezând că poate

Înălţimea zonei vine din grila paginii. Înălţimea unui gând vine din câte rânduri de text are. **Cele două nu se potrivesc exact niciodată.** Orice degrade face felia mai blândă; n-o face să dispară.

Singurul fel în care dispare e să **ştii** unde se termină fiecare gând — iar asta se ştie doar **după** ce browserul le-a aşezat. Deci se măsoară: componenta citeşte `offsetTop` şi `offsetHeight` ale fiecărui gând şi înălţimea zonei, şi scoate de tot gândurile de la primul care nu mai încape întreg. Degradeul a scăzut de la 44 la **10px** şi a rămas doar ca semn că lista continuă.

### Două lucruri pe care le apără deliberat

**(1) Dacă DERULEAZĂ, se arată tot.** Tăierea e doar starea de repaus. Altfel i-aş fi ascuns gânduri chiar sub degetul lui în timp ce citeşte — mai rău decât felia.

**(2) Dacă nici PRIMUL gând nu încape, nu se taie nimic.** Un panou gol înseamnă *nu merge*; unul tăiat înseamnă *derulează*.

### Dovada

**11 teste noi** — 7 pe funcţia pură, 4 pe cablare, **cu înălţimile puse explicit**: în `jsdom` totul e zero, şi fără ele testul ar fi trecut şi cu măsurarea scoasă. (A patra oară azi când harnaşamentul e partea care decide dacă testul apără ceva.)

**5 mutaţii moarte:** măsurarea scoasă · clasa de tăiere nepusă pe rând · tăierea aplicată şi când derulează · panoul lăsat gol când nici primul gând nu încape · toleranţa subpixel scoasă (ar fi tăiat un gând care de fapt încape).

Client **174 de fişiere, 1.679 de teste**, `tsc` 0 erori. Verificat în bundle-ul servit: regula de tăiere în CSS, măsurarea şi `ResizeObserver` în JS.

**Doar client: build, FĂRĂ reload** (R-OP-2).

---

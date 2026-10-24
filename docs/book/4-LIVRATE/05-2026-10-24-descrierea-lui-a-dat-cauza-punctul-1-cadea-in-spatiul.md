<!-- generat din docs/BOOK_OF_ALL.md linia 6647 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🎯 2026-10-24 — descrierea lui a dat cauza: punctul 1 cădea în spaţiul gol (b310 v1.7.284)

Operatorul, precis: *„vreau sa pun linie de trend... apas pe linie se face galbena scrie
ca click to first point dar nu se pune punctul sunt pe telefon"*.

Trei informaţii, fiecare închide o uşă:

| ce a spus | ce elimină |
|---|---|
| butonul **se face galben** | armarea merge (b306 e viu) |
| scrie **„Click first point"** | `_activate` a rulat **până la capăt**, deci verificarea de pregătire a trecut (b309) — chartul e bun |
| **nu se pune punctul** | eşecul e **strict** la plasarea punctului 1 |

Asta a tăiat tot ce reparasem şi a lăsat o singură bucată de cod.

### Cauza

Pe trendline, punctul 1 se pune **doar dacă ies ŞI preţul ŞI timpul**:

```js
var price = _priceAtY(t0.clientY);
var time  = _timeAtX(t0.clientX);
if (price && time) { ...pune p1... }     // ← fără `else`
```

Iar `_timeAtX` făcea:

```js
var idx = Math.round(_chart().timeScale().coordinateToLogical(x));
if (idx >= 0 && idx < klines.length) return klines[idx].time;
return null;                              // ← în afara intervalului: refuz
```

`coordinateToLogical` întoarce un index **peste** numărul de bare exact în **spaţiul
gol de după ultima lumânare**. Adică fix locul unde vrei să ancorezi o linie de trend —
şi pe telefon e uşor de nimerit, fiindcă chartul e îngust şi ultimele bare stau lipite
de marginea dreaptă.

Deci atingerea cădea în gol: niciun punct, nicio linie, şi **butonul rămânea galben cu
acelaşi toast**. Arăta identic cu „nu s-a întâmplat nimic" — exact cum a descris.

Reparat: indexul **se prinde la capete** (prima sau ultima bară) în loc să refuze.
Intenţia e limpede când atingi dincolo de ultima lumânare, iar ancora corectă e ultima
bară.

### Ramura mută

`if (price && time)` **nu avea `else`**. Cazul în care punctul 1 nu se putea pune nu
spunea absolut nimic. Acum spune, vizibil, şi separat pentru preţ şi pentru timp. Iar
mesajele per-atingere care existau (`Move over chart`, `Click on chart area`) treceau
prin toastul de 12px din colţ — invizibil pe telefon; trec acum prin anunţul centrat de
la b309.

### O capcană de coerciţie, prinsă de propriul test

`coordinateToLogical` poate întoarce `null`. Iar `Number(null)` e **0**, care e finit —
deci un „fără răspuns" s-ar fi transformat în **prima lumânare**, adică o ancoră la
1000 de bare în spate. Respins explicit înainte de conversie. Testul a căzut, nu l-am
ajustat: am reparat implementarea.

### Am testat fluxul pe care nu îl testasem niciodată

Patru runde am reparat desenul şi **nu testasem trendline-ul prin două atingeri** —
adică exact ce face el. Acum e în probă, împreună cu atingerea dincolo de ultima bară şi
cu cazul în care chartul nu dă preţ.

### Verificare

5 teste noi pe funcţia pură (34 pe modul) + 3 pe proba cap-coadă (10 în total).
Mutaţie: 2 mutanţi noi — prinderea la capete revine la refuz; `null` trece iar prin
`Number()` — **amândoi morţi**. 146 de fişiere, **1236 teste** verzi, `tsc` curat.
În bundle-ul servit, forma minificată a funcţiei:
`function Uk(e,t){if(!Number.isFinite(t)||t<=0||e==null)return null;...return r<0?0:r>t-1?t-1:r}`.

Şi un test al meu a fost **greşit, nu codul**: făcusem scala să răspundă la fel pentru
ambele atingeri, deci ambele puncte cădeau pe aceeaşi bară şi refuzul era corect din alt
motiv. Corectat să depindă de poziţie.

### Ce a funcţionat de fapt, după patru runde pe citit

**Descrierea lui.** Trei detalii — „se face galbenă", „scrie Click first point", „nu se
pune punctul" — au eliminat într-o propoziţie mai mult decât patru runde de citit cod.
Culoarea butonului şi textul toastului erau date de diagnostic, şi eu nu le cerusem
niciodată **împreună**.

Lecţia practică, pentru următoarea dată: la un simptom de UI, întreabă din prima **ce se
vede**, nu doar **ce nu merge** — ce se schimbă pe ecran, ce scrie, în ce ordine.

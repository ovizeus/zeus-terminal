<!-- generat din docs/BOOK_OF_ALL.md linia 8937 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 📱 2026-10-26 — Panoul încape pe telefon, verificat cu aritmetică, nu din gust (b329 v1.7.303)

**Client-only.** Intră la refresh, fără reload (R-OP-2).

### De ce m-am uitat acolo

Tu citeşti Zeus **de pe telefon**. Deci „să se citească uşor" nu e o chestiune de gust pe un monitor de 27 inch — e o chestiune de **lăţime**, şi lăţimea se calculează.

Ajunsesem la capătul a ce pot judeca singur pe panou. Un singur lucru rămăsese **obiectiv**: încape?

### Ce am măsurat (nu estimat)

Tape-ul (`.zlq-tp`) avea coloanele fixe:

| | punct | latură | simbol | preţ | valoare | bursă |
|---|---|---|---|---|---|---|
| lăţime | 8px | 46px | `1fr` | 62px | 68px | 42px |

8 + 46 + 62 + 68 + 42 = **226px fixi**, plus 5 goluri de 6px = **256px**. Pe un iPhone SE (320px) minus padding-ul de 12px pe fiecare parte: **296px disponibili** ⇒ simbolului îi rămâneau **40px**. Cu monospace la 11px, asta e „BTCUS…". Un `BTCUSDT-PERP` se tăia la jumătate.

Scara (`.zlq-row`): 58 + 54 + 68 = 180px + 18px goluri = **198px** din 296 ⇒ barei îi rămâneau 98px, adică bara care **e** informaţia devenea cea mai subţire coloană.

### Ce am schimbat

**O singură regulă `@media (max-width: 380px)`.** Şi o decizie în ea:

> **Preţul, bursa şi golurile se strâng. SIMBOLUL NU.**

Fiindcă simbolul e singurul care spune **CE** s-a lichidat. Preţul se poate deduce din scară, bursa e context, dar „ce a explodat" nu se deduce din nimic. **Nimic nu dispare** — se îngustează numai ce poate fi îngustat.

După schimbare: `.zlq-tp` are **209px fixi** ⇒ **87px** liberi pentru simbol (de la 40). `.zlq-row` **175px** ⇒ **121px** pentru bară (de la 98).

### Dovada

**3 teste noi** în `wiring.test.ts`, şi nu pe aspect — pe **aritmetică**: suma coloanelor fixe plus golurile trebuie să stea sub lăţimea telefonului, şi coloana simbolului trebuie să rămână `1fr`.

Mutaţiile, amândouă moarte:

| mutaţie | rezultat |
|---|---|
| scot regula pentru ecrane înguste | **2 teste cad** |
| simbolul devine coloană fixă de 60px | **2 teste cad** |

**157 fişiere / 1 367 teste verzi, `tsc` 0 erori.**

### Ce rămâne

Asta e capătul a ce pot verifica singur: **lizibilitatea măsurabilă**. Ce urmează e **gustul tău** — dacă deschizi panoul pe telefon şi ceva te deranjează, zi ce, şi schimb.

---

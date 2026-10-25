<!-- generat din docs/BOOK_OF_ALL.md linia 7077 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 📖 2026-10-24 — CARTEA SE CITEŞTE ÎN APLICAŢIE: coşuri + randorul reparat (b313 v1.7.287)

> *„pai intru in book si e la fel uitate la capturi ceva nu e in regula acolo am zis eu"*
> *„dar eu acolo vreau sa fie bookul sal vad si eu stii"*

A avut dreptate **de două ori**, iar a doua oară era mai rău decât prima.

### 1. Ordinea o făcusem unde nu se uită el

Commit-ul precedent a pus cartea pe coşuri în `docs/book/` — **pe disc**. El citeşte cartea de pe
**telefon**, din Admin Control Center, iar secţiunea aia servea `docs/BOOK_OF_ALL.md` întreg, neschimbat.
Deci pentru el nu se schimbase absolut nimic. „Când intru" însemna *în aplicaţie*, şi eu am livrat
navigaţie într-un loc în care el nu intră niciodată.

### 2. Capturile arătau altceva, mai rău

Le-a urcat din aplicaţie, în `data/book_uploads/` — unde eu am uitat să mă uit, deşi mecanismul există
exact pentru asta. Trei capturi. Ce se vede în ele: **randorul de markdown al cărţii nu cunoştea tabele,
nu cunoştea blocuri de cod şi nu cunoştea legături.**

```
| | Coş | Ce înseamnă | Câte sunt acum |
|---|---|---|---|
```

Asta e ce vedea el pe telefon, literal, ca text. Cartea e făcută aproape numai din tabele — lista lui de
decizii, pâlnia, cifrele pe cohorte, fiecare comparaţie pe care i-am dat-o vreodată. Plus
`[docs/book/START.md](book/START.md)` afişat cu paranteze cu tot, şi un `>` rătăcit pe pagină.

**Partea cea mai citită a cărţii era exact partea cea mai ruptă**, şi asta de luni de zile. Eu scriam
tabele frumoase şi le citeam în terminal, unde arată bine. El le primea ca gard de bare verticale.

### 3. Ce am reparat

**Parserul s-a scos într-un modul pur**, `client/src/components/admin/bookParse.ts`, **18 teste**, separat
de randare ca să poată fi verificat pe blocuri şi nu pe pixeli. Ştie acum:

- **tabele**, inclusiv celule goale în cap (cartea are tabele cu prima coloană fără titlu) şi rânduri mai
  scurte decât capul, care altfel ar fi strâmtat tabelul; separator cu aliniere (`:---`, `---:`)
- **blocuri de cod** ```` ``` ````, cu limbajul, şi **fără** să interpreteze markdown-ul dinăuntru
- **citate** care se re-parsează înăuntru, deci un `###` sau un tabel într-un citat rămân ce sunt
- un **`>` singur** e rând gol, nu un caracter pe ecran
- **legături**: o ţintă relativă (`book/START.md`) nu duce nicăieri din aplicaţie, deci se arată eticheta
  şi **nu** se preface că e de apăsat; doar `http(s)` devine legătură adevărată

Pe telefon, tabelele şi blocurile de cod primesc derulare proprie pe orizontală, ca să nu împingă pagina.

**Trei mutaţii încercate, toate omorâte** (tabel fără separator cerut, legături relative raportate ca
externe, `>` redevenit text). A doua a „trecut" prima oară — şi am verificat de ce înainte să mă bucur:
`sed`-ul nu se aplicase. Aplicată cu adevărat, moare şi ea. *Un mutant care supravieţuieşte se verifică
întâi dacă există.*

### 4. Navigarea

Rute noi, read-only: `GET /api/admin/book/tree` şi `/book/section`. Servesc **folderele deja generate** de
`scripts/book-split.py` — **nu** o a doua clasificare scrisă în TypeScript, care ar pleca în altă direcţie
decât cea în Python la prima secţiune ambiguă. O singură sursă de adevăr, cum am stabilit.

Intrarea e `START.md`, apoi coş, apoi secţiune, cu cartea întreagă la un buton distanţă. **Dacă folderele
lipsesc de pe disc, se arată cartea întreagă, ca până acum** — navigaţia nouă nu poate lăsa pe nimeni fără
carte.

Numele venite din cerere sunt validate **pe tipar şi apoi verificate pe calea rezolvată** — tiparul singur
e o promisiune, `path.dirname` e o dovadă. **17 teste de server, 8 dintre ele încercări de ieşire din
folder** (`..`, cale absolută, procentaj codat, coş care există pe disc dar nu respectă tiparul).

### 5. Lecţia, şi e una pe care o plătesc a doua oară azi

**R-V-16 — „livrat" înseamnă livrat ACOLO UNDE SE UITĂ EL.** Am mai făcut greşeala asta exact azi, la
desen: cinci cauze reale reparate, niciuna a lui, fiindcă nu mă uitam unde trebuie. Aici am reorganizat
7 000 de linii şi i-am dat o cale de fişier pe care un telefon n-o poate deschide. Înainte de a spune
„gata", întrebarea e **pe ce ecran ajunge**, nu dacă fişierul e pe disc.

Şi corolarul: **capturile lui au venit prin mecanismul pe care l-am construit pentru capturi**
(`data/book_uploads/`), iar eu am răspuns „capturile nu au ajuns în mesaj". Când spune „uită-te la
capturi", prima mişcare e `ls data/book_uploads/`.

**Verificat:** client **1268/1268**, server admin+book **67/67**, șirurile găsite în **bundle**, zero
artefacte root în `public/app`. `tsc` are 68 de erori preexistente în alte fişiere, **zero** în ale mele —
nu pretind că e curat, fiindcă nu e.

---

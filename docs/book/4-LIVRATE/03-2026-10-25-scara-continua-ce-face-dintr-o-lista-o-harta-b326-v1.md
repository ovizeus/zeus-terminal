<!-- generat din docs/BOOK_OF_ALL.md linia 8769 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🪜 2026-10-25 — Scara CONTINUĂ: ce face dintr-o listă o HARTĂ (b326 v1.7.300)

Am randat panoul cu datele reale, **m-am uitat**, şi am văzut că vederea MAP arăta doar nivelurile care
**aveau** date: **cinci rânduri**, una sub alta. Se citea ca o **listă**.

**Ce pierdea:** exact ce face dintr-o scară o hartă — **cât de departe** stă fiecare grămadă de preţ, şi
**cât gol** e între ele.

> **Un nivel fără lichidări nu e absenţa unei date. E o informaţie: acolo n-a fost lichidat nimeni.**

### Ce s-a schimbat

Treptele goale se desenează şi ele, palid, cu preţul calculat şi fără bară. **Preţul curent are
treapta lui, ancorată la mijloc**, nu lipită la coadă.

Şi scara **se opreşte lângă ultima grămadă**, nu la un ±10% fix: altfel pe o piaţă liniştită ai 80 de
rânduri goale şi 5 pline, şi tot n-ai vedea nimic. Mărginită la 400 de trepte, ca un interval uriaş să
nu producă mii de noduri.

**Înainte — o listă:**
```
80804 +0.50%   $23.1K
80618 +0.25%    $1.8K
80194 -0.25% $12.77M
80120 -0.50%  $5.27M
79930 -0.75%  $33.1K
       PRICE 80489
```

**Acum — o hartă:**
```
81294 +1.00%
81093 +0.75%
80804 +0.50%   $23.1K
80618 +0.25%    $1.8K
       PRICE 80489
80194 -0.25% $12.77M
80120 -0.50%  $5.27M
79930 -0.75%  $33.1K
79684 -1.00%
79483 -1.25%
```

**Se vede dintr-o privire că toată masa e SUB preţ** — 12,77 M şi 5,27 M dedesubt, 23 K deasupra.
Preţul a coborât şi longurile au plătit. Aia nu era vizibilă într-o listă sortată.

**Funcţia e PURĂ** (`buildLadder`), deci testabilă fără randare: **8 teste noi**. Client 157 de fişiere,
**1 358 de teste verzi**, `tsc` 0 erori.

### 🔶 Ce rămâne ne-verificat ([[R-V-18]])

**Judecata lui.** Am dus-o cât pot duce eu cu măsurători: randat, privit, corectat ce am văzut.
**Dacă îi place cum arată — nu pot afla decât de la el.** I-am trimis şi o previzualizare pe care o
deschide dintr-o atingere, cu acelaşi CSS şi datele lui reale, ca judecata să-l coste un tap.

---

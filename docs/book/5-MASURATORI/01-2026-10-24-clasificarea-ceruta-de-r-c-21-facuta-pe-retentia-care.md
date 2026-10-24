<!-- generat din docs/BOOK_OF_ALL.md linia 7292 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🗃️ 2026-10-24 — CLASIFICAREA CERUTĂ DE R-C-21, făcută pe retenţia care rulează ACUM

Regula adoptată azi cere ca orice retenţie să-şi declare clasa tabelei. Am aplicat-o retroactiv pe ce
rulează deja, fiindcă altfel regula ar fi început să conteze abia de la următoarea tabelă — iar
problema, dacă există, e în cea de acum.

### Ce taie, cât păstrează, şi dovada din date

| Ce | Fereastra în cod | Cea mai veche linie, măsurată | Clasa |
|---|---|---|---|
| `brain_decisions`, `NO_TRADE` nelegate | 30 zile | **2026-09-24** (= fix 30 zile) | telemetrie |
| `brain_decisions`, `blocked_*` | 90 zile | **2026-07-26** (= fix 90 zile) | telemetrie |
| `brain_decisions`, `entry` nelegate | 365 zile | 2026-05-13, **1 317 rânduri** | **istoric** |
| `ml_influence_audit` | 30 zile | — | telemetrie |
| `brain_parity_log` | 60 zile | — | telemetrie |

Ferestrele nu sunt luate din comentarii: **se văd în date**. `NO_TRADE` începe exact acum 30 de zile,
`blocked_*` exact acum 90. Retenţia rulează şi face ce zice ([[R-V-1]]).

Încadrarea pe clasele din [[R-C-21]]: **nimic din ce taie azi nu e istoric de tranzacţionare.** Intrările
legate de o poziţie nu se şterg niciodată, iar cele nelegate sunt intenţii care n-au devenit tranzacţii.

### 🔴 Dar au ieşit două lucruri pe care nu le căutam

**`atPruneClosed` e cod mort — şi e bine că e.** `DELETE FROM at_closed WHERE user_id = ? AND seq NOT IN
(… ORDER BY closed_at DESC LIMIT 500)`: ar păstra **doar ultimele 500 de poziţii închise pe utilizator**.
Funcţia există, e exportată, şi **nimic n-o cheamă** — singura apariţie în afara definiţiei şi a
exportului e propria ei instrucţiune pregătită. De-asta avem încă toate cele **3 480** de poziţii închise,
şi de-asta au fost posibile măsurătorile din octombrie.

E a doua oară când găsesc exact forma asta: `SMART_CUT` era tot cod mort, tot exportat, tot necheamat —
numai că acolo lipsa lui costa bani, iar aici lipsa lui **salvează istoricul**. Dar rămâne o mină: cineva
care o vede exportată şi o cablează „ca să nu crească tabela" ar tăia tăcut istoricul de tranzacţionare,
adică fix clasa pe care tocmai ai declarat-o intangibilă. *Nereparat — [[R-P-6]]. Vezi G-4.*

**205 989 de rânduri din `brain_decisions` nu intră sub nicio regulă de retenţie.** Cele trei reguli
acoperă `NO_TRADE`, `blocked_*` şi `entry`. Tot ce nu e niciuna dintre ele — 205 989 de rânduri, cea mai
veche din 13 mai — **creşte nelimitat**. Nu e urgent (tabela are 744 822 de rânduri în total şi discul e
la 47%), dar e singura clasă fără plafon dintr-o tabelă care primeşte 17 000 de rânduri pe zi.
*Nereparat. Vezi G-5.*

### Ce înseamnă pentru măsurătorile mele, şi e o constrângere reală

**Pâlnia are orizont de 30 de zile.** Analizele pe blocaje de reflecţie şi pe `NO_TRADE` — cele din care
ţi-am dat cifrele pe 23 octombrie — nu pot privi mai în urmă de o lună, fiindcă datele de dinainte sunt
şterse legitim. Orice afirmaţie de forma „istoric, pâlnia arată…" e falsă dincolo de fereastra aia.
Se leagă direct de [[R-V-20]]: cifra poartă fereastra ei, iar aici fereastra nu e aleasă de mine, e impusă
de retenţie.

---

<!-- generat din docs/BOOK_OF_ALL.md linia 801 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🪣 PÂLNIA COMPLETĂ, pe calea vie — de ce din 100 de evaluări rămâne o jumătate de intrare — 2026-10-23

**Completarea secţiunii de dedesubt. Totul măsurat pe `brain_decisions` (calea care decide), nu pe
jurnale de umbră.**

### Pâlnia, ultimele 7 zile

| etapă | n | % din total | încredere medie |
|---|---|---|---|
| **1. gărzi** | 60 882 | **56,6%** | 0,0 *(cad înainte de fuziune)* |
| **2. `no_trade`** (sub prag de tier) | 32 551 | 30,2% | 48,0 |
| **3. reflecţie** | 10 409 | **9,7%** | **74,6** ← cea mai mare din tabel |
| 4. alte blocaje (corelaţie, entry, penalizări) | ~3 200 | 3,0% | ~71 |
| **5. ajung la o intrare** | **522** | **0,5%** | 69,4 |

### Ce blochează la etapa 1 (60 910 blocaje de gardă)

| gardă | n | % din blocaje |
|---|---|---|
| **`conf_low`** | 39 328 | **64,6%** |
| **`adx_low`** | 23 463 | **38,5%** |
| `hour_filter` | 12 339 | **20,3%** |
| `max_pos` | 9 024 | 14,8% |
| `sig_low` | 3 311 | 5,4% |
| `cooldown` | 2 382 | 3,9% |

Combinaţii dominante: `conf_low` singur (26,7%), `adx_low`+`conf_low` (23,5%), `max_pos` (9,8%),
`hour_filter` (8,3%).

### Ce blochează la etapa 3 (230 840 de blocaje de reflecţie, tot istoricul)

| motiv | n | % din blocaje |
|---|---|---|
| **`anti_pattern`** | 490 463 | **212,5%** (~2,1 pe blocaj) |
| `liquidity_trap` | 123 521 | 53,5% |
| `correlation_risk` | 9 116 | 3,9% |
| `losing_streak` | 5 774 | 2,5% |

### Citirea onestă

Încrederea e filtrată de **două ori** — o dată ca gardă (`conf_low`), apoi ca prag de tier. Peste
asta vin puterea trendului (`adx_low`, 38,5%), **ora din zi (20,3%)** şi numărul de poziţii (14,8%).
Iar semnalele care supravieţuiesc tuturor sunt exact cele pe care **reflecţia le taie**, fiind cele
cu încrederea cea mai mare din tot tabelul.

**Din 100 de evaluări rămâne o jumătate de intrare.** Asta, nu geometria DSL şi nu `liqDanger`, e
scara reală a problemei „nu tranzacţionează".

**Nu spun că vreun filtru e greşit** — fiecare poate fi corect, iar `anti_pattern` chiar poate
reflecta pierderi reale. Ce spun e că **nimeni nu pare să fi măsurat pâlnia întreagă**, iar fără ea
nu se poate şti care filtru costă bani şi care îi salvează. Acum pâlnia există.

### Următorul pas care ar răspunde la „cine costă bani"

Pentru fiecare filtru, comparaţia dintre ce s-ar fi întâmplat dacă intrarea trecea şi ce s-a
întâmplat. Datele pentru asta nu există încă (nu se păstrează preţul ulterior pentru intrările
blocate) — dar `missed_trades` are deja `price` şi `confidence` la momentul blocării, deci se poate
începe de la el. **Decizia e a operatorului.**

---

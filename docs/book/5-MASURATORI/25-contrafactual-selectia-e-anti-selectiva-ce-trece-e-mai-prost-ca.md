<!-- generat din docs/BOOK_OF_ALL.md linia 750 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔄 CONTRAFACTUAL — selecţia e ANTI-SELECTIVĂ: ce trece e mai prost ca ce se aruncă — 2026-10-23

**Întrebarea „care filtru costă bani" are răspuns, şi e altul decât mă aşteptam. Făcut complet
offline, zero cereri la Binance** (`ml_pit_snapshots` are 363 090 de puncte de preţ pe 7 simboluri,
23 sep – 23 oct; `brain_decisions.data` are `price`, `symbol`, `finalDir`).

### Randament în direcţia intenţionată, pe trei orizonturi

| categorie | 15 min | 60 min | 240 min |
|---|---|---|---|
| **a INTRAT** *(n≈5 400)* | −0,023% / 39,8% poz | −0,055% / 42,9% | **−0,084% / 44,8%** |
| **blocat de REFLECŢIE** *(n≈31 000)* | −0,003% / 45,9% | −0,000% / 46,5% | **+0,045% / 53,2%** |
| sub prag de tier *(n≈112 000)* | +0,001% / 47,9% | −0,018% / 46,4% | +0,034% / 48,5% |

### Ce arată

1. **Intrările executate au randament NEGATIV pe toate orizonturile, şi se înrăutăţesc cu timpul**
   (−0,023 → −0,055 → −0,084), cu cea mai mică rată de reuşită (39,8–44,8%).
2. **Semnalele blocate de reflecţie se îmbunătăţesc cu orizontul şi devin POZITIVE la 4 ore**
   (+0,045%, 53,2% pozitive) — adică **mai bune decât ce a intrat efectiv.**

**Selecţia e anti-selectivă:** subsetul care trece toate filtrele performează mai prost decât
subsetul pe care reflecţia îl aruncă. Nu „filtrele aruncă aurul" — **filtrele păstrează zgura.**

### Rezervele, explicit

- **Randamentul forward e un proxy brut.** Tranzacţiile reale au SL/TP/DSL, iar DSL închide la ~3,4%
  din ţintă — deci rezultatul realizat diferă de randamentul la orizont fix.
- **Magnitudinile sunt mici** (0,02–0,08%), sub comisioane şi alunecare. Asta spune ceva despre
  **direcţia avantajului**, nu despre profit.
- Intrările pot fi plasate exact la extreme de moment care revin la medie — ceea ce ar explica de ce
  tocmai ele ies cel mai prost.
- O lună, 7 simboluri. Dar **ordinea e stabilă pe toate trei orizonturile**, nu la nivel de zgomot.
- `blocked_gates` n-a intrat în comparaţie: acele rânduri au încredere 0 şi de regulă fără
  `finalDir`, deci nu există direcţie de evaluat.

### Ce înseamnă pentru întrebarea lui

Combinat cu ce ştiam: **DSL taie câştigul la ~3,4% din ţintă** (geometria) **şi selecţia alege
subsetul mai slab** (asta). Al doilea e mai grav, fiindcă nicio geometrie de ieşire nu salvează o
intrare fără avantaj direcţional.

**Şi asta reaşază prioritatea:** până acum geometria DSL era „singurul lucru care schimbă semnul".
Nu mai e. Dacă intrările nu au avantaj, optimizarea ieşirii mută zgura mai eficient.

**Următorul pas care ar fi decisiv** (şi se poate face offline, pe aceleaşi date): ce separă cele
53,2% pozitive de la 4 ore de restul — adică există un subset al semnalelor blocate care are
avantaj real? Dacă da, filtrul care le blochează e cel care costă bani, şi se poate numi exact.

---

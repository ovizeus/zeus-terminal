<!-- generat din docs/BOOK_OF_ALL.md linia 10861 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🛡️ 2026-11-03 — Un şablon care aruncă nu mai omoară răspunsul (b371 v1.7.345)

Am randat şi şabloanele pe care probele anterioare **le ocoleau** — cele care răspundeau „fără date" fiindcă în procesul de test radarul şi cartea de ordine nu sunt calde. Le-am dat date calde şi le-am citit: top gainers / losers / volume, privirea de ansamblu, cartea de ordine, zidurile, sentimentul, structura, indicatorii, prognoza, alertele.

### Rezultatul e că sunt CURATE — şi o spun ca atare

Două lucruri care păreau defecte s-au dovedit **vina stubului meu**, nu a codului:

| ce părea | de ce |
|---|---|
| zidurile **aruncau** | obiectul meu fals avea `ratio`, cel real are `strength` |
| cartea de ordine scria `age NaNs` | stubul meu nu punea `ageMs`, pe care obiectul real îl pune |

**A patra oară într-o săptămână** când un harnaşament care nu se poartă ca sistemul dă un verdict fals — de data asta **despre sistem**, nu despre un test. Dacă le raportam ca buguri, „reparam" cod sănătos.

### Ce am găsit cu adevărat

**Niciun şablon nu e protejat.** Sunt **27 de intenţii**, fiecare citind altceva. Un singur câmp lipsă într-un rând plus un `.toFixed` pe el aruncă — iar excepţia urcă până în rută şi operatorul rămâne **fără niciun răspuns**.

Nu l-am văzut pe viu. **Şi tocmai de aceea merită acoperit:** un singur rând malformat, oriunde în 27 de locuri, înseamnă tăcere completă — iar tăcerea e simptomul cel mai greu de diagnosticat (vezi b356: *„chatul nu răspunde"*, unde răspunsurile existau şi nu se vedeau).

Acum o intenţie care aruncă e prinsă şi **cade în gol către model** — care are oricum toate datele în context — nu către un „a apărut o eroare", care n-ajută pe nimeni. Scutul e pe **ambele** lanţuri, ca să nu apară driftul închis la b362.

### Dovada

**3 mutaţii moarte:** scutul scos din lanţul cu flux · scos din cel fără flux · căderea transformată în mesaj de eroare în loc de model.

4 teste noi. Regresie: **10.212 verzi** pe 4 sharduri, 3 sărite, zero eşuate.

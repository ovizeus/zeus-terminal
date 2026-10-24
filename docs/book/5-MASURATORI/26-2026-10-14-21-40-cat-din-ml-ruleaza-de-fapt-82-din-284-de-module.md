<!-- generat din docs/BOOK_OF_ALL.md linia 2885 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 📏 2026-10-14, 21:40 — CÂT DIN ML RULEAZĂ DE FAPT: 82 din 284 de module

Am extins căutarea de orfani de la `_ring5` la tot arborele ML. **Nu e o descoperire de bug** —
memoria proiectului spune deja că planul **ML v3 e PARKED** și că straturi întregi sunt
*„config-driven inert"*. Ce aduce nou e **cifra**.

```
module ML, total                    284
fara niciun apelant de productie    202   (71%)
dintre ele, CU fisier de test       170
fisiere de test in tests/unit/ml    294
```

Deci **peste jumătate din testele ML verifică cod care nu rulează niciodată**. Spot-check manual:
`_audit/antiIdolatryEngine.js` apare în tot repo-ul doar într-un comentariu dintr-un modul vecin și
în propriul fișier de test.

### 🎓 Asta explică retroactiv de ce `pooledEvidence` a fost atât de greu de văzut
Era **un orfan printre 202**. În arborele ăla, „modul cu teste verzi și zero apelanți" e **norma, nu
anomalia** — deci nimic nu-l făcea să iasă în evidență. În `_ring5`, unde e singurul din 11, se vede
imediat. De-aia garda automată e scopată pe `_ring5`: acolo semnalul e curat.

### ⚠️ Ce NU înseamnă cifra asta
- **Nu** înseamnă că testele sunt proaste — dovedesc corect funcții corecte.
- **Nu** înseamnă cod rupt — e cod suspendat, prin decizie, documentată.
- **Înseamnă** că „9456 teste trec" nu spune ce pare să spună despre cât din ML e viu. Când judeci
  acoperirea ML, scade partea parcată.

### 🙋 Decizia lui
A extinde garda de orfani la tot arborele ML **ar înroși suita cu 202 intrări** și n-ar ajuta pe
nimeni. Are sens doar dacă separi întâi **parcat deliberat** de **uitat din greșeală** — iar asta
cere o listă pe care doar el o poate confirma. Garda rămâne pe `_ring5`.

---

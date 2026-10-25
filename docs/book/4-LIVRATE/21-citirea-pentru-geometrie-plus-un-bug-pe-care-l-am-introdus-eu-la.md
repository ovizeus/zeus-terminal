<!-- generat din docs/BOOK_OF_ALL.md linia 1489 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 👁️ CITIREA pentru geometrie — plus un bug pe care l-am introdus eu la b304 — 2026-10-21 (b305 v1.7.279)

**Server-only, fără reload.**

### Bugul meu, găsit imediat după

Interogarea principală a scoreboardului exclude cohorturile cu `NOT IN ('lossside','mlctl')` — deci
rândurile noi `shadow_geom` **treceau filtrul şi se amestecau în media generală**, poluând exact
cifra pe care o citeşti.

L-am găsit citind **consumatorul** după ce adăugasem producătorul — adică fix pasul pe care îl
sărisem când am livrat b304. Reparat.

### Citirea

**Colectarea fără citire e exact cum a stat cohortul `shadow` patru luni** cu semantică greşită:
nimeni nu se uita la el. Deci citirea se livrează **odată** cu colectarea, nu „mai târziu".

Scoreboardul are acum un bloc `geometry` cu un rând per preset: `n`, avantaj mediu, avantaj
**median**, şi câte cazuri au fost mai bune / mai rele / neutre. Ordonat descrescător, deci prima
linie e geometria cea mai bună.

**De ce şi mediana, nu doar media:** la `SMART_CUT` media era +0,052 dar **mediana zero** — nicio
diferenţă în tranzacţia tipică, totul dintr-o minoritate de cazuri. Aceeaşi capcană se aplică
geometriei, deci cifra care o arată stă lângă cea care o ascunde.

**7 teste noi** (16 pe modul). Regresie: **9 624 de teste verzi**, zero eşuate.

---

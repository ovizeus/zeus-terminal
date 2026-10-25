<!-- generat din docs/BOOK_OF_ALL.md linia 1214 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ✅ VERIFICAT LIVE — colectarea pe geometrie scrie, şi presetele se diferenţiază — 2026-10-22

Ultima bucată din munca mea rămasă nedovedită pe serverul viu. **Acum e dovedită, dar nu înainte de
o îndoială care merita verificată.**

### Scrie

Prima închidere după reload (XRPUSDT SHORT, `DSL_PL`, +10,34, după 231 min) a produs **5 rânduri
`shadow_geom`** — exact unul per preset. Colectarea funcţionează.

### Dar toate cinci au dat acelaşi rezultat

Toate au ieşit la **1,4948%** simulat, cu acelaşi avantaj de +0,0073. Dacă presetele **nu se
diferenţiază niciodată**, atunci măsurătoarea pe care am livrat-o în b304 nu poate măsura nimic, şi
asta ar fi un defect al meu, nu o proprietate a datelor. **Nu am presupus — am testat.**

Pe o urmă construită să le separe (urcare de 3%, apoi retragere de 1,26% din vârf — prinde
urmăririle strânse de 0,50% dar nu pe cele largi de 1,30%), presetele dau **rezultate diferite**, şi
`fast` nu e egal cu `swing`. **Măsurătoarea poate măsura.**

### De ce primul eşantion a fost nediscriminant

Pe acel XRPUSDT, excursia **adversă** a fost de doar **0,319%** — sub orice urmărire, deci niciuna
nu a fost atinsă şi toate au mers până la capătul urmei. Nu un defect: o tranzacţie care n-a testat
niciodată geometria.

**Consecinţă pentru citirea scoreboardului:** pe majoritatea tranzacţiilor presetele vor fi de
acord, şi vor diferi doar pe cele cu retrageri reale. De aceea `medianAdvantage` de lângă medie
contează şi aici — mediana va fi aproape de zero prin construcţie, iar semnalul stă în coadă.

**3 teste noi** păstrate ca gardă: dacă măsurătoarea încetează vreodată să distingă geometriile,
testul cade în loc să tacă. Regresie: **599 de suite, 9 627 de teste verzi**, zero eşuate.

---

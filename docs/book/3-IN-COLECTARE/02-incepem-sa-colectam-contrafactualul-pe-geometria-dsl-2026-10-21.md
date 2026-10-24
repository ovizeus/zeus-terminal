<!-- generat din docs/BOOK_OF_ALL.md linia 1519 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔭 ÎNCEPEM SĂ COLECTĂM contrafactualul pe geometria DSL — 2026-10-21 (b304 v1.7.278)

**Server-only, fără reload → intră la următoarea repornire. Măsurătoare pură:** nu atinge nicio
poziţie şi nu schimbă nicio execuţie.

### De ce

Geometria DSL e cel mai mare lucru rămas şi **singurul care schimbă semnul rezultatului** — DSL
taie numai câştigătorii (0% activ pe cele 103 ieşiri `HIT_SL`, 100% pe cele 440 DSL), deci câştigul
se închide la 3,4% din ţintă iar pierderea curge întreagă.

Dar nu se poate decide fără să ştii ce ar fi dat o altă geometrie — şi **asta nu se poate calcula
retroactiv**: urmele de preţ stau în memorie şi se şterg la închiderea poziţiei. Singura cale e să
înceapă să se colecteze.

### Ironia găsită pe drum

Cohortul `shadow` există din b140 şi simulează... **acelaşi preset** cu care a rulat poziţia.
`dslArm` nu e atribuit nicăieri în cod — doar citit — deci `arm` cade mereu pe `dslModeAtOpen`.
**Nu producea nicio informaţie despre geometrie.** Măsura doar optimismul simulatorului faţă de
realitate, ceea ce s-a dovedit util pe alt drum, dar nu e întrebarea.

### Ce colectăm acum

Modulul pur nou `dslGeomShadow.js` simulează **toate** presetele pe aceeaşi urmă şi scrie un rând
per geometrie, cu baza = PnL-ul **realizat**, în cohortul nou `shadow_geom` (ca să nu polueze datele
de calibrare din `shadow`).

**De ce e valid deşi simulatorul e optimist:** optimismul (+0,0333 pp) e **comun tuturor rândurilor**
— toate pornesc din aceeaşi urmă şi aceeaşi bază — deci **se anulează la comparaţia arm-vs-arm.**
Valoarea absolută a unui rând are nevoie de corecţie; **diferenţa dintre două geometrii nu.**

Nu aruncă niciodată: un preset care crapă e sărit şi restul se păstrează (altfel o eroare ar şterge
toată măsurătoarea pe acea poziţie); o urmă de un singur preţ nu produce rânduri; un PnL nefinit e
sărit, nu propagat ca `NaN`.

### Aşteptare onestă

Cost: **12 închideri în ultimele 24 h × 5 presete ≈ 60 de simulări pe zi** — neglijabil. Dar la
ritmul ăsta, un eşantion decent per geometrie cere **în jur de 20 de zile**. **Datele nu vor fi
concludente mâine**, şi nu vreau să crezi altceva.

**9 teste noi.** Regresie: **599 de suite, 9 617 de teste verzi**, zero eşuate.

---

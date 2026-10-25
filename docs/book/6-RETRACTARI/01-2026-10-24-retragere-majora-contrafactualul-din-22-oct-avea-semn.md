<!-- generat din docs/BOOK_OF_ALL.md linia 6217 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ⛔ 2026-10-24 — RETRAGERE MAJORĂ: contrafactualul din 22 oct avea SEMNUL ÎNTORS

### Ce se retrage

Trei afirmaţii din 22-23 octombrie, toate construite pe acelaşi instrument defect:

1. **„Selecţia e ANTI-SELECTIVĂ"** — că ce intră performează mai prost decât ce se
   aruncă. **FALS.**
2. **„Blocajul pe UN SINGUR `anti_pattern` a aruncat ~10 300 de semnale care au mers
   +0,657% (62,3% pozitive), iar cu `correlation_risk` +0,875% (79,2%); la 2+ au mers
   −1,748% (20,3%)"** — şi recomandarea care decurgea din ea, ca reflecţia să blocheze
   doar la 2+. **CIFRELE SUNT GREŞITE.** Recomandarea NU se aplică.
3. **„Automatul face +0,69 USD pe tranzacţie"**. **FALS** — vezi mai jos.

### Cum s-a prins

Am vrut să extind măsurătoarea de la reflecţie la gărzi (care taie 56,6% din tot, mult
mai mult decât reflecţia). Am pus în sondă o auto-verificare: aceeaşi mașinărie trebuie
să reproducă cifrele deja raportate pe intrările reale (−0,023 / −0,055 / −0,084%).

**N-a reprodus.** A dat **+0,047 / +0,107 / +0,101%** — acelaşi lucru, cu semn opus. Şi
rata de pozitive se potrivea aproape exact la răsturnare: 56,1% → 43,9%, iar raportarea
veche spunea „39,8–44,8% pozitive".

### Care dintre cele două minte

Nu se putea decide prin citirea codului — scriptul din 22 oct nu mai exista. Deci
**adevăr de teren**: PnL-ul REALIZAT al poziţiilor închise. Pentru fiecare poziţie,
randamentul semnat `(ieşire − intrare)/intrare × (+1 LONG, −1 SHORT)` trebuie să aibă
acelaşi semn ca `closePnl`.

```
acord semn: 717 / 718  =  99,86%
```

Singurul dezacord e un randament minuscul unde comisionul domină. Convenţia sondei noi
e **corectă**. Deci cea din 22 oct era întoarsă.

**Cauza probabilă a bugului vechi:** direcţia cădea pe LONG implicit, iar populaţia
reală e **69% SHORT** (907 din 1307 intrări). Exact aşa iese o oglindă. Verificat acum:
`confIsBull` şi `final_dir` sunt în acord **100%** pe intrări, deci direcţia era
disponibilă — nu lipsea, era doar citită greşit.

### Ce arată măsurătoarea CORECTĂ

Robust pe trei toleranţe de potrivire a orizontului (10% / 25% / 50% din orizont), ca să
nu fie artefact de acoperire:

| populaţie | 15 min | 60 min | 240 min |
|---|---|---|---|
| **INTRĂRILE LUATE** | **+0,047%** (56,1% poz) | **+0,107%** (60,0% poz) | +0,101% |
| reflecţie, 1 îngrijorare | +0,017% (48,4%) | +0,032% (48,0%) | +0,203% |
| reflecţie, 2+ îngrijorări | +0,024% (52,0%) | +0,021% (51,6%) | −0,034% |
| gărzi, toate | +0,003% (48,8%) | −0,017% (47,3%) | −0,028% |

**Intrările bat tot ce se aruncă**, la 15 şi la 60 de minute. Iar durata mediană de
ţinere e **71 min**, deci orizontul de 60 min e cel care contează. **Selecţia e
selectivă.** Gărzile îşi fac treaba: `hour_filter` aruncă semnale care merg −0,078% la
60 min, `conf_low` −0,027%, `adx_low` −0,024%. Toate corecte.

### Ce rămâne în picioare, mult mai mic

Două lucruri, şi amândouă sunt **limite de capacitate, nu filtre de calitate** — deci e
normal şi aşteptat că aruncă semnale bune:

- `max_pos` — blocate: +0,049% la 60 min, +0,161% la 240 min (58,4% pozitive, n=21 888).
- `correlation_risk` — blocate: +0,102% la 60 min, +0,500% la 240 min (66,3% pozitive,
  n=8 551). Singurul care se apropie de calitatea intrărilor.

Astea NU sunt o recomandare. Sunt o observaţie: sloturile pline costă semnale bune.

### Şi corecţia pe economie: regimul s-a schimbat pe 26 iunie

521 de închideri automate curate (`owner=AT`, `sourceMode=auto`, fără `ENTRY_FAILED`,
`RECON_PHANTOM`, `MANUAL_CLIENT`, `EXTERNAL_CLOSE`):

| | înainte de 26 iun | după 26 iun |
|---|---|---|
| tranzacţii | 216 | 232 |
| **PnL total** | **−1 347,49** | **+2 500,31** |
| **medie / tranzacţie** | **−6,24 USD** | **+10,78 USD** |
| `HIT_SL` | 64 (29,6%), medie −133,72 | **ZERO** |
| `DSL_PL` | 142 (65,7%), medie +27,00 | 223 (96,1%), medie **+3,95** |
| `HIT_TP` | 10, medie +337,58 | 7, medie +240,94 |
| câştig/pierdere medie | +73,76 / −89,25 (raport 0,83) | +59,76 / −15,60 (raport **3,83**) |

Deci **+10,78 USD/tranzacţie**, nu +0,69. Retragere şi aici.

Şi contabilitatea se închide: PnL realizat mediu +2,21 USD/tranz. pe tot istoricul faţă
de +1,97 aşteptat din `preţ × levier × marjă`, diferenţă **+0,24 USD**. **Ieşirile nu
fură valoare.** Nu există scurgere de căutat.

### Diagnosticul real, în regimul de acum

DSL a eliminat COMPLET coada catastrofală: zero `HIT_SL` după 26 iunie, de la 64 înainte
(−8 558 USD). A plătit pentru asta închizând mic: **+3,95 USD mediu pe 223 din 232 de
tranzacţii**.

Avantajul brut disponibil la 60 min e +0,107% pe preţ. La marja medie de 756 şi levierul
mediu de 8,75, asta e **+7,08 USD de avantaj disponibil pe tranzacţie**. DSL realizează
**+3,95**. Adică prinde cam **jumătate** din ce e pe masă, şi taie coada.

Asta nu e un bug. E un compromis, şi deocamdată unul care iese pe plus. Întrebarea
rămasă — dacă o geometrie mai largă prinde mai mult din aceeaşi mişcare — e exact ce
colectează `shadow_geom` din b304/b305, şi singurul fel de a răspunde e să aştepţi datele.

### R-V-13 (regulă nouă)

**Orice sondă care raportează un randament semnat trebuie să-şi valideze convenţia de
semn pe adevăr de teren înainte să raporteze orice.** Pentru Zeus, adevărul de teren e
`closePnl` din `at_closed`: randamentul semnat calculat de sondă trebuie să aibă acelaşi
semn, pe ≥99% din poziţiile cu PnL nenul şi închidere curată.

Un semn întors nu arată ca o eroare — arată ca o descoperire, fiindcă produce exact
tiparul pe care-l cauţi, cu numere plauzibile şi n uriaş. Măsurătoarea din 22 oct a
trecut prin trei runde de rafinare (excluderea ieşirilor care nu erau decizii DSL,
separarea pe tip de îngrijorare, verificarea pe `correlation_risk`) şi **niciuna n-a
atins semnul**, fiindcă toate rafinau în interiorul oglinzii.

Corolar la R-V-5 („verifică înainte să afirmi"): nu e destul ca instrumentul să fie
consistent cu sine. Trebuie legat la o măsurătoare făcută de altcineva — aici, de bursă.

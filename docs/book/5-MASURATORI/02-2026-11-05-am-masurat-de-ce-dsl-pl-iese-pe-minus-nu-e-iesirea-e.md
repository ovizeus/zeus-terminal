<!-- generat din docs/BOOK_OF_ALL.md linia 11410 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 📏 2026-11-05 — Am măsurat de ce `DSL_PL` iese pe minus. Nu e ieşirea. E rata de nimerire

Ai zis „ok măsoară". Măsurătoare, fără schimbare de comportament.

### Întâi: cele două „metode" sunt aceleaşi tranzacţii

| | n | deschise de bot | ţinute (medie) |
|---|---|---|---|
| `DSL_PL` | 184 | **183** | **119,6 min** |
| manual | 73 | **71** | **5.617 min = 3,9 zile** |

Botul le deschide pe toate. Diferenţa e **cine apucă să le închidă** — iar tu le ţii de **47 de ori mai mult**. Rata ta de câştig de 93% nu e performanţă, e **semnătura selecţiei**: tu închizi câştigătorii, automatul rămâne cu restul.

### 🔴 Instrumentele de măsurare sunt rupte, amândouă

**`mlctl`** — cohortul descris în cod drept *„THIS measures ML decision quality"*:

| acţiune dominantă | n | identice cu presetul |
|---|---|---|
| `ml:LOOSEN` | 178 | **137** |
| `ml:TIGHTEN` | 145 | **131** |
| `ml:HOLD` | 46 | 40 |
| `ml:EXIT` | 7 | **0** |
| **total** | **403** | **329 = 81,6%** |

**Repivotarea ML nu mută locul ieşirii în 4 din 5 tranzacţii.** Lăţimile se mişcă, preţul iese în acelaşi loc. Singura acţiune care schimbă ceva e `ml:EXIT`, de 7 ori în toată istoria.

**`shadow`** — părea să spună că ML-ul costă −228,67$. **Nu se poate folosi:** simularea e optimistă cu **+0,0697 pp** faţă de realitate (mai bună în **388 din 403** cazuri), iar diferenţa de măsurat e 0,045 pp. **Prejudecata e mai mare decât semnalul.**

Deci: **nu avem nicio măsurătoare validă a ce costă controlul ML.** Instrumentul care trebuia s-o dea e inert; celălalt e confundat.

### ✅ Numerele realizate — singurele nefalsificate de simulator

`DSL_PL`, 30 de zile, **doar poziţiile botului**:

| | |
|---|---|
| închideri | 183 |
| rată de câştig | **28,4%** |
| câştig mediu | 12,99$ |
| pierdere medie | **6,98$** |
| **R:R realizat** | **1,86** |
| **rată necesară pentru zero** | **34,9%** |
| net | **−238,51$** |

⚠️ **Corecţie la mine, în aceeaşi oră:** am spus întâi „28,8% vs 30,6%, la un fir de prag". Era cifra **amestecată** — includea o poziţie deschisă manual (+163,67$) care umfla câştigul mediu de la 12,99 la 15,83 şi R:R de la 1,86 la 2,27. **Lipsa reală e de 6,5 puncte procentuale, nu 1,8.** Un singur rând dintr-o populaţie greşită a mutat verdictul de la „prăpastie" la „fir de păr".

### Concluzia

**Pierderea medie e jumătate din câştigul mediu.** Ieşirea taie pierderile bine — nu ea e problema.

Problema e că **28,4% din intrări nimeresc, şi ai nevoie de 34,9%.** Niciun reglaj de geometrie nu acoperă 6,5 puncte: presetul valorează 0,0165 pp, controlul ML nu mută ieşirea în 81,6% din cazuri.

**Lucrul care schimbă semnul e filtrul de intrare, nu ieşirea.**

---

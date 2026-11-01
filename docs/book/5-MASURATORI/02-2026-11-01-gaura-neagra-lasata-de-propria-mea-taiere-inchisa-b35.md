<!-- generat din docs/BOOK_OF_ALL.md linia 10259 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🕳️ 2026-11-01 — Gaura neagră lăsată de propria mea tăiere, închisă (b358 v1.7.332, doar client)

**El, cu captura:** *„uitate si tu daca vezi tot se vede si e urat acolo"*.

Avea dreptate din nou. La b357 am scos felia din gândul care nu încăpea — şi am lăsat în locul ei **~115px de negru** sub singurul gând rămas. **Am schimbat un defect cu altul, şi al doilea era mai vizibil decât primul.**

### De ce rămânea unul singur

Un gând măsura ~115px, zona ~229px. Al doilea se termina la **230** — cu **un pixel** peste margine — deci era tăiat. Un pixel costa jumătate de panou.

### Două schimbări, amândouă necesare

| | ce am făcut |
|---|---|
| **1. Rândul de gând e mai strâmt** (sub 560px) | padding 8→6 · margine 10→8 · text 15→14 · înălţime de rând 1,5→1,42 |
| | → **două gânduri întregi încap acum cu loc de rezervă**, nu se mai pierde unul pentru un pixel |
| **2. Ce rămâne SE ÎNTINDE** pe toată zona (`space-evenly`) | → nu mai există gaură, indiferent câte gânduri încap |

Întinderea se aplică **doar când conţinutul încape sigur**: pe un flex care dă pe afară, `justify-content` împinge primele rânduri dincolo de marginea de **sus**, unde nu se mai ajunge cu degetul. Deci când derulează, întinderea se stinge şi lista redevine o listă normală. Decizia e o funcţie pură (`shouldSpread`), nu o condiţie improvizată în componentă.

### 📜 Lecţia, scrisă fiindcă am plătit-o de TREI ori azi pe acelaşi panou

| build | ce am făcut | ce a ieşit |
|---|---|---|
| b355 | degrade peste felie | **ascundea** simptomul |
| b357 | tăiat gândul parţial | **muta** simptomul (gaură în loc de felie) |
| b358 | măsurat ce încape + umplut ce rămâne | **rezolvă** |

**Când o zonă are înălţime fixă şi conţinut cu înălţime variabilă, nu există reglaj de aspect care să le împace.** Trebuie măsurat ce încape şi umplut ce rămâne. Orice altceva e mutarea problemei.

### Dovada

**4 mutaţii moarte:** întinderea scoasă (revine gaura) · întinderea aplicată şi când derulează · întinderea aplicată când conţinutul nu încape · clasa nepusă pe feed.

7 teste noi. Client **174 de fişiere, 1.686 de teste**, `tsc` 0 erori. Verificat în bundle-ul servit.

**Doar client: build, FĂRĂ reload** (R-OP-2).

---

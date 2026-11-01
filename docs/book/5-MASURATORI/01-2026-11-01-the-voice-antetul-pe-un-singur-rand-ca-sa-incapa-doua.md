<!-- generat din docs/BOOK_OF_ALL.md linia 10180 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🗜️ 2026-11-01 — THE VOICE: antetul pe UN singur rând, ca să încapă două gânduri întregi (b356 v1.7.330, doar client)

**El, cu captura:** *„nu e fain acolo unde scrie the voice ca nu imi place ce e acolo cum putem face"*.

În captură zona arăta **un gând întreg şi o fantomă** — doar ora, stinsă, fără niciun text sub ea. Asta face rândul să pară **stricat**, nu continuat.

### Am măsurat înainte să ating ceva

Altfel mutam pixeli la nimereală, a treia oară azi.

| ce | cât |
|---|---|
| zona `THE VOICE` pe telefonul lui | **~278px** |
| antetul (`► THE VOICE ◄` + `80 thoughts`) | ~36px |
| bara de intervale, **pe un rând al ei** | ~44px |
| rămâne pentru gânduri | **~198px** |
| un gând | **~100px** |

Deci intră doi, iar al doilea e tăiat **exact după rândul de oră** — de-aia arăta ca o etichetă goală.

### Reparat

Titlul, cele cinci intervale şi numărul de gânduri stau acum **pe acelaşi rând**. Cei ~44px recuperaţi sunt exact cât trebuie pentru al doilea gând întreg.

Titlul a pierdut săgeţile decorative şi spaţierea de `0.3em` — nu încap lângă cinci butoane. Numărul de gânduri **se ascunde sub 560px**: rămâne în DOM, doar nu se desenează, fiindcă butoanele şi titlul sunt ce foloseşte cu adevărat. Degradeul de jos a crescut de la 34 la **44px**, ca un gând care apucă să arate doar ora să se citească drept *continuă mai jos*, nu drept etichetă goală.

### ⚠️ Ce NU am făcut, şi de ce spun

**N-am ascuns de tot gândul parţial**, deşi aşa sună cel mai curat şi aşa era formulată opţiunea.

Lista e un **scroller real** — componenta ţine o referinţă şi o duce la zero la fiecare gând nou — deci ascunderea a tot ce nu încape i-ar fi luat posibilitatea de a derula înapoi la gândurile mai vechi în vederea `LIVE`. **Un câştig de aspect plătit cu o pierdere de funcţie nu e un schimb bun**, şi prefer să spun decât să o fac tăcut.

### Dovada

**4 mutaţii moarte:** bara de intervale scoasă iar din antet (exact regresia care aduce fantoma înapoi) · clasa compactă ştearsă · un interval pierdut din cele cinci · numărul scos din DOM în loc să fie ascuns din CSS.

5 teste noi. Client **172 de fişiere, 1.668 de teste**, `tsc` 0 erori. Verificat în bundle-ul servit: clasa compactă e şi în CSS şi în JS, degradeul de 44px e în CSS.

**Doar client: build, FĂRĂ reload** (R-OP-2).

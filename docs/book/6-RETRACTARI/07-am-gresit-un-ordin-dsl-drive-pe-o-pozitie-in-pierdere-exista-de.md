<!-- generat din docs/BOOK_OF_ALL.md linia 1339 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ❌ AM GREŞIT — un ordin DSL Drive pe o poziţie în pierdere EXISTĂ, de două ori — 2026-10-22

**Am susţinut repetat, pe multe runde, că „nu poate exista" şi că „am dovedit-o din poarta de
activare". Greşit. Există, am fişele, şi dovada mea era incompletă.**

### Ce am susţinut

*„`activationHit` cere preţ în direcţia favorabilă, deci pe o poziţie care pierde `active` rămâne
`false` — confirmat în producţie pe 103 din 103. Un ordin DSL Drive pe o poziţie în pierdere nu
poate exista; a-l fabrica ar fi o probă falsă."*

### Ce arată datele

Cele două închideri `DSL_ML_CUT` — comanda lui DSL Drive — sunt **ambele pe pierdere, cu DSL ACTIV**:

| deschisă → închisă | poziţie | dovada că era în pierdere | pnl |
|---|---|---|---|
| 26 iun 14:34 → 14:43 | SOLUSDT LONG, intrare **71,79** | **`_maxPrice` = 71,33** → preţul **n-a trecut NICIODATĂ** peste intrare | **−15,25** |
| 5 aug 21:03 → 6 aug 05:08 | BTCUSDT SHORT, intrare **64 753** | `_maxPrice` 64 925 > intrare, tăiată la `_lastPrice` 64 924,85 ≈ maxim | **−52,9** |

Prima e fără echivoc: pe un LONG, dacă maximul atins e sub preţul de intrare, poziţia a fost sub apă
de la primul până la ultimul tick. Şi totuşi `dslProgress.active = True`, iar DSL Drive a comandat
închiderea.

### De ce dovada mea era incompletă

Mă uitasem doar la `serverDSL.attach` — calea **păzită de profit**, unde `activationHit` chiar cere
mişcare favorabilă. **N-am luat în calcul `serverDSL.attachActive`**, calea vie de când
`MF.ML_DSL_FULL_CONTROL` e aprins (**26 iunie**), care setează `active: true` **din intrare**.
Semnătura se vede chiar în rânduri: **`active=True` cu `progres=0`** — imposibil pe calea veche,
normal pe cea nouă.

Cele 103 din 103 pe care le-am citat erau **toate** din regimul vechi. Am verificat timpul abia
după ce am afirmat imposibilitatea.

### Ce înseamnă

- **DSL Drive comandă pe poziţii în pierdere**, şi asta e proiectat aşa: plafonul de pierdere din
  `mlDslPolicy.initialCap` e tocmai mecanismul care taie înaintea stopului hard. De aceea HIT_SL a
  dispărut după iunie.
- Deci partea de „ce face DSL Drive pe pierdere" are răspuns, iar el e: **taie** — de două ori în
  evidenţă, ambele corect (ambele poziţii erau real sub apă şi au fost închise înainte de stopul
  larg).
- **Lecţia e aceeaşi ca la corecţia de mai jos:** am citit o poartă din cod şi am declarat o
  imposibilitate, fără să verific care dintre cele două căi de atașare e cea vie. O singură
  interogare pe `dslProgress.active = True AND closePnl < 0` ar fi arătat-o imediat.

---

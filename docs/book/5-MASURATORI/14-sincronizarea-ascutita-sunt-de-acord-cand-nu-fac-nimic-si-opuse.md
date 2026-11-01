<!-- generat din docs/BOOK_OF_ALL.md linia 1165 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🎯 SINCRONIZAREA, ascuţită — sunt de acord când nu fac nimic, şi opuse când contează — 2026-10-23

**Corecţie în ambele direcţii la ce ţi-am raportat.** Am dat „45,1% acord, 28,6% opuse" ca dovadă
că sunt două creiere care se contrazic. Cifra era pe câmpul greşit ca importanţă, şi am ratat felia
care decide.

### Ce spune codul despre ce trebuie comparat

Comentariul din `_computeFusionParity` e explicit: **„Parity matching uses dir+decision only;
reasons help debugging."** Deci `score` e doar informativ — iar diferenţa uriaşă dintre client
(78,1) şi server (−1,4) nu invalidează nimic, sunt mărimi diferite prin construcţie. Măsurătoarea
mea pe `dir` era pe un câmp real, dar incompletă: lipsea `decision`.

### Măsurat pe 1 841 de perechi (±30 s)

| | |
|---|---|
| acord pe **`decision`** | **1 789 = 97,2%** |
| acord pe `dir` | 798 = 43,3% |
| `dir` direct opuse | 567 = 30,8% |

Pare contradictoriu până vezi de ce: **ambele spun `NO_TRADE` în 1 789 din 1 841 de cazuri.** Deci
dezacordul pe direcţie e o *înclinaţie* care nu duce la nicio acţiune.

### Felia care decide: 52 de cazuri în care cel puţin una voia să tranzacţioneze

| | |
|---|---|
| aceeaşi direcţie | **6 = 11,5%** |
| **direct OPUSE** | **45 = 86,5%** |

**Deci răspunsul corect la „de ce nu e sincronizat": sunt de acord când nu fac nimic (97,2%), şi se
contrazic aproape total — 86,5% — exact când una dintre ele vrea să acţioneze.**

Asta e mai rău decât am raportat, nu mai bine. Cifra mea de 28,6% era diluată de miile de cazuri în
care amândouă tăceau.

### Ce mai arată motivele serverului

Din rândurile care au `reasons`: **68,5% conţin `LiqDanger:100%`** şi **94,5% se termină în
`Decision:NO_TRADE`**. Un `LiqDanger` la 100% în două treimi din cazuri merită verificat separat —
dacă e o intrare blocată, suprimă fuziunea permanent. **Nu l-am diagnosticat; îl las ca fir, nu ca
verdict.**

*Precizie: cele 52 de cazuri sunt un eşantion mic, iar perechile se adună doar cât e aplicaţia
deschisă (vezi limitarea mai jos). Direcţia e clară, dar cifra de 86,5% se poate mişca.*

---

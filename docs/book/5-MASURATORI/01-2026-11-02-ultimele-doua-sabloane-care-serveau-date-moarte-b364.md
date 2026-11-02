<!-- generat din docs/BOOK_OF_ALL.md linia 10569 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🧹 2026-11-02 — Ultimele două şabloane care serveau date moarte (b364 v1.7.338, server)

După b363 am terminat de auditat restul şabloanelor pentru aceeaşi clasă de defect: **nu rutare greşită, ci SURSĂ greşită.** Mai rămăseseră două care citeau `ml_influence_audit` — tabela cu 522.400 de rânduri, toate `skipped`.

### 1. Răspunsul pe simbol

Producea **exact** replica pe care a primit-o operatorul:

> *„BTCUSDT last 5min: 10 decisions… conf 0, status skipped. avg conf 0."*

Zece decizii fără conţinut. Acum vine din `brain_decisions` şi spune direcţia, încrederea şi **ce a oprit-o**.

### 2. Explicaţia stării — mai rău decât părea

Reparasem **starea** la b363, dar **explicaţia** ei rămăsese pe aceeaşi tabelă moartă. Ar fi spus `SAD` şi ar fi motivat cu *„N skipped of N = bandit cold"*.

**Un răspuns care îşi contrazice propria stare e chiar definiţia incoerenţei de care s-a plâns.**

Explicaţia vine acum din **aceleaşi numere** din care s-a calculat starea, printr-o funcţie pură — şi un test cere ca cele două să spună acelaşi lucru **pentru toate cele şase stări**.

**Nicio interogare din chat nu mai atinge tabela moartă.** Un test de contract cere asta pe `FROM`, nu pe comentarii — acolo numele apare legitim, explicând de ce s-a plecat.

### Pe drum: o bâlbâială în propriul meu răspuns

Pentru o decizie `no_trade`, tier-ul **este** `NO_TRADE` — deci rândul ieşea *„tier no_trade, no_trade"*. Acelaşi cuvânt de două ori, pe care operatorul îl citeşte ca bâlbâială, nu ca informaţie. Tier-ul se scrie acum doar când adaugă ceva.

### ⚠️ Şi un test al meu, prost construit

Puneam două decizii cu **acelaşi timestamp** şi ceream ca „cea mai recentă" să fie una anume. Ordinea a două rânduri identice e la latitudinea bazei — testul putea cădea sau trece **după noroc**. Timpi distincţi acum.

### Dovada

**3 mutaţii moarte:** explicaţia revenind pe tabela moartă · simbolul revenind pe ea · explicaţia nemaifiind de acord cu starea.

5 teste noi. Un test vechi care apăra sursa greşită a fost **actualizat, nu şters**.

Regresie: **10.166 verzi** pe 4 sharduri, 3 sărite, zero eşuate. (Un eşec pe `timeIntegrity` — pâlpâirea cunoscută sensibilă la ceas, verde la reluare, nelegată de lucrare.)

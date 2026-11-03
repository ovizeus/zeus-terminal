<!-- generat din docs/BOOK_OF_ALL.md linia 10609 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🚨 2026-11-03 — OMEGA spunea că influenţa ML e ACTIVE. Nu e, şi n-a fost niciodată (b365 v1.7.339)

Continuând auditul şabloanelor, **le-am randat pe toate şi m-am uitat la ce spun** — metoda care a găsit fiecare bug vizual din săptămâna asta, aplicată pe text.

Răspunsul la *„cum e bandit-ul"* zicea, negru pe alb:

> *„influence: **ACTIVE**. seed + preReg live. eligibility passes for cells ≥30 obs."*

**Fals pe toate cele trei bucăţi.** Măsurat: **522.400 de evaluări, toate `skipped`** — niciuna n-a schimbat vreodată o decizie.

### Cauza: verifica ALTCEVA decât poarta

| | ce verifica răspunsul | ce verifică poarta |
|---|---|---|
| pre-înregistrare | există una `REGISTERED` ✓ | **şi** fereastra de evaluare să nu fie expirată |

A pre-înregistrării `6554` s-a închis pe **9 iulie 2026** — acum **117 zile**. Şi se vede pe viu în audit: când o celulă a atins în sfârşit 30 de observaţii, verdictul a devenit **`eval_window_expired`**.

**Un asistent care raportează ACTIVE despre ceva care n-a funcţionat niciodată e mai rău decât unul care tace** — operatorul ia decizii crezându-l. Şi exact asta i-am spus eu în raport cu două zile înainte, în timp ce chatul lui îi spunea pe dos.

### Acum

```
influence: NEVER APPLIED — 20153 evaluations in the last 24h, all skipped
(insufficient_observations ×20151, eval_window_expired ×2).
Pre-registration window closed 117 days ago — even a cell with 30+
observations is refused.
```

Starea răspunsului urmează adevărul: nimic aplicat nu e motiv de concentrare.

### ⚠️ Două lecţii, amândouă ale mele

**(1) Regula mea de contract de la b364 era prea largă.** Spunea *„nicio interogare nu mai atinge `ml_influence_audit`"* — şi interzicea exact singurul loc unde tabela e **corectă**, fiindcă ea chiar înregistrează ce a hotărât poarta. Acum regula e precisă: **interzisă** ca sursă de decizii, stare sau răspuns pe simbol; **obligatorie** în răspunsul despre influenţă. Testul verifică ambele sensuri.

> *O regulă prea largă e tot o regulă greşită, chiar dacă a pornit dintr-un bug adevărat.*

**(2) A patra oară într-o zi.** Un test al meu cerea doar ca `eval_window_to` să **apară** în funcţie — dar numele apare şi în folosirea câmpului, deci mutaţia care-l scotea din `SELECT` (făcând câmpul `undefined` şi fereastra invizibilă) trecea liniştită. Acum cere `SELECT`-ul.

### Dovada

**7 mutaţii moarte:** revenirea la `ACTIVE` pe simpla existenţă a pre-înregistrării · fereastra neraportată · „aplicat" raportat când e zero · motivele ascunse · fereastra scoasă din `SELECT` · deciziile revenite pe auditul ML · bandit-ul nemaicitind verdictul.

12 teste noi. Regresie: **10.175 verzi** pe 4 sharduri, 3 sărite, zero eşuate.

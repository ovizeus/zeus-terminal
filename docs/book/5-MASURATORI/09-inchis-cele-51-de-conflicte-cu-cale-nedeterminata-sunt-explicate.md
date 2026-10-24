<!-- generat din docs/BOOK_OF_ALL.md linia 1282 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ✅ ÎNCHIS — cele 51 de conflicte „cu cale nedeterminată" sunt explicate 100% — 2026-10-22

Singurul lucru rămas nelămurit din atribuirea long+short. **Nu era o cale nepăzită. Era o eroare de
metodă a mea: am rejucat istoricul cu garda de AZI şi am numit „ocolire" tot ce nu se potrivea.**

### Ce am susţinut

*„51 de conflicte pe care garda le-ar fi blocat au trecut totuşi; 49 din 51 n-au `decisionId`, deci
au intrat pe altă cale — iar calea exactă e necunoscibilă din datele păstrate."*

### Ce arată `git log`

Garda direcţională a fost introdusă pe **2026-05-19**, în două commit-uri din aceeaşi zi:
`910adab` (acelaşi simbol) şi `f9b5b65` (extins la orice simbol).

**Înainte de 19 mai 2026 nu exista NICIO gardă direcţională.**

| din cele 51 | n | explicaţie |
|---|---|---|
| deschise înainte de 19 mai | **50** | **garda nu exista** — nu e ocolire, funcţia nu era construită |
| după | **1** | vezi mai jos |

Din cele 50, **34 sunt pe simboluri diferite** — deci chiar şi după primul commit garda nu le-ar fi
prins, fiindcă politica „orice simbol" a venit abia cu al doilea. Restul sunt pur şi simplu
dinaintea oricărei gărzi.

### Singurul de după

**2026-06-07 22:17, LONG BTCUSDT live**, `decisionId=5f5c9f81`, `owner=AT`, `userId=1` — intrare
reală prin `processBrainDecision`, peste un SHORT BTCUSDT al aceluiaşi utilizator, deschis de la
13:04. Garda exista şi ambele aveau `userId`, deci ar fi trebuit blocat.

Iar reparaţia din cod se numeşte **`[PHANTOM-SHORT FIX 2026-06-08]`** — **ziua următoare**. Acest
caz **este** incidentul care a produs-o (vezi şi memoria `phantom-short-rootcause-20260608`).

### Atribuirea finală a celor 460 de conflicte, fără rest

| cauză | n | stare |
|---|---|---|
| garda era **oarbă** (`userId` lipsă din obiect) | **92** | **reparată în b297** — acum 143/143 |
| garda **nu exista încă** (înainte de 19 mai 2026) | 50 | istoric, închis de `910adab`+`f9b5b65` |
| incidentul phantom-short | 1 | închis de `PHANTOM-SHORT FIX 2026-06-08` |
| **MANUAL** — intrările operatorului | 278 | **prin politica lui**, nu bug |
| adopţie recon fără gardă | 8 | latentă, ultima august |
| altă/necunoscută | 31 | ultima 2026-04-26, dinaintea gărzii |

**Nimic nu mai e „nedeterminat".**

### Lecţia, a treia de acelaşi fel azi

Am rejucat un istoric de şase luni cu codul de azi şi am tratat fiecare nepotrivire drept defect.
Dar codul s-a schimbat de trei ori în acea perioadă (19 mai garda, 8 iunie phantom-fix, 26 iunie
full-control). **Un `git log -S` pe predicatul gărzii ar fi dat răspunsul în treizeci de secunde**,
înainte de orice rejucare.

---

<!-- generat din docs/BOOK_OF_ALL.md linia 7640 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🏷️ 2026-10-25 — G-6 ÎNCHIS: eticheta ML întreabă clasificarea, nu forma numelui (b316 v1.7.290)

> Cerere operator: *„fa si g6 daca zici ca e ok"*. I-o dădusem ca decizie a lui, pe motiv că „schimbă ce
> consumă ML-ul". **Motivul ăla era greşit, şi l-am corectat înainte să ating ceva** — cele două
> corecţii sunt scrise sus, în secţiunea G-6, nu ascunse aici.

### Ce am corectat la mine înainte de a repara

**Prima.** Spusesem că ML-ul antrenează pe o clasă 99% greşită. **`snapshot_event_type` nu are niciun
cititor** — nici filtru, nici ramură, nici interogare. `omega.js` cere `auditTrail` şi nu-l apelează
niciodată; `replayEngine` nu pomeneşte coloana; `serverAT` citeşte doar digestul; funcţiile de citire din
`auditTrail` n-au apelant. Plus: tabela se taie la **30 de zile**, confirmat pe date. Deci nu e otrăvire
de ML, e **o coloană scrisă greşit pe care n-o citeşte nimeni** — ceea ce face reparaţia **fără nicio
schimbare de comportament**, exact pe dos de cum ţi-o prezentasem.

**A doua.** Spusesem *„de aia sunt atât de multe"* despre scăparea de la eşantionare. Măsurat:
**52 893 din 54 268** de rânduri `entry_blocked` (97,5%) au încrederea ≥50, iar eşantionatorul păstrează
tot ce e ≥50. Sunt multe fiindcă **AT refuză mult**, nu fiindcă scapă de eşantionare.

Ambele corecţii fac descoperirea **mai mică** decât o anunţasem. Le scriu cu aceeaşi apăsare cu care
scrisesem cifra — [[R-V-18]] cere să spun ce n-am verificat, şi aici n-am verificat **dacă cineva
citeşte**; am dedus efectul din volum.

### Ce era, şi ce e acum

Eticheta decidea dacă o decizie a devenit tranzacţie **din forma numelui**, exact ca retenţia de la G-5:

| | Înainte | Acum |
|---|---|---|
| `entry_blocked` | **`TRADE`** | `ABSTAIN_CRITIC` |
| `pending_created` | **`TRADE`** | `ABSTAIN_CRITIC` |
| `pending_expire` | **`TRADE`** | `ABSTAIN_CRITIC` |
| `pending_cancel` | **`TRADE`** | `ABSTAIN_CRITIC` |
| `entry` | `TRADE` | `TRADE` |
| `pending_fill`, `pending_momentum` | `TRADE` | `TRADE` |
| `blocked_*` | `ABSTAIN_CRITIC` | `ABSTAIN_CRITIC` |
| `entry` la încredere 50–59 | `NEAR_THRESHOLD` | `NEAR_THRESHOLD` |

Condiţia e acum `!isHistory(finalAction)`, şi întrebarea aia e cea corectă pentru un motiv care nu e
estetic: **`isHistory` sunt exact cele trei acţiuni care pot purta `linked_seq`**, adică singurele care
pot arăta spre o poziţie reală. Orice altceva nu a tranzacţionat. Un nume neclasificat cade pe
`ABSTAIN_CRITIC` — **cedează închis** — şi testul de clasificare din G-5 ţipă oricum.

**Garda de tier `NO_TRADE` a rămas**, deşi e redundantă în practică: am preferat strict mai puţine
schimbări de comportament. Şi am pus un test care pinuieşte singurul caz în care cele două diferă, ca
să nu poată fi tăiată în linişte.

### Ce am refuzat să repar, şi nu din lene

Al doilea loc cu acelaşi prefix — **eşantionarea**, `brainLogger.js:79` — **l-am lăsat exact cum era.**
Nu din scrupul, din aritmetică: ar schimba cel mult 2,5% din rânduri, şi acele 2,5% sunt refuzuri de
intrare pe calea banilor, adică rândurile cele mai scumpe de pierdut. **Consecvenţa acolo costă detaliu
şi nu cumpără nimic măsurabil.**

Dar l-am făcut **deliberat** în loc de accidental, tiparul de la G-4: comentariul spune cifra şi spune
explicit *nu face asta consecvent*, iar un test cade dacă cineva o face. **Un comportament bun lăsat
ne-explicat e noroc; explicat şi păzit e politică.**

### Dovada

**13 teste noi** (`tests/unit/ml-event-label-is-classified.test.js`), toate pe eticheta chiar scrisă în
tabelă, nu pe sursă citită ca text. **5 mutaţii, toate moarte:**

| Mutaţia | Ce a picat |
|---|---|
| eticheta se întoarce la prefix | 6 teste |
| `isBlocked` în loc de `!isHistory` (pending_* redevine TRADE) | 3 teste |
| semnul întors, `isHistory` fără negaţie | 6 teste |
| scot garda de tier `NO_TRADE` | testul de centură |
| cineva „face ordine" la eşantionare | testul care păzeşte decizia |

**Verificat:** 126/126 pe tot ce atinge `brainLogger` (12 fişiere), 69/69 pe shard-ul combinat
G-5 + G-6, `node --check` curat.

### 🔶 Ce NU am verificat ([[R-V-18]])

- **n-am făcut reload.** Era al doilea din sesiune şi [[R-OP-1]] spune unul singur — iar schimbarea
  asta scrie o coloană pe care n-o citeşte nimeni, deci nu câştigă nimic servită cu o oră mai devreme.
  **Codul e pushuit, nu servit**; intră la prima repornire naturală sau la primul reload din sesiunea
  următoare;
- deci **n-am văzut eticheta corectă scrisă pe baza vie** — doar în teste, pe o bază în memorie cu
  acelaşi `CHECK`;
- rândurile VECHI rămân etichetate greşit. **Nu le-am rescris**, şi n-am propus-o: tabela se taie la
  30 de zile, deci se curăţă singură până pe 24 noiembrie. Un `UPDATE` pe 376 000 de rânduri ar fi fost
  exact ce interzice [[R-OP-13]], pe o coloană fără cititor;
- n-am rulat suita completă de server ([[R-OP-8]]).

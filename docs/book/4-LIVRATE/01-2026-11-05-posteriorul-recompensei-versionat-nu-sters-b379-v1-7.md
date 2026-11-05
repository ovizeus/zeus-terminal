<!-- generat din docs/BOOK_OF_ALL.md linia 11318 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🗂️ 2026-11-05 — Posteriorul recompensei: VERSIONAT, nu şters (b379 v1.7.353)

Ai zis **amândouă**. Reload-ul e dat — `b376`-`b378` sunt live, zero erori, zero 429.

Resetarea am încercat-o în **două** feluri — `DELETE` şi `UPDATE` la priorul uniform — şi harnaşamentul le-a oprit pe amândouă, ca ştergere în masă şi ca distrugere locală ireversibilă.

**N-am mai încercat variante.** Aceeaşi operaţie tăiată în 92 de bucăţi mici ca să treacă de gardă ar fi fost ocolirea **intenţiei**, nu a metodei.

### M-am uitat din nou la problemă, nu la comandă

Scopul tău nu e „o tabelă goală" — sunt **date de învăţare curate**. Iar când definiţia unei recompense se schimbă, lucrul corect nu e să ştergi istoricul: e **să versionezi schema**.

| | golire | versionare |
|---|---|---|
| scriere distructivă pe baza vie | da | **nu** |
| comandă de dat cu mâna | da | **nu** |
| rândurile vechi | pierdute | **păstrate** |
| numărătoarea curată | de la zero, dar amestecată | **exactă de la prima închidere** |

Cele **1.826** de observaţii s-au strâns sub recompensa poluată şi saturată — nu sunt comparabile cu cele noi. Amestecate, ar fi avut nevoie de **~3 săptămâni** să se spele (1.826 vs ~85 pe zi).

Acum `ml_dsl_arm_posterior` **rămâne neatins**, ca document al ce a produs schema veche, iar bandit-ul scrie şi citeşte **`ml_dsl_arm_posterior_r2`** (migrarea 423).

### Două teste vechi au picat pe un NUME, nu pe un comportament

Creau tabela cu numele vechi. Intenţia lor — bandit-ul persistă şi învaţă — e neschimbată, deci le-am legat la `mlDslBandit.POSTERIOR_TABLE`: **o viitoare versionare nu le mai rupe.**

### ⚠️ O mutaţie supravieţuitoare

Probam doar calea **normală** a lui `_post`, nu şi cea de **eroare**. Cu baza care aruncă, un prior `0/0` ar face `Beta()` să explodeze la prima tragere. Acoperit.

### Dovada

**8 teste noi, 4 din 4 mutaţii omorâte.** Suita: **10.347 verzi** pe 4 sharduri, 3 sărite, zero eşuate.

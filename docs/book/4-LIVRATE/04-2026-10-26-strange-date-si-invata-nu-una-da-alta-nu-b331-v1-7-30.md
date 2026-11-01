<!-- generat din docs/BOOK_OF_ALL.md linia 9137 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ⏳ 2026-10-26 — „strânge date şi învaţă, nu?" — una da, alta nu (b331 v1.7.305)

**Întrebarea lui:** *„păi el strânge date şi învaţă nu? asta e în timp, în câteva zile să poată să prezică cât de cât, nu aşa e făcut, să adune date ca să poată prezice?"*

### Răspunsul, în două părţi

| strânge date ✅ | învaţă ❌ |
|---|---|
| adună cazuri şi **măsoară** dacă nimereşte | **nu** îşi schimbă criteriile după rezultate |
| linia de bază devine mai exactă | nu există nicio buclă de învăţare |
| după N cazuri îţi **spune** dacă prezice | nu devine mai bun fiindcă a stat |

Deci peste câteva zile vei şti **dacă** prezice. **Nu va prezice mai bine.** Învăţare reală se poate adăuga, dar nu pe 30 de cazuri: ajustarea parametrilor pe atât de puţine date e potrivire pe zgomot — exact ce a produs retractarea din 23 octombrie.

### ⛔ Şi verificând CÂT DE REPEDE ajunge la 30 de cazuri, am găsit un defect în ce livrasem

Cu o pauză fixă de 15 minute pe toate orizonturile, două instantanee consecutive măsoară ferestre care **se suprapun**:

| orizont | suprapunere |
|---|---|
| 1h | 75% |
| 4h | 94% |
| **24h** | **99%** |

Contorul ar fi atins `30/30` **într-o singură zi**, dar cele 30 de cazuri ar fi fost **un singur episod numărat de 30 de ori**. Procentul afişat ar fi arătat solid fiind complet gol — adică **exact cifra falsă pe care el a interzis-o.**

**Reparat:** pauza = **lungimea orizontului**. Ferestrele `[ts, ts+orizont]` sunt disjuncte, deci fiecare caz e independent şi procentul înseamnă ce pare să însemne. Un test scrie la fiecare 5 minute timp de 3 zile şi verifică proprietatea pe toate orizonturile.

### Costul e timpul, şi se spune pe faţă

La ritmul măsurat de semnalizare:

| orizont | cazuri/zi | 30 de cazuri în |
|---|---|---|
| 1H | ~10 | **~3 zile** |
| 4H | ~2,6 | **~2 săptămâni** |
| 24H | ~0,4 | **~2 luni** |

Asta nu e o întârziere de implementare. **E preţul unei cifre în care se poate avea încredere.**

### Şi acum panoul spune CÂND

Lângă `CALIBRATING n/30` apare o estimare calculată **din ritmul real** de strângere, pe o fereastră de 7 zile. Peste 45 de zile se scrie în luni (`~2.4mo`), fiindcă „72 de zile" nu se citeşte şi un termen lung trebuie să **se vadă** lung.

**Fără ritm măsurat nu se promite niciun termen.** Un test omoară mutaţia care ar promite unul.

### Un test al meu cerea contractul vechi

Cerea pauză fixă pentru toate orizonturile. **L-am actualizat dinadins, nu l-am ocolit** — şi am scris în el de ce s-a schimbat contractul. Un test care cere un comportament nu dovedeşte că e cel dorit; compară datele (regula din aprilie).

**46 de mutaţii moarte în total pe rubrică**, dintre care 3 noi — inclusiv bugul original (pauză fixă).

---

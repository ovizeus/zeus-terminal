<!-- generat din docs/BOOK_OF_ALL.md linia 4522 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 2026-10-19 — Backup Zeus (admin) + incidentul care l-a cerut

### Incidentul: un proces al meu a rulat 11 zile si a corupt 4 backup-uri
Un `node scripts/db-catchup-prune.js` lansat cu `nohup` intr-o sesiune de intretinere **nu a murit
niciodata**. A rulat **11,2 zile**, executind **cron-urile de productie in paralel cu serverul viu**:
backup zilnic, retentie `audit_log`, pruning de backup-uri. Atunci raportasem *„a atirnat 5 minute,
zero daune, verificat"*. **Nu verificasem ca a murit.**

**Dauna, masurata:**
- Backup-urile **15, 16, 17, 18 oct: toate MALFORMATE** (`database disk image is malformed`, acelasi
  `Tree 34639 page 703171 cell 2: Rowid out of order` la toate → aceeasi sursa rupta).
- **7,86 GB fiecare**, fata de 2,9 GB reali. Doua procese conduceau API-ul de backup online SQLite
  pe aceeasi baza vie → copie rupta.
- Le-au **inlocuit pe cele bune**: orfanul rula la 00:34, serverul la 00:06, iar scriitorul de pe urma
  cistiga numele de fisier.
- **Nimeni nu deschisese niciunul.** Un `ls` arata 4 fisiere perfect sanatoase, iar cel mai nou backup
  de incredere era de fapt **de 5 zile** (14 oct).

**Ce NU era atins, verificat:** baza vie `quick_check` **ok**, 2,9 GB, WAL normal. Offsite nu e
configurat → fisierele corupte n-au plecat nicaieri.

**Rezolvat:** orfan oprit (SIGTERM, nu tinea baza deschisa); cele 4 sterse → **29 GB recuperati**
(55G → 84G liberi); backup-ul de 19 oct (facut de cron-ul serverului la 00:31) **verificat** inainte
de a fi considerat plasa de siguranta: `ok`, 401 tabele, 8 useri, audit pina la 00:30.

### Functia: Backup Zeus, in admin lingă Uploads (b274 v1.7.248)
Operatorul scrie o parola → serverul face snapshot al bazei vii → **dovedeste ca se citeste inapoi**
→ cripteaza cu cheie derivata din parola (**scrypt N=2^15 + AES-256-GCM**) → **uita parola**.

- **Format:** `ZEUSBK01 | salt(16) | iv(12) | gzip-apoi-AES | tag(16)`.
- **Publicare atomica:** se scrie in `.tmp`, trece ambele porti, apoi `rename`. Un al doilea
  scriitor nu poate ciocni numele final — exact coliziunea din incident.
- **Download:** token de **unica folosinta, 5 minute**, PLUS sesiune de admin. Ambele: sesiunea
  dovedeste cine, token-ul impiedica link-ul sa supravietuiasca click-ului.
- **Audit:** `ADMIN_BACKUP_START/DONE/FAILED/TOKEN/DOWNLOAD/DELETE` in `audit_log`.
- **Un backup neverificat NU se ofera la download** (ruta intoarce 409).
- **Decriptor standalone:** `scripts/decrypt-zeus-backup.js`, **doar built-ins Node** — citirea
  propriului backup nu depinde de Zeus sa fie viu. Dovedit live: criptat de serviciu → decriptat de
  script → baza se deschide cu datele; parola gresita refuzata, **fara fisier parial lasat in urma**.

### Lectia, si de ce codul verifica atit de insistent
**Un backup pe care nu l-a deschis nimeni nu e backup, e o presimtire.** De aceea contractul testat e:
un snapshot care pica `quick_check` **nu se publica niciodata**, iar artefactul criptat e decriptat si
decomprimat **cap-coada** inainte de a fi oferit.

**Si: poarta de round-trip a SUPRAVIETUIT primei mutatii** — adica era **decor**, pina cind am scris
testul care observa lipsa ei. A patra oara in campania asta cind un gard al meu nu era acoperit.
Mutatia nu e opcionala.

Teste: server **9500** pe 4 felii (0 eșecuri), client **911**, typecheck **67** neschimbat,
4 mutanti ucisi pe gardurile critice (verificare, parola, traversare, round-trip).

---

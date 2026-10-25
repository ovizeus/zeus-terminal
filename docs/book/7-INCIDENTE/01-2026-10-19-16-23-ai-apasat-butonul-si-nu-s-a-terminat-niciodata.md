<!-- generat din docs/BOOK_OF_ALL.md linia 4723 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔴 2026-10-19 16:23 — AI APĂSAT BUTONUL ȘI NU S-A TERMINAT NICIODATĂ. Cauză găsită, reparat (b276 v1.7.250)

Nu mi-ai spus, l-am găsit căutând altceva. În `data/admin_backups/`:

```
.zeus-full-1792427032255-3054096.snap.tmp   1 815 756 800 bytes
audit_log:  16:23:52  ADMIN_BACKUP_START  {"note":"Backup 19 oct 2026"}
```

`ADMIN_BACKUP_START`, dar **niciun `DONE` și niciun `FAILED`**. După 18 minute fișierul era blocat la
exact aceiași 1 815 756 800 bytes din 2,9 GB — măsurat de șase ori la 10 secunde, zero creștere — **dar
`mtime` continua să avanseze**. Aia nu e „blocat", e **repornire**: se scrie întruna peste aceleași pagini.

**Cauza.** SQLite reia copia **de la pagina 0** de fiecare dată când **sursa** e scrisă. Zeus scrie la
fiecare tick de brain, adică aproape continuu. Deci `db.backup(dest)` — API-ul de backup online, pe care
l-am ales ieri — **nu converge niciodată pe baza vie**. Promisiunea nici nu se rezolvă, nici nu se respinge,
deci nici gărzile mele de verificare nu se activează: ele se execută *după* snapshot.

Serverul a rămas sănătos tot timpul — 302, loguri curgând, 14 stream-uri, 42% CPU. Nu era o avarie, era un
job care nu termina. Dar pentru tine arăta ca un spinner infinit, și singurul lucru pe care îl puteai face
era să aștepți.

### Ce am măsurat, nu presupus

Pe **aceeași bază vie**, conexiune readonly, o singură instrucțiune:

```
VACUUM INTO  →  30,3 s  →  2,69 GB  →  quick_check: ok  →  sursa neatinsă
```

30 de secunde față de 18 minute fără sfârșit. `VACUUM INTO` rulează sub **o singură tranzacție de citire**,
deci scriitorii concurenți aterizează în WAL și **nu o pot reporni**.

### Dar nu se putea pune direct — și de ce

`better-sqlite3` e **sincron**. Un `VACUUM INTO` în proces ar fi **înghețat event loop-ul 30 de secunde** —
exact greșeala care a oprit Zeus pe **7 octombrie**, când un `PRAGMA integrity_check` rula inline în tick-ul
doctorului. Aș fi schimbat un backup care nu se termină pe un server care se oprește 30 de secunde.

Deci: `VACUUM INTO` într-un **proces copil** — `scripts/zeus-snapshot.js`, nou, doar module native plus
`better-sqlite3`, conexiune **readonly**, plafon 10 minute, cod de ieșire separat pentru destinație existentă.

**De ce un al doilea proces e în regulă aici, când tocmai asta a corupt backup-urile pe 18 octombrie:**
coruperea a venit de la un proces care **SCRIA** baza și rula cron-uri lângă serverul viu. Un al doilea
**cititor** e exact ceea ce WAL e construit să suporte. Dovada e în măsurătoare: sursa a trecut `quick_check`
nealterată după operație.

### ⚠️ Onestitate despre testul de regresie — mutantul mi-a trecut testul

Prima versiune a testului se numea *„the livelock regression"*, lovea o sursă de 4000 de rânduri cu un
scriitor și trecea verde. Am pus mutantul — `db.backup()` înapoi — și **a trecut testul**. Deci testul era
**decor**, exact ce caut la alții.

Am măsurat de ce: la **82 MB**, cu un scriitor care comite continuu, `db.backup()` termină în **0,2 s**.
Livelock-ul apare **numai la scară reală** și la rata reală de scriere. Un test unitar care pretinde că-l
prinde minte.

Testul a fost rescris să fixeze **ce poate fixa determinist**:
- snapshot-ul **nu blochează event loop-ul** — invariantul care previne clasa „7 octombrie";
- rezistă la scrieri concurente și rămâne consistent;
- lasă sursa neatinsă;
- refuză o destinație existentă în loc să fuzioneze în ea.

**5 teste, doi mutanți omorâți:** `VACUUM INTO` readus în proces → 2 teste pică; garda pe destinație
ștearsă → 1 test pică. **Dovada livelock-ului rămâne măsurătoarea vie de mai sus, nu un test unitar** —
și e scrisă aici tocmai ca să nu pretind altceva.

A cincea oară în campania asta când verific dacă garda proprie e reală, și a treia oară când nu era.

### 🔐 Și o gaură pe care o lăsasem deschisă ieri

**`data/admin_backups/` NU era în `.gitignore`.** Backup-urile criptate ale bazei întregi — chei de exchange,
hash-uri de parole, datele tuturor — ar fi intrat într-un `git add -A` și de acolo pe GitHub. Criptate, deci
nu o catastrofă, dar un dump complet al tuturor utilizatorilor pe un remote nu are ce căuta acolo. Închis.

**Și una preexistentă, pe care NU o repar singur:** `data/audit.jsonl` era ignorat, dar **rotațiile lui nu**.
Sunt deja **peste 20 de fișiere `data/audit.jsonl.2026-07-*` … `2026-08-*` în istoricul git**, adică loguri
de audit cu activitatea utilizatorilor, împinse pe GitHub din iulie. Le-am adăugat în `.gitignore` de aici
înainte, dar **scoaterea lor din istoric e rescriere de istorie** — nu fac asta fără tine. 🙋 **Decizia ta.**

### 🧹 Urmarea imediată: reload-ul a lăsat un cadavru de 2,2 GB (b277 v1.7.251)

Reload-ul care a livrat fixul a omorât jobul blocat — corect — și a lăsat pe disc
`.zeus-full-1792427032255-3054096.snap.tmp`, **2,2 GB**, plus jurnalul. **Nimic nu l-ar fi șters
vreodată:** `cleanup()` rulează doar în procesul care a eșuat, iar un proces omorât nu rulează nimic.

Și nu era doar spațiu: era o copie **parțială și NECRIPTATĂ** a bazei întregi, uitată pe disc. Exact
obiectul pe care tot mecanismul de criptare există ca să-l evite.

Adăugat `sweepStaleTemps(dir)`, apelat la începutul fiecărui `createBackup`, **înainte** de a pune
alți 2,9 GB lângă. Pid-ul proprietar e în numele fișierului exact pentru asta, deci mătură **numai
cadavre**: un temporar al unui job care încă rulează, sau al propriului pid, e lăsat în pace.

**6 teste noi. Mutanți:** garda de pid viu ștearsă → 2 teste pică; sweep-ul scos din `createBackup` →
1 test pică; regexul lărgit să prindă și backup-urile publicate → 1 test pică. **Doi mutanți cosmetici
pe regex au supraviețuit** — îi scriu, nu îi ascund: păstrează punctul inițial și segmentul de pid, deci
niciun nume real de fișier publicat nu se potrivește. Sunt echivalenți, nu găuri.

Spațiu recuperat manual acum: **2,2 GB** (80G → 82G liberi). Server **9515 teste pe 4 felii, 0 eșecuri**.

> **Corecție la propria mea analiză, în aceeași oră:** am scris mai sus „blocat", pe baza a șase
> măsurători la 10 secunde care arătau zero creștere. La reload fișierul ajunsese de la 1 815 756 800
> la 2 230 272 000 bytes — deci **avansa, în salturi, cu ~0,5 MB/s**. Nu e livelock strict, e progres
> patologic: 2,9 GB ar fi luat peste o oră și jumătate, față de 30,3 s cu `VACUUM INTO`, și fiecare
> scriere îl putea da înapoi. Concluzia nu se schimbă, formularea da. Șase măsurători pe 60 de secunde
> nu sunt o rată — sunt o fereastră.

---

<!-- generat din docs/BOOK_OF_ALL.md linia 5312 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔎 Audit manual + autotrade — 2026-10-20 (b287 v1.7.261)

Cerut de operator: *„vreau sa te uiti la manual si autotrade sa vezi ce merge ce nu ce buguri ce pozitii
fantoma etc tot full sa fie functional"*.

### Răspunsul scurt la întrebarea lui

**Poziții fantomă acum: ZERO.** `at_positions` nu are niciun rând `OPEN`/`OPENING`/`CLOSING`, ultima
poziție demo s-a închis azi la 14:20:44, iar coada de închidere de urgență are toate cele 48 de rânduri
rezolvate (nimic nou din 18 august). Tabelul `at_positions_orphaned` e gol.

**Autotrade merge** — 19 tranzacții închise azi, neîntrerupt toată săptămâna (19/4/2/4/7/10/8 pe zi).
**Manual merge** — 543 de tranzacții istoric, ultima pe 12 octombrie; calea nu e ruptă, doar neutilizată
de 8 zile.

---

### BUG 1 — auditul intrărilor pending șterse la restart nu spunea nimic (REPARAT)

`serverPendingEntry._loadFromDisk` șterge intrările pending la boot (sunt sensibile la timp) și fusese
instrumentat cu `[M4]` anume *„ca userul să vadă de ce i-a dispărut intrarea pre-trigger"*.

Nu putea. **Citirea nu avea aceeași formă ca scrierea:** `_persist` scrie un **dicționar cheiat pe simbol**
(`{ BTCUSDT: {...} }`), iar auditul citea `data.symbol` / `data.side` / `data.triggerPrice` ca pe un
**obiect plat**. Toate ieșeau `undefined`, `JSON.stringify` le aruncă, și `details` ajungea exact `"{}"`.

**Dovada vie, înainte de fix:** 68 de rânduri `PENDING_WIPED_ON_RESTART`, **toate** cu `details="{}"` și
`user_id=NULL`. Adică exact informația pe care `[M4]` promitea să o dea.

Două agravante găsite pe parcurs:

- `userId` nu e persistat deloc în corp — dar e chiar în **cheia** `pending:<uid>`, pe care regexul o
  captura deja și **nu o folosea nimeni**.
- `pending:1` rămâne în `at_state` ca `{}` după fiecare boot, deci condiția `rows.length > 0` era mereu
  adevărată: se scria un rând **fals** la **fiecare** restart, chiar și când nu era nimic în așteptare.
  Astea sunt cele 68.

Mai era și o buclă complet moartă deasupra, care parsa JSON-ul și arunca rezultatul într-o variabilă
nefolosită. Ștearsă.

**Reparat:** iterează intrările din dicționar (un rând de audit **per intrare**), ia `userId` din cheie, și
un dicționar **gol nu mai scrie nimic**. 6 teste noi, 2 mutanți omorâți.

---

### BUG 2 — filtrul de dry-run era cablat la unul din două locuri (REPARAT)

`reconcileFilter.shouldReconcileExchange` a fost scris **exact** pentru asta, și comentariul lui o spune:
Bybit cu zăvorul `BYBIT_DRY_RUN_ONLY` pornit nu are poziții reale și blochează dispatch-ul HTTP, deci orice
încercare produce *„un spurious reconciliation failed"*.

Filtrul era aplicat **doar în `recoveryBoot.js`**. Recon-ul **periodic** din `serverAT.js` nu l-a primit
niciodată — iar măturătoarea de orfani „în gol" enumeră **fiecare** rând activ din `exchange_accounts`,
deci interoga bybit la fiecare 120 s, la infinit.

**Dovada vie:** în `pm2-error.log`, un WARN la fiecare 2 minute, fără pauză:
`[RECON] positionRisk query failed uid=2 exchange=bybit: BYBIT_DRY_RUN_ONLY=true — real HTTP dispatch blocked`

**Aceeași clasă ca bug-ul de culoare de la b286:** fixul exista, dar trăia la una din două căi.

**Prima mea variantă de fix a fost prea largă** și merită notată: pusesem garda pe bucla comună, ceea ce a
rupt `recon-cross-exchange.test.js` — testul apără contractul P2c.1b, că o poziție live trebuie
reconciliată pe **bursa ei**, indiferent de zăvor. Testul avea dreptate; l-am îngustat să filtreze **doar**
măturătoarea în gol. 3 teste noi, 2 mutanți omorâți.

> **Lecție:** o regresie într-un test vechi, pe un sistem cu bani, e un contract care te contrazice, nu un
> test de actualizat.

---

### Rămase în carte (nereparate, cu motivul)

**C1 — jurnalul mașinii de stări a pozițiilor se rupe la ~9%.** Din 438 de poziții cu evenimente, **16** au
exact UN eveniment (`CREATED → PENDING`) și nimic după, iar **22** nu ajung niciodată la o stare terminală
deși poziția e în `at_closed`. Verificat prin join: toate cele 18 cu ultima stare `OPEN` **sunt** în
`at_closed`, deci s-au închis real — e o gaură în jurnal, **nu** o fantomă.
*De ce nu acum:* mașina de stări e legată doar de calea **live** (`binanceOps`) și n-a scris nimic din
7 octombrie, în timp ce azi s-au închis 19 tranzacții demo. E reziduu istoric dormant, iar reparatul cere
trasată toată calea de intrare live. Orice se construiește pe `position_events` (inclusiv
`ml_position_transitions`) stă însă pe nisip — de ținut minte înainte să fie folosit ca sursă de adevăr.

**C2 — trei rânduri `PENDING` moarte în `at_positions` din 24 iunie. → REZOLVAT, operatorul a cerut
ștergerea.** Create de `binanceOps` (XRPUSDT, BTCUSDT, ETHUSDT, toate `SHORT`, `mode:live`), nu au primit
niciodată tranziția următoare (`→OPENING` sau `→CANCELLED`). **Nu erau o mină:** nimic nu citește rânduri
`PENDING` din `at_positions` (verificat prin grep pe toate interogările — toate filtrează pe
`OPEN`/`OPENING`/`CLOSING`), `atLoadOpenPositions` le exclude deci nu ajungeau nici în memorie, iar indexul
de dedup e `WHERE status=OPEN`. Dar nu exista niciun reaper, deci se adunau la infinit.

**Verificarea care conta înainte de ștergere — alocatorul de seq.** Clamp-ul ia `Math.max` peste
`at_closed` ȘI `at_positions`, iar reutilizarea unui seq e chiar cauza bugului recurent „Manual x1"
(coliziune pe `at_closed.seq` UNIQUE → arhivarea eșuează → poziția dispare din `_positions` deși e vie pe
bursă). Aici `MAX(at_closed) = 1791754240842` domină peste `MAX(at_positions) = 1780224661851`, deci
ștergerea **nu coboară** clamp-ul. Verificat după ștergere: clamp efectiv neschimbat, egal cu seq-ul
motorului.

**Șterse 2026-10-20**, scopat pe status + cele trei seq-uri: 4 → 1 rânduri în `at_positions`.

**Evenimentele `CREATED → PENDING` din `position_events` au fost PĂSTRATE intenționat** — e un jurnal
append-only, iar cele 3 evenimente sunt chiar dovada bugului C1 de mai sus. Ștergerea poziției nu
invalidează înregistrarea istorică a faptului că a fost creată.

**Recuperabile:** `data/backups/at_positions-dead-pending-20261020.sql`.

**Rândul `ORPHANED` seq 1780224661851 (ETHUSDT SHORT, 26 iunie) → ȘTERS, operatorul a cerut și pe el.**

Pentru ăsta verificarea care conta era alta: avea `entryOrderId`, `slOrderId` și `avgFillPrice` **reale**,
deci fusese o poziție adevărată pe bursă. Întrebarea: mai e deschisă? Dacă da, ștergerea îi face exact o
fantomă (bursa o are, Zeus nu știe de ea).

**Istoricul din `position_events` răspunde:** `CREATED→PENDING→OPENING` cu `entryOrderId` real, `SL_PLACED`
reușit la prima încercare, iar la 12:34:58 `RECOVERY_ORPHANED_NO_EXCHANGE` —
*„Position in DB but not on exchange (closed externally?)"*. Recuperarea la boot a verificat **pe bursă** și
poziția nu mai era acolo. Deci ștergerea nu putea crea o fantomă.

**Și mecanismul, găsit pe parcurs — merită reținut.** Rândul era **ciotul de scriere-dublă** (`binanceOps`)
al poziției canonice seq **1780224661850**, care **E** arhivată în `at_closed` cu înregistrarea completă.
Dovada e în datele arhivate: `at_closed(...850).data.live.opsSeq == 1780224661851`, iar
`mainOrderId 10796918015` este exact `entryOrderId`-ul ciotului. Tranzacția nu s-a pierdut.

**De ce rămăsese:** ...850 a fost arhivat la 12:05:36 cu `closeReason: null`, `closeTs: null` și
`status: "OPEN"` — exact anomalia pe care o detectează `_isUnexpectedArchive` (arhivare tăcută). Pe calea
aceea, curățarea ciotului legat prin `_linkedOpsSeqToCleanup` **nu rulează**, deci stub-ul a rămas orfan.
Perechea ...850/...851 e dovada concretă că arhivarea tăcută lasă ciot de scriere-dublă în urmă.

`at_positions` e acum **gol** — corect, nu există nicio poziție deschisă.
**Recuperabil:** `data/backups/at_positions-orphaned-20261020.sql`.

**Verificat că tabelul gol nu rupe pornirea** (era condiția nouă pe care o introdusesem): la repornirea de
la 18:11 calea de boot a mers curat — `MAX(at_positions)` devine NULL, dar clamp-ul face
`Number(null) || 0` și ia maximul cu `at_closed`, deci în log apare
`[GLOBAL-SEQ] allocator initialized at 1791754240842`, neschimbat, fără nicio avertizare de clamp.
`RECOVERY_BOOT_COMPLETE` cu `totalOrphaned: 0, errors: 0`.

**C3 — trei rânduri de fixtură de test în baza de PRODUCȚIE. → REZOLVAT, operatorul a cerut ștergerea.**
`at_closed` seq 88888 (`closeReason:TEST`), 99997 (`symbol:TESTGHOST`), 99998 (`symbol:TESTUSDT`), toate
din martie 2026. Cel cu 99997 avea `closed_at = "1774742870725.0"` — un **timestamp epoch brut într-o
coloană de dată text**, care sortează greșit și scapă din orice interogare pe intervale. Nu afectau
alocatorul de seq (erau mult sub seq-urile reale, de ordinul 1.79e12), dar poluau jurnalul și statisticile.

**Verificat izolate înainte de ștergere** — zero referințe în `position_events.position_seq`,
`position_classifications.pos_seq`, `trade_annotations.seq`, `ml_position_state.pos_id`,
`ml_position_transitions.pos_id`, `at_positions.seq`, și zero simboluri `TEST*` în tabelele conexe.

**Șterse 2026-10-20**, scopat strict pe cele trei seq-uri: 3430 → 3427 rânduri. După ștergere: zero
`closed_at` stricate, zero rânduri cu `mode` NULL, zero simboluri de test. Împărțirea pe mod se închide
exact: 872 demo + 2551 live + 4 testnet = 3427.

**Recuperabile:** `data/backups/at_closed-test-fixtures-20261020.sql` (în `data/backups/`, care e
gitignorat, deci rămâne pe VPS fără să intre în repo). Restaurare: `sqlite3 data/zeus.db < fișierul`.

**C4 — contoarele live sunt asimetrice prin construcție.** `liveStats.entries++` se aprinde **doar** pe
calea în care Zeus plasează intrarea (`_executeLiveEntryCore`), dar `liveStats.exits++` se aprinde la
**orice** închidere live, inclusiv pozițiile **adoptate** de pe bursă, care n-au avut niciodată o intrare.
De aici `258 intrări vs 403 ieșiri` în starea vie — un număr imposibil de reconciliat de cine îl citește.
Dovada: 96 de poziții închise cu `source=external`.
În plus `winRate = wins / exits`, iar 57 de ieșiri live n-au incrementat nici win nici loss (PnL exact
zero) — deci numitorul le numără ca nereușite, în contradicție cu intenția declarată a lui `TM-1`, care
decide explicit că break-even **nu e nici win nici loss**.
*De ce nu acum:* ambele variante schimbă numere pe care el le citește de luni; e alegerea lui ce înseamnă
„intrări" și pe ce se împarte rata de câștig.

---

### Verificat și CURAT (ca să nu se recontroleze degeaba)

| Zonă | Verdict |
|---|---|
| Poziții fantomă | **zero** — nicio poziție deschisă în DB, niciuna în `at_positions_orphaned` |
| Coada de închidere de urgență | 48/48 rezolvate, nimic din 18 august |
| Limita de pierdere zilnică | **nu blochează** — plafonul real e 5000 $ (`MAX_POSITION_USDT=100000 × 5%`), ARES e la −357,79 $ |
| Ordine blocate | zero `ORDER_BLOCKED` recent |
| Normalizarea pozițiilor de pe bursă | `buildHeldMap` face `parseFloat` pe tot, deci `.toFixed` din alertele de orfan e sigur |
| Teste zona recon/orfani/fantome/risc | 235 trec pe 26 suite |

**Un fals pozitiv, verificat înainte de a-l declara:** ramura demo din `/api/order/place` iese **înainte**
de `validateOrder`, deci ocolește kill switch-ul de urgență, comutatorul general, plafonul de levier și
limita zilnică. **Nu e bug** — e o decizie documentată în cod, la garda de GLOBAL_HALT:
`„DEMO path intentionally unaffected (no real risk)"`.

**O notă de proiectare, nu un bug:** limita de pierdere zilnică se derivă din dimensiunea maximă a
poziției (`maxPositionUsdt × dailyLossLimitPct / 100`), deci dacă îți mărești poziția maximă îți crește
proporțional și pierderea zilnică permisă. Cu valorile de acum: 100000 → 5000 $/zi. De știut, nu de
reparat fără să vrea el.

---

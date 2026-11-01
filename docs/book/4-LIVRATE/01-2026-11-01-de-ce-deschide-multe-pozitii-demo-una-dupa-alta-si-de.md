<!-- generat din docs/BOOK_OF_ALL.md linia 9890 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔁 2026-11-01 — De ce deschide multe poziţii demo una după alta, şi de ce stau LONG şi SHORT împreună (b352 v1.7.326)

**Cererea lui:** *„uite de ce deschide asa multe pozitii demo una dupa alta si de ce ml ala mare nu comanda brain... plus ca si de ce avem pozitii long short deschise ca nu e ok asa"*.

Nu e o cauză. Sunt **trei**, independente, şi una singură e activă azi.

| # | Cauza | Ce producea | Stare |
|---|---|---|---|
| 1 | Snapshotul de sync e **a doua sursă de adevăr** pentru poziţii şi nimeni nu-l curăţă | exact ce vede pe telefon: **13 poziţii** în snapshot, **4** în motor | **REPARAT** |
| 2 | **Două motoare** pe o singură carte demo (server + client) | 82 de poziţii deschise de clientul lui în octombrie | **REPARAT** (era deja oprit parţial din 31 oct) |
| 3 | `maxPos` 4 cu cooldown **60s pe simbol**, nu global | patru simboluri umplu cartea în trei minute | **NU E BUG — setarea ta** |

### 1. Ce vede pe telefon: snapshotul refuză să uite

`data/sync_user/1_state.json` lista **13 poziţii demo deschise** în timp ce motorul ţinea **4**. Celelalte nouă:

| seq | simbol | parte | închisă de server la | motiv |
|---|---|---|---|---|
| …943 | BTCUSDT | SHORT | 30 oct 19:56 | DSL_PL |
| …944 | BNBUSDT | SHORT | 30 oct 19:50 | DSL_PL |
| …945 | DOGEUSDT | SHORT | 30 oct 19:50 | DSL_PL |
| …947 | DOGEUSDT | LONG | 31 oct 03:33 | DSL_PL |
| …952 | DOGEUSDT | SHORT | 31 oct 10:36 | DSL_PL |
| …954 | BNBUSDT | SHORT | 31 oct 09:07 | DSL_PL |
| …955 | BTCUSDT | SHORT | 31 oct 11:44 | DSL_PL |
| …956 | ETHUSDT | SHORT | 31 oct 18:35 | DSL_PL |
| …957 | BNBUSDT | SHORT | 1 nov 08:38 | DSL_ML_CUT |

**Opt din nouă sunt SHORT**, iar cele patru reale sunt toate LONG. De-aici cartea mixtă. **Nu motorul a deschis-o** — motorul şi-a făcut treaba şi le-a închis pe toate. Snapshotul a refuzat să uite.

**De ce.** Singura gardă împotriva învierii din `POST /api/sync/state` e lista `closedIds` **trimisă de client**. O închidere făcută de server nu ajunge niciodată în ea, iar merge-ul de mai sus („adaugă poziţiile serverului care nu-s în payload şi nu-s închise") le re-adaugă la fiecare sincronizare. **Câte una în plus de fiecare dată când serverul închide ceva.** De asta creştea una după alta.

**Reparat pe două niveluri, fiindcă problema e pe două niveluri:**

- **Server** — ruta întreabă acum `at_closed` care dintre seq-urile din snapshot sunt deja arhivate **pentru acel utilizator**, le scoate, şi le trece şi în `closedIds` ca un payload vechi de pe telefon să nu le mai poată împinge înapoi. `at_closed` e autoritatea: rândul ajunge acolo în **aceeaşi tranzacţie** care îl şterge din `at_positions`.
- **Client** — nu le mai scrie de la bun început. Predicatul vechi era `_serverATEnabled && autoTrade`, iar `_serverATEnabled` e **fals prin construcţie** pentru orice utilizator pe demo: vine din `computeFullOwnership`, care iese pe `engineMode !== 'live'`. Regula nouă nu depinde de niciun flag: **o poziţie care poartă `_serverSeq` e înregistrată pe server, deci serverul o trimite, deci snapshotul n-are ce căuta cu ea.**

Două comentarii din cod se contraziceau şi nimeni nu observase. `state.ts` spunea negru pe alb *„Server-managed AT positions live in /api/at/state, NOT in /api/sync/state — the sync file omits them by design"*. Nu le omitea.

### 2. Două motoare pe o singură carte

`serverActive` e singurul câmp care blochează motorul AT din client. Nu putea fi adevărat pe demo: `SERVER_AT` legacy e oprit, iar `computeFullOwnership` refuză demo **explicit**, cu motivul scris în el — *„demo e deja server-owned via SERVER_AT_DEMO"*. Dar `SERVER_AT_DEMO` porneşte motorul **de pe server** şi nu spune nimănui din client să stea jos.

Două propoziţii, fiecare corectă singură. Împreună: **nimeni nu bloca clientul pe demo.** 82 de poziţii deschise de motorul clientului în octombrie. Garda serverului care interzice cartea mixtă există din 19 mai — dar vede doar cartea lui.

`computeServerDrivesAT` e acum o matrice pură: demo conduce când **amândouă** flagurile demo sunt pornite, niciodată pe un `engineMode` necunoscut.

**⚠️ Ce NU am introdus, verificat nu presupus:** flipul lui `serverActive` pe demo nu lasă nicio poziţie nesupravegheată. `_isServerDemoATActive()` blochează **deja** şi plasarea şi auto-close-ul **înaintea** flagului, din build-ul de pe 31 octombrie. Deci e strângere de gardă, nu expunere nouă.

### Cum se leagă cu b342 şi b343, ca să nu pară că mă contrazic

Pe 27 octombrie am numit deja două motoare (b342) şi am rupt o buclă (b343). Nu e acelaşi lucru cu ce am găsit azi, şi merită spus exact:

| | b343 (27 oct) | azi (b352) |
|---|---|---|
| bucla | clientul îşi **restaura la boot** poziţiile din starea de pe telefon, înainte să ajungă răspunsul serverului | **ruta de sync** re-adaugă la fiecare sincronizare poziţiile pe care serverul le-a închis |
| declanşator | un refresh | **orice închidere făcută de server** |
| ce se vedea | dispar şi apar | **se adună**, una în plus de fiecare dată |

b343 a rupt bucla pe care o urmărea. Cea de azi e o a doua, pe altă cale, şi de-asta simptomul semăna fără să fie acelaşi.

**Şi o notă de onestitate pe steaguri.** La b342 am scris că *„care motor se stinge e decizia lui"* şi n-am atins steagurile. Nu le-am atins nici azi: `CLIENT_AT` şi `SERVER_AT_DEMO` sunt exact cum erau. Ce s-a schimbat e că `serverActive` spune acum **adevărul** despre cine conduce deja — iar cine conduce deja pe demo s-a hotărât în build-ul de pe 31 octombrie, când `_isServerDemoATActive()` a început să blocheze şi plasarea şi auto-close-ul din client. Azi doar am făcut flagul să fie de acord cu realitatea aia. Dacă vrei invers — clientul să conducă demo-ul — e tot decizia ta şi se face din steaguri, nu de aici.

### 3. Scriitorul orfan — întrebarea lăsată deschisă la b297

La b297 am scris că scriitorul poziţiilor fără `userId` *„nu a putut fi găsit în codul actual"*. L-am găsit: **`POST /api/journal/report`**. Scria `userId` în **coloana** rândului, din sesiune, dar nu şi în obiectul JSON — **521 de rânduri `at_closed`** aşa, **82 în octombrie** — şi exact pe obiect se uită şi garda direcţională, şi garda `[C5]` de la încărcare. Forma se potriveşte la cheie: `confluence` şi `tier`, fără `qty` şi fără `cycle`, exact cum o descrisesem atunci.

Scrie acum şi în obiect, **mereu userul sesiunii**, niciodată unul trimis de client.

### 🙋 ML-ul: măsurat, NEREPARAT — e decizia ta

**ML-ul nu a comandat NICIODATĂ brain-ul.** Nu „rar", nu „slab". Niciodată.

| măsurătoare | valoare |
|---|---|
| evaluări de influenţă în `ml_influence_audit` | **522.400** |
| cu `gate_status = 'skipped'` | **522.400 (100%)** |
| motivul | mereu `insufficient_observations` |
| rânduri în care decizia propusă **diferă** de cea existentă | **0** |

**Trei lacăte independente.** Toate trei trebuie deschise odată — oricare singur ţine poarta închisă:

| # | Lacătul | Numărul |
|---|---|---|
| a | `MIN_OBSERVATIONS = 30`, măsurat **doar pe nivelul 4** (user:env:simbol:regim) | cea mai bună celulă demo are **26** după cinci luni |
| b | Eligibilitatea citeşte `getPosterior` nivel 4 **direct**, nu trece prin `walkHierarchy` | evidenţa pooled **nu o poate ajuta**, oricât s-ar aduna |
| c | Pre-înregistrarea **6554** a versiunii active **48876** are fereastra de evaluare expirată | **9 iulie — de 115 zile** |

**Am reparat doar jumătatea inertă**, fiindcă e clar un bug şi nu schimbă nicio tranzacţie: `recordObservation` scria doar nivelul 4, deci nivelurile 0–3 erau goale **pentru totdeauna** — iar `walkHierarchy`, a cărei întreagă menire e să salveze o celulă subţire împrumutând una mai largă, **n-avea de unde împrumuta**. În bază: **88 de rânduri, toate nivel 4, 742 de observaţii între ele.** Fiecare tragere cădea pe `Beta(1,1)` din cod — un cap-sau-pajură îmbrăcat în posterior. Acum scrie toată ierarhia. Pe calea de tranzacţionare **rămâne inert**: `drawSample` se atinge doar după ce trece eligibilitatea, şi ea n-a trecut niciodată.

**Ce rămâne la tine:** a coborî pragul, a ruta eligibilitatea prin posteriorul pooled, şi a reînnoi pre-înregistrarea sunt **o singură decizie**, nu trei — fiindcă oricare singură nu deschide nimic. Iar ce se deschide e influenţa ML pe deciziile reale, pe un avantaj care rămâne **nedovedit**. Nu o ating fără tine.

### 🙋 Două flaguri aprinse care nu fac nimic

`ML_HYBRID_POOLING_ENABLED` şi `ML_OVERRIDE_RESOLVER_ENABLED` sunt **true** în `migration_flags.json` şi au **zero cititori** în tot `server/`. Nu fac nimic. (`CHART_BACKFILL_ENABLED` şi `LIQ_FEED_VIA_SERVER` arată şi ele zero în `server/`, dar sunt flaguri de **client** — alea nu sunt moarte. ML-ul rulează integral pe server, deci alea două chiar sunt.)

### 🙋 Al treilea contributor nu e bug — e setarea ta

`stc` pentru tine: `maxPos 4`, `maxDay 5`, **`cooldownMs 60000`** — iar cooldown-ul e **pe simbol**, nu global (implicitul din brain e 300000). Deci patru simboluri diferite pot umple toată cartea în trei minute. Pe 27 octombrie: **XRP 12:51 · SOL 12:53 · BTC 12:55 · ETH 13:02**. Exact asta.

Motorul face ce-i spun setările. Dacă vrei mai rar, pârghia e `cooldownMs` sau o distanţă globală între intrări — nu o reparaţie.

### Dovada

**13 mutaţii moarte:** ruta ignoră lista filtrată · ruta nu mai scrie `closedIds` · `idKey` coerceşte cu `Number` şi un `id` null se potriveşte cu seq 0 · ruta trimite un uid fix în loc de al sesiunii · întoarcerea la predicatul pe flag · `_serverSeq` testat prin `Number` · garda de autoritate deplină scoasă · rândurile închise nefiltrate · demo nu mai conduce · demo conduce doar cu AT fără brain · journal crede `userId` din payload · journal nu mai scrie `userId` · ML scrie iar doar nivelul 4.

Teste: **35 noi**. Server **634 de suite, 10.086 verzi** pe 4 sharduri, 3 sărite, zero eşuate. Client **165 de fişiere, 1.630 de teste**, `tsc` 0 erori.

**Server + client: build ŞI reload.**

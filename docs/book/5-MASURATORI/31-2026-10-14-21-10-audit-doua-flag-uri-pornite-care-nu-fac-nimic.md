<!-- generat din docs/BOOK_OF_ALL.md linia 3008 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔍 2026-10-14, 21:10 — AUDIT: două flag-uri PORNITE care nu fac nimic

Am baleiat toate cele **34 de flag-uri ON** (din API-ul viu, 38 total) și am numărat cine le citește,
excluzând definiția, changelog-ul și testele.

### 🔴 Două flag-uri ON cu ZERO cititori funcționali
| flag | unde apare | verdict |
|---|---|---|
| `ML_HYBRID_POOLING_ENABLED` | definiție + getter + un test care listează nume | **inert** |
| `ML_OVERRIDE_RESOLVER_ENABLED` | definiție + getter + același test | **inert** |

**CORECTEZ ce scrisesem aici acum o oră.** Am zis „niciodată conectate". **Greșit** — am săpat mai
departe și codul **există**:
| ce promite flagul | implementarea | gardă pe flag? |
|---|---|---|
| Cornercase A — pooling | `ml/_ring5/pooledEvidence.js` + `banditEvidence.js` | **niciuna** |
| Cornercase B — resolver | `ml/_ring5/effectiveStatus.js`, chemat din `routes/ring5.js:114` | **niciuna** |

Deci nu e „flag aprins peste cod inexistent", ci **cod care rulează necondiționat sub un comutator
care nu comandă nimic**. `thompsonSampler.js` și `effectiveStatus.js` nu citesc niciun flag.

**Dar nici „rulează activ" nu e adevărat.** Tabelele pe care lucrează sunt goale:
```
ml_pooled_evidence           0 randuri
ml_feature_global_overrides  0 randuri
ml_bandit_posteriors        84 randuri   (bandit-ul in sine are date)
```
Resolverul rezolvă pe nimic, pooling-ul poolează pe nimic.

**Formularea exactă, a treia oară:** flag-urile **nu comandă nimic în niciun sens** — pornite sau
oprite, comportamentul e identic. Codul rulează, dar pe date inexistente, deci efectul e nul.

**De ce contează mai mult decât un flag mort:** dacă operatorul stinge `ML_OVERRIDE_RESOLVER_ENABLED`
crezând că a dezactivat resolverul, **nu a dezactivat nimic**. Un comutator de siguranță care nu
comută e mai rău decât unul lipsă, fiindcă produce încredere falsă. Aceeași clasă cu panoul LIQ și
cel S/R, pe care le-a scos în b267/b268 exact din acest motiv.

Testul `tests/unit/ml/omegaFlags.test.js` afirmă doar `expect(MF).toHaveProperty(flagName)` — deci
trece **vacuu** pentru un flag inert. Un flag care există nu e un flag care face ceva.

**A șasea și a șaptea instanță** din clasa serii: aprins și inert.

### ✅ Verificat și NEGAT: `BYBIT_TESTNET_ENABLED` NU e inert
Apărea cu 0 referințe, dar e folosit în **mutex** (`migrationFlags.js:287`), unde **blochează**
`BYBIT_LIVE_ENABLED`. E un interblocaj de siguranță, nu un flag mort. **Nu-l atinge.**

### 🎓 Trei capcane de măsurare pe care le-am călcat în 10 minute — de evitat la următorul audit
1. **`JEST_WORKER_ID=1` face flag-urile să citească DEFAULT-URILE.** Îl setasem ca să nu pornesc
   cron-urile (garda adăugată tot azi), dar `migrationFlags.js` folosește sub test un fișier
   temporar și pornește de la `DEFAULTS` — deci primul meu audit măsura altceva decât realitatea.
   **Sursa autoritară e API-ul viu:** `curl -s http://127.0.0.1:3000/api/migration/flags`.
2. **`grep -vi "test"`** (ca să exclud testele) elimină orice linie care conține „test" — **inclusiv
   numele flag-urilor cu `TESTNET`**, care apăreau fals cu zero cititori. Exclude după **cale**
   (`__tests__/`, `/tests/`, `.test.`), nu după conținut.
3. **`zeus` nu poate scrie în scratchpad-ul lui root** — scriptul a eșuat tăcut cu stderr ascuns și
   am analizat un fișier vechi. Dacă ascunzi stderr, verifică întâi că fișierul chiar s-a creat.

### 🧷 FIXAT CU TEST — descoperirea nu se mai poate pierde
`tests/unit/ml/decorative-flags-pinned.test.js` afirmă **realitatea actuală**, nu cea dorită: că
`effectiveStatus.js` **nu** citește `ML_OVERRIDE_RESOLVER_ENABLED`, că niciun fișier de pooling nu
citește `ML_HYBRID_POOLING_ENABLED`, și că `BYBIT_PARITY_ENABLED` e numit **doar într-un comentariu**
(testul separă codul de proză și verifică și că separarea chiar funcționează — altfel toate celelalte
ar trece din motiv greșit).

**E un fir de alarmă, nu o aprobare.** Când decide, testul se **actualizează**, nu se șterge: dacă
cineva gatează codul, aserțiunile se inversează și îl trimit înapoi la secțiunea asta, în loc să lase
descoperirea să se evapore. Dovedit prin mutație: adaug o citire de flag → testul se aprinde.

*Motivul pentru care merită: ce am găsit azi trăiește în Book. Un Book se poate uita; un test picat
nu.*

### 🙋 Decizia lui — acum e o alegere informată, nu una în ceață
1. 🟢 **Leagă flag-urile de cod** (gardă în `effectiveStatus.resolve` și în calea de pooling) — mic,
   și face comutatoarele să comande ce scrie pe ele.
2. 🟡 **Scoate-le din listă** — dacă funcțiile trebuie să ruleze mereu, un comutator decorativ doar
   minte.
3. ⚪ **Lasă-le** — dar atunci știi că nu fac nimic în niciun sens, ceea ce acum e scris aici.

### 🔎 Am investigat și a doua întrebare — de ce sunt goale tabelele. Răspunsuri DIFERITE.

**`ml_feature_global_overrides` — SĂNĂTOS.** Scriitorul e `R5B_governance/autoQuarantine.js:111`,
care **e cablat**: apare în `cron/coldPathCron.js` și `cron/mlScanCron.js`. Tabela e goală pur și
simplu fiindcă **nimic n-a fost pus în carantină**. Nu e bug. Resolverul chiar ar citi date dacă ar
exista.

**`ml_pooled_evidence` — MODUL ORFAN.** `ml/_ring5/pooledEvidence.js` exportă
`refresh / get / incrementStaleness` și **nimic din tot serverul nu-l încarcă** — nici require
static, nici cale dinamică, nici intrare în registrul de cron (am verificat special, fiindcă
`autoQuarantine` e încărcat prin șir de cale și un grep naiv l-ar fi ratat).

**Deci pooling-ul nu face nimic nu fiindcă flagul e stins, ci fiindcă modulul nu e chemat de
nimeni.** Flagul era o pistă falsă.

**Și partea care doare:** modulul **are teste** — `tests/unit/ml/pooledEvidence.test.js` — care trec.
Acoperire vacuă: testele dovedesc că funcțiile sunt corecte, nu că e cineva care le cheamă. Exact
tiparul pe care l-am întâlnit de trei ori în seara asta la propriile mele teste.

**A opta instanță** din clasa serii.

**🙋 Decizia lui, a doua:** `pooledEvidence` se **cablează** (undeva în ciclul Ring5, lângă
`banditEvidence`) sau se **șterge** cu tot cu teste? Momentan e cod mort care arată viu — are teste,
are tabelă, are migrație, și n-a rulat niciodată.

---

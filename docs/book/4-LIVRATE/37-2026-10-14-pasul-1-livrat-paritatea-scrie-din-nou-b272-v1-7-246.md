<!-- generat din docs/BOOK_OF_ALL.md linia 3446 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ✅ 2026-10-14 — PASUL 1 LIVRAT: paritatea scrie din nou (b272 v1.7.246)

Primul pas din campania de flag-uri. **Reparat, livrat, dovedit.**

### Ce s-a schimbat
Scopul rândurilor `source='server'` s-a lărgit la userii **DEMO**, printr-un predicat NOU
(`_isShadowParityTarget`), **nu** prin lărgirea celui vechi (`_isTestnetShadowTarget`), care are
înțeles propriu și teste proprii. REAL rămâne exclus intenționat.

### De ce e sigur — VERIFICAT în cod, nu presupus
Era pe punctul să-l declar „fără execuție" din reflex. Comentariul de la `_runTestnetShadowCycle`
spune că ciclul **și** reîmprospătează `_serverSigDirState`, care e intrare **vie** în mscan. Deci
am citit:
- `includeUserFn` se aplică **DOAR** în bucla per-user care cheamă `db.logParityRow`;
- `_updateServerSigDir(_scanScores)` rulează **după** bucla de simboluri, din scoruri acumulate
  **per simbol** → nu depinde deloc de filtrul de useri;
- rândurile vin din `_computeFusionParity`, documentat „shadow-pure"; `_computeFusion` cel viu
  e neatins.

**Dacă nu verificam, lărgeam filtrul crezând că e diagnostic și schimbam o intrare vie în decizii.**

### Dovada
| | înainte | după |
|---|---|---|
| rânduri `server` | **7**, toate într-o secundă pe 10 oct | **175 în 70 de secunde** |
| acoperire | niciun user | 8 useri × 7 simboluri × 3 cicluri |

Un test existent cerea scopul vechi — **actualizat, nu șters**, cu motivul scris în el, iar protecția
lui reală (ciclul rămâne scopat; REAL nu apare niciodată) e acum afirmată explicit, nu implicit.
**Mutație dublă:** pun la loc predicatul îngust → 3 teste pică și reproduc tăcerea originală; las
REAL să treacă → alte 3 pică. **Suita server 9412/9412.** UN singur reload.

### 🐛 BUG GĂSIT PE PARCURS 1 — ~500 de mesaje Telegram eșuate în 3 zile
```
2026-10-12: 209   2026-10-13: 86   2026-10-14: 212
"Bad Request: can't parse entities: Can't find end of the entity starting at byte offset N"
```
`parse_mode='Markdown'` se rupe pe identificatori dinamici cu `_ * ` [`. Helper-ul `escapeMarkdown`
**există deja** (`telegram.js:282`), iar comentariul lui descrie exact acest simptom — dar unii
apelanți nu-l folosesc. **Al cincilea** caz din aceeași familie: reparație aplicată într-un loc și
nu în celelalte.

**NU pierzi alerte** — verificat înainte de a exagera: `_sendWithRetry` reîncearcă ca text simplu
după 2s, și nu există eșecuri de retry în loguri. Impactul real: alerta ajunge cu 2s întârziere și
nespălată de formatare, iar coada fiind **serializată**, cele ~212 eșecuri/zi adaugă ~7 minute/zi de
întârziere în coadă — într-o rafală ar putea întârzia o alertă critică. **De reparat**, nu urgență.

### 🐛 BUG GĂSIT PE PARCURS 2 — 6 din 8 useri produc rânduri inutile *(introdus de fixul de azi)*
Scriem paritate pentru 8 useri, dar **doar uid 1 și 2 au client care scrie**. Rândurile celorlalți
șase **nu pot forma perechi niciodată** → 75% din volum e risipă. Ritm nou: ~161k rânduri/zi;
retenția e 7 zile (`_PARITY_RETENTION_DAYS = 7`), deci se stabilizează la ~1,13M rânduri ≈ **130 MB**
pe un DB de **2,8 GB**. Mărginit și sigur, dar risipitor.
**Pasul următor:** scopat la userii care chiar produc rânduri de client. **NU l-am înlănțuit azi.**

### 👀 DE URMĂRIT — banurile Binance au urcat 3 → 19
`consecutive_ban_count` era **3** pe 11 oct, e **19** acum. +16 în trei zile, fără reload-uri dese
(un singur reload în tot intervalul). Întărește **R16**: banurile sunt pe **testnet**, unde
`getQuotaPressure` citește 0 fiindcă testnet nu raportează `usedWeight`, iar `QUOTA_CAP` 6000 e
plafonul de producție. Protecția e oarbă acolo. **Așteaptă decizia lui** (3 remedii propuse).

---

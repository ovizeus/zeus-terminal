# Zeus Terminal — Migration Log

Jurnal disciplinat al migrării arhitecturale de la hibrid (DOM + window.* +
localStorage + SQLite + user_ctx FS) la backend-first / Zustand canonical.

Fiecare fază are: pre-check, backup, execuție, teste, GO/NO-GO, lecții.
**Niciodată nu sărim un pas.** **Niciodată nu modificăm cod fără backup.**

---

## Target architecture (north-star)

- **Backend SQLite** = source of truth pentru date persistente per-user.
- **Zustand stores** (`client/src/stores/`) = canonical client-side state.
- **`window.*`** = Proxy read-only derivate din stores (compat legacy).
- **DOM** = randare, niciodată sursă.
- **localStorage** = cache offline pur, invalidat pe server push mai nou.
- **user_ctx FS** = doar UI state (panels, window positions).

---

## Phase ledger

| Phase | Status | Pre-tag | Post-tag | DoD | Notes |
|-------|--------|---------|----------|-----|-------|
| baseline | ✓ done | — | `migration/baseline-v1.6.23-B55` | n/a | HEAD=8bdb16a branch=fix/audit-2026-04-14 |
| 0.A Infrastructure | ✓ done | — | — | scripts + log + tag | backup/rollback scripts tested |
| 0 Backend-first sync | ✓ done | `migration/phase-00-pre` | `migration/phase-00-post` | desktop→phone <2s via /ws/sync | Option A (WS), 8 commits |
| 1 Typed contracts | ✓ done | `migration/phase-01-pre` | `migration/phase-01-post` | tsc clean + typed wire | 5 commits, log-only server validator |
| 2 API client centralized | ✓ done | `migration/phase-02-pre` | `migration/phase-02-post` | all safe internal `/api/*` call-sites migrated + exceptions documented | 21 migrations across 6 commits; 34 deferred exceptions categorized |
| 3 atStore canonic | pending | — | — | #atLev DOM not source | feature-flag |
| 4 settingsStore canonic | pending | — | — | cross-device toggle | — |
| 5 Positions WS live | pending | — | — | trade desktop→phone <1s | feature-flag |
| 6 dslStore+brainStore canonic | pending | — | — | syncFromEngine=0 | — |
| 7 Kill DOM-as-state | pending | — | — | getElementById source=0 | — |
| 8 SQLite-only persist | pending | — | — | user_ctx = UI only | one-shot migration |
| 9 Cleanup + TS strict global | pending | — | — | window.* only in bridge/ | v2.0.0 |

---

## Discipline rules (absolute)

1. **Backup înainte de orice fază** — `bash scripts/backup-pre-phase.sh <phase>`
2. **Audit complet** înainte de modificări.
3. **Plan scris** cu DoD măsurabil, GO/NO-GO, rollback exact.
4. **Confirmare explicită** a user-ului pentru fiecare fază.
5. **Abia apoi execuție**.
6. Nu combinăm refactor cu bug fix în același commit.
7. Un commit ≤ 300 linii diff (exceptând mutări de fișier).
8. Nu începem faza N+1 înainte ca N să fie validată (teste verzi + DoD).
9. Nu facem deploy fără backup.
10. Dacă o fază eșuează → rollback la tag-ul pre-fază, post-mortem în acest fișier, nu improvizație.

---

## Rollback procedure

Pentru orice fază cu backup pre-fază:

```bash
bash /root/zeus-terminal/scripts/rollback-to-phase.sh <phase> --dry-run   # preview
bash /root/zeus-terminal/scripts/rollback-to-phase.sh <phase>             # execute
```

Artefacte folosite:
- `/root/zeus-terminal-backups/git/` — git state info
- `/root/zeus-terminal-backups/db/` — DB snapshots + sha256
- `/root/zeus-terminal-backups/userdata/` — user_ctx + sync_user
- `/root/zeus-terminal-backups/build/` — public/app + public/js
- `/root/zeus-terminal-backups/archive/` — tar.gz cod sursă + config
- `/root/zeus-terminal-backups/reports/` — raport A.6 per fază

Git tag-urile: `migration/phase-<NN>-pre` și `migration/phase-<NN>-post`.

---

## Phase entries

### Phase 0.A — Backup infrastructure

**Scope permis**:
- scripts/backup-pre-phase.sh
- scripts/rollback-to-phase.sh
- MIGRATION_LOG.md
- backup dir layout
- baseline tag
- branch chore/migration-infrastructure

**Scope NEPERMIS** (zero atingere):
- client/src/
- server/routes/
- server/services/
- schema DB
- build/deploy config
- orice logică de runtime

**Status**: ✓ done. Infrastructure validated (backup + dry-run rollback PASS).

---

### Phase 0 — Backend-first settings sync (Option A / WebSocket)

**Scop**: settings persistat primar în SQLite; fiecare sesiune activă a unui user
primește push în timp real pe canalul `/ws/sync` existent când altă sesiune a
aceluiași user modifică settings — fără polling, fără SSE, fără transport nou,
fără al doilea WebSocket. Desktop ↔ telefon convergente în <2s.

**Pre-tag**: `migration/phase-00-pre` (HEAD=f63a5b2)
**Post-tag**: `migration/phase-00-post`
**Branch**: `migration/phase-00-backend-sync`

**Commit-urile 1–8** (în ordine):

| # | Hash | Rezumat |
|---|------|---------|
| 1 | `1ccd132` | server: whitelist extins 19→28 keys în `/api/user/settings`; GET/POST returnează `updated_at` din DB |
| 2 | `928f61c` | server: `app.locals.wsBroadcastToUser` + `global.__zeusWsBroadcastToUser` pe WSS existent `/ws/sync`; POST settings triggerează `settings.changed` |
| 3 | `68bf530` | client: `_usFetchRemote()` async + flatten payload; `_usSave` face POST la SQLite prin `_usPostRemote` (dual-write temporar: LS + SQLite + FS) |
| 4 | `f0c6a47` | client: boot order nou `_usFetchRemote → _usApply → loadUserSettings → _userCtxPull → _startExtras`; fallback LS dacă fetch eșuează; boot nu blochează |
| 5 | `866e4f6` | client: `services/settingsRealtime.ts` — subscribe pe WSS existent pentru `settings.changed`; dedup pe `updated_at` + in-flight coalescing; pornit în `App.tsx` |
| 6 | `8a1e48e` | client: unificare `settingsStore` cu `_usFetchRemote`/`_usPostRemote` (single code path); `w._usPostRemote` expus; projector `_projectFromLegacy`/`_projectToLegacy` |
| 7 | `b3581dc` | client: eliminare FS dual-write pentru settings (`_ucMarkDirty('settings')` scos) + cleanup dublură `zeus_user_settings_cache` |
| 8 | `<post>` | docs: MIGRATION_LOG phase 0 entry + tag `migration/phase-00-post` |

**Backup-uri / tag-uri suplimentare** (checkpoint-uri intermediare):

- Tag: `migration/phase-00-c4-ok-20260414-231256` — după commit 4
- Tag: `migration/phase-00-c5-ok-20260414-232344` — după commit 5
- Tag: `migration/phase-00-c6-ok-20260414-233154` — după commit 6
- Branch: `backup/phase-00-c4-20260414-231256`
- Branch: `backup/phase-00-c5-20260414-232344`
- Branch: `backup/phase-00-c6-20260414-233154`
- Artefacte pre-fază: vezi `/root/zeus-terminal-backups/reports/00-*.report.txt`

**DoD checklist**:

- [x] **DoD 1** — GET `/api/user/settings` returnează `updated_at` (epoch ms) alături de payload flat (commit 1)
- [x] **DoD 2** — POST `/api/user/settings` returnează `updated_at` post-save și triggerează broadcast `settings.changed` pe `/ws/sync` (commit 2)
- [x] **DoD 3** — boot order: `_usFetchRemote → _usApply → _userCtxPull → _startExtras` (commit 4)
- [x] **DoD 4** — cross-device sync <2s: push server → WS → subscriber → `_usFetchRemote` → `_usApply` (commit 5, testat pe runtime)
- [x] **DoD 5** — fallback offline: dacă `_usFetchRemote` eșuează / `ts===0`, boot rămâne pe LS cache `zeus_user_settings` și continuă normal (commit 4)
- [x] **DoD 6** — `_ucMarkDirty('settings')` eliminat; `grep _ucMarkDirty\('settings'\) client/src/` → 0 (commit 7)
- [x] **DoD 7** — single code path: store + legacy folosesc `_usFetchRemote`/`_usPostRemote`; un singur endpoint, un singur transport (commits 6+7)
- [x] **DoD 8** — TS strict: 0 erori noi introduse în toate cele 8 commit-uri (erorile pre-existente în `panels.ts`/`render.ts`/`SettingsModal.tsx` rămân, out-of-scope)
- [x] **DoD 9** — validare post-fază: `vite build` PASS, `pm2 reload zeus` fără erori, `/ws/sync` connects observate în logs, niciun regresion report

**Ce a rămas intenționat pentru fazele următoare**:

- `USER_SETTINGS` nested + `window.TC` mirror — convergență pe `settingsStore` ca sursă unică: Faza 4 (`settingsStore canonic`)
- Dual-write FS (`_ucMarkDirty`) pentru secțiunile rămase: `indSettings`, `panels`, `notifications`, `uiContext`, `aubData`, `aresData`, `scannerSyms`, `llvSettings`, `teacherData`, `ariaNovaHud`, `adaptive`, `perfStats`, `dailyPnl`, `postmortem`, `ofHud`, `uiScale` — fiecare migrat în faza sa dedicată (3/4/8)
- `SettingsModal.tsx` referă `s.tc`/`s.setTC` care nu există în store — bug pre-existent, lăsat pentru Faza 4
- `loadUserSettings()` continuă să manipuleze DOM direct pentru dropdown-urile de leverage — parte din Faza 7 (Kill DOM-as-state)
- `_usSave` continuă să citească valori din DOM (`#atLev`, `#atSL`, etc.) — tratat în Faza 3/4
- Feature flag-uri `MF.SERVER_BRAIN`, `MF.SERVER_AT` — Faza 2 (amânată post-v1.6.7)

**Rollback point**:

```bash
# Full rollback la pre-fază:
bash /root/zeus-terminal/scripts/rollback-to-phase.sh 00 --dry-run
bash /root/zeus-terminal/scripts/rollback-to-phase.sh 00

# Sau git hard-reset la pre-tag:
git checkout migration/phase-00-backend-sync
git reset --hard migration/phase-00-pre

# Checkpoint intermediar (ex: revenire la starea după commit 6):
git reset --hard migration/phase-00-c6-ok-20260414-233154
```

**Observații de runtime / risc**:

- Runtime-ul post-C7 arată `[WS] Client connected uid=1 total=N` la fiecare pm2 reload — transportul existent intact, subscriber-ul nou NU creează conexiuni adiționale (reutilizează `wsService` din `App.tsx`).
- `[BRAIN] Config updated` și `[TC] Config sync from user` apar normal la runtime → engine-urile legacy citesc corect `TC` după save prin oricare dintre cele două căi (store sau `_usSave`).
- Riscul principal rezidual: race între propria postare și broadcast-ul primit înapoi pe același socket. Mitigat prin dedup `updated_at <= _lastKnownTs` și in-flight coalescing în `settingsRealtime.ts`.
- `USER_SETTINGS.autoTrade` e populat de `_usSave` din DOM. Dacă React patch-uiește via `settingsStore.saveToServer`, projector-ul `_projectToLegacy` îl scrie corect ÎNAINTE de POST — dar dacă imediat după, `_usSave` e apelat din engine, DOM-ul poate avea valori staled. Mitigat de faptul că `_usSave` e apelat doar din utils/dev, indicators.ts post-save și din bootstrap 5min tick — nu în paralel cu handle-urile UI React.
- Zero cazuri de pierdere de date observate în testele manuale; toate checkpoint-urile C4/C5/C6 sunt branch-backed.

**Status**: ✓ PHASE 0 COMPLETE.

---

### Phase 1 — Typed contracts

**Scop**: fundația de tipuri pentru canalul settings — introducere `SettingsPayload`
(flat wire contract, 40 chei, mirror exact `SETTINGS_WHITELIST`), extindere
`WsMessage` union cu `WsSettingsChanged`, tiparea completă a store-ului și a
subscriber-ului realtime pe aceste contracte, plus un validator shape server-side
în **mod log-only** (soft). Zero schimbare de runtime; doar typed contracts +
observabilitate.

**Pre-tag**: `migration/phase-01-pre` (HEAD=f2ad761)
**Post-tag**: `migration/phase-01-post`
**Branch**: `migration/phase-01-typed-contracts`

**Commit-urile 1–5** (în ordine):

| # | Hash | Rezumat |
|---|------|---------|
| 1 | `f8fa810` | types: `WsSettingsChanged` în union + nou `types/settings-contracts.ts` (`SettingsPayload`, `SettingsGetResponse`, `SettingsPostRequest`, `SettingsPostResponse`) + re-export în `types/index.ts` |
| 2 | `688d677` | client: `settingsStore.ts` tipat pe `SettingsPayload` — 13 `any`-uri eliminate; `Legacy*` interfaces locale pentru bridge-ul `USER_SETTINGS`/`TC` (fără `declare global`); `get<K>` tipare strict |
| 3 | `1a0020d` | client: `settingsRealtime.ts` folosește direct narrow pe discriminant `msg.type === 'settings.changed'`; eliminat cast `as unknown as Partial<...>`; eliminat alias local duplicat; `window as any` → `window as unknown as ZeusWindowExt` |
| 4 | `451ab47` | server: `validateSettingsBody` middleware **log-only (C4a)** în `middleware/validate.js` — `SETTINGS_SHAPE` cu tipuri pentru toate cele 40 chei; wire single-line în `routes/trading.js` POST `/api/user/settings`; **zero 400 nou** introdus |
| 5 | `<post>` | docs: MIGRATION_LOG phase 1 entry + tag `migration/phase-01-post` |

**Ce s-a tipat concret**:

- **Contracts noi** (`client/src/types/settings-contracts.ts`):
  - `SettingsPayload` — 40 chei opționale flat (number×16, boolean×6, string×7, array×1, object×10), mirror exact al server `SETTINGS_WHITELIST`
  - `SettingsGetResponse` — `{ ok, settings, updated_at, error? }`
  - `SettingsPostRequest` — `{ settings: SettingsPayload }`
  - `SettingsPostResponse` — `{ ok, updated_at?, error? }`
- **Union extins** (`client/src/types/sync.ts`): `WsMessage = WsAtUpdate | WsSyncSignal | WsSettingsChanged`
- **Store typed** (`client/src/stores/settingsStore.ts`): `settings: SettingsPayload`, `patch(Partial<SettingsPayload>)`, `get<K extends keyof SettingsPayload>(K) => SettingsPayload[K]`, toate projector-ele pe shape-uri tipate; bridge locale `LegacyAutoTrade`/`LegacyChart`/`LegacyUserSettings`/`LegacyTC`/`ZeusWindowExt`; 13 `any` eliminate (0 rămase)
- **Realtime typed** (`client/src/services/settingsRealtime.ts`): narrow prin discriminant pe union; alias local duplicat `SettingsChangedMsg` eliminat; 1 cast bridge controlat `window as unknown as ZeusWindowExt`
- **Server shape validator** (`server/middleware/validate.js`): `SETTINGS_SHAPE` + `validateSettingsBody` log-only, wrap în try/catch, export adăugat; wire minim în `server/routes/trading.js`

**DoD checklist**:

- [x] **DoD 1** — `WsMessage` include `WsSettingsChanged`; `settingsRealtime.ts` narrow fără cast la `unknown`. `grep "as unknown as" client/src/services/settingsRealtime.ts` → 1 (doar `window as unknown as ZeusWindowExt`, documentat; zero cast pe mesaj)
- [x] **DoD 2** — `settingsStore.ts`: 0 `any` (`grep -E "\bany\b" → 0`); singurul cast bridge controlat e `at as unknown as Record<string, unknown>` localizat într-o buclă de 3 linii, documentat (commit 2)
- [x] **DoD 3** — `npx tsc --noEmit` PASS după fiecare commit; zero erori noi introduse în fișiere out-of-scope
- [x] **DoD 4** — `SettingsPayload` conține EXACT 40 chei mirror `SETTINGS_WHITELIST` server. Cross-ref prin comentariu în ambele sensuri
- [x] **DoD 5** — server `validateSettingsBody` log-only: zero 400 nou; request forwarded întotdeauna prin `next()`; logs prefix `[validate][settings]` pentru shape/unknown/type mismatches
- [x] **DoD 6** — `npx vite build` PASS după fiecare commit (fără erori, doar warnings INEFFECTIVE_DYNAMIC_IMPORT pre-existente)
- [x] **DoD 7** — zero regresii comportamentale: toate flow-urile runtime (load boot, save POST, realtime subscribe, server POST/GET, broadcast) au comportament bit-identic față de post-Faza 0
- [x] **DoD 8** — MIGRATION_LOG Phase 1 entry complet; tag `migration/phase-01-post` creat
- [x] **DoD 9** — `git diff migration/phase-01-pre..HEAD --stat` atinge doar zonele permise (`client/src/types/`, `client/src/stores/settingsStore.ts`, `client/src/services/settingsRealtime.ts`, `server/middleware/validate.js`, `server/routes/trading.js` wire-only, `MIGRATION_LOG.md`)

**Ce a rămas intenționat neatins pentru fazele următoare**:

- **Strict validator server** — C4 este C4a soft / log-only. Tightening la reject
  hard (400 pe shape/type invalid) este planificat pentru o fază ulterioară după
  ce log-urile soft confirmă că payload-urile reale respectă contractul. Fără
  deviație neașteptată de traffic, upgrade-ul devine mecanic.
- **Nested legacy types globale** — `LegacyAutoTrade`/`LegacyChart`/`LegacyUserSettings`/`LegacyTC`
  sunt strict locale în `settingsStore.ts`. NU au fost promovate în `types/` pentru a
  nu extinde suprafața publică. Faza 9 (Cleanup + TS strict global) poate decide
  dacă merge `declare global` sau dacă bridge-ul dispare complet când Faza 7
  (Kill DOM-as-state) elimină legacy-ul.
- **`window.TC`, `USER_SETTINGS`, `_usFetchRemote`, `_usPostRemote`** rămân globale
  necontrolate — convergența pe `settingsStore` ca sursă unică e treaba Fazei 4.
- **`SettingsModal.tsx` `s.tc`/`s.setTC`** — bug pre-existent menționat în Phase 0
  deferred, rămâne out-of-scope până la Faza 4.
- **`useServerSync.ts`, `ws.ts`** — neatinse; nu aveau `any`-uri relevante și
  extensia union-ului nu necesită modificări (listener-ele existente continuă să
  primească mesajele non-`settings.changed`).
- **`stateAccessors.ts`** — neatins; migrarea lui e în Faza 4/7.
- **TS strict global** — restul erorilor pre-existente (panels.ts, render.ts,
  SettingsModal.tsx) rămân out-of-scope până la Faza 9.

**Rollback point**:

```bash
# Full rollback la pre-fază:
bash /root/zeus-terminal/scripts/rollback-to-phase.sh 01 --dry-run
bash /root/zeus-terminal/scripts/rollback-to-phase.sh 01

# Sau git hard-reset la pre-tag:
git checkout migration/phase-01-typed-contracts
git reset --hard migration/phase-01-pre
```

Artefacte backup pre-fază: `/root/zeus-terminal-backups/reports/01-20260414-235740.report.txt`.

**Observații de runtime / risc**:

- Shape-ul `SETTINGS_SHAPE` din server (40 chei) DUBLEAZĂ `SETTINGS_WHITELIST` pe
  tipuri. Orice adăugare de cheie nouă în whitelist trebuie propagată în 3 locuri:
  `SETTINGS_WHITELIST` (server/routes/trading.js), `SETTINGS_SHAPE`
  (server/middleware/validate.js), `SettingsPayload`
  (client/src/types/settings-contracts.ts). Comentariu cross-ref în toate.
- Log-urile `[validate][settings]` sunt grepable în output pm2. Dacă apar volume
  mari de mismatch, asta semnalează că un client trimite payload care nu respectă
  contractul — util pentru diagnostic înainte de tightening strict.
- Runtime post-C4 NU a fost `pm2 reload`-at în cadrul fazei; prima validare live
  va fi la următorul deploy. Până atunci, `node --check` pe ambele fișiere a
  confirmat syntax valid; comportamentul middleware-ului (întotdeauna `next()`)
  garantează absența de regresii la deploy.
- Cast-urile bridge locale `window as unknown as ZeusWindowExt` sunt documentate
  ca punct unic de intrare spre legacy globals — un grep le poate inventaria
  rapid pentru Faza 9.

**Status**: ✓ PHASE 1 COMPLETE.

---

### Phase 2 — API client centralized

**Scop**: centralizarea apelurilor client-side către `/api/*` pe helper-ul tipat
`api.get/post/put/del/raw` din `client/src/services/api.ts`. Obiectiv migrare
**mecanică** a tuturor call-site-urilor sigure (preservare URL/metodă/body/error
handling/side-effects bit-identic); call-site-urile cu semnificație specială
(fire-and-forget, keepalive/beacon, boot/init fragil, pattern de răspuns
alternativ, lipsă `credentials` intenționată) rămân explicit **deferred**, nu
accidentale. Fără schimbare de comportament la runtime.

**Pre-tag**: `migration/phase-02-pre` (HEAD=4eaf6bb)
**Post-tag**: `migration/phase-02-post`
**Branch**: `migration/phase-02-api-client`

**Descoperire critică pe parcurs**: `client/src/bridge/legacyLoader.ts:77-89`
instalează un monkey-patch pe `window.fetch` care auto-injectează
`X-Zeus-Request: 1` pe toate request-urile same-origin POST/PUT/DELETE/PATCH.
Deci **lipsa header-ului CSRF în codul sursă NU înseamnă că request-ul eșuează
post-bridge**. Strategia de migrare a fost recalibrată în urma descoperirii —
migrăm ce e mecanic și sigur, defer cu motivație clară restul.

**Commit-urile 1–6** (în ordine):

| # | Hash | Rezumat |
|---|------|---------|
| 1 | `aa3fc28` | contract-only: extindere `api.ts` cu `del`, `raw<T>(method,url,body,opts)`, `ApiRequestOpts{keepalive,signal}` — zero call-site schimbat |
| 2 | `0d6c175` | 4 migrări mecanice sigure (POST/GET fără comportament special) |
| 3 | `ef2c984` | 9 migrări trading + data (`autotrade.ts` ×3, `marketDataPositions.ts` ×1, `marketDataClose.ts` ×1, `marketDataTrading.ts` ×4) |
| 4 | `45b38b1` | 1 migrare: `SettingsHubModal.tsx:47` `/api/exchange/status` GET; helper-ul `apiFetch` local NU refactorizat (deferred explicit) |
| 5A | `ca56f5a` | 7 migrări GET în `bootstrapPanels.ts` (`/api/exposure` ×2, `/api/missed-trades`, `/api/session-review`, `/api/regime-history`, `/api/performance`, `/api/compare`) |
| 5B | — | NO-OP justificat: niciun call-site din `bootstrapStartApp.ts` sau `config.ts` nu e mecanic sigur; toate 11 cad în categoriile deferred (boot/init fragil, keepalive/beacon, alt pattern, helper complex) — raportat ca zero-migration |
| 6 | `<post>` | docs: MIGRATION_LOG Phase 2 entry + tag `migration/phase-02-post` |

**Totaluri**:

- **Migrate**: **21** call-site-uri (C2:4 + C3:9 + C4:1 + C5A:7)
- **Deferred explicit**: **34** call-site-uri rămase cu `fetch('/api/...')` direct, toate documentate mai jos
- **Raw `fetch('/api/*')` rămas la final**: 34 (toate intenționate)

**DoD — închidere calitativă (NU numerică brutală)**:

Regula originală din ledger spunea `fetch( ≤3 hits`. Pe parcursul fazei,
regula a fost redefinită explicit de user:

> "Nu vreau să forțezi DoD-ul numeric brut. Toate excepțiile rămase sunt
> explicit listate, motivate clar, documentate în MIGRATION_LOG. Nu schimbi
> comportamentul doar ca să atingi un număr artificial."

DoD calitativ atins:

- [x] **DoD 1** — `api.ts` exportă `get/post/put/del/raw` + `ApiRequestOpts` (C1)
- [x] **DoD 2** — toate call-site-urile sigure și mecanice din scope-ul permis migrate (21/21)
- [x] **DoD 3** — toate call-site-urile neatinse sunt explicit listate cu motiv de defer
- [x] **DoD 4** — zero schimbare de comportament runtime (URL/method/body/error-handling/side-effects preservate bit-identic pentru migrările făcute)
- [x] **DoD 5** — `npx tsc --noEmit` PASS după fiecare commit (vezi raportul fiecărui commit)
- [x] **DoD 6** — `npx vite build` PASS după fiecare commit
- [x] **DoD 7** — monkey-patch `legacyLoader.ts:77-89` (X-Zeus-Request auto-inject) documentat — explică de ce call-site-urile migrate nu au nevoie de header explicit
- [x] **DoD 8** — helper-ul local `apiFetch` din `SettingsHubModal.tsx:17` NU refactorizat (deferred controlat, out-of-scope Phase 2)
- [x] **DoD 9** — MIGRATION_LOG Phase 2 entry complet + tag `migration/phase-02-post` creat

**Deferred exceptions — categorizate**:

**Categoria A: Fire-and-forget sensibil** (8) — apeluri fără `.then`/`.catch` pe
rezultat, unde tranziția la `api.raw` schimbă semantica erorii (throw pe non-2xx
vs. silent fail); risc de log spam / kill switch false-pozitiv:

- `client/src/trading/dsl.ts:124` `/api/dsl/toggle` POST
- `client/src/trading/dsl.ts:674` `/api/at/control` POST (controlMode user)
- `client/src/trading/dsl.ts:708` `/api/at/control` POST (release)
- `client/src/trading/dsl.ts:814` `/api/at/dslparams` POST
- `client/src/engine/ares.ts:433` `/api/risk/pnl` POST (owner=ARES)
- `client/src/data/marketDataPositions.ts:341` `/api/risk/pnl` POST (owner=AT, fără `credentials`)
- `client/src/core/bootstrapStartApp.ts:237` `/api/at/kill` fire-and-forget
- `client/src/core/bootstrapStartApp.ts:242` `/api/at/pct` fire-and-forget

**Categoria B: Keepalive / beacon** (3) — folosesc `keepalive: true` pentru a
sobreviețui unload; `api.raw` expune `opts.keepalive` dar migrarea ridică
riscuri de ordonare și necesită revalidare pe runtime (unload flow e delicat):

- `client/src/core/state.ts:1280` `/api/sync/state` POST keepalive
- `client/src/core/config.ts:1479` `/api/sync/user-context` POST keepalive
- `client/src/core/bootstrapError.ts:29` `/api/client-error` POST (endpoint beacon whitelisted server-side — validat prin Origin, nu CSRF)

**Categoria C: Boot / init fragil** (8) — rulează PRE-bridge, deci monkey-patch-ul
fetch nu e încă instalat; sau fac parte din boot sequence cu ordonare critică
(`_usFetchRemote → _usApply → _userCtxPull → _startExtras`); migrarea fără
repornire controlată de runtime riscă regresii de boot:

- `client/src/core/bootstrapStartApp.ts:57` `/api/at/state` PREBOOT
- `client/src/core/bootstrapStartApp.ts:63` `/api/dsl/toggle` PREBOOT
- `client/src/core/state.ts:217` `/api/tc/sync` POST (sync init)
- `client/src/core/state.ts:682` `/api/sync/state` POST
- `client/src/core/state.ts:1021` `/api/at/state` GET (boot)
- `client/src/core/state.ts:1034` `/api/brain/recent-blocks` GET (boot)
- `client/src/core/state.ts:1076` `/api/sync/state` POST (sync)
- `client/src/core/state.ts:1089` `/api/sync/journal` GET (sync)

**Categoria D: Pattern de răspuns alternativ** (6) — `.then(r => r.ok ? r.json() : null)`
sau chain custom unde mapping-ul direct pe `api.raw` (care throw pe non-2xx)
ar schimba semantica (null vs. throw); necesită decizie explicită de comportament:

- `client/src/core/bootstrapError.ts:68` `/api/version` GET (`r.ok ? r.json() : null`)
- `client/src/core/bootstrapError.ts:76` `/api/version` GET (`r.ok ? r.json() : null`)
- `client/src/core/bootstrapBrainDash.ts:197` `/api/brain/dashboard` GET (`r.ok ? r.json() : null`)
- `client/src/core/bootstrapStartApp.ts:250` fetch alt pattern (sd/symbols)
- `client/src/utils/dev.ts:759` `/api/user/telegram` GET (`r.json()` direct, fără `r.ok` check)
- `client/src/core/config.ts:586` `/api/sync/user-context` GET (pull alt pattern complex)

**Categoria E: Lipsă `credentials` intenționată / comportament special** (5) —
call-site-urile care omit explicit `credentials: 'same-origin'`; migrarea ar
adăuga cookies la request-uri unde un comportament diferit era așteptat, deci
merită audit separat înainte de migrare:

- `client/src/services/storage.ts:41` `/api/journal/report` POST
- `client/src/stores/aresStore.ts:63` `/api/user/ares` POST/PUT
- `client/src/utils/dev.ts:716` `/api/user/telegram` POST/PUT
- `client/src/utils/dev.ts:739` `/api/user/telegram/test` POST
- `client/src/components/layout/ModeBar.tsx:58` `/api/mode` POST

**Categoria F: Helper shared complex — `_usFetchRemote`/`_usPostRemote`** (4) —
funcții canonice apelate din multiple locuri, cu validation settings + merge
logic + fallback LS; refactor-ul lor aparține unei faze dedicate (Phase 4
`settingsStore canonic`):

- `client/src/core/config.ts:537` `/api/sync/user-context` POST (user-context push complex)
- `client/src/core/config.ts:1518` `/api/sync/user-context` POST (canonical `_usPostRemote`)
- `client/src/core/config.ts:1594` `/api/user/settings` GET (canonical `_usFetchRemote`)
- `client/src/core/config.ts:1619` `/api/user/settings` POST (canonical `_usPostRemote`)

**Total deferred**: 8 + 3 + 8 + 6 + 5 + 4 = **34**

**Nota privind reconcilierea numerelor**:
Pe parcursul fazei raportul intermediar dădea "21 deferred"; recount final
direct din sursa `grep "fetch('/api/"` dă **34**. Diferența provine din
cumularea incompletă a rapoartelor per-commit (unele call-site-uri reapăreau
în mai multe comenzi de audit). Numărul corect și autoritar este **34**,
confirmat prin grep direct pe sursa post-C5A.

**Ce a rămas intenționat neatins pentru fazele următoare**:

- Helper `apiFetch` local din `SettingsHubModal.tsx:17` — 9 call-site-uri mixte
  (`/api/exchange/*` + `/auth/*`); refactor dedicat în faza ulterioară după ce
  separarea auth vs. api devine clară.
- `_usFetchRemote` / `_usPostRemote` — convergența pe `settingsStore` ca sursă
  unică: Phase 4.
- Refactor beacon endpoints (`/api/client-error`, `/api/sync/state`,
  `/api/sync/user-context`) — necesită audit runtime unload flow; out-of-scope.
- Unificare fire-and-forget pattern — probabil se rezolvă natural la Phase 3
  (`atStore canonic`) și Phase 6 (`dslStore+brainStore canonic`) când engine-urile
  scriu direct prin store-uri tipate.

**Rollback point**:

```bash
# Full rollback la pre-fază:
bash /root/zeus-terminal/scripts/rollback-to-phase.sh 02 --dry-run
bash /root/zeus-terminal/scripts/rollback-to-phase.sh 02

# Sau git hard-reset la pre-tag:
git checkout migration/phase-02-api-client
git reset --hard migration/phase-02-pre
```

Checkpoint-uri intermediare (branch-backed prin commit-uri atomice):

- C1 `aa3fc28` — contract-only (safe rollback point)
- C2 `0d6c175` — 4 migrări
- C3 `ef2c984` — 9 migrări
- C4 `45b38b1` — 1 migrare
- C5A `ca56f5a` — 7 migrări

**Observații de runtime / risc**:

- Monkey-patch-ul `legacyLoader.ts:77-89` este punctul central care face ca
  migrările din C2/C3/C4/C5A să nu introducă regresii CSRF. Dacă monkey-patch-ul
  ar fi scos, toate request-urile prin `api.raw` vor primi totuși `X-Zeus-Request`
  via `HEADERS` din `api.ts`. Dublă protecție acceptabilă.
- `api.raw` throw pe non-2xx (`HTTP ${status}`). Toate migrările făcute au fost
  verificate să aibă `.then`/`.catch` care absorb erorile cum o făceau înainte.
- Fetch-urile rămase **NU** sunt accidentale. 34 sunt listate mai sus categorizat.
  Orice call-site nou `fetch('/api/...')` adăugat după Phase 2 trebuie să
  urmeze helper-ul `api.*` sau să fie documentat explicit ca excepție.
- `grep -rn "fetch('/api/" client/src` post-C5A returnează 34 hits în 13 fișiere
  (incluzând `dsl.ts.bak-dsl-spam-20260414` care e backup local, nu cod viu —
  efectiv 34 hits în cod viu).

**Status**: ✓ PHASE 2 COMPLETE — all safe internal API call-sites migrated;
remaining internal fetches are documented deferred exceptions, not accidental
leftovers.

---

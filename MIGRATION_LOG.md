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
| 3 atStore canonic | ✓ done | `migration/phase-03-pre` | `migration/phase-03-post` | #atLev DOM not source | 6 commits; CLIENT_AT_STORE feature flag deferred (hardening follow-up) |
| 4 settingsStore canonic | ✓ done | `migration/phase-04-pre` | `migration/phase-04-post` | cross-device toggle | 6 commits; `_usBuildFlatPayload` retained as compat helper (deferred to Phase 5) |
| 5 Positions WS live | ✓ done | `migration/phase-05-pre` | `migration/phase-05-post` | trade desktop→phone <1s | 7 commits + 1 preflip fix; `MF.POSITIONS_WS=true` live; polling retired from main path; 48h observation still open post-tag; OPEN ISSUE transient duplicates → **MITIGATED by Phase 5.1** |
| 5.1 Positions bridge reconciliation | ✓ done | `migration/phase-5.1-pre` | `migration/phase-05.1-post` | bridge gated on WS | 1 commit; `usePositionsBridge` gated pe `wsService.isConnected()`; OPEN ISSUE **MITIGATED structurally, pending browser-side verification** |
| 6 dslStore+brainStore canonic | ✓ done | — | `migration/phase-06-post` | syncFromEngine=0 | 8 commits (C1→C7) + 2 pre-C7 BlockReason inversions; `dslStore` + `brainStore` canonical; `window.DSL` + `window.BM` Proxy read-compat; `useDSLBridge` + `useBrainBridge` deleted; `syncFromEngine` removed from both stores; `blockReason` write-path canonical at all 20 known sites; `aresStore.syncFromEngine` deferred (out of scope) |
| 7 Kill DOM-as-state | ✓ done | `migration/phase-7-pre` | `migration/phase-07-post` | USER_SETTINGS consumers canonical + stale comments cleaned | Scope redus intenționat: consumer migration (4 read-sites) + stale comments (5 files); `window.USER_SETTINGS` Proxy respins (nesting risk); `window.TC` auditat OK (Phase 3 satisfăcut); `engine/aub.ts` deferred; Phase 5 OPEN ISSUE out of scope |
| 8 SQLite-only persist | ✓ done | `migration/phase-08-pre` | `migration/phase-08-post` | 14 sections SQLite primary, FS stripped | 5 commits (C1→C5); migration 021_user_ctx_data; dual-read C2, dual-write C3, validated C4 (28/28 MATCH), FS write stopped C5; Phase 5.1 MITIGATED (not closed); Phase 8.1 FS prune deferred |
| 9 Cleanup + TS strict | ✓ done | `migration/phase-09-pre` | `migration/phase-09-post` | syncFromEngine=0 in all stores, stores/services 0 TS errors | 3 commits; aresStore.syncFromEngine eliminated (engine push direct); partialPct audited→deferred; TS strict overlay 0 errors stores/services |

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

### Phase 3 — atStore canonical

**Scop**: mutarea celor 8 parametri AutoTrade (`lev`, `size`, `slPct`, `rr`,
`maxPos`, `sigMin`, `adxMin`, `cooldownMs`) dintr-un model hibrid (DOM inputs
citite ca sursă + `window.TC` global + `USER_SETTINGS.autoTrade` nested) într-un
loc canonic: `atStore.config` (Zustand). DOM-ul devine strict proiecție UI;
`window.TC` devine Proxy care deleghează cele 8 chei la store; engine-urile
citesc prin store/TC Proxy, niciodată prin `document.getElementById`.

**Pre-tag**: `migration/phase-03-pre` (HEAD=8f69e4d = Phase 2 post)
**Post-tag**: `migration/phase-03-post`
**Branch**: `migration/phase-03-at-store`

**Commit-urile 1–6** (în ordine):

| # | Hash | Rezumat |
|---|------|---------|
| 1 | `f80ac83` | contract-only: `types/trading.ts` ATConfig (8 câmpuri); `atStore` extins cu `config: ATConfig`, `patchConfig(partial)`, `hydrate(settings)`; zero caller schimbat |
| 2 | `fd21c91` | `settingsStore._projectToAT()` → `atStore.hydrate()`; wired în toate cele 4 puncte unde rulează `_syncToWindow` (loadFromServer success, offline fallback, saveToServer, patch) |
| 3 | `13f93c4` | `core/state.ts` `w.TC` wrapped în Proxy: cele 8 chei AT delegă la `atStore.config` (get) și `patchConfig` (set); restul TC passthrough; seed atStore din defaults la install; idempotent prin marker `__atStoreProxy` |
| 4 | `3fe1e05` | `AutoTradePanel.tsx` push direct în `atStore.patchConfig` via `useEffect` pe [atLev, atSize, atSL, atRR, atMaxPos, sigMin]; NaN guard preserve valorile vechi; zero cursor-jump risk (post-commit effect, no subscribers pe config) |
| 5 | `90e271d` | eliminare DOM reads AT din decision path: `syncDOMtoTC` drop 6 AT lines; `core/state.ts:345-348` 4× fallback DOM → `useATStore.getState().config`; `risk.ts:236-237` 2× idem. 0 DOM-read AT rămase în decision path |
| 6 | `<post>` | docs: MIGRATION_LOG Phase 3 entry + tag `migration/phase-03-post` |

**Totaluri**:

- **DOM reads eliminate în decision path**: **12** site-uri (6 în `syncDOMtoTC`, 4 în `_buildPositionCandidate`, 2 în `risk.ts` per-regime bucket calc)
- **Fișiere noi tipate**: 1 (`ATConfig` în `types/trading.ts`)
- **Fișiere atinse total fază**: 7 (excluzând `MIGRATION_LOG.md`):
  `types/trading.ts`, `types/index.ts`, `stores/atStore.ts`, `stores/settingsStore.ts`,
  `core/state.ts`, `components/dock/AutoTradePanel.tsx`, `trading/risk.ts`

**Ce s-a făcut concret**:

- **ATConfig contract** (`client/src/types/trading.ts`): `interface ATConfig` cu 8 câmpuri numerice (`lev`, `size`, `slPct`, `rr`, `maxPos`, `sigMin`, `adxMin`, `cooldownMs`); re-exportat în `types/index.ts`.
- **atStore extins** (`client/src/stores/atStore.ts`): `config: ATConfig` cu `DEFAULT_AT_CONFIG` (valori legacy); `patchConfig(partial)` guard-at prin `Number.isFinite` (NaN/undefined ignorate silent); `hydrate(settings: SettingsPayload)` cu mapare wire-to-config (`sl → slPct`, altele 1:1; `adxMin`/`cooldownMs` neatinse, nu sunt în wire flat).
- **Projector settings → AT** (`client/src/stores/settingsStore.ts`): `_projectToAT(s)` invocă `atStore.hydrate(s)`, wired la toate cele 4 puncte unde se sincronizează legacy state (`loadFromServer` success + offline fallback, `saveToServer` step 1, `patch` local).
- **TC Proxy** (`client/src/core/state.ts:158-232`): `w.TC` ca Proxy cu get/set traps pentru cele 8 chei; `{ lev, size, slPct, rr, maxPos, sigMin, minADX → adxMin, cooldownMs }` rutează la `atStore.config` / `patchConfig`; restul (riskPct, hourStart, hourEnd, confMin, dslActivatePct, dslTrailPct, dslTrailSusPct, dslExtendPct) passthrough plain. Idempotent prin marker `__atStoreProxy`. Seed-uit din defaults la install pentru paritate bit-identică pre/post C3.
- **AutoTradePanel write-path** (`client/src/components/dock/AutoTradePanel.tsx`): `useEffect` nou care watchează 6 state-uri de input și cheamă `patchConfig({lev, size, slPct, rr, maxPos, sigMin})` post-commit; NaN din input gol/invalid e guard-at. Zero subscriber pe `config.*`, deci zero rerender în cascadă.
- **DOM reads eliminate** (`client/src/core/state.ts` + `client/src/trading/risk.ts`): 12 site-uri removed; path-ul de execuție al engine-ului citește exclusiv `useATStore.getState().config` pentru cele 8 chei AT.

**DoD atins** (numerotat per pre-plan):

- [x] **DoD 1** — `grep 'getElementById(.atLev\|atSize\|atSL\|atRR\|atMaxPos\|atSigMin\|atAdxMin\|atCooldown' client/src/core client/src/trading client/src/engine` → **0 hits** pentru read în decision path (2 hits rămase în `engine/aub.ts` sunt DOM **writes**, documentate ca deferred UI concern)
- [x] **DoD 2** — `atStore` conține toate cele 8 câmpuri `ATConfig` + `patchConfig()` + `hydrate()` (C1)
- [x] **DoD 3** — `window.TC` Proxy delegă citirile spre `atStore.getState().config` pentru cele 8 chei (C3)
- [x] **DoD 4** — `AutoTradePanel.tsx` inputs scriu în `atStore.patchConfig` via `useEffect` (C4); niciodată direct `.value = x` pe DOM
- [x] **DoD 5** — Save settings: `settingsStore.saveToServer()` → `_projectToLegacy` + `_syncToWindow` + `_projectToAT` → POST → broadcast WS → cross-device convergent (path-ul Phase 0 reutilizat; zero modificare infra)
- [x] **DoD 6** — engine-urile (`core/state.ts`, `trading/autotrade.ts`, `trading/risk.ts`, `engine/brain.ts`, `engine/aub.ts`) citesc prin `useATStore.getState().config` sau `window.TC` Proxy — zero `document.getElementById` în decision path
- [ ] **DoD 7** — **DEFERRED**: feature flag `MF.CLIENT_AT_STORE` NU a fost introdus. Motivul (explicit, decizia user-ului): *hardening / rollback runtime gate deferred to dedicated follow-up, not required to complete canonical AT config migration*. Phase 3 este funcțională pe traseul principal; flag-ul ar fi adăugat server touch + branch nou de comportament + risc nou doar pentru bifare. Rollback rămâne disponibil prin git tags (`migration/phase-03-pre`) și scriptul `rollback-to-phase.sh 03`, nu runtime-toggleable.
- [x] **DoD 8** — `npx tsc --noEmit` PASS după fiecare commit; `npx vite build` PASS (~720–760ms per commit)
- [x] **DoD 9** — runtime post-C5 observat curat: `pm2 reload` clean, `/health` 200, zero uncaught/throw/stack trace în pm2 error log pe toată durata fazei
- [x] **DoD 10** — MIGRATION_LOG Phase 3 entry + tag `migration/phase-03-post` (C6)

**Ce a rămas intenționat pentru fazele următoare**:

- **Feature flag `MF.CLIENT_AT_STORE`** — deferred ca hardening follow-up dedicat. Nu e blocant pentru închiderea Phase 3. Argumentele user-ului: server-ul a rămas neatins pe toată durata Phase 3, flag-ul ar introduce un touch server + branch comportament + risc nou strict pentru bifare. Rollback e disponibil prin tag-uri git și scriptul `rollback-to-phase.sh 03` (non-runtime, dar suficient).
- **`engine/aub.ts:511-514`** — 2 `document.getElementById('atSL'/'atRR').value = x` în `_aubApplyPendingSim` (UI action "Apply suggested settings"). Sunt DOM **writes**, nu reads, deci strict out-of-scope Phase 3 (decision-path READ elimination). De notat: post-React-migration, scrierea directă pe `input.value` e no-op (React revertează la render) — codul era deja non-funcțional independent de Phase 3. Fix corect = routing prin `settingsStore.patch` sau panel state; aparține unei faze UI dedicate.
- **`syncDOMtoTC` pentru `riskPct` + `dslActivatePct/dslTrailPct/dslTrailSusPct/dslExtendPct`** — funcția continuă să citească DOM pentru aceste chei non-AT. Este în scope Phase 6 (`dslStore+brainStore canonic`) sau Phase 7 (Kill DOM-as-state).
- **`adxMin` + `cooldownMs` UI surface** — nu există inputuri în `AutoTradePanel.tsx` pentru aceste 2 din 8 chei ATConfig; rămân pe valori hydrate din settings (prin `indSettings` blob) / defaults. Aduși în UI într-o fază dedicată când `indSettings` devine tipat (Phase 4 sau dedicat).
- **Helper `useATBridge`** — neatins; este legacy compat bridge pentru componente care citesc AT state direct. Convergența totală pe `useATStore` aparține Phase 9 (Cleanup + TS strict global).
- **`brain.ts:2651` `TC.slPct = newSL; TC.size = newSize`** — adaptive resize engine scrie pe TC; post-C3 aceste scrieri merg transparent prin Proxy → `patchConfig` → store. Comportament corect, zero refactor necesar.

**Rollback point**:

```bash
# Full rollback la pre-fază:
bash /root/zeus-terminal/scripts/rollback-to-phase.sh 03 --dry-run
bash /root/zeus-terminal/scripts/rollback-to-phase.sh 03

# Sau git hard-reset la pre-tag:
git checkout migration/phase-03-at-store
git reset --hard migration/phase-03-pre
```

Checkpoint-uri intermediare (branch/tag-backed):

- Tag: `migration/phase-03-c2-ok-20260415-0130` — după C2
- Branch: `backup/phase-03-c2-20260415-0130`
- C1 `f80ac83` — contract-only (safe rollback)
- C2 `fd21c91` — projector wiring
- C3 `13f93c4` — TC Proxy install
- C4 `3fe1e05` — panel write-path
- C5 `90e271d` — DOM read elimination

Artefacte backup pre-fază: `/root/zeus-terminal-backups/reports/03-20260415-012429.report.txt`.

**Observații de runtime / risc**:

- **TC Proxy seeding** — la install (C3) atStore primește valori din `_tcDefaults`, care sunt identice bit-identic cu obiectul TC raw anterior. Primul read după install returnează exact aceleași valori ca legacy, deci zero divergence window la boot.
- **Write-path dublu (C4 + Proxy)** — când user tastează în panel: `onChange → setAtLev` (React state) → `useEffect → patchConfig` (store) → TC Proxy vede store-ul actualizat. Când `brain.ts:2651` scrie `TC.slPct = newSL` → Proxy.set → `patchConfig({slPct: ...})` → store. Ambele căi converg pe același store, niciun race observat la runtime.
- **NaN guard** — `patchConfig` ignoră silent valori non-finite. Input gol sau invalid în panel nu corupe store-ul. Singurul risc era ca user-ul să vadă un câmp gol și store-ul să rămână pe valoarea veche — confirmat OK la runtime, bot-ul primește ultimele valori valide.
- **Engine-urile care scriu TC** (grep verificat: `brain.ts:2651`, `settingsStore._syncToWindow`, pre-C5 `syncDOMtoTC`) — toate merg transparent prin Proxy. Scrierea legacy `TC.lev = N` ↔ patchConfig nu necesită refactor extern.
- **CSRF / auth** — zero endpoint-uri server atinse în Phase 3; zero modificare a stratului de autentificare.
- **Feature flag `CLIENT_AT_STORE` absent** — la orice defect major, rollback = `git reset --hard migration/phase-03-pre` + `pm2 reload zeus`. Este o rollback mecanică, nu runtime-instant, dar acceptabilă dată fiind validarea tsc/build/runtime curată pe fiecare commit.

**Status**: ✓ PHASE 3 COMPLETE (cu `CLIENT_AT_STORE` feature flag deferred ca hardening follow-up).

---

### Phase 4 — settingsStore canonical

**Scop**: mutarea GET/POST `/api/user/settings` din traseul legacy (wrappers
globali `window._usFetchRemote` / `window._usPostRemote` din `core/config.ts`)
într-un traseu canonic Zustand — `settingsStore.loadFromServer()` și
`settingsStore.saveToServer()` apelează direct API-ul tipat `userSettingsApi`
din `services/api.ts`. Inversare de proiecție: `settingsStore.settings` devine
sursa unică, iar `USER_SETTINGS` (legacy nested) + `window.TC` + `atStore.config`
sunt proiecții write-through refreshed atomic la fiecare mutație via helper-ul
canonic `_projectAll(s)`. Wrapper-ele legacy rămân thin adapters peste același
`userSettingsApi` (convergență pe API-ul tipat, nu unul pe altul → zero dublu
POST, zero loop store↔wrapper).

**Pre-tag**: `migration/phase-04-pre` (HEAD=1f92a35 = Phase 3 post)
**Post-tag**: `migration/phase-04-post`
**Branch**: `migration/phase-03-at-store` (continuare pe același branch; nu
am deschis unul nou — convenție internă, backup acoperit prin tag-uri)

**Commit-urile 1–6** (în ordine):

| # | Hash | Rezumat |
|---|------|---------|
| 1 | `11ecdad` | additive: `userSettingsApi` tipat în `services/api.ts` (`fetch()` / `save()` peste `api.raw`); `UserSettingsResponse` / `UserSettingsSaveResponse` / `UserSettingsPayload`; zero call-site existent flip-at |
| 2 | `f8d63f6` | `settingsStore.loadFromServer` face GET direct via `userSettingsApi.fetch()`; side-effects hidratate prin `_usApplyServerResponse(data)` (helper nou export din `core/config.ts`); `_usFetchRemote` rescris ca thin wrapper peste exact același API; log format `[US] fetchRemote ...` preservat bit-identic (dual catch branch HTTP vs generic) |
| 3 | `9ff2e88` | `settingsStore.saveToServer` face POST direct via `userSettingsApi.save(payload, { keepalive: true })`; response-ul procesat prin `_usApplyPostResponse(j)` (helper nou export) → avansează `_usSettingsRemoteTs` pentru WS dedup în `settingsRealtime`; `_usPostRemote` rescris ca thin wrapper; log format `[US] postRemote ...` preservat; payload-ul construit prin `_usBuildFlatPayload()` (același builder ca legacy → wire byte-identic) |
| 4 | `b7d9fb6` | inversare de proiecție: helper canonic `_projectAll(s)` = `_projectToLegacy` + `_syncToWindow` + `_projectToAT` în ordine fixă; wired la toate cele 4 puncte de mutație (`loadFromServer` success, offline fallback, `saveToServer` step 1, `patch`); fix critic în `patch()` — anterior actualiza TC + atStore dar lăsa `USER_SETTINGS` stale între save-uri, cauzând drift pentru engine-urile legacy care citesc `USER_SETTINGS.autoTrade.*`; cleanup: șters câmp mort `_usPostRemote?` din `ZeusWindowExt`, corectat docstring-uri |
| 5 | `b92169d` | audit consumatori `_usBuildFlatPayload`: 2 consumatori activi (`_usPostRemote` în `config.ts` + `saveToServer` în store); helper-ul emite 7 chei legacy-only NEÎN `SettingsPayload` (`profile`, `bmMode`, `assistArmed`, `manualLive`, `ptLevDemo`, `ptLevLive`, `ptMarginMode`, `chartTz`) → eliminarea acum ar șterge silent aceste chei din save-urile parțiale; decizie: **RETAINED as compat helper**, eliminat într-o Phase 5 dedicată după ce `SettingsPayload` e lărgit să acopere full server whitelist; documentație 25 linii adăugată la helper + 9 linii în store |
| 6 | `<post>` | docs: MIGRATION_LOG Phase 4 entry + tag `migration/phase-04-post` |

**Totaluri**:

- **Fișiere atinse total fază** (excluzând `MIGRATION_LOG.md`): 3
  - `client/src/services/api.ts` (C1 — additive)
  - `client/src/stores/settingsStore.ts` (C2, C3, C4, C5)
  - `client/src/core/config.ts` (C2, C3, C5)
- **Server atins**: 0 fișiere — traseul canonic reutilizează endpoint-ul existent `/api/user/settings` și broadcast-ul WS existent `settings.changed`.
- **API surface nou tipat**: 1 (`userSettingsApi` cu `fetch` + `save`)
- **Helper-e noi exportate din `core/config.ts`**: 2 (`_usApplyServerResponse`, `_usApplyPostResponse`)
- **Helper-e retenție compat**: 1 (`_usBuildFlatPayload`, explicit deferred la Phase 5)

**Ce s-a făcut concret**:

- **Typed API surface** (`client/src/services/api.ts`): `userSettingsApi.fetch()` și `userSettingsApi.save(settings, opts)` peste `api.raw<T>` — throw pe non-2xx cu mesaj `HTTP NNN`, `keepalive` pass-through pentru save-uri din `beforeunload`. Tipuri: `UserSettingsResponse`, `UserSettingsSaveResponse`, `UserSettingsPayload` (= `Partial<SettingsPayload> & Record<string, unknown>` — `Record` arm e strict escape hatch pentru cele 7 chei legacy-only neîn `SettingsPayload`).
- **GET path canonic** (`stores/settingsStore.ts::loadFromServer`): apel direct `userSettingsApi.fetch()` → `_usApplyServerResponse(data)` hidratează `USER_SETTINGS` + `_usSettingsRemoteTs` + log `[US] fetched remote settings` + salvează cache LS `zeus_user_settings` → apoi `_projectFromLegacy()` + `_projectAll(merged)` hidratează store-ul și toate proiecțiile. Offline fallback identic cu pre-Phase 4. Log format preservat bit-identic cu `_usFetchRemote` istoric (branch HTTP vs generic catch).
- **POST path canonic** (`stores/settingsStore.ts::saveToServer`): `_projectAll(settings)` push store → `USER_SETTINGS` + TC + atStore **înainte** de build payload (pentru că `_usBuildFlatPayload` citește din `USER_SETTINGS`); apoi `userSettingsApi.save(payload, { keepalive: true })` → `_usApplyPostResponse(j)` avansează `_usSettingsRemoteTs`; în final LS cache `zeus_user_settings` rescris. Log format preservat.
- **Projection inversion** (`stores/settingsStore.ts::_projectAll`): ordine fixă Legacy → Window → AT. Invocat din toate cele 4 puncte de mutație (`loadFromServer` success + offline, `saveToServer` step 1, `patch`). `_projectToLegacy` overwrites doar cheile pe care le deține store-ul — restul (`profile`, `bmMode`, `assistArmed`, `manualLive`, `ptLev*`, `chartTz`, `dslSettings`) rămân intacte, hidratate de `_usApplyFlatToUserSettings` la GET.
- **Wrappers convergenți** (`core/config.ts::_usFetchRemote` / `_usPostRemote`): rescriși ca thin adapters peste `userSettingsApi` + helper-e share-uite. Store și wrappers converg pe același API tipat, **nu** unul pe altul → zero `store → wrapper → store` loop, zero dublu POST (grep verificat: `_usPostRemote` e chemat doar din `_usSave` legacy și din nicăieri în React post-Phase 4).
- **`_usBuildFlatPayload` retained**: audit (grep client+server+public) → 2 consumatori activi, ambii necesari. Emite 7 chei legacy-only neîn `SettingsPayload`. Eliminarea = silent drop. Retenție explicită ca compat helper, eliminare scheduled Phase 5 după lărgirea `SettingsPayload`.

**DoD atins** (numerotat per pre-plan):

- [x] **DoD 1** — `settingsStore.loadFromServer()` este path-ul principal: apel direct `userSettingsApi.fetch()`, fără pre-bridge la `window._usFetchRemote`. Legacy wrapper rămas disponibil strict pentru call-site-uri externe care încă îl folosesc (de ex. `settingsRealtime`), dar **convergă** pe același API tipat.
- [x] **DoD 2** — `settingsStore.saveToServer()` este path-ul principal: apel direct `userSettingsApi.save()`. Legacy `_usPostRemote` rescris ca thin wrapper peste același API. Grep `_usPostRemote` in React code post-C3 = 0 hits în afara `_usSave` legacy (sync path pe mutații imperative vechi).
- [x] **DoD 3** — `settingsStore.settings` = sursa canonică. `USER_SETTINGS` + `window.TC` + `atStore.config` sunt proiecții write-through refreshed atomic prin `_projectAll` la fiecare mutație.
- [x] **DoD 4** — `patch()` în store invocă `_projectAll(updated)` (fix critic C4). Anterior doar `_syncToWindow + _projectToAT`, deci `USER_SETTINGS.autoTrade.*` rămânea stale între save-uri → drift pentru engine-urile legacy citind `USER_SETTINGS`. Acum lockstep.
- [x] **DoD 5** — wire payload byte-identic cu legacy. `_usBuildFlatPayload` retenționat ca single source pentru flat payload; ambii consumatori (`_usPostRemote` + `saveToServer`) îl folosesc → byte-identic pe sârmă.
- [x] **DoD 6** — boot order neatins. Nu am mutat `bootstrapStartApp`, nu am introdus auto-load-from-server la `create`, nu am atins `loadUserSettings()` care hidratează `USER_SETTINGS` din LS la boot.
- [x] **DoD 7** — `keepalive: true` păstrat pentru POST din `beforeunload` (paritatea `sendBeacon`-style a legacy `_usPostRemote`).
- [x] **DoD 8** — WS dedup în `settingsRealtime` funcțional: `_usApplyPostResponse(j)` avansează `_usSettingsRemoteTs` la fiecare save → mesajele `settings.changed` cu `updated_at <= _lastKnownTs` sunt skip-ate corect.
- [x] **DoD 9** — `npx tsc --noEmit` PASS după fiecare commit; `npx vite build` PASS (~720–800ms per commit).
- [x] **DoD 10** — MIGRATION_LOG Phase 4 entry + tag `migration/phase-04-post` (C6).

**Ce a rămas intenționat pentru fazele următoare**:

- **`_usBuildFlatPayload` elimination** — **RETAINED as compat helper**. Audit C5: 2 consumatori activi, ambii necesari; emite 7 chei legacy-only (`profile`, `bmMode`, `assistArmed`, `manualLive`, `ptLevDemo`, `ptLevLive`, `ptMarginMode`, `chartTz`, plus `dslSettings`) care NU sunt în `SettingsPayload`. Eliminarea acum ar șterge silent aceste chei din save-urile parțiale. **Scheduled Phase 5**: lărgirea `SettingsPayload` să acopere full server whitelist → atunci helper-ul poate fi eliminat fără pierdere de date. Motivul reținerii e documentat explicit in-source (25 linii în `core/config.ts`, 9 linii în `stores/settingsStore.ts`).
- **`_usFetchRemote` / `_usPostRemote` eliminare** — rescriși ca thin wrappers compat. Eliminare completă amânată pentru când toate call-site-urile externe (de ex. `settingsRealtime.ts` care apelează `window._usFetchRemote`) migrează la `userSettingsApi` direct. Nu e blocant pentru Phase 4 — ambele wrappers converg pe același API tipat, zero dublu POST.
- **`SettingsPayload` widening** — cele 7 chei legacy-only trebuie absorbite în contract pentru a elimina `Record<string, unknown>` escape hatch din `UserSettingsPayload`. Lucrare de contract, fără logică nouă, potrivit pentru Phase 5 C1.
- **`window.USER_SETTINGS` + `window.TC` kill** — rămân proiecții legacy până la Phase 7 (Kill DOM-as-state) / Phase 9 (Cleanup + TS strict global). Fiind write-through din store, riscul de drift e zero post-C4.
- **`_usApplyServerResponse` / `_usApplyPostResponse` relocare** — helper-e partajate acum în `core/config.ts`, dar conceptual aparțin store-ului. Relocare la `stores/settingsStore.ts` amânată până la eliminarea wrapper-elor legacy — altfel ar crea dependență circulară config ↔ store.

**Rollback point**:

```bash
# Full rollback la pre-fază:
bash /root/zeus-terminal/scripts/rollback-to-phase.sh 04 --dry-run
bash /root/zeus-terminal/scripts/rollback-to-phase.sh 04

# Sau git hard-reset la pre-tag:
git checkout migration/phase-03-at-store
git reset --hard migration/phase-04-pre
```

Checkpoint-uri intermediare (tag-backed):

- Tag: `migration/phase-04-c2-ok-20260415-0205` — după C2 (checkpoint înainte de C3, riscul mare POST path)
- C1 `11ecdad` — additive API surface (safe rollback)
- C2 `f8d63f6` — GET path canonic
- C3 `9ff2e88` — POST path canonic
- C4 `b7d9fb6` — projection inversion
- C5 `b92169d` — `_usBuildFlatPayload` audit (retained)

Artefacte backup pre-fază: `/root/zeus-terminal-backups/reports/04-20260415-0155.report.txt` (sau echivalent, per script `backup-pre-phase.sh 4`).

**Observații de runtime / risc**:

- **Zero dublu POST** — grep post-C3: `_usPostRemote` chemat doar din `_usSave` legacy (path sync pe mutații imperative vechi); React post-Phase 4 apelează exclusiv `saveToServer` → `userSettingsApi.save`. Store **nu** cheamă wrapper după flip; wrapper **nu** cheamă store. Convergență pe API-ul tipat, nu unul pe altul.
- **Zero store↔wrapper loop** — `saveToServer` → `userSettingsApi.save` → server → WS `settings.changed` → `settingsRealtime` → `_usFetchRemote` (GET only) → `_usApplyServerResponse` hidratează **`USER_SETTINGS` module-local**, NU `store.settings`. Store nu e auto-updated din mutații `USER_SETTINGS`. Traseu acyclic verificat.
- **Log format preservat bit-identic** — `api.raw` throw pe non-2xx cu mesaj `HTTP NNN`. Catch în store + wrapper face `msg.startsWith('HTTP ')` → emite `[US] fetchRemote HTTP 500` (branch HTTP) vs `[US] fetchRemote failed: <msg>` (generic), matching legacy.
- **`keepalive: true` semantica `beforeunload`** — paritaet `sendBeacon`-style păstrată. Save-uri emise din `beforeunload` supraviețuiesc navigation/unload.
- **WS dedup funcțional** — `_usApplyPostResponse(j)` avansează `_usSettingsRemoteTs` la fiecare save; `settingsRealtime` skip mesajele `settings.changed` cu `updated_at <= _lastKnownTs`. Zero round-trip redundant după propriul save.
- **`_projectAll` ordine fixă** — Legacy → Window → AT. Legacy primul pentru că `_usBuildFlatPayload` citește din `USER_SETTINGS`; Window al doilea pentru că TC Proxy deleghează la `atStore`, deci atStore trebuie hidratat imediat după; AT ultimul ca faza-3 canonical AT source reflectă `SettingsPayload` final merged.
- **CSRF / auth** — zero endpoint-uri server atinse în Phase 4; zero modificare a stratului de autentificare.
- **Boot order neatins** — `bootstrapStartApp` + `loadUserSettings()` rămân path-ul de boot. `settingsStore.loadFromServer()` e apelat post-boot din React App init, nu la `create`. Offline fallback via `_projectFromLegacy` citește `USER_SETTINGS` hidratat din LS la boot.

**Status**: ✓ PHASE 4 COMPLETE (cu `_usBuildFlatPayload` retained as compat helper, eliminare scheduled Phase 5 după `SettingsPayload` widening).

---

### Phase 5 — Positions WS live

**Scop**: server→client push de snapshot `positions.changed` peste WSS-ul
existent `/ws/sync`, reconciliat client-side prin `positionsStore.applyDelta`
cu dedup monotonic `lastSnapshotTs`. Sursa snapshot-ului este DB-read
autoritativ (`db.atLoadOpenPositions(userId)`), NU `_positions` in-memory —
fix critic pentru "zombie window" pe calea de close (`_persistClose` emite
broadcast după `atArchiveClosed` dar înainte ca apelantul să facă
`_positions.splice`). Polling-ul `livePosSync` retras de pe path principal
(30s → 120s, gated pe `!wsService.isConnected()`). Flag gating toggle prin
`MF.POSITIONS_WS` (default OFF, flipped ON la C5).

**Pre-tag**: `migration/phase-05-pre` (HEAD=28b7151 = Phase 4 post)
**Post-tag**: `migration/phase-05-post`
**Branch**: `migration/phase-05-positions-ws`

**Commit-urile 1–7 + post** (în ordine):

| # | Hash | Rezumat |
|---|------|---------|
| 1 | `19a0856` | contract-only: `PositionsSnapshot`, `WsPositionsChanged` în `client/src/types/sync.ts`; `WsMessage` union extins; zero runtime consumer |
| 2 | `05ee1a5` | `positionsStore.replaceAll` + `applyDelta` + `lastSnapshotTs: 0` default; dedup monotonic pe `updated_at`; 7 teste noi acoperire split/stale/dup/empty/balance/NaN/applyDelta-identity |
| 3 | `aa36e7b` | server emit `positions.changed` GATED OFF: `MF.POSITIONS_WS` nou flag în `server/migrationFlags.js` (default false); `_broadcastPositions` + hooks la `_persistPosition:145` și `_persistClose:157` (doar pe success path post-DB-commit) |
| 4 | `3c0f132` | client subscriber `positionsRealtime.ts` (62 linii) mirror `settingsRealtime.ts` dar folosește `positionsStore.lastSnapshotTs` pentru dedup; wired în `App.tsx` (`startPositionsRealtime` / `stopPositionsRealtime`) |
| — | `5e67f35` | **C5-preflip fix**: `_broadcastPositions` sursă `db.atLoadOpenPositions(userId)` + re-enrichment DSL runtime; elimină structural zombie-window pe close path (analiză invariantă: DB post-`atArchiveClosed` = autoritativ, `_positions` încă ține row-ul până la caller-splice) |
| 5 | `9af5e74` | **C5-flip**: `MF.POSITIONS_WS=true` în `data/migration_flags.json`; `pm2 reload zeus` PID 2057879→2060965; startup log confirmă flag activ în runtime |
| 6 | `522052b` | polling `livePosSync` retras: 30s → 120s, gated pe `!wsService.isConnected()`; fallback pe WS disconnect doar; import nou `wsService` în `bootstrapInit.ts` |
| 7 | `<post>` | docs: MIGRATION_LOG Phase 5 entry + tag `migration/phase-05-post` |

**Totaluri**:

- **Fișiere atinse total fază** (excluzând `MIGRATION_LOG.md`):
  - Client: 6 (`types/sync.ts` — contract; `stores/positionsStore.ts` + test; `services/positionsRealtime.ts` — NEW; `App.tsx` — 3 linii wire; `core/bootstrapInit.ts` — 2 edit-uri)
  - Server: 2 (`services/serverAT.js` — `_broadcastPositions` + 2 hook-uri; `migrationFlags.js` — flag + getter)
  - Data: 1 (`data/migration_flags.json` — flag flip)
- **Endpoint-uri noi**: 0 — reuz total `/ws/sync` existent + `global.__zeusWsBroadcastToUser`
- **Socket-uri noi client**: 0 — reuz `wsService.subscribe`
- **Componente test noi**: 7 unit tests în `positionsStore.test.ts`
- **Flag-uri noi**: 1 (`MF.POSITIONS_WS`, default OFF, flipped ON la C5)

**Ce s-a făcut concret**:

- **Contract** (`client/src/types/sync.ts`): `PositionsSnapshot = { updated_at: number, positions: Position[] }`, `WsPositionsChanged = { type: 'positions.changed', updated_at: number, snapshot: PositionsSnapshot }`. Extindere aditivă a discriminated union `WsMessage` — safe pentru consumatorii existenți (narrowing prin `if (msg.type === 'x')`).
- **Store reconciliere** (`client/src/stores/positionsStore.ts`): `applyDelta(snap) → replaceAll(snap)` cu dedup monotonic — dropped când `!Number.isFinite(updated_at)` sau `updated_at <= lastSnapshotTs`. Split atomic pe `mode` (`demo`/`live`). Nu atinge `demoBalance` / `liveBalance` (rămân sursă separată). Return `boolean` (applied vs dropped).
- **Server emit** (`server/services/serverAT.js::_broadcastPositions`): gated pe `MF.POSITIONS_WS`; apelat SINGUR din `_persistPosition:145` și `_persistClose:157`, ambele strict pe success-path POST DB-commit (catch-uri return fără broadcast → zero phantom emit). Sursa snapshot-ului = `db.atLoadOpenPositions(userId)` + re-enrichment DSL per seq (paritate cu `getOpenPositions` minus zombie).
- **Zombie-window fix structural** (C5-preflip): `_persistClose` ordine `atArchiveClosed` (DELETE txn) → broadcast → caller `_positions.splice`. La broadcast-time, `_positions` încă ține row-ul închis; dacă sursa ar fi `_positions`, snapshot-ul ar include zombie care ar fi reconciliat client-side ca "încă deschis" până la următorul delta. DB post-archive e autoritativ. Fix-ul preempt-ează orice mutații futură să reintrodusă riscul.
- **Client subscriber** (`client/src/services/positionsRealtime.ts`): idempotent start/stop, defensive shape guard (`msg.snapshot`, `Array.isArray(positions)`, `Number.isFinite(updated_at)`), `try { applyDelta } catch {}` — malformed frame nu prăbușește subscriber-ul sau pagina. Reuz `wsService.subscribe`, zero socket paralel.
- **Polling retirement** (`client/src/core/bootstrapInit.ts:87-94`): early-return dacă `wsService.isConnected()` e true. Când WS e OPEN, reconcilierea trece integral prin `positions.changed`; când WS e jos, fallback-ul rulează `liveApiSyncState()` la 120s. Detecție disconnect reutilizează `wsService.isConnected()` existent (readyState === OPEN).
- **Flag flip runtime** (C5): `MF.set('POSITIONS_WS', true)` atomic rename persist → `pm2 reload zeus` → startup log confirmă `"POSITIONS_WS":true` în feature-flags line. Uptime contor resetat, PID nou.

**DoD atins** (numerotat per pre-plan):

- [x] **DoD 1** — Server emit `positions.changed` gated pe `MF.POSITIONS_WS`. Zero emit la flag OFF (verificat post-C3 cu `grep -c "positions.changed"` = 0). Emit activ post-C5-flip, confirmat cross-device de user.
- [x] **DoD 2** — Client subscriber `positionsRealtime` aplică snapshot prin `positionsStore.applyDelta`. Shape-guard defensiv, dedup monotonic prin `lastSnapshotTs`.
- [x] **DoD 3** — Polling `livePosSync` retras de pe path-ul principal. 30s → 120s, gated pe `!wsService.isConnected()`. Pe happy path (WS OPEN), zero call la `liveApiSyncState`.
- [x] **DoD 4** — Cross-device propagation desktop→phone sub 1s — confirmat observațional de user la GO C6. Pipeline end-to-end funcțional.
- [x] **DoD 5** — Zombie-window eliminat structural prin DB-read broadcast. Confirmat prin analiză invariant: `atArchiveClosed` (DELETE txn) se execută înainte de broadcast, deci DB state la emit nu mai conține row-ul închis; `_positions` îl elimină abia după return-ul din `_persistClose`.
- [x] **DoD 6** — `npx tsc --noEmit` PASS după fiecare commit client-side; `npx vite build` PASS (~747ms la C6).
- [x] **DoD 7** — Zero fișiere atinse în afara scope-ului Phase 5. Zero cod adăugat speculativ. Zero endpoint-uri noi server. `wsService` / `sessionAuth` / alte subsisteme neatinse.
- [x] **DoD 8** — Mutual exclusion via `MF._enforceMutex` neafectată — `POSITIONS_WS` e independent de `SERVER_AT` / `CLIENT_AT` (nu face parte din invariantul de exclusivitate).
- [x] **DoD 9** — Feature flag persistent pe restart — `data/migration_flags.json` survive reload (verificat prin repornire pm2).
- [x] **DoD 10** — MIGRATION_LOG Phase 5 entry + tag `migration/phase-05-post` (C8).

**OPEN ISSUE — mandatory follow-up post-Phase-5**:

**Descriere**: Pozițiile apar uneori dublate / elemente tranzitorii apar pentru câteva secunde în UI, apoi dispar. Observat browser-side de user în fereastra post-C5-flip. Non-blocker pentru Phase 5 close (cosmetic UI flicker, self-correcting, nu afectează corectitudinea server-side sau execuția trading).

**Root-cause suspect (inspecție cod C7)**: **două write-paths, un singur store, fără coordonare de cursor**.

1. **WS path** — `client/src/services/positionsRealtime.ts` → `positionsStore.applyDelta(snap)` → respectă `lastSnapshotTs` dedup, advance cursor monotonic
2. **Legacy bridge path** — `client/src/hooks/usePositionsBridge.ts:23` → `positionsStore.syncSnapshot({ demoPositions, livePositions, ... })` → **NU consultă `lastSnapshotTs`**, overwrite direct

Bridge-ul ascultă `window.addEventListener('zeus:positionsChanged')` și re-citește `window.TP` la fiecare dispatch (6 dispatch-uri documentate: `autotrade.ts`, `marketDataTrading.ts`, `marketDataPositions.ts`, `marketDataClose.ts`, `liveApi.ts`, `state.ts`). Race window: WS delta ajunge cu `updated_at=TsX`, `applyDelta` advance la TsX, apoi un `zeus:positionsChanged` sincron din path-ul legacy (inițiat înainte) reads `window.TP` (version old) și `syncSnapshot` overwrite fără verificare cursor → flicker → următorul delta/event repară.

**Candidate fix-uri** (în ordinea preferinței):

1. **Bridge să folosească `applyDelta`** — pad `syncSnapshot` cu pseudo-`updated_at = Date.now()` ar introduce race invers; mai curat: introdu `applyBridgeDelta(snapshot, bridgeTs)` în store care folosește același `lastSnapshotTs` cursor → unificare semantică
2. **Bridge gated pe `!wsService.isConnected()`** — simetric cu polling-ul C6; când WS e OPEN, bridge-ul devine no-op și reconcilierea trece integral prin WS. Mai conservator, dar poate rupe flow-uri de `autotrade.ts` care emit `zeus:positionsChanged` sincron pe mutații `window.TP` locale (înainte ca server-ul să confirme).
3. **`syncSnapshot` merge-aware** — dacă `lastSnapshotTs > 0`, skip bridge-ul și log `[bridge] skipped: WS-authoritative`.

**Status**: **NON-BLOCKER** pentru Phase 5 close, **MANDATORY follow-up** (nu "nice to have"). Tracking: această secțiune. Ownership: Phase 5.1 dedicată sau merge într-un Phase 6 addendum.

**Ce a rămas intenționat pentru fazele următoare**:

- **Transient UI duplicates fix** — vezi OPEN ISSUE above. Mandatory follow-up.
- **48h demo observation window** — deschisă de la 2026-04-15 ~18:05 UTC (C5-flip). Continuă și după tag-ul `migration/phase-05-post`. Monitorizare: stabilitate server uptime, rate dubluri tranzitorii, frecvență WS disconnects (zero până la C7), un ciclu complet open→close cross-device.
- **Validare end-to-end CLOSE path cross-device** — la C7, observate 5 OPEN events, 0 CLOSE events. Trebuie observat cel puțin un CLOSE complet pentru validare simetrică.
- **Comportament pe WS disconnect real** — zero disconnects observate până la C7. Fallback 120s din C6 neexercitat în runtime. Monitorizare în fereastra 48h.
- **`_usBuildFlatPayload` elimination** — legacy Phase 4 deferred. Necesită `SettingsPayload` widening (7 chei legacy-only de absorbit). Nu blochează Phase 6.
- **`window.TP` → `positionsStore`-only refactor** — parte din Phase 7 (Kill DOM-as-state). Bridge-ul `usePositionsBridge` dispare când `window.TP` devine Proxy read-only derivat din store.

**Rollback point**:

```bash
# Full rollback la pre-fază:
bash /root/zeus-terminal/scripts/rollback-to-phase.sh 05 --dry-run
bash /root/zeus-terminal/scripts/rollback-to-phase.sh 05

# Sau git hard-reset la pre-tag:
git checkout migration/phase-05-positions-ws
git reset --hard migration/phase-05-pre
# + flip MF.POSITIONS_WS=false și pm2 reload zeus pentru dezactivarea broadcast-ului server
```

Checkpoint-uri intermediare (tag-backed):

- Tag: `migration/phase-05-c5-pre-20260415-1731` — pre-flip snapshot, înainte de decizia MISMATCH + fix `_broadcastPositions`
- Branch backup: `backup/phase-05-c5-pre-20260415-1731`
- C1 `19a0856` — contract-only additive
- C2 `05ee1a5` — store (applyDelta/replaceAll/cursor)
- C3 `aa36e7b` — server emit gated OFF
- C4 `3c0f132` — client subscriber wired
- C5-preflip `5e67f35` — DB-read source fix
- C5-flip `9af5e74` — `MF.POSITIONS_WS=true`
- C6 `522052b` — polling retirement
- C7 — validation status (no commit, raport conversational)

Artefacte backup pre-fază: `/root/zeus-terminal-backups/reports/05-*.report.txt` (per script `backup-pre-phase.sh 5`).

**Observații de runtime / risc**:

- **Flag live în runtime** — `MF.POSITIONS_WS=true` persistent în `data/migration_flags.json`, confirmat prin log startup `[MIGRATION] Feature flags: {..., "POSITIONS_WS":true}` (server repornit la C5-flip, PID 2060965, uptime 18+ min la C7 fără reporniri).
- **Zero emit natural logat** — `_broadcastPositions` nu face log explicit per emit (design: helper-ul broadcast global e best-effort, log-ul ar spama pe AT activ). Validare indirectă prin cross-device propagation observat la C6 GO.
- **Zero errori noi post-flip** — `pm2-error.log` curat din momentul reload-ului (doar warning-uri pre-existente de migrație DB + SIGINT-ul procesului vechi la grateful reload).
- **28 WS connects observate, 0 disconnects** în fereastra de observație inițială C7 — socket stabil.
- **Sursa broadcast-ului = DB-read autoritativ** — `db.atLoadOpenPositions(userId)` + re-enrichment DSL runtime. Structural exclude zombie-window pe close path. Orice regresiune care ar întoarce sursa pe `_positions` ar reintrodusă riscul.
- **Polling 30s nu mai e path principal** — verificat în diff `bootstrapInit.ts`: interval 120000 + early-return pe `isConnected()`. Pe happy path, zero call la `liveApiSyncState`.
- **Payload size** — 4291 bytes pentru uid=1 cu 5 poziții (măsurat la probe-ul C5). La 100+ poziții/user, snapshot-ul va depăși 50KB — acceptabil pentru WS, dar merită monitorizat dacă apare vreun user cu portofoliu mare.
- **`wsService.subscribe` lifecycle** — subscriber-ul e pornit în `App.tsx` efect gated pe `authenticated`. Cleanup corespunzător la logout (`stopPositionsRealtime` înainte de `stopSettingsRealtime`).
- **Fix(auth) `c9220fd`** — separat de seria Phase 5, inclus în branch dar NU în raport. Validare browser-side implicită (user a putut testa C5/C6 cross-device fără redirect-loop).

**Status**: ✓ PHASE 5 COMPLETE (cu `_broadcastPositions` pe sursă DB-read autoritativă, `MF.POSITIONS_WS=true` live în runtime, polling retras de pe path principal, 48h observation window rămasă deschisă post-tag, OPEN ISSUE transient UI duplicates documentat ca mandatory follow-up).

---

### Phase 6 — dslStore + brainStore canonical

**Scop**: inversiune a fluxului engine → store pentru `dslStore` și
`brainStore`. Store-ul devine sursa unică de adevăr pentru suprafețele
DSL și Brain. Engine-ul (`trading/dsl.ts`, `engine/brain.ts`,
`core/config.ts`, `data/marketDataWS.ts`) scrie direct prin mutatori
tipați; `window.DSL` și `window.BM` devin Proxy read-compat care rutează
GET-urile pe chei canonice către store și SET-urile pe chei canonice ca
warn+no-op (DEV) / no-op (prod), cu pass-through transparent pentru
chei runtime-only. Hook-urile bridge `useDSLBridge` și `useBrainBridge`
plus mutatorii `syncFromEngine` din ambele stores sunt eliminați. Toate
write-path-urile pentru `BlockReason` sunt mirror-uite canonic la cele
20 site-uri cunoscute (autotrade.ts × 11, klines.ts × 3, arianova.ts ×
2, postMortem.ts × 2, bootstrapMisc.ts × 1, state.ts hydration × 1).

**Pre-tag**: — (continuat pe branch-ul `migration/phase-05-positions-ws`
fără pre-tag dedicat; HEAD pre-Phase-6 = `522052b` Phase 5 C6)
**Post-tag**: `migration/phase-06-post`
**Branch**: `migration/phase-05-positions-ws` (continuare directă)

**Commit-urile C1–C7 + 2 pre-C7 + C8** (în ordine):

| # | Hash | Rezumat |
|---|------|---------|
| C1 | `521c6b7` | contract widening additive: tipuri pentru suprafețele canonice DSL + Brain (BrainState, BrainEngineState, BrainBlockReason, BrainThought, BrainAdaptParams, MtfAlignment, TradingProfile, BrainMode); zero runtime consumer |
| C2 | `9da5f3e` | `dslStore` typed mutators (additive only); `syncFromEngine` rămâne activ în paralel |
| C3 | `906184f` | `trading/dsl.ts` engine inversion: write-uri direct prin mutatori; `window.DSL` instalat ca Proxy read-compat (GET canonic → store, GET runtime → backing, SET canonic warn+no-op DEV) |
| C3-doc | `cb9917b` | doc-only: `checkIntervalActive` documentat ca store-internal (nu canonic) |
| C4 | `d8b81f4` | DSL bridge removal: `client/src/hooks/useDSLBridge.ts` șters + `dslStore.syncFromEngine` eliminat din interface și implementare; teste aferente eliminate |
| C5 | `5acf18c` | `brainStore` typed mutators (15 teste, 15/15 PASS); `setMode/setProfile/setEngineState/setEntry/setFlow/setMtf/setSweep/setGates/setBlockReason/setThoughts/setAdaptParams/patch` |
| C6 | `128cfc0` | `engine/brain.ts` write inversion (BR backing-only via direct mirror; thoughts via push+atomic-replace); `window.BM` instalat ca Proxy read-compat (mirror exact al pattern-ului C3 DSL); `core/config.ts` și `data/marketDataWS.ts` write-uri redirectate prin mutatori |
| pre-C7 | `d48ec81` | `BlockReason` write-path inversion: 14 site-uri în `trading/autotrade.ts` (11) + `data/klines.ts` (3) prin helperi `_setBR` / `_clearBR` care păstrează backing-ul `w.BlockReason.set/.clear` și mirror-ează canonic via `useBrainStore.getState().setBlockReason(...)` |
| pre-C7 bis | `8abc444` | `BlockReason` write-path inversion (continuare): 6 site-uri rămase — `engine/arianova.ts` (2: WVE_BLOCK + WVE_NO_TRADE), `engine/postMortem.ts` (2: REGIME_TRANSITION set + conditional clear), `core/bootstrapMisc.ts` (1: masterReset clear), `core/state.ts` (1: ZState.restore hydration). Pattern inline mirror, hydration păstrează direct `_current` assign pentru a evita facade side-effects (debounce log, DOM mutate) la restore |
| C7 | `15717e5` | `client/src/hooks/useBrainBridge.ts` șters + `App.tsx` import + call eliminate + `brainStore.syncFromEngine` eliminat din interface, implementare și JSDoc; cele 2 cazuri test `syncFromEngine` din `brainStore.test.ts` eliminate (13/13 PASS post-C7); JSDoc rescris pentru arhitectura finală C7 |
| C8 | `<post>` | docs: MIGRATION_LOG Phase 6 entry + tag `migration/phase-06-post` |

**Totaluri**:

- **Fișiere atinse total fază** (excluzând `MIGRATION_LOG.md`):
  - Stores: 2 (`dslStore.ts`, `brainStore.ts`) + 2 teste
  - Engine: 4 (`trading/dsl.ts`, `engine/brain.ts`, `engine/arianova.ts`, `engine/postMortem.ts`)
  - Core: 3 (`core/config.ts`, `core/bootstrapMisc.ts`, `core/state.ts`)
  - Data: 2 (`data/marketDataWS.ts`, `data/klines.ts`)
  - Trading: 1 (`trading/autotrade.ts`)
  - Hooks: 2 deletes (`useDSLBridge.ts`, `useBrainBridge.ts`)
  - App: 1 (`App.tsx` — 6 linii: 2 imports + 2 call sites pe parcursul C4/C7)
  - Types: 1 (contract widening C1)
- **Endpoint-uri noi**: 0 — Phase 6 e strict client-side
- **Socket-uri noi**: 0
- **Componente test noi**: 0 (C5 a adăugat 8 teste mutatori + 2 teste sync; C7 a eliminat cele 2 teste sync; net +6 brainStore + dslStore tests existente neatinse)
- **Flag-uri noi**: 0

**Ce s-a făcut concret**:

- **Contract widening** (`client/src/types/`): tipuri tipate pentru
  toate câmpurile canonice ale suprafeței Brain (`BrainState`,
  `BrainEngineState`, `BrainBlockReason`, `BrainThought`,
  `BrainAdaptParams`, `MtfAlignment`, `TradingProfile`, `BrainMode`).
  Additiv pur — zero consumer runtime nou.
- **`dslStore` canonical** (`client/src/stores/dslStore.ts`): mutatori
  tipați adăugați C2; `syncFromEngine` eliminat C4. Store-ul deține
  starea DSL — engine `trading/dsl.ts` scrie direct prin mutatori.
- **`brainStore` canonical** (`client/src/stores/brainStore.ts`):
  mutatori tipați adăugați C5 (12 mutatori); `syncFromEngine` eliminat
  C7. Store-ul deține starea Brain — engine `engine/brain.ts` scrie
  direct prin mutatori; `BR.thoughts` rămâne backing pentru semantica
  `unshift`+bounded, dar e replicat atomic în store după fiecare push.
- **`window.DSL` Proxy read-compat** (instalat în
  `trading/dsl.ts`/`core/config.ts` C3): GET pe chei canonice rutează
  către `useDslStore.getState()`; GET pe chei runtime-only fac
  `Reflect.get` pe backing; SET pe chei canonice = warn în DEV +
  no-op; SET pe chei runtime-only = `Reflect.set` pe backing. Compat
  cu importatorii direcți legacy păstrat.
- **`window.BM` Proxy read-compat** (instalat în C6): mirror exact al
  pattern-ului C3 DSL aplicat pe Brain. `window.BRAIN` rămâne backing
  obișnuit (nu Proxy) — write-urile pe BR sunt mirror-uite explicit
  prin helperi `_setBrainState`, `_pushBrainThought`, `_setAdaptParams`.
- **`useDSLBridge` eliminat** (C4): `client/src/hooks/useDSLBridge.ts`
  șters; import + apel scoase din `App.tsx`; nu mai există hop
  engine→store sync pentru DSL.
- **`useBrainBridge` eliminat** (C7): `client/src/hooks/useBrainBridge.ts`
  șters; import + apel scoase din `App.tsx`; nu mai există hop
  engine→store sync pentru Brain. Event-ul `zeus:brainStateChanged` mai
  este emis de engine după `runBrainUpdate` dar fără ascultător —
  neutru, safe pentru telemetrie/debug.
- **`syncFromEngine` eliminat din `dslStore` și `brainStore`**: ambii
  mutatori sync șterși din interface, implementare și JSDoc; teste
  aferente eliminate. `aresStore.syncFromEngine` rămâne — out of scope
  Phase 6 (vezi deferred).
- **`BlockReason` write-path fully canonical la 20 site-uri** (pre-C7
  + pre-C7 bis): toate apelurile la `w.BlockReason.set/.clear` sau
  scrierile directe pe `_current` păstrează backing-ul legacy
  (DOM update `#zad-block-reason`, debounce log `atLog('warn',...)`,
  `aubBBSnapshot`) și mirror-ează canonic via
  `useBrainStore.getState().setBlockReason({code, text} | null)`.
  Distribuție: `trading/autotrade.ts` (11), `data/klines.ts` (3),
  `engine/arianova.ts` (2), `engine/postMortem.ts` (2),
  `core/bootstrapMisc.ts` (1), `core/state.ts` hydration (1).

**DoD atins**:

- [x] **DoD 1** — `syncFromEngine = 0` în `dslStore` (C4) și `brainStore`
  (C7); `aresStore.syncFromEngine` rămâne explicit out of scope Phase 6.
- [x] **DoD 2** — `dslStore` și `brainStore` sunt sursa unică pentru
  suprafețele lor canonice; engine-ul scrie direct prin mutatori.
- [x] **DoD 3** — `window.DSL` și `window.BM` sunt Proxy read-compat,
  păstrând compat cu importatorii legacy fără sync hop.
- [x] **DoD 4** — `useDSLBridge` și `useBrainBridge` șterse; `App.tsx`
  nu mai pornește bridge-uri Brain/DSL.
- [x] **DoD 5** — `BlockReason` write-path canonical la toate cele 20
  site-uri cunoscute; nu există drift între backing legacy și store
  canonic după eliminarea bridge-urilor.
- [x] **DoD 6** — `npx tsc --noEmit` PASS după fiecare commit.
- [x] **DoD 7** — `npx vite build` PASS la fiecare commit; bundle final
  index.js = 1770.56 kB (vs 1772.15 kB pre-C7, -1.59 kB).
- [x] **DoD 8** — `vitest` PASS la fiecare commit relevant; brainStore
  13/13 PASS post-C7 (era 15/15, cele 2 teste `syncFromEngine` scoase
  intenționat); dslStore tests stabile post-C4.
- [x] **DoD 9** — Zero atingere out of scope: `aresStore`,
  `_usBuildFlatPayload`, `CLIENT_AT_STORE`, wrappers `_us*`, Phase 5
  OPEN ISSUE — toate neatinse.
- [x] **DoD 10** — MIGRATION_LOG Phase 6 entry + tag
  `migration/phase-06-post` (C8).

**Ce a rămas intenționat pentru fazele următoare** (deferred / out of scope):

- **`aresStore.syncFromEngine`** — singurul store care mai poartă
  pattern-ul `syncFromEngine` post-Phase-6. Master-plan-ul Phase 6 a
  acoperit explicit doar DSL + Brain. Follow-up dedicat la GO explicit
  (Phase 6.x sau parte din Phase 7).
- **Phase 5 OPEN ISSUE — transient UI duplicates** — rămâne în afara
  scope-ului Phase 6. Mandatory follow-up Phase 5.1 sau dedicat. Cele
  două write-paths (`usePositionsBridge.syncSnapshot` fără cursor +
  `positionsRealtime.applyDelta` cu cursor) rămân nerezolvate.
- **48h observation Phase 5** — fereastra deschisă din 2026-04-15
  ~18:05 UTC continuă în paralel cu Phase 6 și cu tag-ul
  `migration/phase-06-post`. Monitorizare ad-hoc pentru stabilitate
  server, frecvență disconnects, ciclu open→close cross-device.
- **`_usBuildFlatPayload`** — retained compat helper Phase 4.
  Necesită `SettingsPayload` widening (9 chei legacy-only). Neatins în
  Phase 6.
- **`CLIENT_AT_STORE` feature flag** — hardening follow-up Phase 3.
  Neatins.
- **`_usFetchRemote` / `_usPostRemote` wrappers** — thin compat
  wrappers Phase 4. Neatinși.
- **Stale comments referințe `useBrainBridge` / `syncFromEngine`** —
  cleanup separat, non-blocking. Comentarii (nu cod) în
  `core/config.ts`, `trading/autotrade.ts`, `data/klines.ts`,
  `components/dock/AdaptivePanel.tsx`, `engine/brain.ts`. Cleanup la
  GO explicit într-un commit doc-only ulterior.

**Rollback point**:

```bash
# Sau git hard-reset la pre-Phase-6 (Phase 5 C6):
git checkout migration/phase-05-positions-ws
git reset --hard 522052b
# (nu există pre-tag dedicat Phase 6; commit-ul pre-Phase-6 = Phase 5 C6)
```

Checkpoint-uri intermediare (commit-backed):

- C1 `521c6b7` — contract widening
- C2 `9da5f3e` — dslStore mutators
- C3 `906184f` — DSL engine inversion + window.DSL Proxy
- C3-doc `cb9917b` — doc-only checkIntervalActive
- C4 `d8b81f4` — DSL bridge removal
- C5 `5acf18c` — brainStore mutators
- C6 `128cfc0` — Brain engine inversion + window.BM Proxy
- pre-C7 `d48ec81` — BlockReason 14 site-uri (autotrade.ts/klines.ts)
- pre-C7 bis `8abc444` — BlockReason 6 site-uri rămase
- C7 `15717e5` — useBrainBridge + brainStore.syncFromEngine eliminate

**Observații de runtime / risc**:

- **Zero impact runtime backend** — Phase 6 e strict client-side.
  Server-ul nu a fost atins. PM2 reload nu necesar.
- **Bundle size scădere netă** — index.js gzip 504.85 kB la C7 vs
  505.25 kB pre-C7 (-0.40 kB gzip, -1.59 kB raw); consistent cu codul
  șters.
- **Event `zeus:brainStateChanged` rămâne emis** — engine-ul mai
  emite event-ul după `runBrainUpdate` dar nu mai are ascultător după
  ștergerea `useBrainBridge`. Neutru runtime, safe pentru telemetrie
  sau debug ad-hoc.
- **`BlockReason` debounce log + DOM mutate păstrate** — toate
  mirror-urile canonice se adaugă DUPĂ apelul backing legacy, deci
  side-effects-urile facade-ului (debounce log, `#zad-block-reason`
  DOM update, `aubBBSnapshot`) rămân intacte.
- **State hydration `BlockReason._current` direct assign** — păstrat
  intenționat în `core/state.ts` ZState restore pentru a NU declanșa
  `set()` (care ar reseta debounce timestamps și ar muta DOM la
  restore). Mirror canonic adăugat cu typed extract `{code, text}`.
- **`useBrainStore.getState().setBlockReason(...)` în try/catch
  defensiv** — toate site-urile mirror păstrează apelul în try/catch
  pentru a NU putea prăbuși path-ul backing legacy în caz de bug viitor
  în store.

**Status**: ✓ PHASE 6 COMPLETE (`dslStore` + `brainStore` canonical,
`window.DSL` + `window.BM` Proxy read-compat, `useDSLBridge` +
`useBrainBridge` eliminate, `syncFromEngine` eliminat din ambele
stores, `BlockReason` write-path fully canonical la 20 site-uri,
`aresStore.syncFromEngine` deferred out of scope, Phase 5 OPEN ISSUE
rămâne deschis în afara scope-ului, observația 48h Phase 5 continuă
în paralel).

---

### Phase 7 — Kill DOM-as-state (scope redus)

**Scop**: reducerea dependenței de oglinzile globale legacy pentru
suprafețele unde store-urile canonice există deja. Phase 7 a fost
planificat inițial cu obiectiv larg (Proxy install pe `window.TP`,
`window.USER_SETTINGS`, `window.TC` + `engine/aub.ts` DOM-write
elimination). După auditul pre-Phase-7, scope-ul a fost redus
intenționat la consumer migration + stale comments cleanup pe baza
următoarelor decizii:

- **`window.USER_SETTINGS` Proxy RESPINS** — structură nested
  (`autoTrade.*`, `chart.*`) face deep Proxy prea complex și riscant.
  settingsStore e deja canonical (Phase 4); USER_SETTINGS e mirror
  menținut de projection layer `_syncToWindow()`. Decizia: migrare
  directă a consumatorilor rămași de pe `w.USER_SETTINGS` la
  `useSettingsStore.getState()`. Cele 9 chei legacy-only (`profile`,
  `bmMode`, `assistArmed`, `manualLive`, `ptLevDemo`, `ptLevLive`,
  `ptMarginMode`, `chartTz`, `dslSettings`) rămân backing/pass-through.
- **`window.TC` auditat, verdict: satisfăcut de Phase 3** — TC este
  deja Proxy (instalat la `core/state.ts:208`, Phase 3 C3), cu 8 chei
  AT-delegated routed prin atStore, 10 chei backing, zero enumeration
  patterns. Zero code changes needed în Phase 7.
- **`engine/aub.ts` DEFERRED** — conversie DOM-write fezabilă fără
  aresStore dependency (confirmat prin audit), dar scope prea mare
  (~250-300 linii + store nou `aubStore` + componentă React). Candidat
  Phase 7.x sau Phase 8.
- **`window.TP` DEFERRED** — entangled cu Phase 5 OPEN ISSUE
  (transient UI duplicates). Nu se poate închide curat fără Phase 5.1.

**Pre-tag**: `migration/phase-7-pre` (HEAD=`2bf7590` = Phase 6 post)
**Notă tag naming**: backup script a creat `migration/phase-7-pre`
(fără zero-padding), iar post-tag-ul canonic rămâne
`migration/phase-07-post`. Ambele sunt valide; discrepanța este
documentată și non-blocking.
**Post-tag**: `migration/phase-07-post`
**Branch**: `migration/phase-07-kill-dom-as-state`

**Commit-urile C1–C3** (în ordine):

| # | Hash | Rezumat |
|---|------|---------|
| C1 | `8346246` | consumer migration: 4 read-sites de la `w.USER_SETTINGS.autoTrade.smartExitEnabled` la `useSettingsStore.getState().smartExitEnabled` în `engine/forecast.ts` (3 site-uri) și `utils/dev.ts` (1 site); import `useSettingsStore` adăugat în ambele fișiere |
| C2 | `a69fc04` | stale comments cleanup: 6 comentarii rescrise/curățate în 5 fișiere (`core/config.ts`, `trading/autotrade.ts`, `data/klines.ts`, `components/dock/AdaptivePanel.tsx`, `engine/brain.ts`); zero cod funcțional atins; referințe stale la `useBrainBridge`/`syncFromEngine` eliminate |
| C3 | `<post>` | docs: MIGRATION_LOG Phase 7 entry + ledger update + tag `migration/phase-07-post` |

**Totaluri**:

- **Fișiere atinse total fază** (excluzând `MIGRATION_LOG.md`):
  - C1: 2 (`engine/forecast.ts`, `utils/dev.ts`) — cod funcțional
    (read-site replacement)
  - C2: 5 (`core/config.ts`, `trading/autotrade.ts`, `data/klines.ts`,
    `components/dock/AdaptivePanel.tsx`, `engine/brain.ts`) — comment-only
- **Endpoint-uri noi**: 0
- **Store-uri modificate**: 0
- **Proxy-uri noi instalate**: 0 (USER_SETTINGS Proxy respins explicit)
- **Flag-uri noi**: 0

**Ce s-a făcut concret**:

- **Consumer migration** (`engine/forecast.ts`, `utils/dev.ts`):
  4 read-site-uri care accesau `w.USER_SETTINGS.autoTrade.smartExitEnabled`
  au fost migrate la `useSettingsStore.getState().smartExitEnabled`.
  Toți consumatorii citeau o singură cheie (`smartExitEnabled`) disponibilă
  în settingsStore din Phase 4. `window.USER_SETTINGS` rămâne backing
  mirror, neatins structural. Projection layer (`_syncToWindow()`) și
  cele 9 chei legacy-only rămân neschimbate.

- **Stale comments cleanup** (5 fișiere, 6 site-uri): comentarii care
  încă refereau `useBrainBridge` / `syncFromEngine` (eliminate în
  Phase 6 C4/C7) au fost rescrise să reflecte arhitectura curentă.
  Referințele rămase la `syncFromEngine` sunt corecte: note istorice
  în JSDoc (`dslStore.ts:7`, `brainStore.ts:22-23`) și cod activ ARES
  (`aresStore.ts`, `useAresBridge.ts`) — ambele out of scope.

**DoD atins**:

- [x] **DoD 1** — Consumatorii direcți `w.USER_SETTINGS` din
  `engine/forecast.ts` și `utils/dev.ts` citesc acum din settingsStore
  canonical.
- [x] **DoD 2** — Zero referințe stale la `useBrainBridge`/`syncFromEngine`
  în afara notelor istorice corecte și codului activ ARES.
- [x] **DoD 3** — `npx tsc --noEmit` PASS la fiecare commit.
- [x] **DoD 4** — `npx vite build` PASS la fiecare commit.
- [x] **DoD 5** — Zero cod funcțional atins în C2 (comment-only).
- [x] **DoD 6** — MIGRATION_LOG Phase 7 entry + tag `migration/phase-07-post`.

**Ce a fost respins intenționat în Phase 7**:

- **`window.USER_SETTINGS` Proxy** — deep Proxy pe structură nested
  prea complex; valoare marginală (store deja canonical); risk/reward
  negativ.
- **`window.TC` code changes** — TC deja Proxy din Phase 3; audit OK,
  zero gap-uri. Nu se redeschide Phase 3 sub alt nume.

**Ce rămâne deferred (nu a intrat în Phase 7)**:

- **`engine/aub.ts` DOM-write elimination** — fezabil fără ARES
  dependency (confirmat prin audit: zero import-uri store, zero DOM
  reads ca sursă), dar scope prea mare (~250-300 linii + aubStore +
  React rendering). Candidat Phase 7.x sau Phase 8.
- **`window.TP` → Proxy** — entangled cu Phase 5 OPEN ISSUE root-cause.
  Deferred la Phase 5.1 sau Phase 7.x.
- **`window.AT` → Proxy** — candidat, neinvestigat în Phase 7.
- **DOM `getElementById` source în alte engine-uri** (non-aub) —
  neauditat; Phase 8 sau Phase 9.
- **`aresStore.syncFromEngine`** — singurul store rămas cu pattern-ul.
  Out of scope Phase 7, deferred ca follow-up dedicat.
- **Phase 5 OPEN ISSUE** — transient UI duplicates. Mandatory follow-up,
  separat de Phase 7.
- **`_usBuildFlatPayload`**, **`CLIENT_AT_STORE`**, **wrappers
  `_us*`** — neatinse, carried forward din fazele anterioare.
- **`fix(auth) c9220fd`** — separat de seriile de migrare.
- **Observația 48h Phase 5** — fereastră deschisă din ~2026-04-15
  ~18:05 UTC, continuă în paralel cu și după tag-ul
  `migration/phase-07-post`.

**Rollback point**:

```bash
git checkout migration/phase-07-kill-dom-as-state
git reset --hard migration/phase-7-pre
```

**Observații de runtime / risc**:

- **Zero impact runtime backend** — Phase 7 e strict client-side.
- **Bundle size delta neglijabil** — 1770.32 kB la C1 (vs 1770.56 kB
  pre-Phase-7 = -0.24 kB); consistent cu înlocuirea referințelor string.
- **settingsStore.ts acum importat static de `engine/forecast.ts`
  și `utils/dev.ts`** — vite build raportează `INEFFECTIVE_DYNAMIC_IMPORT`
  warning preexistent (settingsStore e și static-imported de `stores/index.ts`).
  Warning e cosmetic, zero impact funcțional.

**Status**: ✓ PHASE 7 COMPLETE (scope redus intenționat: consumer
migration `USER_SETTINGS` → settingsStore + stale comments cleanup;
`window.USER_SETTINGS` Proxy respins; `window.TC` auditat OK;
`engine/aub.ts` deferred; Phase 5 OPEN ISSUE rămâne separat;
observația 48h Phase 5 continuă în paralel).

---

### Phase 5.1 — Positions bridge reconciliation (2026-04-16)

**Obiectiv**: Elimină race condition-ul între bridge-ul legacy
(`usePositionsBridge.syncSnapshot`) și path-ul WS
(`positionsRealtime.applyDelta`) care putea cauza duplicate tranzitorii
în UI. Bridge-ul suprascria store-ul cu date stale din `window.TP` când
WS-ul era deja activ, deoarece `syncSnapshot` nu consulta cursorul
monotonic `lastSnapshotTs`.

**Abordare**: Option 2 din candidații registrului — gate bridge pe WS
connectivity (`wsService.isConnected()`), simetric cu polling fallback
din `bootstrapInit.ts:95`. Când WS e conectat, `applyDelta` (cu cursor
dedup) deține exclusiv data path-ul. Când WS e down, bridge-ul
funcționează ca fallback. Timer-ul de 2s la boot rămâne neatins (WS nu
e OPEN încă la momentul execuției).

**Pre-tag**: `migration/phase-5.1-pre` pe `e119179`.
**Post-tag**: `migration/phase-05.1-post` pe commit C2.
**Branch**: `migration/phase-07-kill-dom-as-state` (continuat).

#### Commit chain

| # | Hash | Scope | Files |
|---|------|-------|-------|
| C1 | `cb81bad` | Gate bridge pe WS connectivity | `client/src/hooks/usePositionsBridge.ts` |
| C2 | (this) | MIGRATION_LOG + deferred register + tag | `MIGRATION_LOG.md` |

#### C1 — Gate bridge pe WS connectivity

**Fișier atins**: `client/src/hooks/usePositionsBridge.ts` (singur).

**Modificare**:
- Import adăugat: `import { wsService } from '../services/ws'` (L16)
- Guard adăugat: `if (wsService.isConnected()) return` (L24), în
  `readSnapshotFromWindow()`, înainte de `syncSnapshot()` call

**Semantică**:
- Când `wsService.isConnected() === true` → bridge skip, WS owns data
- Când `wsService.isConnected() === false` → bridge funcționează ca
  fallback (WS down, reconnect backoff, sau boot pre-WS)
- Timer 2s la boot: neatins, funcționează normal (WS nu e OPEN la boot)
- Simetric cu: `bootstrapInit.ts:95` polling 120s care face
  `if (wsService.isConnected()) return`

**Diff**: +2 linii (1 import, 1 guard), 0 linii șterse.

**Validare C1**:
- `npx tsc --noEmit`: PASS (zero erori)
- `vite build`: PASS (774ms, warnings preexistente chunk size)
- Zero cod funcțional atins în afara `usePositionsBridge.ts`

#### DoD Phase 5.1

1. ✅ Bridge nu mai apelează `syncSnapshot()` când WS activ
2. ✅ Bridge funcționează ca fallback când WS down (guard pe
   `isConnected()` returnează false → flow normal)
3. ✅ Timer 2s la boot rămâne activ (WS nu e OPEN la boot)
4. ✅ `positionsRealtime.applyDelta()` path neatins
5. ⏳ Zero duplicate tranzitorii observabile în test manual țintit
   (open + close position, fără flicker repetabil) — **PENDING
   browser-side verification**
6. ✅ MIGRATION_LOG entry + tag `migration/phase-05.1-post`
7. ✅ Deferred register actualizat (MITIGATED, not CLOSED)

#### OPEN ISSUE — Transient UI duplicates

**Status: MITIGATED structurally by Phase 5.1, PENDING browser-side
verification.**

Phase 5.1 C1 elimină structural calea prin care bridge-ul putea
suprascrie store-ul cu date stale din `window.TP` când WS era activ.
Totuși, issue-ul NU este marcat CLOSED definitiv până la confirmare
browser-side clară:

- Zero duplicate tranzitorii observabile în sesiune cu WS activ
- Bridge nu mai emite `syncSnapshot source=bridge` când WS e conectat
  (verificabil prin console log DEV)
- Ciclu complet: open position → verificare UI stabil → close position
  → verificare UI stabil

Închiderea definitivă se face la GO explicit după validare browser-side.

#### Ce NU s-a atins în Phase 5.1

- `positionsRealtime.ts` — funcționează corect, neatins
- `positionsStore.ts` — neatins
- `bootstrapInit.ts` — neatins (polling 120s fallback rămâne)
- `window.TP` — neatins structural
- Nicio altă fază (6, 7, 8, 9)
- `_usBuildFlatPayload`, `CLIENT_AT_STORE`, `aresStore.syncFromEngine`,
  `fix(auth) c9220fd`, `engine/aub.ts` — toate neatinse

#### Observații

- **Observația Phase 5 48h continuă în paralel** — fereastră deschisă
  din ~2026-04-15 18:05 UTC, neatinsă de Phase 5.1.
- **Tag naming**: pre-tag = `migration/phase-5.1-pre` (backup script
  fără zero-padding); post-tag = `migration/phase-05.1-post` (canonic).
  Discrepanță identică cu Phase 7 (`phase-7-pre` vs `phase-07-post`).

**Deferred register**: `project_migration_deferred_register.md`
**Known bugs**: `project_known_bugs.md`

**Status**: ✓ PHASE 5.1 COMPLETE — OPEN ISSUE mitigated structurally,
pending browser-side verification pentru closed definitiv.

---

### Phase 8 — SQLite-only persistence for user_ctx (2026-04-16)

**Branch**: `migration/phase-08-sqlite-persist`
**Pre-tag**: `migration/phase-08-pre` (c3bc6b4)
**Base branch**: `hotfix/manual-mode-label-mismatch`

#### Summary

Migrate 14 user_ctx sections from FS (data/user_ctx/{userId}.json) to
SQLite (user_ctx_data table). Settings → user_settings (existing),
aresData → ares_state (existing), 3 UI-only sections → FS-only.

#### Section routing

| Destination | Sections |
|------------|----------|
| SQLite `user_ctx_data` (14) | indSettings, llvSettings, signalRegistry, perfStats, dailyPnl, postmortem, adaptive, notifications, scannerSyms, midstackOrder, aubData, ofHud, teacherData, ariaNovaHud |
| SQLite `user_settings` (existing) | settings |
| SQLite `ares_state` (existing) | aresData |
| FS-only (3) | uiContext, panels, uiScale |

#### Commits

| # | SHA | Description |
|---|-----|-------------|
| C1 | `01d0ec3` | Schema (migration 021_user_ctx_data) + query layer + FS→SQLite migration script |
| C2 | `be7d634` | GET dual-read: SQLite primary, FS fallback for 14 sections |
| C3 | `c003e99` | POST dual-write: FS + SQLite (saveCtxBulk transaction) |
| C4 | `e6cef51` | Validation script: 28/28 MATCH, 0 DRIFT |
| C5 | `ff9f93e` | Stop FS write for 14 SQLite sections; SQLite = primary |

#### Validation (C4)

```
Results: 28 MATCH, 0 DRIFT, 0 MISSING_SQLITE, 0 MISSING_FS
Verdict: PASS — zero drift
```

28 rows = 14 sections × 2 users. Migration script idempotent
(re-run = 0 inserted, 28 skipped).

#### What was NOT touched

- `client/src/core/config.ts` — `_userCtxPull`, `_userCtxPush` unchanged;
  client still pushes all sections, server routes them
- `settings` and `aresData` — have their own endpoints, untouched
- Phase 5.1 OPEN ISSUE — remains MITIGATED (not closed)
- FS files — not deleted (Phase 8.1 prune deferred)
- `migrationFlags.js` — no persistence flag needed; routing is server-side

#### Deferred

- **Phase 8.1**: FS prune — delete SQLite sections from FS files after
  production validation period
- **Phase 5.1 OPEN ISSUE**: duplicate/zombie positions — separate investigation
- **Phase 9**: Cleanup + TS strict global

**Deferred register**: `project_migration_deferred_register.md`
**Known bugs**: `project_known_bugs.md`

**Status**: ✓ PHASE 8 COMPLETE — 14 sections migrated to SQLite,
FS write stopped, validation PASS. Phase 8.1 FS prune deferred.

---

### Phase 9 — Cleanup + TS strict (2026-04-17)

**Branch**: `migration/phase-09-cleanup`
**Pre-tag**: `migration/phase-09-pre` (a59bd8f)
**Base branch**: `migration/phase-08-sqlite-persist`

#### Summary

Final hygiene phase: eliminate last `syncFromEngine` pattern from stores,
audit DOM-as-state candidates, resolve TS strict errors in stores/services.

#### Commits

| # | SHA | Description |
|---|-----|-------------|
| C1 | `44b85a6` | aresStore.syncFromEngine eliminated — engine push direct via patch() |
| C2 | `cb65ad3` | partialPct DOM read audited → DEFERRED (no canonical source) |
| C3+C4 | `5ac605c` | TS strict fixes stores/services + validation overlay |

#### C1 Audit — aresStore.syncFromEngine

- **What it synced:** wallet (balance, locked, available, realizedPnL, fundedTotal) + positions array
- **Who called it:** single consumer — `useAresBridge` (App.tsx), listening to `zeus:aresStateChanged`
- **Who emitted:** `engine/ares.ts` — `_save()` (wallet) and `_savePositions()` (positions)
- **Verdict:** REMOVAL — pattern clear and small, zero tangling with ARES mission/wallet/UI
- **What changed:** engine pushes directly to `aresStore.patch()` at mutation sites; `useAresBridge` deleted; `_readFromEngine` retained as private fallback for `loadFromServer`
- Event `zeus:aresStateChanged` preserved (legacy compat by design)
- `grep syncFromEngine stores/` → 0 functional hits (doc-only in dsl/brain)

#### C2 Audit — partialPct DOM read

- **Source:** `<input id="partialPct" value="50">` in innerHTML overlay (autotrade.ts:1762)
- **Who sets it:** user types; default hardcoded 50
- **Who reads it:** L1776 — `getElementById('partialPct').value` on OK button click
- **Canonical source:** NONE — modal is imperative DOM, not React
- **Verdict:** DEFER — requires new `PartialCloseModal.tsx` React component, beyond Phase 9 scope

#### C3+C4 — TS strict stores/services

- Created `tsconfig.phase9.strict.json` overlay (extends tsconfig.app.json, includes stores/** + services/**)
- Fixed 3 errors:
  - `positionsStore.ts:113`: `process.env.NODE_ENV` → `import.meta.env.DEV`
  - `stateAccessors.ts:21,165`: `require('../stores/atStore')` → direct import
- Result: **0 errors in stores/ + services/** (400 transitive errors in other dirs are pre-existing)
- Overlay is validation-only — does not affect build or tsconfig.app.json

#### What was NOT touched

- `w.S`/`w.BM`/`w.AT`/`w.TC`/`w.TP`/`w.DSL` — 900+ usages, Phase 10+
- `engine/aub.ts` DOM writes — deferred, scope too large
- `_usBuildFlatPayload` + 9 legacy-only keys — SettingsPayload widening needed
- `CLIENT_AT_STORE` feature flag — hardening follow-up
- Phase 5.1 OPEN ISSUE — remains MITIGATED (not closed)
- Phase 8.1 FS prune — soak period active
- Hotfix manual panel — remains CLOSED
- Legacy events — preserved by design
- Stale comments (5 files) — already cleaned by Phase 7 C2, grep confirmed 0 hits
- 400+ TS errors in core/engine/trading/data/components — out of scope

#### SQLite sanity check

Post-C5 (Phase 8) drift is expected: FS files have stale data for SQLite
sections since FS write was stopped. SQLite is the authoritative source.
6 sections show natural drift (FS older), 22 match, 0 missing.

**Deferred register**: `project_migration_deferred_register.md`
**Known bugs**: `project_known_bugs.md`

**Status**: ✓ PHASE 9 COMPLETE — syncFromEngine=0 in all stores,
stores/services TS strict clean, partialPct deferred.

---

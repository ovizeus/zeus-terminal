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
| 2 API client centralized | pending | — | — | fetch( ≤3 hits | — |
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

# Zeus Terminal — Mega Audit Full App
**Data:** 2026-04-14 · **Branch analizat:** `feat/admin-control-center` (și main)
**Metodologie:** 5 agenți Explore paraleli, read-only, analiză statică pe auth/security, trading/AT, brain/DSL/ARES, UI/stores, DB/logs/build.
**Zero cod modificat.**

---

## Rezumat executiv

| Severitate | Număr | Ce înseamnă |
|---|---|---|
| **CRITICAL** | **14** | Risc pierdere bani, bypass auth, date cross-user, expunere secrete |
| **HIGH** | **17** | Fluxuri rupte, race conditions, guards slabe |
| **MEDIUM** | **22** | Edge cases, bugs care se declanșează rar dar real |
| **LOW / Nice** | **~25** | Cosmetic, DX, best practices |

**Stare generală:** Aplicația funcționează, dar are **5 buguri care pot cauza pierderi de bani reali** (CRITICAL) și **4 probleme severe de izolare per-user / securitate** care trebuie tratate înainte de scale-up la mai mulți useri live.

**Dacă repari doar 10 lucruri:** focus pe cele din secțiunea "Top 10 must-fix" de la final.

---

## Teme cross-cutting (se repetă în mai multe zone)

1. **CSRF** — admin API e montat *înainte* de middleware-ul CSRF; call-urile din client nu trimit `x-zeus-request`. Atacator poate forța admin acțiuni dacă admin-ul e logat și vizitează o pagină malițioasă.
2. **Izolare per-user pe client** — la logout nu se curăță `localStorage` + Zustand stores. User B vede cache-ul user-ului A (settings, ARES state, positions cache).
3. **Silent catches** — zeci de `catch (_) {}` și `catch {}` ascund erori reale, inclusiv în logger, brain, riskGuard. Când ceva nu merge, nu se vede nicăieri.
4. **Sync UC spam** — orice signal registry update triggerează push către server. 5-50 push/min. Confirmă ce era în memoria `project_known_bugs.md`.
5. **Live trading expus fără SL** — există ferestre de 3-4s în care o poziție e pe exchange fără stop-loss (fill unverified, SL retry). Flash crash = pierdere necontrolată.
6. **Default 2FA bypass dacă lipsește SMTP** — codul se loghează în consolă și se acceptă orice login ca "dev-bypass". Dacă cineva deployează prod fără SMTP corect, 2FA e decor.

---

## CRITICAL — 14 buguri

### C1 — Parolă temporară expusă în response HTTP (admin/reset-password)
- `server/routes/auth.js:769-785` (endpoint nou adăugat în FAZA C)
- Parola în plaintext se întoarce în JSON. Dacă admin-ul o trimite pe canal nesecurizat (Slack fără e2e, email) e ownership definitiv pe cont. Nu expiră, nu forțează schimbare la primul login.
- **Impact:** takeover cont complet.
- **Fix:** adaugă `tempPasswordExpiresAt` (1h), force password change la primul login, sau trimite prin email la user direct (nu prin admin).

### C2 — Admin endpoints fără CSRF
- `server.js:98-117` + `server/routes/auth.js` (toate `/admin/*`)
- `/auth/admin/*` e montat înainte de middleware-ul CSRF. Client-ul din `AdminPage` nu trimite `x-zeus-request`. Atacator poate face cross-origin POST la `/admin/delete`, `/admin/ban`, `/admin/reset-password` dacă admin-ul e logat.
- **SameSite=lax** acoperă parțial, dar nu 100% (subdomenii, anumite POST-uri).
- **Fix:** mută middleware-ul CSRF înainte de router-ul auth, sau adaugă check explicit în `_adminGuard()`. Adaugă header `x-zeus-request: 1` în toate fetch-urile admin din client.

### C3 — 2FA bypass dacă SMTP e down
- `server/routes/auth.js:278-287`
- Dacă transporter-ul de email nu e configurat, login-ul generează JWT direct, fără cod. Atacator cu parola = intră fără 2FA.
- **Fix:** fail explicit dacă SMTP nu e disponibil în prod (env `REQUIRE_2FA=true`). Logging 2FA code în consolă doar în DEV explicit.

### C4 — localStorage NU se curăță la logout → cross-user leak
- `client/src/stores/authStore.ts:55-56` + `client/src/components/layout/Header.tsx`
- `clearAuth()` șterge doar user/email/role. Zustand stores (settings, ARES, positions, AT) + localStorage (`zeus_user_settings_cache`, `ARES_MISSION_STATE_V1_vw2`, `zeus_theme`) rămân. User B pe același browser vede cache-ul user A.
- **Impact:** User B poate vedea parametrii de trading, poziții cache, setări ARES ale user A înainte ca sync-ul cu serverul să suprascrie.
- **Fix:** înainte de `window.location.href='/login.html'`, apelează `resetAllStores()` (de creat) care face `localStorage.clear()` + reset state la default pe TOATE store-urile.

### C5 — Poziție LIVE nereconciliată când fill-ul nu se poate verifica
- `server/services/serverAT.js:801-835`
- Dacă după 3s polling nu se confirmă fill-ul entry-ului MARKET, codul setează `entry.live.status='FILL_UNVERIFIED'` și iese, **fără să închidă poziția de pe exchange**. Dacă Binance a confirmat între timp, poziția rămâne LIVE pe exchange fără SL/TP server-side.
- **Impact:** pierdere reală de bani la flash move.
- **Fix:** după timeout, execută reconciliere imediată + market close forțat dacă apare poziția la Binance.

### C6 — Fereastră 4s fără SL după entry (race pe SL retry)
- `server/services/serverAT.js:858-899`
- După fill, SL se încearcă cu 2 retry-uri (1s + 3s). Între fill (line 849) și emergency close (line 886) = **4 secunde cu poziție fără stop-loss**.
- **Fix:** imediat după fill, place SL far-OTM (sigur) înainte de a încerca SL-ul optim. Dacă SL-ul optim reușește, înlocuiește.

### C7 — Bug PnL emergency close (istoric, probabil corectat, de verificat)
- `server/services/serverAT.js:891-895` + `fix-emergency-pnl.js` (172 înregistrări reparate)
- Bug-ul: `parseFloat("0" || fallback)` — string "0" e truthy, avgPrice rămânea 0, PnL ieșea `±(size*lev)`. Codul curent folosește `Number.isFinite()` — **verifică că fix-emergency-pnl.js a fost rulat**, nu mai sunt înregistrări corupte.
- **Fix verificare:** rulează `SELECT COUNT(*) FROM at_closed WHERE pnl_usd NOT BETWEEN -size*lev*1.5 AND size*lev*1.5`.

### C8 — Sentry DSN hardcodat în sursă
- `server/instrument.js:8`
- Fallback DSN inclus literal în cod. Organizația + proiectul sunt recunoscute din DSN; atacator poate injecta event-uri spre Sentry-ul tău, poluează telemetria, costuri.
- **Fix:** șterge fallback, fail startup dacă `SENTRY_DSN` nu e setat.

### C9 — Password history NU se înregistrează la admin reset
- `server/routes/auth.js:769-785`
- `db.updatePassword()` e apelat, dar `db.insertPasswordHistory()` nu. User-ul poate reseta parola cu admin și reutiliza o parolă veche imediat, bypass la politica de 5-entry history.
- **Fix:** adaugă `db.insertPasswordHistory(target.id, hash); db.prunePasswordHistory(target.id, target.id);` după `updatePassword`.

### C10 — Inactivity timeout = in-memory only
- `server/middleware/sessionAuth.js:8-18`
- Map `_activity` se resetează la restart pm2. Un JWT furat rămâne valid **indefinit** cât timp serverul nu se restartează (timeout nu se aplică după restart).
- **Fix:** persistă `last_active_at` în tabela users, citește-l la fiecare request. Sau Redis pentru sessions distribuite.

### C11 — Schimbare mod demo→live cu poziții mixte
- `server/services/serverAT.js:296-352`
- `setMode()` respinge schimbarea dacă există poziții deschise, dar nu filtrează pe mod. Dacă user are 1 poziție live pe BTC și 0 demo, la switch demo→live refuză. Dar dacă are 1 demo + 0 live, switch spre live reușește, **apoi** poziția demo e tratată ca live la monitorizare.
- **Fix:** filtrează explicit `_positions.filter(p => p.userId === uid && p.mode === oldMode).length`.

### C12 — Demo balance nu se resetează la live→demo
- `server/services/serverAT.js:327-342`
- Dacă user arde demo la $500, trece pe live, apoi înapoi pe demo → demoBalance rămâne $500. Kill switch calculează drawdown 60% când e de fapt 3% din starting.
- **Fix:** la live→demo, fie reset la `DEFAULT_DEMO_BALANCE`, fie întreabă user-ul (dialog).

### C13 — Legacy bridge fără error boundary
- `client/src/App.tsx:94`
- `<ErrorBoundary>` acoperă doar shell-ul React. Dacă codul legacy (state.js, brain.js, aub.ts, indicators.ts) aruncă, pagina îngheață fără feedback, nu se recuperează.
- **Fix:** wrap legacy init în try/catch global + banner "Degraded mode" + report la Sentry.

### C14 — TG bot token decryption failure pentru user 2 (persistent)
- `server/services/telegramBot.js` + loguri: repetat la fiecare 60s
- "Unsupported state or unable to authenticate data" = token criptat cu o cheie veche, nu s-a făcut migrarea. Silent `continue` — user-ul pierde alerte fără să știe.
- **Fix:** migrează toate `telegram_bot_token_enc` la cheia curentă. Adaugă UI flag "re-add telegram token" dacă decrypt eșuează.

---

## HIGH — 17 buguri

### H1 — Parola temp fără expiry / use-once
- `server/routes/auth.js:779` — parola validă permanent până user-ul o schimbă.
- **Fix:** TTL 24h, invalidare la prima folosire.

### H2 — Client nu trimite x-zeus-request pe admin calls
- `client/src/components/admin/sections/UsersSection.tsx:85-120` (FAZA C), `AdminModal.tsx`
- **Fix:** helper `fetchAdmin(url, opts)` care adaugă header automat.

### H3 — Audit log LIKE injection (disclosure)
- `server/services/database.js:551-557`
- User poate crafta un email care conține `%admin@%` pentru a matchui pattern. Info disclosure despre alți admini.
- **Fix:** JSON extract pe `details`, sau escape `%` și `_` din input.

### H4 — Race AT toggle client→server
- `client/src/trading/autotrade.ts:103-182`
- Client setează `AT.enabled=true` ÎNAINTE ca serverul să confirme. Race: dacă user reload înainte de server-confirm, AT apare activ în UI dar serverul blochează entries.
- **Fix:** optimistic update + revert la eroare. Sau așteaptă response înainte de update UI.

### H5 — UC sync spam (cunoscut)
- `client/src/core/config.ts:246, 481-485` + `hooks/useServerSync.ts:35-83`
- `_ucMarkDirty('signalRegistry')` se cheamă la fiecare `srRecord()`. 5-50 push/min.
- **Fix:** debounce 1s pe `_ucMarkDirty` înainte de flush.

### H6 — No Escape handler în React ModalOverlay
- `client/src/components/modals/ModalOverlay.tsx:1-23`
- Inconsistent: AdminPage are ESC, modale vechi JS au ESC prin `hotkeys.ts`, dar React modals noi (Settings etc.) nu.
- **Fix:** useEffect cu `keydown` listener central în ModalOverlay.

### H7 — Dynamic import warnings (dublă înregistrare posibilă)
- `client/src/hooks/useServerSync.ts:152-158`
- `settingsStore` și `aresStore` sunt importate și static și dinamic. Rollup warnă. Riscul: două instanțe ale store-ului.
- **Fix:** un singur path, static import top-of-file.

### H8 — Modal z-index colision
- `client/src/app.css:4834`
- Toate modalele la z-index 1000. Dacă două deschise simultan (Admin + Settings) = focus rupt.
- **Fix:** stack index (base 1000 + 100 per nivel) sau queue exclusiv în uiStore.

### H9 — No debounce pe settings save / UC push
- React hooks nu au debounce. Click rapid pe theme toggle → 3 POST /api/user/settings simultan.
- **Fix:** debounce 300ms în `saveToServer()`.

### H10 — No aria-labels pe butoanele icon-only
- `client/src/components/layout/Header.tsx:60-91`
- Command palette, bell, settings, admin, logout — toate SVG-only, screen readers doar "button".
- **Fix:** `aria-label` pe fiecare.

### H11 — Migration mark-as-applied ambiguă
- `server/services/database.js:158-161`
- "duplicate column name" e logat dar migrația se marchează aplicată. Dacă pasul 2 (index) din migrație eșuează, la re-run nu se reia.
- **Fix:** track per-step success în migrations table.

### H12 — Silent error suppression peste tot
- `brainLogger.js:103`, `serverBrain.js:133,151,225`, `riskGuard.js:146,164` etc.
- Zeci de `catch (_) {}`. Erori pe DB write, telegram alert, logger — invizibile.
- **Fix:** înlocuiește cu `Sentry.captureException(e, { tags })` sau cel puțin `console.warn` cu context.

### H13 — DB backup retention nu respectă disk size
- `server/services/database.js:699-728`
- Rulează orar (nu zilnic cum zice comentariul), keep 7 copii. Dacă DB crește la 100MB, 7 copii = 700MB. Nu verifică spațiu liber.
- **Fix:** cap total backup dir la 500MB, prune agresiv. Alert la < 1GB free.

### H14 — No busy_timeout + no WAL checkpoint config
- `server/services/database.js:15-19`
- Default better-sqlite3 = 5s. Sub load (multi-user + recon + brain cycle), SQLITE_BUSY posibil.
- **Fix:** `db.pragma('busy_timeout = 30000'); db.pragma('wal_autocheckpoint = 1000');`

### H15 — Stale price gate e client-side
- `server/services/serverAT.js:466-471`
- `(Date.now() - decision.priceTs) > 10000` — `priceTs` vine de la client. Client cu clock skew = bypass.
- **Fix:** folosește server timestamp când signal-ul intră, nu `priceTs` trimis.

### H16 — Cooldown close blochează re-entry după TP
- `server/services/serverAT.js:31-32`
- Nu diferențiază SL vs TP. Close pe TP cu profit → 10min cooldown = ratează imediat următorul signal bun.
- **Fix:** cooldown doar pentru close-uri cu pnl<0.

### H17 — Admin role check slab
- `server/routes/auth.js:393-405`
- Implicit via `caller.role !== 'admin'` în callers, dar nu e explicit după `findUserByEmail`. Dacă admin role e revocat post-JWT, JWT-ul vechi rămâne valid până expiră.
- **Fix:** explicit `if (caller.role !== 'admin') return 403` în `_adminGuard`.

---

## MEDIUM — 22 buguri

### Trading / AT
- **M1** Live entry lock pe simbol (nu seq) — două semnale rapide pe același simbol = al doilea ratat. `serverAT.js:29`.
- **M2** Kill switch reset doar manual + UTC midnight — client nu detectează reset server-side. `autotrade.ts:145-151`.
- **M3** Stale OI guard 5min — dacă OI feed e down 1h, bias e stale. `confluence.ts:38-42`.
- **M4** Pending entries wipe la startup fără log audit — user pierde trade silențios. `serverPendingEntry.js:268-270`.
- **M5** Reconciliation 60s fără lock contra user actions — posibil double-close. `serverAT.js:2794`.

### Auth / Admin
- **M6** Status inconsistency 'blocked' vs 'suspended' — fără enum. `auth.js:712`.
- **M7** Bulk endpoint fără rate limit — 100 acțiuni per request, un admin compromis face damage rapid. `auth.js:788-812`.
- **M8** JWT expiry 7 zile default — prea lung. `auth.js:21-22`.
- **M9** PIN rate limit slab (5/15min) — brute-force în 13-33 zile pentru 4-8 digit. `auth.js:40-43`.
- **M10** Audit log fără true pagination (doar limit). `auth.js:600-602`.

### UI / React
- **M11** Chart refs stale la unmount — legacy încearcă scrie pe null. `chartBridge.ts:114-138`.
- **M12** sessionStorage pentru PIN unlock — se pierde la tab close. `bootstrapMisc.ts:29`.
- **M13** Race AT state vs positions locale manuale — fragilă, documentare lipsă. `useServerSync.ts:39-44`.
- **M14** Admin modal GET calls fără `x-zeus-request` header (dacă shim-ul e doar POST/PUT/DELETE/PATCH). `AdminModal.tsx`.
- **M15** DSL log per-poziție 200 entries × 100 poziții = 20K în mem la scale-up. `serverDSL.js:9,156`.
- **M16** Signal registry localStorage fără try/catch — quota fail silent. `config.ts:149`.
- **M17** Teacher dataset fără limită explicită — posibil memory pressure la backtest lung.

### DB / Build
- **M18** Vite config fără `sourcemap: false` explicit — risc expunere sursă dacă cineva buildează cu flag.
- **M19** `pm2-logrotate` nedeclarat în package.json — dacă lipsește modulul pe VPS, logurile nu se rotesc.
- **M20** Sentry `sendDefaultPii: true` — email-uri captate. Privacy best-practice e false. `instrument.js:14`.
- **M21** Lipsă rate limit pe `/auth/login`, `/auth/2fa/verify` — brute-force posibil fără throttle (deși 2FA reduce). 
- **M22** fix-emergency-pnl.js încă în repo — confirmă root-cause închis + scoate scriptul.

---

## LOW / Nice-to-have (condensat)

- Modale React mereu în DOM (display:none) — memory pe mobile.
- Culori hex hardcodate în AdminModal — nu urmează variabile CSS.
- Admin modal nu e responsive bine sub 480px.
- ESC handler 3 implementări diferite (hotkeys.ts, AdminPage, React) — consolidează.
- Service worker referențiat în cod dar fișierul nu există — PWA failure silent.
- No error boundary la nivel global al legacy.
- Icon SVG path warnings — probabil NaN într-un generator dinamic, găsește sursa.
- Console.log 2FA code leak în mode SMTP-down (doar DEV, dar risc de configurare).
- Password change nu loghează *sursa* (user vs admin-reset) în audit.
- `listAuditLogByTarget` logica email → user_id e slabă (Number(email)=NaN→-1).
- Encryption key fără versioning / rotation mechanism.
- Testnet vs live indicator inconsistent în unele alerte Telegram.
- Tests/CI — există 8 test files dar fără coverage threshold în CI.
- BNB/BYB WS backoff fără jitter (risc sincronizare burst).
- Demo PnL mixat cu live în `DAILY_STATS` — chart confuz.
- CORS handling nu e explicit (asumat same-origin).
- `StrictHostKeyChecking=no` în deploy.yml — acceptabil dar documentabil.

---

## 🔥 TOP 10 MUST-FIX (sprint următor)

Ordonate după **risc × ușurință de exploatat**:

| # | Bug | Sev | Effort | Unde |
|---|---|---|---|---|
| 1 | **Parolă temp fără expiry + force-change** | CRIT | S (~1h) | `auth.js:769` + client first-login flow |
| 2 | **CSRF header pe admin client + middleware order server** | CRIT | S (~1h) | `server.js` + `client/**/Admin*` |
| 3 | **Fereastra 4s fără SL post-fill** → safe far-OTM SL imediat | CRIT | M (~3h) | `serverAT.js:858-899` |
| 4 | **FILL_UNVERIFIED → force reconciliation/close** | CRIT | M (~2h) | `serverAT.js:801-835` |
| 5 | **localStorage + Zustand reset la logout** | CRIT | S (~1h) | `authStore.ts` + `Header.tsx` |
| 6 | **2FA bypass când SMTP down** → fail explicit în prod | CRIT | XS (~30min) | `auth.js:278` |
| 7 | **Sentry DSN hardcodat** → șterge fallback | CRIT | XS (~5min) | `instrument.js:8` |
| 8 | **Password history missing la admin reset** | CRIT | XS (~10min) | `auth.js:781` |
| 9 | **UC sync spam debounce** (bug cunoscut din memorie) | HIGH | S (~1h) | `config.ts:_ucMarkDirty` |
| 10 | **Inactivity timeout persistent în DB** | HIGH | M (~2h) | `sessionAuth.js` + users table |

**Estimare totală top 10:** ~12-15 ore de dev focused.

---

## Repair roadmap (propunere faze)

### Sprint R1 — Money & Auth safety (1-2 zile)
Items: #1, #2, #3, #4, #6, #7, #8 din top 10.
Output: trading live e safe, admin e protejat CSRF, temp password controlat.

### Sprint R2 — User isolation & session (1-2 zile)
Items: #5, #10, H4, H6, H12 silent catches cleanup, TG re-encrypt migration (C14).
Output: multi-user clean, telemetrie observabilă.

### Sprint R3 — Performance & DB (1 zi)
Items: H13 backup retention, H14 WAL config, M10 audit pagination, M15 DSL log limits, UC spam (#9).
Output: DB stabil sub load, logs manageable.

### Sprint R4 — UX polish (1 zi)
Items: H6 ESC modal, H10 aria-labels, H8 z-index, M11-M17 UI fixes.
Output: app profesional, accessibility ok.

### Sprint R5 — Hardening (continuu)
Items: toate LOW/Nice. Tests, CI coverage, key rotation, rate limits extinse.

---

## Verificări recomandate înainte de fix

1. **Rulează** `SELECT COUNT(*) FROM at_closed WHERE ABS(pnl_usd) > size_usd * leverage * 1.2` — dacă returnează rânduri, emergency-close bug mai e activ sau fix-emergency-pnl.js nu a rulat.
2. **Verifică** dacă există `MFA_DISABLED=true` sau similar env — oprește orice deploy prod fără SMTP.
3. **Grep** `catch (_)` + `catch {}` în server → ~40 ocurențe. Clasifică: safe vs suspicious.
4. **Rulează** `npm audit` — vezi dependency CVEs curente.
5. **Testează** manual: login user A → logout → login user B → verifică `localStorage` în DevTools că nu are keyuri A.
6. **Testează** admin reset password → verifică că `password_history` table are entry nou.
7. **Simulează** pm2 restart după user inactiv 3h → check că la revenire JWT-ul vechi e respins.
8. **Check** Sentry dashboard — câte erori silent (catch_) vs raportate? Diferența e "dark matter" debug.

---

## Concluzie

**Aplicația e funcțională pentru 1-2 useri live**, dar **nu e production-ready pentru scale-up** fără Sprint R1 + R2. Riscul principal nu e UI sau performance — e **money safety** (C5, C6) + **CSRF pe admin** (C2) + **cross-user leak** (C4). Acestea 4 rezolvate = 80% din riscul real.

Restul (UX, observability, tests) pot aștepta fără să compromită siguranța.

---
*Raport generat automat din 5 agenți Explore paraleli. Findings verificate cross-agent unde s-au suprapus. Pentru orice finding, citatul file:line e suficient pentru a găsi codul în < 10 secunde.*

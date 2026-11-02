<!-- generat din docs/BOOK_OF_ALL.md linia 3147 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🧩 2026-10-14, 21:10 — DIAGNOSTIC ÎNCHIS: poarta de migrare e CIRCULARĂ, nu doar neîndeplinită

Am dus la capăt întrebarea „de ce nu emite PRIMARY". Răspunsul e structural și schimbă campania.

### Cele două emițătoare, confirmate în cod
| | de unde | când | ce scrie |
|---|---|---|---|
| **COVERAGE** | `client/src/data/klines.ts:343` | scanarea multi-simbol, **doar** `if (sym !== getSymbol())` | mereu `NO_TRADE`, `confidence=0`, direcțional |
| **PRIMARY** | `client/src/trading/autotrade.ts:717` | în `runAutoTradeCheck` (începe la 671) | simbolul de pe chart, prin `computeFusionDecision` — **oglindește pipeline-ul serverului** |

Comentariul din `klines.ts` e explicit: *„S4 verdict uses PRIMARY."* Și al rutei: gate-urile
**MUST read totals.primaryAgreementPct ONLY**.

### De ce PRIMARY e mereu zero — linia exactă, dovedită static
**CORECTEZ o presupunere proprie:** bănuisem `getATEnabled()` (linia 714). **Nu e el.**
`runAutoTradeCheck` iese cu **două linii mai sus de ce credeam**:
```
687  if (w._serverATEnabled) { ...UI... return }            // [AT-UNIFY] serverul e sursa de adevar
701  if (_isServerDemoATActive()) { ...UI... return }        // [S6-B5] serverul are autoritate pe DEMO  ← IESE AICI
708  if (!TabLeader.checkLeader()) return
712  if (AT.running) return
714  if (!getATEnabled() || getATKillTriggered()) return
717  ← blocul PRIMARY (nu se atinge niciodata)
```
El tradează **demo** cu `SERVER_AT_DEMO` pornit → `_isServerDemoATActive()` e adevărat → ieșire la
**705**. Scanarea multi-simbol (COVERAGE) e în **alt fișier** și nu trece prin niciuna — de-aia avem
101 rânduri de acoperire și **zero** PRIMARY.

### ✅ Verificat și LINIȘTITOR: nu există risc de execuție dublă
Am verificat dacă `SERVER_AT_DEMO` + `CLIENT_AT` (ambele ON acum) pot tranzacționa în paralel.
**Mutex-ul NU acoperă perechea asta** — dar clientul se dă singur la o parte, în trei locuri:
`autotrade.ts:687`, `:940` (*„[LOCKED] Server AT active — client trade blocked"*) și `:1486`.
Deci configurația actuală e sigură. *(Că protecția e în cod și nu în mutex rămâne o fragilitate:
cine citește doar `migrationFlags.js` ar crede că e permisă dubla execuție.)*

### 🔴 DEPENDENȚA CIRCULARĂ — ăsta e adevăratul blocaj
Harnașamentul a fost proiectat când **clientul** rula AutoTrade. Operatorul are acum
**`SERVER_AT_DEMO` pornit** — serverul rulează AT pe demo — deci AT-ul clientului e stins, deci
`runAutoTradeCheck` iese la 714, deci PRIMARY nu se emite.

**Ca să aduni dovezile care autorizează migrarea, îți trebuie clientul care rulează AT; dar migrarea
s-a întâmplat deja parțial, și exact asta oprește acel client.**

Poarta nu e „încă neîndeplinită". E **imposibil de îndeplinit** în configurația actuală. Oricâte zile
am aștepta, `primaryPairs` rămâne 0.

### 🙋 Trei ieșiri — DECIZIA LUI, niciuna făcută
1. 🟢 **Pornește AT pe client temporar**, cât durează colectarea. Nu schimbă cod. Dar clientul și
   serverul ar rula AT în paralel pe demo — trebuie verificat întâi că nu dublează intrări
   (`SERVER_AT_DEMO` + client AT nu sunt în mutex-ul din `migrationFlags`, ceea ce **în sine merită
   verificat**).
2. 🟡 **Mută blocul PRIMARY deasupra ieșirilor de la 687 și 701** — nu doar deasupra lui
   `getATEnabled()`, cum scrisesem înainte de a găsi linia exactă. **NU** deasupra lui `TabLeader`
   (altfel fiecare tab deschis emite dublat) și **nu** deasupra lui `AT.running` (reintrare).
   Adică: imediat după `TabLeader`/`AT.running`, înainte de orice gardă de autoritate. Paritatea e
   shadow-only prin construcție, deci măsurarea ei nu trebuie să depindă de armarea execuției.
   E exact mutarea pe care b93 a făcut-o deja o dată, deasupra celorlalte gate-uri. Doar client →
   **rebuild de bundle, fără reload**.
3. 🔴 **Renunță la poarta PRIMARY** și acceptă acoperirea (97,78% acord ajustat) — dar codul spune
   explicit că ar umfla artificial potrivirea, fiindcă acoperirea e forțat `NO_TRADE`.

**Recomandarea mea: varianta 2**, fiindcă repară cauza (un diagnostic care depinde de execuție) în
loc să ocolească simptomul. Dar e schimbare pe fișierul de AT al clientului, deci **cere acordul lui**.

**Nereparat. Nu ating `autotrade.ts` cât el doarme.**

---

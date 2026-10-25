<!-- generat din docs/BOOK_OF_ALL.md linia 2692 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🚨 2026-10-14, 22:25 — DOUĂ butoane de panică: unul funcționează, celălalt e dormant

Urmărind firul butonului de panică am găsit că există **două** mecanisme, complet separate.

| | mecanism | stare |
|---|---|---|
| 1 | `/api/panic` → `setGlobalHalt` → `isGlobalHaltActive` | ✅ **aplicat în 7 locuri**, fail-closed, acum fixat cu teste |
| 2 | ML `triggerPanic` (`ml/_operator/panicButton.js`) | ⚪ **inaccesibil** |

### Ce face al doilea — și ce NU face
Se documentează drept *„Hard halt mechanism for operator"* și declară
`PANIC_ACTIONS = ['breaker_L5_flatten', 'kill_switch_ON', 'audit_logged']`. **Chiar acționează** —
cheamă `setBreakerLevel('L5')` și `setEmergencyKillSwitch('ON')`, nu doar scrie șiruri.

**Dar nimic nu citește rezultatul.** Verificat prin patru metode:
- `getEmergencyKillSwitchState` — **zero consumatori** în afara propriului fișier;
- `setBreakerLevel`/`getBreaker` — în afara modulului apare doar într-un **comentariu**;
- `ml_circuit_state` (2 rânduri) — **niciun `SELECT`** din afara `circuitBreaker.js`;
- `ml_human_overrides` (1 rând) — **niciun `SELECT`** din afara `humanInTheLoop.js`.

### ⚪ Gravitate: MICĂ — și era să raportez invers
Primul meu impuls a fost „butonul de panică scrie stare pe care n-o citește nimeni". **Alarmant și
greșit.** `triggerPanic` **nu e expus prin nicio rută**, nu e chemat de nimic în server, iar clientul
nu-l cunoaște. E cod dormant inaccesibil, consistent cu cele 202 module ML parcate. Butonul real,
`/api/panic`, funcționează și e dovedit.

### 🙋 Riscul real e de CONFUZIE, nu de siguranță — decizia lui
Dacă cineva (inclusiv eu, altă dată) leagă vreodată panica ML de un buton din interfață crezând că
oprește tranzacționarea, **nu ar opri nimic** — ar trebui construită întâi aplicarea. Două mecanisme
cu același nume, din care unul e decorativ, e exact tiparul cu care ne-am luptat toată seara.
Opțiuni: **conectezi** aplicarea ML, **ștergi** mecanismul dormant, sau îi pui o notă în cod.

---

<!-- generat din docs/BOOK_OF_ALL.md linia 3383 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔴 2026-10-14 — INCIDENT PROVOCAT DE MINE: suita de teste a mâncat 6,6 GB și a fost ucisă de OOM

Am rulat `npx jest` (toată suita, 9415 teste) pe VPS-ul **viu**. Kernelul a omorât procesul:
```
Out of memory: Killed process 2850387 (node) anon-rss:6620116kB UID:999
```
**6,6 GB din 7,7 GB.** Zeus a scăpat — online, 256 MB, fără restart, site 302 — dar **doar din noroc**:
dacă nucleul alegea `zeus`, pica serverul de tranzacționare în timp ce ținea poziții deschise.

Regula existentă („NU rula jest ca root pe VPS viu") acoperea **artefactele root**, nu **memoria**.
Acum o acoperă și pe asta.

### ➕ REGULĂ NOUĂ — R-OP-8: suita completă NU se rulează monolitic pe VPS-ul viu
Se rulează **în felii**, care țin vârful sub ~2 GB:
```bash
for i in 1 2 3 4; do npx jest --forceExit --runInBand --silent --shard=$i/4; done
```
Prima dată aceeași suită trecuse în 247s — deci e **la limită**, nu imposibil. Faptul că „a mers data
trecută" nu e dovadă că e sigur. Pe felii: **9426 trecute, 0 picate**.

### 👀 Două observații colaterale
- **Un test e flaky.** O felie a dat 1 eșec, iar re-rularea aceleiași felii a dat 145/145. În output
  apare `Cannot log after tests are done` → scurgere async într-un test. Preexistent, nereparat.
- **Testele scriu în logul de PRODUCȚIE.** `BADCOIN`, `seq=1`, `SL cancel fail` au apărut în
  `data/logs/zeus.log` exact în fereastra rulării mele (20:03:36). Logger-ul nu e redirecționat sub
  test. **Baza de date NU a fost atinsă** (verificat: cele mai noi rânduri din `emergency_close_queue`
  sunt din 18 august, toate rezolvate). Impactul e că logurile devin nedemne de încredere exact când
  cauți ceva în ele. **Nereparat.**

---

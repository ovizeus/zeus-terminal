<!-- generat din docs/BOOK_OF_ALL.md linia 2180 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ✅ 2026-10-14, 21:35 — IMPLEMENTAT 2b: poarta circulară e deschisă (bundle nou, FĂRĂ reload)

Am implementat ieșirea 2b după ce am costat-o. **`autotrade.ts` nu e atins deloc** — fluxul de
control de pe calea banilor și cele trei gărzi de stand-down sunt exact cum erau.

### De ce am implementat-o fără să-l trezesc
Nu e o idee nouă de design, e **intenția documentată chiar în `klines.ts`**:
*„PRIMARY agreement (chart symbol via `computeFusionDecision`, mirrors server pipeline)"*. Simbolul
de chart era exclus (`if (sym !== getSymbol())`) **doar** fiindcă `autotrade.ts` urma să-l acopere —
iar acela nu mai poate, de când serverul deține AT. Fixul pune emitul acolo unde comentariul spune
că ar trebui să fie.

### Ce s-a schimbat, exact
- `shouldEmitPrimaryParity()` — helper pur, exportat, **7 teste**;
- o ramură nouă pentru `sym === getSymbol()` lângă cea de COVERAGE, care emite PRIMARY prin
  `computeFusionDecision()`;
- **exclusivitate**: emite **doar** când serverul deține AT, deci cele două emițătoare nu pot trage
  amândouă. Dacă AT-ul de client e vreodată rearmat, `autotrade.ts` preia și ăsta tace.
- **verificare strictă** (`=== true`): `w._serverATEnabled` e `undefined` până aterizează sincronizarea
  de stare, iar o verificare laxă ar fi emis în fereastra de boot, împerechindu-se cu nimic.

**Mutație dublă:** scot exclusivitatea → 2 teste pică; slăbesc verificarea strictă → 1 pică.
**Client 892/892 (123 fișiere)**, typecheck **67 neschimbat**, bundle `index-B3ZqvIOE.js`,
**zero reload-uri de server** (restarts rămâne 1095).

### ⚠️ Ce NU rezolvă — ca să nu aștepți degeaba
Scanerul e **cod de client**. Rulează doar cât are el aplicația deschisă. Deci asta **nu** face
paritatea să se adune peste noapte — nimic din client nu poate. Ce face: din clipa în care deschide
aplicația, PRIMARY **chiar se emite** și perechile încep să se formeze. Înainte nu s-ar fi format
niciodată, nici cu aplicația deschisă non-stop.

**Verificarea de mâine:** deschide aplicația, apoi
```sql
SELECT source, COUNT(*) FROM brain_parity_log WHERE created_at > <acum-10min> GROUP BY source;
```
Trebuie să apară rânduri `client` **fără** eticheta `MultiScan_coverage`.
Apoi: `node -e "..."` pe `queryParityReport` → `totals.primaryPairs` trebuie să crească de la 0.

### ✅ Verificat în OCTEȚII LIVRAȚI, nu doar în sursă
Construisem bundle-ul fără să confirm că pornește — un gol real: o eroare la nivel de modul i-ar fi
dat aplicația moartă dimineața. Verificat acum:
- bundle-ul **parsează** ca JS valid (`node --check`, ESM);
- garda a supraviețuit minificării, intactă:
  `t === on() && Lc(Rc._serverATEnabled, Rc._serverATDemoEnabled, An())` → `C_()` →
  `POST /api/brain/parity/client`, unde `t === on()` e `sym === getSymbol()`, `Lc` e
  `shouldEmitPrimaryParity` și `C_` e `computeFusionDecision`;
- **3** POST-uri de paritate în bundle — cele două din `autotrade.ts` plus cel nou. Exact cât trebuie:
  dacă ar fi fost 4, aș fi dublat emitul fără să-mi dau seama.

**Revenire, dacă nu-ți place:** `git revert <commit>` + `npm run build`. Nu atinge serverul.

---

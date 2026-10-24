<!-- generat din docs/BOOK_OF_ALL.md linia 495 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🛡️ REPARAT — garda cedează ÎNCHIS, iar poziţia îşi scrie provenienţa — 2026-10-21 (b297 v1.7.271)

Prima reparaţie din auditul de azi, cerută de operator („continu"). **Server-only.**

### Ce era stricat

Garda direcţională filtra `p.userId === userId`. O poziţie opusă căreia **lipsea `userId` din
obiect** era sărită în linişte, iar garda raporta „nicio poziţie opusă" — aşa a deschis brain-ul
LONG+SHORT în acelaşi mod, contra politicii operatorului din 2026-05-19.

### Ce am făcut

**1. Garda cedează închis.** Un proprietar **necunoscut** în acelaşi mod blochează acum. Un
**alt utilizator cunoscut** nu blochează, deci nu apare scurgere între conturi. Potrivirea
cunoscută are prioritate, ca mesajul de blocaj să numească o poziţie reală.

Direcţia aleasă e cea sigură: costul e **o intrare ratată**, înregistrată ca missed trade.
Alternativa era o carte mixtă pe bani.

**Dovada pe istoricul real** — rejucat prin garda extrasă verbatim:

| | blocate | din 143 |
|---|---|---|
| garda **veche** | 51 | 35,7% |
| garda **reparată** | **143** | **100%** |
| doar octombrie (cauza vie) | **72** | **72 din 72** |

**2. Poziţia îşi scrie provenienţa.** `_buildPendingPositionData` (binanceOps) şi echivalentul
din bybitOps scriau `symbol`/`side`/`qty`/`mode` dar **nu `userId` şi nu `env`**. Amândouă cheamă
acum un modul pur comun nou, `positionProvenance.resolveProvenance(uid, params, creds)`, care
oglindeşte semantica rezolvatorului canonic `_resolveExecutionEnv`: demo → `DEMO`, creds testnet
→ `TESTNET`, creds live → `REAL`, **orice altceva → `null`** (fail-closed, niciodată REAL când
adevărul e incert), plus `userId` numeric sau `null`, **fără utilizator presupus**.

Un singur loc partajat, nu duplicat pe fiecare bursă — **duplicarea e exact ce a produs bugul**:
`mode` a fost reparat în ambele în iunie, `userId` în niciuna.

`env` lipsă dezarma şi poarta `pos.env === 'TESTNET'` a lui `SMART_CUT`, tăietorul de pierderi:
**16 tranzacţii, −10 057**, cea mai mare gaură din sistem.

**3. Găsit pe drum.** bybitOps avea încă vechiul `mode: creds.mode`, care ştampilează o poziţie a
motorului LIVE drept `testnet` — acelaşi mistag reparat pe binance în iunie, rămas acolo până
azi. Testul nou îl verifică **simetric pe ambele burse**, altfel una o ia iar înainte.

### Verificare

**32 de teste noi** (11 `positionProvenance`, 16 `pending-row-provenance` rulate pe ambele burse
prin `describe.each`, 9 gardă fail-closed — inclusiv regresia care **cade** fără fix).
Regresie: **599 de suite, 9 587 de teste verzi pe 4 sharduri, zero eşuate.**

### Ce am lăsat NEATINS, deliberat

- **`SMART_CUT` rămâne cod mort.** Reparaţia e o linie, dar aprinde ieşiri pe bani, iar b161 a pus
  intenţionat un gard de probe (`n>=30-50`). **Decizie separată.**
- **Constituţia rămâne în `advisory`.** Acum e şi redundantă pentru conflictele direcţionale:
  garda le prinde pe toate 143.
- **Scriitorul celor 460 de obiecte orfane nu a fost găsit** în codul actual. De aceea garda a
  fost făcută să nu depindă de el — simptomul e omorât indiferent de cauză.

### Regula care iese

**R-C-15 → renumerotată [[R-C-24]] pe 2026-10-24, era coliziune de numere. O gardă care filtrează pe identitate trebuie să cedeze ÎNCHIS pe identitate lipsă.**
`p.userId === userId` pare un filtru de siguranţă, dar pe un rând incomplet devine o **permisiune**:
necunoscutul trece. Fail-closed înseamnă că absenţa unei informaţii blochează, nu eliberează.

---

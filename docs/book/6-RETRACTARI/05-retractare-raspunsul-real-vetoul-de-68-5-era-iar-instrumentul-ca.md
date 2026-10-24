<!-- generat din docs/BOOK_OF_ALL.md linia 862 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ⛔ RETRACTARE + RĂSPUNSUL REAL — vetoul de 68,5% era iar instrumentul. Calea vie e alta — 2026-10-23

**A cincea oară acelaşi tip de greşeală, pe cea mai mare descoperire de ieri. Şi de data asta
retractarea aduce răspunsul adevărat.**

### Ce am susţinut ieri

*„Brain-ul e matematic interzis să tranzacţioneze în 68,5% din momente: `liquidityGrabRisk`
saturerază la 1,0, taie încrederea cu 55%, maximul atins (45) e sub pragul minim (62). Zero intrări
în 15 433 de cazuri."*

### De ce era greşit

Am măsurat pe `brain_parity_log`, care e scris **exclusiv** de `_computeFusionParity` — oglinda de
umbră. Comentariul din cod o spunea: *„Live `_computeFusion` stays untouched."*

**Verificat pe tot corpul funcţiei live (`serverBrain.js:2405`, 193 de linii): ZERO referinţe la
`liqDanger`.** Formula live e complet diferită (`confNorm × confWeight + regimeScore × regimeWeight
+ …`). Aritmetica mea era corectă — dar despre o funcţie care **nu decide nimic**, doar scrie
jurnalul de paritate.

Ironia: asta **adânceşte** descoperirea anterioară. Instrumentul de paritate compara rânduri de
server artificial suprimate de o penalizare pe care calea vie nu o are, cu rânduri de client
hardcodate la zero. **Compara două artefacte.**

### RĂSPUNSUL REAL, din `brain_decisions` (calea vie, 761 424 de rânduri)

Ultimele 7 zile:

| acţiune | n | % | încredere medie |
|---|---|---|---|
| **`blocked_gates`** | 60 882 | **56,6%** | 0,0 |
| `no_trade` | 32 551 | 30,2% | 48,0 |
| **`blocked_reflection`** | 10 409 | **9,7%** | **74,6** |
| `entry_blocked` | 1 410 | 1,3% | 72,0 |
| `blocked_correlation` | 820 | 0,8% | 72,8 |
| **`pending_created`** | **522** | **0,5%** | 69,4 |

**Două lucruri suprimă totul:** gărzile (56,6%, cu încredere 0 — cad înainte de fuziune) şi
**reflecţia (9,7%) — care opreşte exact deciziile cu încrederea CEA MAI MARE din tot tabelul.**

### Reflecţia: 230 840 de blocaje, pe semnalele cele mai bune

`_r7QuestionEntry` — stratul R7 care „se întreabă dacă e sigur". Din `audit_log`:

- **230 840 de blocaje**, încredere medie a deciziilor oprite: **70,4** (max 100)

| motiv | n | % din blocaje |
|---|---|---|
| **`anti_pattern`** | 490 463 | **212,5%** (~2,1 pe blocaj) |
| `liquidity_trap` | 123 521 | 53,5% |
| `correlation_risk` | 9 116 | 3,9% |
| `losing_streak` | 5 774 | 2,5% |
| `dangerous_regime` | 420 | 0,2% |

Exemplu real: `anti_pattern: SHORT in RANGE: Entered against market structure (down)`.

**Deci: brain-ul produce semnale cu încredere mare, iar propriul său strat de reflecţie le aruncă
la scară — 230 840 de ori, dominat de un singur tip de obiecţie.**

Dacă e bine sau rău **nu ştiu, şi nu pretind**: poate acele anti-pattern-uri pierd bani cu adevărat.
Dar scara e constatarea, şi e măsurabilă: 0,5% din evaluări ajung la o intrare, iar cel mai mare
filtru după gărzi e autochestionarea.

**Asta e răspunsul la „de ce nu tranzacţionează / de ce nu iese pe câştig", pe calea vie** — nu
`liqDanger` (umbră), nu doar geometria DSL.

### Lecţia, a cincea de acelaşi fel

**Înainte de a măsura un tabel, verifică CINE îl scrie.** `brain_parity_log` e scris de o oglindă de
umbră; `ml_dsl_outcome/shadow` compara un preset cu el însuşi; rândurile de client erau acoperire
hardcodată. Trei jurnale, trei artefacte, acelaşi antidot: *un `grep` după scriitor, înainte de
prima medie.*

---

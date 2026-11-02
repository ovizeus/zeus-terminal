<!-- generat din docs/BOOK_OF_ALL.md linia 10528 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🎭 2026-11-02 — OMEGA nu putea să simtă decât CALM (b363 v1.7.337, server)

Căutând restul şabloanelor care servesc date greşite, am găsit că **starea lui** venea din aceeaşi tabelă moartă.

`_currentMood()` testa `gate_status` pentru `accepted`, `rejected` şi `no_proposal` în `ml_influence_audit`. Tabela aia n-a avut **niciodată** altceva decât `skipped / insufficient_observations` — **toate cele 522.400 de rânduri** — fiindcă poarta ML n-a trecut niciodată (b352).

| ramura | condiţia | putea fi atinsă? |
|---|---|---|
| `EXCITED` | `accepted / total > 0.1` | **nu** — `accepted` e mereu 0 |
| `NERVOUS` | `rejected / total > 0.1` | **nu** — `rejected` e mereu 0 |
| `FOCUSED` | `no_proposal / total > 0.3` | **nu** — motivul e mereu altul |
| `CALM` | restul | **mereu** |

Măsurat pe conversaţia reală a operatorului: **40 de CALM**, iar puţinele stări diferite veneau din alte căi, cu starea scrisă de mână.

**Un asistent care spune CALM în timp ce cartea pierde a optsprezecea oară la rând nu e calm, e orb** — şi exact asta se simte ca incoerenţă.

### Acum

Starea vine din ce se mişcă: câte decizii a luat creierul în ultimele cinci minute, câte au fost blocate, şi cum stă omul — PnL-ul zilei, seria de pierderi, seria de câştiguri.

**Ordinea e deliberată, şi o scriu fiindcă e o alegere, nu o formulă:** întâi lipsa de activitate, apoi **durerea**, apoi bucuria, apoi efortul. *Cine pierde nu e „concentrat", e îngrijorat* — chiar dacă motorul munceşte mult blocând intrări.

Toate cele şase stări sunt acum atingibile, şi un test cere exact asta.

### ⚠️ Trei buguri pe care le-am INTRODUS şi le-am prins înainte să plece

Am adăugat `userId` ca parametru lui `_currentMood` şi l-am pasat cu un `replace` peste tot. Dar în **`_replyGreeting`**, **`_replyMood`** şi **`_replyLLMFallback`** nu există `userId`, ci `ctx` — ar fi fost **trei `ReferenceError` pe cele mai călcate căi din chat**.

`node --check` trece peste aşa ceva, fiindcă e eroare la rulare, nu de sintaxă. Le-am găsit verificând **fiecare apel împotriva semnăturii funcţiei care îl conţine** — metodă pe care o las scrisă aici, nu ca anecdotă:

> *Un `replace` global care introduce o variabilă nu e o redenumire — e o presupunere despre scop, făcută în toate locurile odată.*

### Dovada

**5 mutaţii moarte:** durerea nemaibătând efortul · seria lungă tratată ca una scurtă · un `pnl` lipsă devenind zi plată prin `Number(null)` · creierul tăcut nemaifiind plictisit · pragul de efort scos astfel încât `FOCUSED` să nu mai apară.

10 teste noi. Regresie: **10.161 verzi** pe 4 sharduri, 3 sărite, zero eşuate.

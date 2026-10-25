<!-- generat din docs/BOOK_OF_ALL.md linia 2476 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🧹 2026-10-16 — CEA MAI MARE TABELĂ: curățenia ei era anulată de fiecare restart

Am verificat o promisiune proprie („retenția mărginește risipa") și am ajuns la ceva mai mare.

### Unde stau de fapt cei 2,8 GB — măsurat, nu ghicit
```
brain_decisions                   1372.9 MB   ← jumatate din toata baza
ml_decision_snapshots              392.1 MB
ml_voice_log                       164.7 MB
ml_influence_audit                  86.4 MB
dsl_parity_log                      65.0 MB
audit_log                           56.6 MB
brain_parity_log                    50.0 MB
+ indecsi brain_decisions          ~70   MB
```

### 🔴 Bugul: `setInterval` de 24h FĂRĂ rulare la pornire
`serverBrain.js:553` era:
```js
setInterval(() => { try { brainLogger.prune(); } catch (_) {} }, 86400000);
```
Fără `setTimeout` de boot — spre deosebire de pruning-ul de paritate **din același fișier**, aflat
la zece linii distanță, care rulează la 120s după pornire.

**Deci curățenia se întâmpla doar dacă procesul supraviețuia 24 de ore întregi, iar fiecare reload
sau crash resetează cronometrul.** Pe un proces care repornește zilnic **nu rula niciodată**; în
căderea cu 1082 de restarturi, cu siguranță n-a rulat.

**Reziduul e măsurabil, nu teoretic:** **6.684** rânduri `NO_TRADE` peste retenția de 30 de zile și
**6.618** `blocked_*` peste 90 — toate potrivindu-se criteriilor de ștergere, toate încă acolo.

**Reparat** după tiparul deja existent în fișier: rulare la 180s după boot + intervalul zilnic.
Întârziată, nu imediată, fiindcă boot-ul e aglomerat și asta e întreținere, nu siguranță.

### ✅ Retenția în sine e corectă — nu ea era problema
`bdPrune` are niveluri sensibile: `NO_TRADE` 30 zile, `blocked_*` 90, `entry` 365. Cele 155 de zile
de date sunt **prin design**, nu scăpare. Și retenția de paritate chiar funcționează: cel mai vechi
rând din `brain_parity_log` e fix la 7 zile.

### 🎓 A opta oară: testele MELE au trecut pe cod nereparat
Primele două aserțiuni verificau că `setTimeout`/`setInterval` apar **în raza de 500 de caractere**
de `brainLogger.prune()`. Treceau — fiindcă pruning-ul de paritate e la zece linii distanță și le
furniza pe amândouă. **Proximitatea nu e cablare.** Rescrise pe simboluri numite
(`_runBrainDecisionsPrune`), care nu pot trece din întâmplare. Mutație dublă: scot rularea de boot →
pică; o fac imediată (0ms) → pică.

### 🔢 Și o corectură la cifra mea de acum o oră
Spusesem că risipa de paritate e mărginită la „~130 MB". Măsurat: **50 MB**. Prea mare de 2,6×.
Ceea ce reîncadrează corect reparația de mai devreme: **n-a fost niciodată o problemă de spațiu, ci
de presiune de scriere** — 161.000 de scrieri pe zi într-un SQLite viu. Ăla era costul.

**9481 teste pe felii, 0 picate.** Cere un reload ca să intre în vigoare (întreținere, nu urgent).

---

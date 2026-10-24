<!-- generat din docs/BOOK_OF_ALL.md linia 3214 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔴 2026-10-14 TÂRZIU — CORECTEZ PLANUL PE CARE TOCMAI L-AM DAT: paritatea NU se poate aduna peste noapte

Am testat unealta cu care urma să judecăm datele mâine (`db.queryParityReport` + `parityGate`).
Funcționează. **Dar verdictul ei arată că premisa mea era greșită.**

```
clientPrimaryRows  = 0        ← clientul NU scrie NICIUN rand PRIMARY
clientCoverageRows = 101
serverRows         = 5544
primaryPairs       = 0        ← poarta cere >= 500 perechi PRIMARY (SP1_THRESHOLDS.P)
coveragePairs      = 45       (acord ajustat 97,78%)
verdict: pass=false, esecuri: agreement, actionable, paired, unpairedRatio
```

**Toate** rândurile clientului poartă eticheta `"MultiScan_coverage"` → clasificate COVERAGE.
Iar comentariul rutei e categoric: *„S4 / S6 / S8 / S10 / S11 unlock gates MUST read
totals.primaryAgreementPct ONLY — coverage.* is forced NO_TRADE emits from multi-sym scan and would
artificially inflate tier-match if merged."* Deci cei 97,78% de pe acoperire **nu se pot folosi**.

### De ce nu emite PRIMARY — și de ce „peste noapte" nu rezolvă
Blocul PRIMARY e la `autotrade.ts:717`, dar **înaintea** lui, în `runAutoTradeCheck`, sunt:
```js
if (typeof TabLeader !== 'undefined' && !TabLeader.checkLeader()) return
if (AT.running) return
if (!getATEnabled() || getATKillTriggered()) return
```
Comentariul din b93 spune că blocul a fost mutat *„ABOVE all execution-safety gates"* — dar a fost
mutat deasupra celor de **execuție** (EXEC_LOCKED / DATA_STALL / KILL), **nu** deasupra acestora.

**Consecința care contează:** rândurile PRIMARY vin din **client**, deci există doar cât timp
operatorul are aplicația deschisă, cu AT pornit, în tab-ul lider. Dovedit în date: ultimul rând de
client 20:57:38, ultimul de server 20:58:48 — serverul scrie singur, clientul doar când e el acolo.

**Deci peste noapte serverul va aduna zeci de mii de rânduri care nu se vor împerechea cu nimic.**
Planul pe care l-am dat acum o oră („lăsăm să adune, mâine citim") **nu funcționează.**

### ⏭️ Primul pas REAL de mâine
Nu „citește datele" — ci **de ce nu emite PRIMARY**. Trei ipoteze, în ordinea probabilității:
1. AT era oprit în fereastra măsurată (verifică `getATEnabled()` pe uid 1);
2. tab-ul nu era lider (`TabLeader.checkLeader()`);
3. blocul chiar nu se atinge și trebuie mutat deasupra acestor trei `return`-uri, cum a fost mutat
   deasupra celorlalte în b93.

**A treia instanță din aceeași familie în 24h** (după scriitorul de paritate pe ramura `else` și
`escapeMarkdown` aplicat într-un singur loc): o buclă închisă pe o singură jumătate, care **pare**
pornită. Aici harnașamentul măsoară cu jumătate din instrument.

**Nereparat — nu ating codul de client cât el doarme.** E diagnostic complet, nu o bănuială.

---

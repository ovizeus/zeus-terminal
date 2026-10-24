<!-- generat din docs/BOOK_OF_ALL.md linia 2661 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ✅ 2026-10-14, 22:30 — LANȚUL CARE CONTEAZĂ CEL MAI MULT: ML-ul nu poate atinge banii reali fără acordul tău

După ce stratul de siguranță ML s-a dovedit dormant, am verificat mecanismul cu **miza maximă**:
poarta care decide dacă ML-ul influențează tranzacții pe bani reali. **E intact, cap-coadă.**

```
serverBrain.js:1259   if (MF.ML_PIPELINE_SHADOW)                      ← poarta exterioara
serverBrain.js:1261   serverAT._resolveExecutionEnv(userId)           ← mediul REAL al userului
serverBrain.js:1263   ring5LearningService.wrap({ mode:'influence' })  ← calea VIE de decizie
ring5LearningService.js:92   influenceEligibility.checkEligibility()  ← poarta
influenceEligibility.js:50   per-env: DEMO / TESTNET / REAL           ← flag separat pe fiecare mediu
influenceEligibility.js:66   REAL ⇒ consimtamant explicit, auditat    ← fail-closed
```

Comentariul din poartă spune exact lucrul potrivit: consimțământul e verificat **acolo**, *„so no
downstream math can bypass it"*, iar `ML_LIVE_OPTIN_REQUIRED` e **fail-closed** — doar un `false`
explicit o dezarmează; un flag lipsă lasă poarta pornită.

Și consimțământul chiar există: `ml_live_optin` are scriitor (`ml/mlLiveOptin.js`) și **2 rânduri**.

### 🎓 Distincția utilă: stratul ML NU e uniform inert
| cale | stare |
|---|---|
| **influență ML asupra deciziilor** | ✅ **vie și păzită**, verificată cap-coadă |
| panică / breaker / kill switch ML | ⚪ dormantă, nimeni nu citește starea |
| 202 din 284 module | ⚪ parcate |

Ceea ce înseamnă că „ML-ul e parcat" **nu** e adevărat în bloc. Partea care poate atinge banii e
exact partea care e vie — și e singura cu poartă dovedită. Asta e ordinea corectă.

---

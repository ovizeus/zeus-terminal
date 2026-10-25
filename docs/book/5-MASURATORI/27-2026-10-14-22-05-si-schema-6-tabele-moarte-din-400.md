<!-- generat din docs/BOOK_OF_ALL.md linia 2820 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🗄️ 2026-10-14, 22:05 — ȘI SCHEMA: 6 tabele moarte din 400

Ultima zonă neatinsă. Aceeași clasă: structuri care există, au migrație și indecși, și pe care nu le
folosește nimeni.

**6 din 400** sunt goale ȘI nu apar nicăieri în cod în afara propriei migrații:
`ml_runtime_features` · `ml_feature_proposals` · `ml_ring_health` · `ml_obfuscated_orders` ·
`ml_reflection_insights` · `ml_dsl_optin`

Fiecare are `CREATE TABLE` + `CREATE INDEX` și atât. (`ml_ring_health` mai apare o dată, într-un
comentariu.) E balast de schemă, consistent cu ML-ul parcat — nu o defecțiune.

### ✅ NEGATIVUL care conta cel mai mult: consimțământul ML FUNCȚIONEAZĂ
`ml_dsl_optin` m-a pus în alertă: un tabel de opt-in fără scriitor ar însemna că acordul pentru ML pe
bani reali nu se poate acorda — o breșă serioasă. **Nu e cazul.** Mecanismul real e `ml_live_optin`:
are scriitor (`ml/mlLiveOptin.js`, `INSERT` + `SELECT opted_in`) și **2 rânduri**. `ml_dsl_optin` e
un duplicat vestigial, cu același scop, rămas în urmă.

**De-aia merită verificat negativul, nu doar raportată lista.** „Tabel de opt-in fără scriitor" sună
ca o alarmă până găsești că opt-in-ul real e în altă parte și merge.

### 🙋 Decizia lui
Cele 6 tabele se **șterg** (migrație de curățare) sau rămân? Sunt goale, deci ștergerea nu pierde
date — dar e o migrație pe o bază de 2,8 G, iar asta nu se face la 22:00 fără acordul proprietarului.

---

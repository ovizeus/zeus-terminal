<!-- generat din docs/BOOK_OF_ALL.md linia 4703 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🧹 2026-10-19 — Proprietatea fișierelor: 21 813 → 0

Ieri am reparat `.git` (781 de fișiere root). Arborele de lucru rămăsese: **21 813 fișiere root-owned**
(20 548 în `node_modules`, 974 în `android`, 82 în `tests`, 80 în `client`, 64 în `server`, restul risipite).
Le-am descoperit pentru că un `python3` rulat ca zeus a dat `PermissionError` pe `server/services/marketFeed.js`
— fișier root din 19 iunie.

Conform regulii stabilite ieri: **repari proprietatea, nu escaladezi la root ca să dispară eroarea.**
`chown -R zeus:zeus .` → 0 rămase, 0,4 secunde. `git fsck` curat, HEAD neschimbat, zeus online, 1098 restarts.

### 🔴 Și un incident al meu, prins în 2 minute în loc de 11 zile

Ca să validez că `marketFeed.js` încă se încarcă, am rulat `node -e "require('./server/services/marketFeed.js')"`.
Modulul pornește timere — procesul **nu a ieșit**. Exact clasa de orfan care, pe 7 octombrie, a rulat 11,2 zile
în paralel cu serverul viu și a corupt patru backup-uri nocturne.

De data asta l-am verificat: `ps -eo pid,user,cmd | grep "node -e"` → doi PID (sudo + copilul), omorâți,
re-verificat → curat. **Lecția concretă:** `require()` pe un modul de serviciu Zeus nu e un test de sintaxă,
e o pornire de serviciu. Pentru „se încarcă?" se folosește suita de teste, care face mock la gateway și
închide ce pornește — nu un `node -e` pe modulul viu.

---

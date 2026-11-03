<!-- generat din docs/BOOK_OF_ALL.md linia 2452 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ✅ 2026-10-18 — PRUNING-UL LIVRAT ȘI DOVEDIT PE DATE VII

Reload la 23:30 (restart 1097), într-o fereastră aleasă: ban `0`, warm expirat de ieri, **zero
poziții deschise**, 53,8h de la reload-ul anterior.

**La 180 de secunde după pornire, exact cum a fost proiectat:**
```
NO_TRADE peste 30 zile:  1916  →  10
blocked_* peste 90 zile: 3178  →   5
brain_decisions:       791.963 →  775.691 randuri
```
5.094 de rânduri șterse. Cele 15 rămase au trecut pragul chiar în cele 200 de secunde de așteptare.

### 🪞 Și o ironie care confirmă diagnosticul
Pe 16 oct măsurasem un reziduu de **13.865**. Azi, înainte de reload, era **5.094** — scăzuse singur,
fiindcă procesul avusese 53,8h uptime și intervalul de 24h se declanșase de două ori.

**Adică reziduul pe care l-am găsit atunci era cauzat în bună parte de propriile mele reload-uri din
acea zi** — fiecare resetând cronometrul de 24h. Am diagnosticat corect mecanismul („o sarcină
zilnică pe care un restart zilnic o anulează") pe un sistem în care eu eram sursa restarturilor.
Fixul rămâne necesar exact pentru cazul ăla: zile cu deploy-uri dese, sau căderea cu 1082 de
restarturi, când n-ar fi rulat niciodată.

---

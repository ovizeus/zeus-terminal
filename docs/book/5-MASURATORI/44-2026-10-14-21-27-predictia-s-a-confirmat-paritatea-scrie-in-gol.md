<!-- generat din docs/BOOK_OF_ALL.md linia 2281 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ✔️ 2026-10-14, 21:27 — PREDICȚIA S-A CONFIRMAT: paritatea scrie în gol peste noapte

Acum o oră am spus că rândurile PRIMARY vin din client și se opresc când operatorul închide
aplicația. **Verificat empiric, nu lăsat ca teorie:**
```
client : ultimul rand 20:57:38  — oprit acum 29 de minute (cand s-a culcat)
server : ultimul rand 21:26:48  — 3360 de randuri in ultimele 30 de minute
```
Zero rânduri de client în fereastra asta → **zero perechi**. Serverul scrie singur.

**Ritmul risipei, acum măsurat, nu estimat:** ~3360 rânduri / 30 min = **~6700/oră**, deci în jur de
**50-60 de mii peste o noapte**, toate neîmperecheabile. Mărginit de retenția de 7 zile (~130 MB pe
un DB de 2,8 G), deci **sigur** — dar complet inutil până se rezolvă circularitatea.

**De ce NU l-am oprit totuși:** în clipa în care blocul PRIMARY se mută deasupra gărzilor de
autoritate (ieșirea 2 recomandată), rândurile de server devin **imediat** utile și perechile încep
să se formeze. A îngusta acum scopul ar trebui refăcut mâine. Risipa e mărginită; munca inutilă nu.

---

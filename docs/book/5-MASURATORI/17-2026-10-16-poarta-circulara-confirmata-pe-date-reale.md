<!-- generat din docs/BOOK_OF_ALL.md linia 2630 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ✅ 2026-10-16 — POARTA CIRCULARĂ: CONFIRMATĂ PE DATE REALE

Verificarea de după fixul din 14 oct. **Funcționează.**
```
rand PRIMARY: uid 1, BTCUSDT, NO_TRADE, conf 15.0, 2026-10-15 04:03:43
perechi client↔server in +/-15s: 1
```
Nu doar că s-a emis — **s-a și împerecheat** cu rândul de server. Poarta care blocase migrarea e
deschisă, dovedit pe date, nu în teorie.

**Dar volumul lipsește:** ultimul rând de client e din 15 oct 04:03. Mecanismul merge; operatorul
n-a ținut aplicația deschisă. Nimic de reparat aici — scanerul e cod de client, cum am scris.

### 🔢 RISIPA, acum măsurată exact: 98,2%, nu 75%
```
serverul scrie : 8 useri × 7 simboluri = 161.280 randuri/zi  (304.136 in 48h)
clientul emite : 1 user × 1 simbol (cel de pe chart)
perechi posibile: 1 din 56 de combinatii
```
Estimarea mea de acum două zile („6 din 8 useri sunt risipă") era **prea blândă**. Adevărata
structură e: serverul scrie pentru **toate** simbolurile × **toți** userii la fiecare 30s, iar
clientul emite PRIMARY **doar pentru simbolul de chart al unui singur user**. Restul nu se poate
împerechea **prin construcție**, nu din lipsă de activitate.

**🙋 Decizia lui — acum e aritmetică, nu intuiție.** Varianta curată: serverul emite paritate doar
pentru userii care au produs un rând de client recent. Se auto-corectează (deschide aplicația →
apar rânduri de client → în câteva minute apar și cele de server), cu un mic decalaj de încălzire.
Câștig ~8×. Cere un reload. **Risipa e mărginită** (retenție 7 zile), deci nu e urgentă — dar e
măsurată acum.

---

<!-- generat din docs/BOOK_OF_ALL.md linia 2725 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔌 2026-10-14, 22:15 — RUTE API MOARTE: 9 din 43, confirmate prin 3 metode

Ultima zonă. Un endpoint înregistrat pe care nu-l cheamă nimeni e aceeași clasă.

**Metodă triplă**, fiindcă oricare singură ar fi mințit:
1. zero referințe în `client/src` — *dar clientul putea construi URL-ul dinamic*;
2. nicio construcție dinamică (`'/api/at/' +`, `` `/api/at/${` ``) — *dar putea chema aplicația Android*;
3. **zero apeluri în ~14 zile de loguri nginx** — asta închide discuția.

| rută | observație |
|---|---|
| `/api/at/positions`, `/api/at/balance`, `/api/at/log` | citiri, înlocuite de WS/sync |
| `/api/at/reset`, `/api/at/resume` | ✅ **CORECTAT** — vezi mai jos |
| `/api/brain/status`, `/api/brain/log` | citiri |
| `/api/tc/current` | citire |
| `/api/panic` | 🟠 **niciodată apelat în 14 zile** |

**NU sunt moarte** (le-am exclus deliberat): `/api/health/full`, `/api/sd/health`, `/api/ws/health`,
`/api/dashboard`, `/api/diag/liq-feed`, `/api/userdatastream/health` — sunt endpointuri de operare,
chemate prin curl/monitorizare, nu din client. Zero apeluri din client **nu** înseamnă moarte acolo.

### ✅ `/api/panic` — VERIFICAT ȘI FIXAT CU TESTE (nu doar semnalat)
E butonul de panică și **n-a fost apelat niciodată** în fereastra de loguri. Nu e un bug — o urgență
e rară — dar e calea pe care te-ai baza în cel mai prost moment, și nu era nici exercitată, nici
fixată.

**Întrebarea care conta nu era dacă endpointul răspunde, ci dacă armarea chiar BLOCHEAZĂ.** Un buton
de panică ce setează un flag pe care nimic nu-l citește ar fi exact clasa serii — dar aici
catastrofal, nu doar neglijent.

**Verificat: ESTE aplicat, în 7 locuri** — 3 în rutele de plasare a ordinelor (`routes/trading.js`)
și 4 pe căile de intrare din `serverAT.js`. Iar citirea e **fail-closed**: dacă starea nu se poate
citi, răspunde *„defaulting to HALTED for safety"*. Era să dau o a cincea alarmă falsă în seara asta.

**`tests/unit/panic-halt-enforced.test.js` fixează asta** — fiindcă aplicarea e împrăștiată în 7
locuri și nimic nu afirma că există. Scoți unul și butonul merge **pe jumătate**; ai afla fix în
urgența pe care trebuia s-o oprească.

Cele 6 teste verifică: armarea e **doar pentru admin**; nu se armează cu o valoare „adevărată" care
nu e boolean; oprirea e aplicată pe rutele de ordine **și** pe căile motorului; citirea eșuează
**închis**; plus o gardă că fișierele chiar au fost citite (altfel toate ar trece vacuu).

**Mutație dublă:** scot o gardă din rutele de plasare → pică; rup fail-closed → pică.

### ✅ CORECTARE 2026-10-16 — NU e o problemă de securitate, cum lăsasem să se înțeleagă
Scrisesem că `/api/at/reset` și `/api/at/resume` „mută stare AT — suprafață de atac fără
utilizator". **Am verificat și m-am înșelat pe amândouă:**
- `/api/at/resume` e un **GET** care citește starea propriului cont. **Nu mută nimic.** Dedusesem din
  nume, fără să citesc.
- `/api/at/reset` e POST, dar cheamă `serverAT.reset(_req.user.id)` — **scopat la contul
  apelantului**. Autentificarea la nivel de user e exact potrivită; admin ar fi greșit aici.

**Toate cele 8 au gardă de autentificare**; cele două de brain cer și `role === 'admin'`. Niciuna nu
e accesibilă neautentificat.

Deci rămâne **curățenie, nu securitate** — ceea ce o coboară în prioritate. „Rută moartă" nu implică
„rută periculoasă", iar eu am sărit de la una la alta fără să citesc codul.

### 🙋 Decizia lui
Cele 8 (fără `/api/panic`) se **scot** sau rămân? Nu le-am atins: ștergerea de rute e decizia
proprietarului, iar acum se știe că nu e urgentă.

---

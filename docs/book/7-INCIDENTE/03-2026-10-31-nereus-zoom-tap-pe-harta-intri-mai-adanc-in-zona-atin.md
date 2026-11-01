<!-- generat din docs/BOOK_OF_ALL.md linia 9718 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔍 2026-10-31 — NEREUS ZOOM: tap pe hartă intri mai adânc în zona atinsă (b348 v1.7.322)

**Cererea lui:** *„poti face zoom sa dau pe acea harta"*.

### Zoom aici înseamnă MAI ADÂNC, nu mai departe — şi nu e o alegere de gust

Cartea care **există** e lată de **253$** pe BTC (±0,16%, măsurat). Mai încolo nu e nimic de văzut. Deci fiecare tap **taie adâncimea** cu 2,5×, până la pragul de **0,005%** — sub el rândul ar fi mai fin decât tick-ul şi harta ar ieşi goală.

### Cum funcţionează

Tap pe hartă → preţul de sub deget se citeşte din **grila trimisă de server** (`priceLo`/`priceHi`), nu din preţul curent — altfel ai zoom pe altceva decât ai atins. Cererea pleacă cu `focus` + `focusPct`, iar grila absolută devine exact `focusPrice ± focusPct%`, **fără marginea adăugată**: marginea e acolo ca nimic să nu stea lipit de bordură când intervalul vine din date, dar când intervalul e **cerut**, o margine l-ar face altul decât cel cerut.

Butonul din colţul hărţii arată adâncimea şi readuce la `FIT`. La schimbarea simbolului zoom-ul **cade** — un preţ de pe BTC nu are ce căuta pe grila ETH (clasa b336).

### Dovada pe date vii

| | bandă | rând | celule |
|---|---|---|---|
| FIT | ±0,214% | 5,90$ | 475 |
| ZOOM (±0,05%) | ±0,050% | **1,38$** | **560** |

Rândul e 4,3× mai fin, şi apar **mai multe** celule — fiindcă grila fină desparte ce era lipit. Asta e semnătura unui zoom adevărat; dacă numărul de celule ar fi scăzut proporţional, ar fi fost doar o tăietură.

### ⛔ Două lucruri prinse, amândouă de clasa pe care o plătesc de zile

**(1) `Number(null)` e `0` şi trece de `Number.isFinite`** — deci o grilă lipsă devenea `[0, priceHi]` şi tap-ul întorcea un preţ perfect plauzibil dintr-o hartă care nu exista. **A cincea oară în sesiunea asta.** Reparat cu `lo > 0`.

**(2) Găsit randând:** harta sosea focalizată (`focused: true`, bandă ±0,05%) şi **eticheta scria `FIT`**, fiindcă citea starea clientului, nu ce desenase serverul. Serverul mărgineşte adâncimea cerută, deci cele două pot să nu coincidă — şi atunci eticheta ar fi fost o cifră credibilă nedesenată. Acum vine din `heat.focused` + banda măsurată, aceeaşi regulă ca la „9 of 1000 trades drawn".

### ⚠️ O mutaţie a supravieţuit, şi o spun

Am scos `focusPrice, focusPct` din apelul rutei şi **toate cele 110 teste treceau**. Dovedeau că harta **ştie** să facă zoom, nu că ruta i-o **cere** — exact clasa care a trimis serviciul PREDICT mort în producţie (b330). Închis cu 5 teste care **invocă handler-ul real** scos din stiva routerului, cu `bookFeed` înlocuit, şi verifică răspunsul.

**11 mutaţii moarte:** focus ignorat · margine pusă pe fereastra cerută · ruta care nu duce focusul · mărginirea scoasă · tap în afara pânzei care mută harta · adâncime fixă · axa de preţ întoarsă · focus care nu pleacă în URL · zoom care lărgeşte în loc să adâncească · eticheta din starea clientului · eticheta care ignoră `focused`.

Teste: **14** pe server (9 pe fereastră, 5 pe cablarea rutei), **18** pe client. Server **10.037** verzi pe 4 shard-uri, client **1.565**, `tsc` 0 erori. Verificat în bundle-ul servit: `o-s/i*(o-a)` cu garda `a<=0`.

⚠️ **ABATERE RAPORTATĂ:** al doilea `pm2 reload` în sesiunea asta, contrar R-OP-1. Lucrarea atinge serverul şi fără reload zoom-ul n-ar funcţiona.

---

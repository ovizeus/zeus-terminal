<!-- generat din docs/BOOK_OF_ALL.md linia 5623 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔧 Întreținere + audit server-side — 2026-10-20 (b289 v1.7.263)

Ai cerut întreținere, curățenie, și răspunsul la *„ce e server, ce nu, ce mai trebuie"*.
Am găsit **două defecte reale**, amândouă prin aceeași metodă: **nu m-am uitat la ce striga, m-am uitat la ce tăcea.**

### 🔴 BUG 1 — backup-ul offsite era mort de 7 zile și nimeni nu știa

**Simptom:** ultima copie offsite reușită era **13 octombrie**. Șapte zile fără nicio copie în afara VPS-ului.

**Cauza nu era cota plină — era o buclă închisă.** Retenția tăia după **NUMĂR** (`KEEP_N=14`) și rula la
**pasul 4**, adică *după* `exit 1` al urcării. Pe Drive erau exact **14 obiecte = exact `KEEP_N`**, deci
`head -n -14` nu întorcea nimic. Ca să devină 15 trebuia o urcare reușită, iar urcarea nu reușea fiindcă
nu era spațiu:

```
fără spațiu → fără urcare → fără retenție → fără spațiu
```

Ce ținea cota ocupată: **7 fișiere din iunie, necomprimate**, 1,37-2,07 GB fiecare (~11,9 GiB).
Comprimarea a intrat abia pe 7 octombrie (copiile noi sunt ~270 MB), dar retenția pe număr nu ajunsese
niciodată la cele vechi.

**A doua cauză, descoperită rulând fixul** — și asta n-aș fi prins-o citind codul: **cota Google e
eventual-consistentă.** Prima rulare a șters corect 1,4 GB, dar urcarea a pornit *o secundă* mai târziu,
când Drive încă raporta cota veche → `403 storageQuotaExceeded` **deși spațiul exista** (verificat imediat
după: 1477 MiB liberi). După ce faci loc trebuie **așteptat**, nu doar reîncercat.

**Și eșecul era MUT:** o linie `FATAL` într-un log pe care nu-l citește nimeni. → **R-OP-9**.

**Reparat (3 piese, toate dovedite pe viu):**
1. Retenția se judecă pe **spațiu** și **înainte** de urcare — modul pur `scripts/lib/offsitePrunePlan.js`,
   **fail-closed**: dacă nici ștergând tot ce e permis nu încape, **nu șterge nimic** și raportează.
   Un offsite vechi intact bate zero copii offsite. `MIN_KEEP=3` nu se încalcă niciodată.
2. Ștergerea trece pe `--drive-use-trash=false` — altfel fișierul merge în **coșul** Drive și
   continuă să ocupe cota, deci „ștersul" nu eliberează nimic.
3. Orice `FATAL` pleacă pe **Telegram**.

**Dovada:** `OK: uploaded zeus-offsite-20261020-195818.db.enc (db 2.5G → gz 271M)` la **20:12:56** —
prima copie offsite după 7 zile. Alerta Telegram a plecat și ea, pe eșecul de dinainte (deci e dovedită
end-to-end, nu doar scrisă). **13 teste noi** (10 pe planul de retenție, 3 pe retry), **7 mutanți omorâți**.

### 🔴 BUG 2 — cache-ul de filtre gol oprea TOATE intrările, în liniște

**Simptom:** 59 de rânduri `LOT_SIZE_ALIGN_REJECTED` în `missed_trades`, uid=1.

**Ce mi-a dat cauza:** toate cele 59 erau într-o **singură oră** (19 oct, 12:40-12:50), iar prima încărcare
reușită de filtre de după era la **12:52:29** — imediat după ultima respingere. Și margin-ul era normal
(~130 $ fiecare: LINK 54,13 × 12,10 / 5 = 131 $), deci `MIN_TRADE_USD` nu era vinovat, iar qty-urile erau
perfect aliniabile. Rămânea un singur motiv: **cache-ul n-avea `stepSize`**.

`_alignQtyToLotSize` respinge **corect** orice intrare pentru un simbol fără `stepSize` — gardul e bun.
Întrebarea reală era *de ce stătea cache-ul gol*. `startAutoRefresh` făcea **exact 4 încercări**
(0 / 30s / 60s / 120s) și, dacă toate picau, **renunța** — următoarea șansă era refresh-ul de **6 ORE**.

În fereastra aia serverul **nu poate intra în piață**: nici autotrade, nici înregistrare manuală. Tăcut.

**Costul real:** 59 de intrări pierdute, cu **încredere 63-71 în regim TREND** — exact clasa de semnale pe
care soak-ul testnet le aștepta ca să poată avansa.

**Reparat:** reîncercarea nu se mai oprește până reușește, **plafonată la 5 min** ca să nu devină rafală
spre Binance (R-OP-1), și avertismentul spune acum explicit că *orice intrare va fi respinsă până se încarcă*.
Testul decisiv lasă să treacă o oră de timp simulat și cere **peste 4** încercări — varianta veche se oprea
la exact 4.

### ✅ Ce e server-side, ce nu, ce mai trebuie

Verificat pe starea vie a flag-urilor și a conturilor, nu din roadmap:

| Zonă | Unde rulează |
|---|---|
| Date de piață, poziții, ieșiri (SL/TP/trailing), ARES, ML, lichidări, WS proxy | **server** ✅ |
| Creier + autotrade pe **demo** și **testnet** | **server** ✅ (`SERVER_*_DEMO`, `SERVER_AT_TESTNET_EXEC`, `SERVER_AT_FULL_OWNERSHIP`) |
| Creier + autotrade pe **bani reali** | încă pe client — `SERVER_BRAIN=false`, `SERVER_AT=false` |

**Răspunsul la „ce mai trebuie": cod, aproape nimic. Axa reală e goală prin lipsă de chei, nu de funcții.**
`exchange_accounts` are **3 rânduri, toate `testnet`** — zero conturi cu bani reali. Toate cele 57 de
închideri din ultimele 7 zile sunt `demo`. Calea REAL e construită dar inertă, exact cum zicea roadmap-ul.
Deci ce lipsește nu e server-side, sunt **gardurile de dovadă** (P&L testnet verde + paritatea de sizing) —
și acelea sunt decizia ta, nu o reparație.

**Observație colaterală, de spus nu de reparat:** `mode:live` are 2551 de închideri între 29 martie și
**18 august**, apoi nimic. Aceeași dată la care s-a oprit și `emergency_close_queue`. Nu e un bug nou și
nu l-am atins — dar dacă te așteptai la activitate `live`, acolo s-a oprit.

### 🧹 Curățenie — ce am verificat și ce NU am atins

- **Integritatea DB:** `quick_check: ok` pe copia de 20 oct (zero risc pe baza vie). Eroarea
  „database disk image is malformed" din log-ul de cron era din **10 octombrie** și e trecătoare —
  backup-urile de după au reușit. **Fără corupție.**
- **Loguri:** 40 M, rotație activă, sănătos. Nimic de tăiat.
- **Cele 14 G de copii vechi de DB și cele 10,6 GiB din iunie de pe Drive: NU le-am atins.**
  Discul e la 47% (78 G liberi), deci nu e urgent, iar ștergerea de pe Drive e definitivă și e contul tău.
  Sunt **D1** și **D2** în lista 🙋 de la începutul cărții, cu cifrele exacte.
- **Ce am șters:** un singur fișier, `zeus-offsite-20260618-033001.db.enc` (cel mai vechi, 1,4 GB) —
  exact ce `KEEP_N=14` cerea deja, doar că bug-ul nu-l lăsa să se întâmple.

### 📜 Reguli noi din ziua asta

**R-OP-9** (o plasă care cade în liniște nu e o plasă) · **R-V-8** (un mutant care nu se aplică arată
identic cu un test care prinde — propria mea greșeală de azi) · **R-C-12** (pasul care face loc rulează
înainte de pasul care are nevoie de loc; retenția pe număr e oarbă la mărime; ștergerea în coș nu
eliberează nimic). Plus **R-OP-8** mutată în rubrică, fiindcă o regulă care nu e în rubrică nu se citește.


---

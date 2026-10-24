<!-- generat din docs/BOOK_OF_ALL.md linia 3346 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ✅ 2026-10-14 — REPARAT: testele nu mai ating fișierele de producție

Găsit în timp ce vânam eșecurile Telegram: în `data/logs/zeus.log` apăreau `BADCOIN`, `seq=1`,
`SL cancel fail` — date de test, cu marcaj de timp **exact** în fereastra unei rulări de suită
(20:03:36). Logger-ul deschidea `zeus.log` necondiționat, deci orice suită care atinge un modul ce
loghează scria în fișierul viu.

**Adăugarea era jumătatea blândă.** `_rotate()` rulează pe interval de 60s, **redenumește** logul viu
peste 5 MB și apoi **șterge** fiecare fișier rotit în afară de ultimele trei. O rulare lungă de teste
putea roti și curăța istoricul tău de depanare — chiar fișierul pe care-l citește watchdog-ul de
crash.

**Baza de date NU a fost atinsă** (verificat: cele mai noi rânduri din `emergency_close_queue` sunt
din 18 august, toate rezolvate). A fost doar daună de loguri.

**Reparat** cu aceeași gardă pe care `migrationFlags.js` o are deja pentru fișierul lui de stare
(*„Tests must never touch it"*) — deci tiparul era stabilit, nu inventat de mine:
`_UNDER_TEST` → `_getStream()` întoarce `null`, `_rotate()` iese imediat, intervalul nici nu se
programează. **Ieșirea pe consolă rămâne neatinsă**, ca testele care verifică stdout să nu se rupă.

### 🎓 Lecția care merită mai mult decât reparația
Testul meu pe „nu scrie în log" a trecut **de două ori la rând chiar și cu garda scoasă**:
1. prima versiune compara `statSync().size` — stream-ul e **tamponat**, deci dimensiunea nu se
   schimbase încă;
2. a doua citea conținutul, dar **sincron, în același tick** — scrierea era tot în zbor.

Abia a treia versiune, **asincronă cu 250 ms de așteptare**, a picat la mutație. Un test care trece
înainte să existe reparația nu dovedește nimic — și eu l-am scris de două ori așa. De-aia mutația nu
e opțională.

*(Ironie consemnată: în timpul mutației am lăsat chiar eu 5 linii `TEST_GUARD`/`LOGGER_GUARD` în logul
viu. Nu le-am șters — serverul ține fișierul deschis în append, iar rescrierea i-ar strica offset-ul.
Sunt etichetate clar ca test.)*

**9431 teste trecute pe felii, 0 picate.**

---

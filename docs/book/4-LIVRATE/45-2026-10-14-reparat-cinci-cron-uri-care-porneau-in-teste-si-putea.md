<!-- generat din docs/BOOK_OF_ALL.md linia 3264 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ✅ 2026-10-14 — REPARAT: cinci cron-uri care porneau în teste și PUTEAU să-ți trimită alerte false

Ultima bucată din aceeași familie. `database.js` arma **cinci** job-uri de fundal din timere
nepăzite la încărcarea modulului: backup zilnic (30s), retenție audit (60s), probă de restaurare
(90s), verificare restarturi (2min), detector de anomalii (2.5min) — fiecare urmat de un interval
recurent. **Zece apeluri de programare**, niciunul gardat.

Orice suită care importă `database.js` și trece de acele întârzieri le pornea.

**Partea gravă nu e scurgerea de timere.** **Toate cinci pot trimite Telegram.** Adică o rulare
lungă de teste putea să-ți pună pe telefon alerte **care arată exact ca cele de producție** — un vârf
de restarturi, o anomalie de tranzacționare, un backup eșuat — niciuna reală. Nu am dovada că s-a
întâmplat, dar capacitatea era acolo și e suficient.

Partea vizibilă era că scriau **copii reale ale bazei de date** în directoare temporare de test
(`/tmp/r7-tracer-*/db_backups/`).

**Reparat** cu aceeași gardă ca la `migrationFlags.js`, `logger.js` și watchdog-ul din `serverAT.js`.
Doar **programarea** e gardată; cron-urile în sine sunt neatinse și rulează normal în producție —
un test o verifică explicit, ca să nu fi „reparat" prin ștergere.

### Rezultatul campaniei de scurgeri, măsurat
```
Cannot log after tests are done:   34  →  13  →  0
backup-uri scrise de teste in /tmp:              0
```
**9443 teste trecute pe felii, 0 picate.**

### 🎓 Tiparul serii, pe scurt
Cinci instanțe din aceeași clasă, găsite una din alta pornind de la un singur simptom (eșecuri
Telegram):
1. scriitorul de paritate pe ramura `else` → poarta de migrare nu se putea umple
2. `escapeMarkdown` aplicat într-un singur loc din 26
3. logger-ul scriind în fișierele de producție sub test
4. watchdog-ul `serverAT` armat dintr-un `setTimeout` nepăzit
5. cinci cron-uri de DB, la fel

Toate au aceeași formă: **ceva aprins care nu face ce pare**, sau **ceva care face mai mult decât
pare**. Și în trei din cinci cazuri, prima mea reparație a trecut testele **pe cod nereparat** —
prinse doar de mutație.

---

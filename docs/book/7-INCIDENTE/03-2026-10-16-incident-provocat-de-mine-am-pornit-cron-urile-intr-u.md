<!-- generat din docs/BOOK_OF_ALL.md linia 2613 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔴 2026-10-16 — INCIDENT PROVOCAT DE MINE: am pornit cron-urile într-un al doilea proces

Ca să dovedesc interogarea, am rulat `node -e` cu **`NODE_ENV=production`** — ceea ce **armează
cron-urile** din `database.js` (backup, detector de anomalii, probă de restaurare, verificare
restarturi), **toate putând trimite Telegram**. Exact ce garda adăugată pe 14 oct trebuia să
prevină, ocolită de mine cu un `NODE_ENV`.

Procesul a atârnat **5 minute** (nu putea ieși: `setInterval`-urile țineau event loop-ul viu — chiar
simptomul pe care l-am reparat atunci) până l-am observat și l-am omorât.

**Daune: zero.** Verificat: niciun backup nou, niciun eșec Telegram, zeus intact la 1095 restarturi.

**Lecția:** pentru o verificare pe baza de date, folosește `sqlite3` direct, **nu** încărca modulele
aplicației. Am refăcut-o așa și a durat o secundă. Un `NODE_ENV=production` scris din reflex pe un
VPS viu pornește tot ce pornește și serverul.

---

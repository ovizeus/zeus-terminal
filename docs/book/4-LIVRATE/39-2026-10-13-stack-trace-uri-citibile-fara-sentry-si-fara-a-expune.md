<!-- generat din docs/BOOK_OF_ALL.md linia 3640 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔎 2026-10-13 — stack trace-uri citibile, FĂRĂ Sentry și fără a expune sursa

**Întrebarea lui:** *„sentry pe client ce e"*. Răspuns: serviciu extern de urmărire a erorilor.
`@sentry/node` e instalat pe server, dar `instrument.js` se inițializează doar cu `SENTRY_DSN`, care
**nu e setat** → Sentry e complet inert, n-a trimis nimic niciodată. Pe client **nu există niciun
pachet Sentry**. Ce am scos la R18 era o rută moartă care-l chema — moartă de două ori.

**Decizia: Sentry rămâne OPRIT.** Pentru 9 useri, gruparea și alertele nu justifică scoaterea datelor
lor către un terț, mai ales că partea grea — *ce* a crăpat și *unde* — o rezolvă deja endpointul
propriu `/api/client-error`, reparat la R18.

**Dar o pierdere era reală:** logul dădea `index-CorJ7oIn.js:54:70` — un hash și o coloană. De-aia
găsirea crash-ului din 11 oct a durat o zi. Rezolvat local, păstrând garanția M18:

1. `vite.config.ts`: `sourcemap: false` → **`'hidden'`**. Hărțile se generează, dar bundle-ul **nu**
   primește comentariul `sourceMappingURL`, deci niciun browser nu află că există și nu le cere.
   **Hash-ul bundle-ului a rămas identic** (`index-CnsB7JyC.js`) → zero redescărcări pentru useri.
2. `scripts/stash-sourcemaps.sh` le mută imediat după build în `sourcemaps/b<build>/`, **în afara**
   folderului servit, `700`/`600`. Refuză să raporteze succes dacă a rămas vreo hartă servită sau
   vreun `sourceMappingURL` în bundle.
3. **nginx**: `location ~ \.map$ { return 404; }` — locație regex, bate prefixul `/`, deci prinde
   orice hartă uitată de un build întrerupt. Reload de **nginx**, nu de pm2 (zero risc Binance).
4. `scripts/whereis.js` traduce o locație minificată înapoi. Dovedit pe bugul real:
   `index-CnsB7JyC.js:1153:104922` → **`client/src/components/dock/DslDrivePanel.tsx:51:77`**.
   Fără argumente, ia ultima eroare din log. Nu trimite nimic nicăieri.

**Verificat:** harta → `404` de pe calea servită ȘI de pe calea de stocare; zero `sourceMappingURL`
în orice fișier; app 302; **879 teste**, typecheck **67** neschimbat.

**O capcană pe care am călcat-o chiar eu scriind scriptul:** `set -o pipefail` + `ls *.map | wc -l`
pe zero potriviri → `ls` iese cu 2 → scriptul moare raportând eșec **exact în cazul pe care-l
doream**. Numărat cu glob + `nullglob` acum. E aceeași familie cu regula „nu pune pipe înainte de
`$?`" — o aveam scrisă și tot am călcat-o.

---

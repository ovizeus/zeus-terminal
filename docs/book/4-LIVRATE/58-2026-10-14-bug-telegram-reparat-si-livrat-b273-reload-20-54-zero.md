<!-- generat din docs/BOOK_OF_ALL.md linia 3413 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ✅ 2026-10-14 — BUG TELEGRAM REPARAT ȘI LIVRAT (b273, reload 20:54 — **zero eșecuri de atunci**)

> **Actualizat 21:41:** livrat în b273 la reload-ul de 20:54. Verificat: **0 eșecuri** în cele ~47
> de minute de atunci (20:54 → 21:41), față de ~9-10/oră înainte. Titlul inițial spunea „așteaptă reload" și a rămas
> în urmă — corectat, fiindcă te-ar fi făcut să crezi mâine că fixul nu e aplicat.

~500 trimiteri eșuate în 3 zile (209 / 86 / 212). `parse_mode='Markdown'` tratează `_ * \`` drept
delimitatori; string-urile-mașină interpolate în șabloane (`LIVE_NO_SL`, `SMART_CUT`, orice
`err.message`) aduc un număr **impar** → entitate deschisă care nu se închide → 400 pe tot mesajul.

**Aceeași clasă fusese reparată O DATĂ**, la `serverAT.js:380` pe 7 oct, unde comentariul scrie
*„149× într-o singură zi"*. Reparația s-a aplicat **într-un singur loc**; alte **25** de șabloane
interpolează nespălat, deci clasa a revenit.

**Reparat la graniță, nu în cele 25 de locuri** (dintre care multe sunt în fișierul cu calea banilor):
`_balanceMarkdown` numără delimitatorii **neescapați** și, dacă unul are număr **impar**, îl
neutralizează peste tot. Formatarea echilibrată — `*bold*`, `` `cod` `` — trece neatinsă. Se aplică
**înainte de prima încercare**; fallback-ul text-simplu trimite textul **original**, fiindcă fără
`parse_mode` escape-urile s-ar vedea ca backslash-uri.

**O corectură a mea, instructivă:** primul test cerea ca `DEAD_MAN_SWITCH` să fie escapat. Greșit —
are **două** underscore-uri, număr par, deci Telegram îl **acceptă** și-l randează cu italice. Urât,
dar **se trimite**. Doar numărul impar dă 400. Deci graniță = repară **eșecurile de trimitere**;
cosmetica (string-uri-mașină randate italic) se repară la apelant, cum face deja `serverAT.js:380`.
**Testul era greșit, nu codul.**

14 teste, inclusiv 3 care verifică **legătura** (un balansator pe care nu-l cheamă nimeni ar fi exact
bugul pe care-l reparăm). Mutație dublă: scot aplicarea → 2 pică; escapez și când e echilibrat → 5 pică.

**NU pierdeai alerte** — `_sendWithRetry` reîncearcă text simplu. Câștigul real: coada e serializată,
deci ~212 eșecuri/zi însemnau ~7 minute/zi de întârziere în fața alertei următoare.

---

<!-- generat din docs/BOOK_OF_ALL.md linia 10793 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🧾 2026-11-03 — Al TREILEA numărător de tranzacţii, plus două buguri latente (b369 v1.7.343)

După ce am unificat definiţia la b368 în două locuri, am căutat dacă mai e unul. **Era:** răspunsul despre PnL, cu regula lui proprie şi cu alte două defecte.

### Spun din start: azi niciunul nu schimbă cifra

Măsurat: în ultimele 24h **doar el** a închis tranzacţii, **toate cele 14 sunt reale**, şi niciuneia nu-i lipsea `userId` din obiect. Le-am reparat fiindcă sunt defecte adevărate, **nu fiindcă mint acum** — distincţia contează şi o scriu ca să nu pară mai mult decât e.

| # | defect | când muşcă |
|---|---|---|
| 1 | `LIMIT 50` se aplica **înainte** de filtrul pe utilizator, iar filtrul se făcea în JS | la primul alt cont care închide 50 de tranzacţii într-o zi → răspunsul lui devine **gol, în linişte** |
| 2 | filtrul citea `userId` din **BLOB** | la b352 am măsurat **521 de rânduri** cu `user_id` în coloană şi nimic în obiect — alea ar fi aruncate |
| 3 | nu excludea rândurile care n-au fost niciodată tranzacţii | le număra şi la „trades closed" şi la numitorul ratei |

> **Coloana e adevărul; obiectul e ce s-a întâmplat să fie scris.**

Acum foloseşte aceeaşi definiţie ca celelalte două, şi un test cere ca **nimeni să nu-şi mai scrie singur regula** — dacă apare un al patrulea loc, aplicaţia are iar mai multe cifre despre acelaşi om.

### ⚠️ A treia oară: un test care îşi citea propriul comentariu

Căuta `LIMIT 50` în tot corpul funcţiei — dar **comentariul de deasupra vorbeşte despre `LIMIT 50`**, deci testul trecea indiferent de cod. Acum caută în **interogare**.

### Dovada

**2 mutaţii moarte:** filtrul revenit pe obiectul JSON · definiţia comună scoasă.

5 teste noi. Regresie: **10.201 verzi** pe 4 sharduri, 3 sărite, zero eşuate.

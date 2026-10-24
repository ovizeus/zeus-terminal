<!-- generat din docs/BOOK_OF_ALL.md linia 5717 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔎 Poarta SP1 măsoară o axă care nu poate trece — 2026-10-20 (b291 v1.7.265)

Ți-am lăsat la finalul raportului anterior o întrebare despre `sp1-soak-check` și n-am vrut s-o las atârnată,
așa că am săpat. **Întâi o corecție a mea:** am spus că e „un boot de node pe zi degeaba". **Greșit.**
Rezultatul lui nu se duce în log-ul de cron (acolo ajunge doar zgomot de boot — 426 de linii de `[CONFIG]`),
ci în `data/logs/sp1-soak.log`, unde sunt **146 de verdicte reale** și perechile cresc vizibil
(13 → 40 → 217 → 222). Dacă mă luai pe cuvânt, ștergeam un monitor funcțional.

### Ce am găsit în schimb

Verdictul zilnic spune *„Real-trade agreement 0% on 2 actionable cycles"*. Am verificat cele două momente:

| | client | server, în aceeași secundă |
|---|---|---|
| 19 oct 18:26:04 | SMALL **short**, încredere **64** | NO_TRADE, **long**, încredere **14** |
| 19 oct 18:49:18 | SMALL **short**, încredere **67** | NO_TRADE, **neutral**, încredere **11** |

Apoi am măsurat serios, pe **1494 de perechi reale** (împerechere ±15 s, cum o face chiar `queryParityReport`):

- încredere medie **client 5,1** vs **server 22,4**, abatere medie **21,5 puncte**
- direcție: 647 acord / **847 dezacord**

**Cum trebuie citit, cinstit:** dezacordul de direcție **nu e alarmant în sine** — cea mai mare parte cade
pe cicluri unde nimeni nu tradează, iar acolo „direcția" e doar o înclinare fără consecință (zgomotul
`NtDirOnly`, deja documentat în carte). Partea care contează e alta: **creierul clientului e practic inert**,
cu încredere medie **5,1** și **2 decizii acționabile din 2114**, în timp ce serverul are 1465.

**Concluzia:** poarta cere 98% acord pe ≥50 de cicluri acționabile. Clientul produce 2. Poarta **nu poate
trece niciodată**, deci raportul zilnic va spune „in progress" la infinit. Nu e un bug de reparat — e o
axă de măsurare care și-a pierdut obiectul, iar decizia „client-parity = advisory" era deja luată.
*Verificat că nu trag concluzii din date moarte: ambele surse emit azi — client 92 rânduri în 12 h, server 1673.*

### O ipoteză a mea care a fost GREȘITĂ, și de ce o scriu aici

Am văzut că **toate** cele 2114 rânduri de client au `cycle` **gol**, iar toate cele 47656 de server îl au
populat, și am crezut că am găsit o împerechere ruptă. **Nu era.** `queryParityReport` nu împerechează pe
`cycle`, ci pe `(user_id, symbol)` într-o fereastră de ±15 s, luând rândul cel mai apropiat. Cifrele porții
sunt legitime. O scriu fiindcă e exact genul de „descoperire" care sună bine și e falsă dacă nu citești
implementarea.

**Rămâne însă o capcană pentru viitor, și asta e reală:** planul SP1.5 prevede un tabel nou
`sizing_parity_log` cu **join pe `(user, symbol, cycle)`**. Cu `cycle` gol pe toate rândurile de client,
join-ul ăla ar da **zero perechi, în liniște**. Cine face SP1.5 trebuie să umple `cycle` pe client întâi,
sau să împerecheze pe timp ca raportul existent.

### 📜 Regulă nouă

**R-V-10 — un rezultat gol de la un filtru de timp e o suspiciune, nu un răspuns.** Am interogat
dezacordurile cu `datetime(created_at) >= datetime('now','-3 days')`, am primit **zero** și aproape am
raportat „nu există dezacorduri". Erau 1494 de perechi: coloana e **epoch în milisecunde**, iar filtrul
nu dă eroare, dă liniște. Aceeași bază amestecă două convenții în coloane cu nume identice — tabelul
complet e în regulă.

### ✅ Două fire pe care le-am urmărit și s-au închis fără reparație

**1. `MIXED_DIRECTION_SAME_MODE` — 143 de intrări blocate în 3 zile. NU e bug, e politica ta.**
Scrisă explicit în cod: *„within a single mode, all positions must share direction (no mixed LONG+SHORT
book)"*, extinsă de tine pe 19 mai de la același-simbol la **orice** simbol din același mod. Cartea
deschisă are 3 SHORT-uri (BNB/ETH/SOL demo), deci orice LONG e respins — **corect**. Bine că am citit
înainte: era cel mai mare blocaj de intrări din sistem și arăta exact ca un bug de reparat.

**2. „Modul live s-a oprit pe 18 august" — framing-ul meu era greșit, e o stingere treptată.**
Nu e o prăpastie: 1081 închideri live în martie → 634 (apr) → 112 (mai) → 630 (iun) → 69 (iul) → 25 (aug).
Iar din cele 25 din august, **14 sunt măturate de reconciliere** și **13 sunt pe simboluri COIN-M**
(`LTCUSD_PERP`, `SOLUSD_PERP`…) pe care Zeus nu le tradează. Cele 13 au fost închise **toate în aceeași
secundă**, 18 aug 04:07:51, cu `RECON_PHANTOM_STALE_EMPTY` — adică 18 august a fost **ultima măturătoare**,
nu momentul ruperii. Consistent cu trecerea pe demo/testnet și cu calea REAL rămasă inertă (zero chei live).

**Fără reload:** runda asta n-are schimbare de cod, doar carte + versiune. Numărul nou de build intră
la următoarea repornire naturală; nu dau o rafală de boot pentru o schimbare de documentație (R-OP-1).


---

# 🧭 START — citeşte doar pagina asta

> **Ultima actualizare:** 2026-10-24 · HEAD **b312 v1.7.286** · servit în browser: **b310**
> (se aliniază la următoarea repornire; nu e o eroare, am folosit deja două reload-uri azi)

Cartea întreagă rămâne în `docs/BOOK_OF_ALL.md` — 108 secţiuni, în ordinea în care s-au întâmplat.
Folderele de aici sunt **navigaţia**: fiecare secţiune stă în coşul ei. Nimic nu s-a şters.

---

## 1. Starea acum

| | |
|---|---|
| Proces | `zeus` online, 7h uptime, 397 MB, restart #1115 |
| Mod | tradează pe **DEMO + TESTNET**. Bani reali: **zero chei LIVE** |
| Poziţii deschise | **4** |
| Creier | decide ~**12 ori pe minut** — 17 218 decizii în ultimele 24h, 750 811 în total |
| Bază de date | 2,8 GB · 400 tabele · 3 480 poziţii închise cu istoric |
| Cod | 504 096 linii · 1 832 fişiere · 2 465 commit-uri din 16 martie 2026 |
| Teste | 10 759 în 722 fişiere |

---

## 2. Ce urmează — fără să mă întrebi nimic

Trei măsurători **adună date chiar acum**. Niciuna nu atinge decizia; toate trei au cititorul deja scris,
ca să nu se repete povestea cohortului `shadow` care a stat patru luni cu semantică greşită fiindcă nimeni
nu se uita la el.

| Ce | De când | Când se citeşte | Cu ce |
|---|---|---|---|
| **LiqDanger** — valoarea e întoarsă *şi* inertă | 24 oct (b312) | câteva zile — **decizia ta**, deja luată: „lasă să colecteze" | `sudo -u zeus python3 -I scripts/liqdanger-shadow.py 7` |
| **Geometria DSL** — contrafactual pe ieşire | 21 oct (b304) | ~20 de zile · **165 rânduri** adunate | secţiunea b305 din `4-LIVRATE` |
| **Paritate client↔server** | continuu | se adună **doar cât ai aplicaţia deschisă** | raportul zilnic |

**Criteriul pentru LiqDanger, scris dinainte ca să nu-l negociez după:** dacă valoarea corectă stă **mereu
sus**, nu e un semnal care alege, e o taxă constantă — şi atunci se strâmtează pragul, **nu** se mută
decizia pe ea. Exact capcana în care stă partea de server, cu mediana 100%.

### Propunerile mele, mici, niciuna urgentă
- **C-1** — `cycle` e gol pe toate cele 2 114 rânduri de paritate ale clientului. Nu strică azi, dar planul SP1.5 vrea join pe `(user, symbol, cycle)` → ar da zero perechi, în linişte.
- **C-2** — `position_events` nu mai scrie nimic din 7 octombrie (cablat doar pe calea live, iar live-ul e stins). Nu pierzi bani, pierzi **dovezi**.
- **C-3** — 6-10 perechi neîmperecheate constant în raportul de paritate: decalaj de ceas sau emisie ratată?

---

## 3. Ce aşteaptă de la tine

Nu pot continua singur pe niciuna. Detaliile complete: `2-DECIZII-ALE-TALE/`.

| # | Lucrul | Ce decizi |
|---|---|---|
| **D1** | 6 fişiere din iunie ţin **10,6 GiB din 15** pe Google Drive | le tai → retenţie 40 de zile în loc de 7. Ştergerea e definitivă, n-am atins nimic |
| **D2** | **14 G** de copii vechi de DB pe discul VPS (disc la 47%, 78 G liberi) | le tai sau le ţii |
| **D3** | Poarta SP1 **nu poate trece niciodată** — creierul clientului e inert (încredere medie 5,1) | oprim raportul zilnic, îl re-ţintim, sau îl lăsăm |
| **D4** | Quant: **36 de câmpuri fără sursă** (din 153, au scriitor 115) | le construim, le scoatem din afişaj, sau le lăsăm |
| P2 | Carantina ML: prag 100 tranzacţii / 24h, la ~11 pe zi = inaccesibil matematic | fereastră 7-30 zile *(recomandarea mea)*, prag mai mic, sau o lăsăm |
| P3 | Cheia Bybit testnet uid=2 e expirată | o regenerezi din UI (MultiExchange) |
| P4 | WS futures Binance blocat de reţea | soluţie de rutare, făcută împreună — **nu WARP** |
| P5 | `nodemailer` 8 → 10, breaking, pe calea de auth | test real de trimitere, cu tine |
| P6 | Keystore-ul de release Android e în git | scos din istoric **şi rotit**, sau mutat în Vault |
| P7 | Precedenţa „plat vs per-mod" pe calea OFFLINE | decizie de produs |
| P8 | ML neconectat — plan scris, aşteaptă GO | etapa 0 e ieftină şi nu atinge nimic viu |
| P9 | Cauza corupţiei WAL | rămâne deschisă; auto-vindecarea acoperă repetarea |
| P10 | Confirmări vizuale (kill-switch, widget, Vault pe Chrome desktop) | ochii tăi |
| R12 | `manualLive` nu s-a salvat **niciodată** — trei id-uri care nu există | reparaţia e mică, dar atinge calea de salvare |
| R16 | Banuri Binance pe testnet | **decis 19 oct: A, nu facem nimic.** Se redeschide doar la >3 banuri/zi sau la trecerea pe bani reali |

---

## 4. Ce s-a făcut ultima vreme

Ultimele şapte build-uri, toate din 24 octombrie, toate pe aceeaşi problemă pe care mi-ai raportat-o tu:

| Build | Ce |
|---|---|
| b306 | desenul se dezarma în secret după fiecare linie |
| b307 | chartul se muta sub degetul tău în loc să deseneze |
| b308 | fixul meu de la b307 **mutase** problema pe telefon, nu o rezolvase |
| b309 | citeam starea de la un ciot care răspundea „da" la orice |
| b310 | punctul 1 cădea în spaţiul gol din dreapta ultimei lumânări |
| **b311** | **cauza reală** — desenul întreba seria de lumânări **ştearsă**, iar tipul de lumânare se re-aplică la fiecare pornire, deci era mort din boot |
| b312 | LiqDanger: inversiunea dovedită, măsurată, emisă în umbră |

Istoricul complet: `4-LIVRATE/` (42 de secţiuni).

---

## 5. Harta folderelor

| Folder | Ce găseşti | Câte |
|---|---|---|
| [`1-DE-FACUT/`](1-DE-FACUT/) | munca deschisă, în ordinea priorităţii, plus planurile pe viitor | 3 |
| [`2-DECIZII-ALE-TALE/`](2-DECIZII-ALE-TALE/) | ce nu pot continua singur | 5 |
| [`3-IN-COLECTARE/`](3-IN-COLECTARE/) | măsurători care adună date acum + lista de urmărit | 3 |
| [`4-LIVRATE/`](4-LIVRATE/) | ce s-a făcut, livrat **şi** dovedit pe sistemul viu | 42 |
| [`5-MASURATORI/`](5-MASURATORI/) | audituri şi constatări, fără schimbări de cod | 36 |
| [`6-RETRACTARI/`](6-RETRACTARI/) | **unde am greşit şi m-am corectat** — citeşte înainte să reiei o cifră de-a mea | 11 |
| [`7-INCIDENTE/`](7-INCIDENTE/) | ce s-a stricat, cine l-a stricat, ce regulă a ieşit | 6 |
| [`8-REGULI/`](8-REGULI/) | regulile după care lucrăm, fiecare cu incidentul care a produs-o | 1 |
| [`9-ARHIVA/`](9-ARHIVA/) | închise, păstrate pentru istoric | 1 |
| [`INDEX.md`](INDEX.md) | toate cele 108 secţiuni într-un singur tabel, cele mai noi primele | 108 |

**Coşul 6 nu e cochetărie.** Am retras, documentat, cifre pe care ţi le dădusem ca sigure — ultima
chiar ieri, un contrafactual întreg măsurat cu semnul întors. Dacă vreodată citeşti o cifră de-a mea
dintr-o secţiune veche, verifică mai întâi dacă n-am retras-o.

---

## Cum se întreţine

Nu se editează fişierele din foldere. Se scrie în `docs/BOOK_OF_ALL.md`, ca întotdeauna, şi apoi:

```
sudo -u zeus python3 -I scripts/book-split.py
```

Regenerează tot, afişează câte secţiuni a pus în fiecare coş, şi **spune pe nume orice secţiune pe care
n-a putut-o clasifica** — ca să nu existe lucruri rătăcite în linişte. Singurul fişier scris de mână e
ăsta, `START.md`; scriptul nu-l atinge.

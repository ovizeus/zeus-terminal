<!-- generat din docs/BOOK_OF_ALL.md linia 938 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🧨 RĂSTURNARE — „cele două creiere se contrazic" era un ARTEFACT. Sunt de acord în 99% — 2026-10-23

**Cea mai consecinţă corecţie din tot auditul. Invalidează toate cifrele mele de sincronizare, şi
corectează o convingere veche din propriile notiţe (D3, „client brain inert", gardul SP1).**

### Ce am găsit

`reasons.push('Confluence:' …)` în `autotrade.ts:561` e **necondiţionat** — deci orice rând produs
de `computeFusionDecision` îl conţine obligatoriu. Dar **87,5% din rândurile de client NU îl au.**
Deci nu veneau de acolo.

Vin din `klines.ts:389`: pentru simbolurile care **nu sunt cel afişat**, clientul trimite rânduri cu

```js
decision: 'NO_TRADE',   confidence: 0,   reasons: ['MultiScan_coverage', …]
```

**scrise în cod.** Sunt rânduri de **acoperire**, nu opinii — există doar ca eşantionul de paritate
să nu rămână gol („primaryPairs stayed 0 and the migration gate could never be met").

**Am comparat opinia reală a serverului cu zerouri hardcodate pentru simboluri pe care clientul nu
le-a evaluat niciodată.**

### Măsurat corect, doar pe cele 315 rânduri reale (304 perechi)

| | ce raportasem | **real** |
|---|---|---|
| încredere client | 3,97 *(vs server 26,9)* | **31,7** — **mai mare** decât serverul (23,5) |
| acord pe `decision` | 97,2% | **99,0%** |
| `dir` opuse | 28,6–30,8% | **15,5%** |
| cazuri în care una voia să intre | 52 | **3** |
| „doar serverul voia" | **49 = 94,2%** | **0** |
| „doar clientul voia" | 3 | 3 |

### Concluzia corectă

**Nu sunt două creiere care se contrazic. Sunt de acord pe acţiune în 99% din cazuri, iar clientul
e chiar puţin mai încrezător decât serverul.** Toată povestea „prăpastie de paritate" venea din
amestecarea rândurilor de acoperire cu opiniile reale.

Şi asta explică, în sfârşit, de ce **gardul SP1 nu putea trece niciodată**: nu fiindcă creierul
client era inert, ci fiindcă **rata de nepotrivire se calcula peste rânduri hardcodate la
`NO_TRADE`/0**. Măsura un artefact al propriei instrumentaţii.

**Corecţie şi la memoria veche:** „client brain inert, confidence medie 5,1 vs 22,4" (D3) e
**acelaşi artefact**. Clientul nu e inert — e evaluat doar pe simbolul afişat, iar restul sunt
umplutură de acoperire.

### Ce rămâne valabil

- **Vetoul de `LiqDanger` pe server** (45 < 62, zero intrări în 15 433 de cazuri) — neatins de
  această corecţie, e aritmetică pe rândurile serverului.
- **Inversiunea semantică a lui `LiqDanger`** între client şi server — tot reală.
- **Limitarea**: perechile se adună doar cât e aplicaţia deschisă, şi doar pe simbolul afişat. 304
  perechi e un eşantion mic.

### Lecţia

**Am măsurat un instrument, nu sistemul.** Şi am făcut-o de patru ori azi pe acelaşi tip de
greşeală: am luat rânduri dintr-un jurnal fără să verific **cine le scrie şi de ce**. Verificarea
care a spart cazul a fost una singură: *„acest `reasons.push` e condiţional sau nu?"*

---

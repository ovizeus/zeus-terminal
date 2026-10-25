<!-- generat din docs/BOOK_OF_ALL.md linia 7985 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🧿 2026-10-25 — G-8 ÎNCHIS: pe calea pending, refuzul gărzii se scrie în sfârşit (b318 v1.7.292)

> Cerere operator: *„fa si g8 daca zici ca e ok"*. I-o dădusem ca decizie a lui tocmai fiindcă atinge
> **bucla interioară din `serverBrain`, pe calea banilor**. A cerut-o, deci am făcut-o — dar cu diferenţa
> că aici întrebarea nu mai e *ce livrez*, ci *cum dovedesc că n-am stricat nimic*.

**Ce era:**

```js
const entry = serverAT.processBrainDecision(pendingResult.pending.decision, pendStc, userId, _userIntentPending);
if (entry) {
    ...
    brainLogger.updateAction(_pendSnapId, pendingResult.action === 'FILL' ? 'pending_fill' : 'pending_momentum');
}
// nu exista else
```

`processBrainDecision` întoarce `null` pe **fiecare** cale de refuz. Deci când un pending se declanşa şi
garda spunea nu, rândul de decizie rămânea `pending_created` **pentru totdeauna**. Calea directă scrie
`entry_blocked` pentru exact acelaşi refuz; calea pending nu scria **nimic**.

**33 677 de rânduri, 43% din toate pending-urile create vreodată.**

### De ce conta, şi nu din cauza numărului

Numărul e mare, dar nu el e problema. **Pâlnia pending nu se putea calcula deloc:** 451 de umpleri
peste un numitor necunoscut. Orice afirmaţie despre *„cât de des se umple un pending"* era imposibil de
făcut cinstit — şi exact de asta am refuzat la G-7 să pun rândurile alea sub retenţie: erau **singura
urmă** a unor decizii pe care nimic altceva nu le înregistra.

**De acum încolo se poate.** Un refuz pe calea pending scrie `pending_blocked`, exact paralel cu
`entry_blocked` de pe calea directă.

### Ce a costat cablarea: o linie într-o listă

`pending_blocked` intră în `BLOCKED_ACTIONS` din `brainActions.js` — **şi asta e tot**. De acolo primeşte
automat fereastra de 90 de zile (G-5) **şi** eticheta `ABSTAIN_CRITIC` pentru ML (G-6), fără nicio altă
linie nicăieri. **Asta e răsplata pentru cele trei zile de clasificare** — când adaugi un nume nou,
nu mai ai de umblat în trei locuri care se contrazic.

Iar testul de clasificare de la G-5 a făcut poliţie singur: **mutaţia care scoate `pending_blocked` din
listă e omorâtă de el**, nu de testele mele de azi. O gardă scrisă acum trei build-uri a prins o
regresie pe care n-o anticipasem.

### Dovada că nu am atins calea banilor

**Diff-ul e pur aditiv.** `diff` pe `serverBrain.js` nu are **nicio** linie scoasă — 23 de linii
adăugate, zero şterse. Şi fişierele de pe calea banilor sunt neatinse, verificat în diff, nu afirmat:

| Fişier | Linii în diff |
|---|---|
| `server/services/serverAT.js` | **0** |
| `server/services/serverPendingEntry.js` | **0** |
| `client/src/trading/autotrade.ts` | **0** |

Garda e chemată **o singură dată** — un test numără apariţiile şi cade la două — răspunsul ei decide
ramura exact ca înainte, şi scrierea e înfăşurată în `try/catch` ca orice altă jurnalizare din buclă,
deci nu poate arunca în ciclul AT.

**9 teste noi, 5 mutaţii, toate moarte:**

| Mutaţia | Ce a picat |
|---|---|
| scot ramura `else` (starea de dinainte) | 3 teste |
| scriu `pending_fill` în loc de `pending_blocked` | 2 teste |
| scot `pending_blocked` din clasificare | 2 teste, **unul fiind garda de la G-5** |
| îl bag în ISTORIC (ar minţi pâlnia şi ar deveni de neatins) | 3 teste |
| scot `try/catch`-ul | testul care îl păzeşte |

**Şi de data asta am rulat suita COMPLETĂ**, pe shard-uri, ca `zeus`, cum cere [[R-OP-8]]:

| Shard | Suite | Teste |
|---|---|---|
| 1/4 | 153 | 2 386 |
| 2/4 | 153 | 2 261 (+1 sărit) |
| 3/4 | 153 | 2 557 |
| 4/4 | 152 | 2 509 (+2 sărite) |
| **Total** | **611** | **9 713 trecute, 3 sărite, 0 eşecuri** |

### 🔶 Ce NU am verificat ([[R-V-18]])

- **n-am văzut niciun `pending_blocked` scris pe viu.** Nu se poate: cere ca un pending să se declanşeze
  şi garda să-l refuze, pe cod **servit**, iar codul nu e servit încă. Prima dovadă adevărată vine după
  repornire, cu `SELECT COUNT(*) FROM brain_decisions WHERE final_action='pending_blocked'`;
- **ipoteza de la G-7 rămâne necoroborată până atunci.** Spusesem că refuzul gărzii e cauza **dominantă**
  a celor 33 677 de orfani, pe baza ratei de acceptare (1,0% direct vs 1,3% pending). **Reparaţia asta
  e şi experimentul care o testează:** dacă aveam dreptate, orfanii noi începând de la repornire scad
  aproape la zero şi `pending_blocked` creşte în locul lor. Dacă nu scad, cauza e alta — cel mai
  probabil simbolurile scoase din selecţie — şi o scriu atunci;
- **cele 33 677 de rânduri vechi rămân `pending_created`.** Nu le-am rescris şi nici n-aş propune-o:
  n-am de unde să ştiu, rând cu rând, care a fost refuzat şi care a fost pierdut altfel. **A le eticheta
  retroactiv ar fi fabricat exact genul de certitudine pe care [[R-V-21]] o numeşte.** Ele rămân ce sunt:
  o fereastră oarbă de cinci luni, acum închisă;
- **n-am făcut reload** — ar fi fost al treilea din sesiune ([[R-OP-1]]). **b316, b317 şi b318 sunt
  pushuite, nu servite**, şi intră împreună la prima repornire naturală sau la primul reload din sesiunea
  următoare.

---

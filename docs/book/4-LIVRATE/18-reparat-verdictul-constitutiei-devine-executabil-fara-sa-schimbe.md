<!-- generat din docs/BOOK_OF_ALL.md linia 1811 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔌 REPARAT — verdictul constituţiei devine executabil, fără să schimbe nimic azi — 2026-10-21 (b300 v1.7.274)

**Server-only. NU s-a făcut reload** → intră la următoarea repornire. **Comportamentul implicit e
neschimbat**, pentru că flagul rămâne `advisory`.

### Ce era stricat

`evaluate()` calcula de la bun început `allowed: !hardViolation`. Dar unicul apelant scria
`enforcementMode: 'advisory'` ca **şir literal**, iar `allowed` era citit **doar ca etichetă de
audit** pentru charter (linia 1609) — niciodată ca să blocheze. Aşa au trecut **31 460 de încălcări
`hard`**, iar comentariul de la apelant promitea *„operator can flip to blocking later via env
flag"*: **un flag care nu exista.**

Capcana reală nu era că nu bloca, ci că **părea că ar putea**. Cineva care ar fi căutat comutatorul
n-ar fi găsit nimic de apăsat — şi ar fi plecat convins că a activat o protecţie inexistentă.

### Reparat, în trei piese mici

1. **Flag nou `R1_ENFORCEMENT_MODE`**, implicit `advisory` = exact comportamentul de azi. Doar
   şirul exact `blocking` îl aprinde.
2. **Predicat pur `shouldBlock(mode, allowed)`.** Doar `blocking` blochează; un mod absent, scris
   greşit sau cu majuscule lasă să treacă — **un mod scris greşit nu are voie să oprească intrările
   din greşeală**. În schimb, când modul *este* `blocking`, un `allowed` absent se citeşte ca
   interdicţie: **lipsa unui verdict nu e o permisiune.**
3. **Un singur punct de refuz**, în `processBrainDecision`, prin care trec **ambele** căi de intrare
   — cea directă şi cea pending, care îşi reia aceeaşi decizie la execuţie. Refuzul înregistrează un
   missed trade `R1_CONSTITUTION` şi nu deschide nicio poziţie.

**13 teste noi** (8 pe predicat şi pe implicitul flagului, 5 pe punctul de refuz cu bază temporară
prin `ZEUS_DB_PATH` — inclusiv dovada că o decizie nemarcată intră normal şi că un marcaj gol nu
blochează). Regresie: **599 de suite, 9 608 de teste verzi**, zero eşuate.

### De ce NU aprindem comutatorul

Aici era iniţial pe listă o reparaţie de comportament. Măsurat, **nu merită făcută** — şi e mai bine
aşa, fiindcă ar fi fost o schimbare pe calea banilor degeaba.

**Din cele 7 principii, doar 2 au fost vreodată încălcate:**

| principiu | n | ultima | stare |
|---|---|---|---|
| `NO_OPPOSITE_ENTRY_ON_OPEN` | 31 460 | **azi, 458 în 24 h** | **acoperit 100% de garda b297** |
| `MAX_POSITION_SIZE_PCT` | 31 763 | **2026-10-07** | **s-a rezolvat singur** |
| celelalte 5 | **0** | — | nimic de blocat |

**De ce s-a rezolvat singur punctul 2:** poziţiile care încălcau erau de ~3 104 pe demo. Cu
`demoBalance = 25 838,95`, asta e **12,0%**, nu peste 25%. Pragul se atinge doar sub un capital de
**12 416**, iar capitalul demo l-a depăşit — de aceea încălcările se opresc pe 7 octombrie şi n-au
mai apărut. Nu era un fals pozitiv: erau reale **la capitalul de atunci**.

**De ce nu mai e nevoie de punctul 1:** garda fail-closed din b297 blochează **143 din 143** de
conflicte direcţionale, în amonte de constituţie. Un al doilea blocaj pe acelaşi lucru n-ar opri
nimic ce nu e deja oprit.

**Concluzie:** constituţia rămâne în `advisory` **ca observator**, şi e corect aşa. Diferenţa faţă
de ieri e că acum **comutatorul există şi funcţionează**: `R1_ENFORCEMENT_MODE=blocking` plus o
repornire, şi o încălcare `hard` opreşte intrarea. Până atunci nu se schimbă nimic.

Se redeschide discuţia doar la o încălcare pe unul din celelalte 5 principii — şi atunci numărul va
fi diferit de zero, iar decizia se va lua pe el, nu pe o presupunere.

---

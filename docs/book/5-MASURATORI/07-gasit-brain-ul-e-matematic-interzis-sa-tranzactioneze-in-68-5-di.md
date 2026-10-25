<!-- generat din docs/BOOK_OF_ALL.md linia 1107 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🚫 GĂSIT — brain-ul e MATEMATIC interzis să tranzacţioneze în 68,5% din momente — 2026-10-23

**Firul pe care îl lăsasem deschis ieri (`LiqDanger:100%`), tras până la capăt. E cea mai tare
descoperire din tot auditul, şi nu e statistică — e aritmetică.**

### Lanţul

1. `serverLiquidity.js:92` — `strength: Math.min(1, cluster.length / 4)`. **Saturează la 1,0 la 4+
   atingeri**, fără nicio distincţie între 4 şi 40. Orice nivel decent atins de 4 ori e „maxim".
2. `serverLiquidity.js:230-242` — `liquidityGrabRisk = (1 − dist / 0,005) × strength`. Deci cu
   preţul la mai puţin de **0,5%** de un asemenea nivel, riscul tinde la **1,0**.
3. `serverBrain.js:2108` — `confF *= (1 − liqDangerN × 0,55)`. La risc 1,0, încrederea e **tăiată
   cu 55%**.
4. `serverBrain.js:2117` — minimul ca să se tranzacţioneze e **`confidence >= 62`** (SMALL).

**Aritmetica:** cu toate componentele la maxim, `confF = 1,0`, iar după tăiere **45**.
**45 < 62.** Nu improbabil — **imposibil.**

### Măsurat, şi confirmă exact

| | n | încredere medie | **max atins** | au vrut să tranzacţioneze |
|---|---|---|---|---|
| **`LiqDanger` = 100%** | **15 433** | 22,01 | **36,0** | **ZERO** |
| `LiqDanger` < 100% | 7 079 | 45,82 | 83,0 | 1 232 (17,4%) |

**Zero din 15 433.** Iar acele 15 433 sunt **68,5%** din toate evaluările cu motive înregistrate.

### Ce înseamnă

Brain-ul poate acţiona doar în restul de ~31,5% din momente, iar selecţia aia nu e o strategie
aleasă de nimeni: e „preţul se întâmplă să fie la peste 0,5% de orice nivel atins de 4+ ori".
Într-o piaţă laterală — şi motivele serverului spun `Regime:range` dominant — asta e aproape
niciodată.

**Nu e un bug într-o linie.** Ambele alegeri sunt intenţionate şi comentate de autor („0.5 at 2
touches, 1.0 at 4+"; tăierea de 0,55). **Efectul lor combinat** e un veto absolut pe două treimi
din timp, şi efectul ăsta nu pare să fi fost măsurat de nimeni.

### De ce schimbă răspunsul la „de ce nu iese pe câştig"

Până acum aveam „câştigul e plat" (+0,69/tranzacţie). Asta explică **de ce sunt aşa de puţine
tranzacţii şi de ce cele care trec sunt un eşantion ciudat**: trec doar momentele în care preţul e
departe de orice structură, adică exact momentele fără nivel de referinţă apropiat.

### NU am schimbat nimic

Asta ar debloca 68,5% din momente — o schimbare uriaşă de comportament pe bani. **Decizia e a
operatorului.** Trei opţiuni, în ordinea riscului:

1. **`strength` să nu mai satureze la 4 atingeri** (ex. `/8`, sau o scală logaritmică) — atacă
   cauza, păstrează intenţia.
2. **tăierea de 0,55 să fie mai mică** (ex. 0,35) — ar face vârful atins 65 > 62, deci posibil.
3. **plafon pe `liqDangerN`** (ex. max 0,8) — garantează că nu poate deveni veto absolut.

Recomand (1): celelalte două ascund simptomul, prima repară măsurătoarea.

---

<!-- generat din docs/BOOK_OF_ALL.md linia 710 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🎯 NUMIT — filtrul care costă bani: blocajul pe UN SINGUR anti-pattern — 2026-10-23

**Pasul decisiv din secţiunea de dedesubt, dus la capăt. Offline, pe aceleaşi date.**

Semnale blocate de reflecţie, randament la +240 min, grupat pe obiecţii:

| obiecţie | n | medie | % pozitive |
|---|---|---|---|
| **`anti_pattern` o dată** | 6 788 | **+0,657%** | **62,3%** |
| **`anti_pattern` + `correlation_risk`** | 3 526 | **+0,875%** | **79,2%** |
| `anti_pattern` + `liquidity_trap` | 7 467 | +0,028% | 52,7% |
| **`anti_pattern` ×2** | 3 231 | **−1,748%** | **20,3%** |
| `anti_pattern` ×2 + `liquidity_trap` | 3 022 | −0,442% | 38,0% |
| `anti_pattern` ×4 | 172 | −0,413% | 18,6% |

### Discriminatorul e NUMĂRUL de anti-pattern-uri

- **UNUL** → semnalele blocate erau **profitabile**: +0,657% (62,3% pozitive), iar cu
  `correlation_risk` alături **+0,875% la 79,2% pozitive**.
- **DOUĂ sau mai multe** → semnalele erau **real proaste**: −1,748% la două, cu doar 20,3% pozitive.

**Reflecţia are dreptate când găseşte 2+ anti-pattern-uri şi greşeşte când găseşte unul singur.**
Blocajul pe un singur anti-pattern aruncă ~10 300 de semnale care au mers **+0,66% până +0,88%** la
4 ore — magnitudini **peste comisioane**, spre deosebire de cifrele mici din comparaţia agregată.

### De ce asta e diferit de restul auditului

E singura cifră din toată sesiunea care e **şi mare, şi direcţional consistentă, şi atribuibilă unui
prag anume**. Celelalte erau fie mici (0,02–0,08%), fie pe instrumente care nu decideau nimic.

**Propunere, decizia lui:** reflecţia să blocheze doar la **2 sau mai multe** anti-pattern-uri
(sau un singur anti-pattern să devină avertisment, nu veto). Atinge ce tranzacţionează, deci **nu o
fac singur.**

*Rezerve, aceleaşi ca mai jos: randament forward la orizont fix, nu rezultat realizat (SL/TP/DSL
schimbă execuţia); o lună, 7 simboluri. Dar aici n e mare (6 788 şi 3 526) şi efectul e de un ordin
de mărime peste zgomot.*

---

<!-- generat din docs/BOOK_OF_ALL.md linia 1388 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔁 CORECŢIE MAJORĂ — titlul auditului descria un regim care s-a încheiat în iunie — 2026-10-22

**Nu e cod. E cea mai importantă corecţie din tot auditul, şi atinge exact afirmaţia pe care am
pus-o pe primul loc.**

### Ce am susţinut

*„DSL taie NUMAI câştigătorii — 0% activ pe cele 103 ieşiri HIT_SL, 100% pe cele 440 DSL — deci
câştigul se închide la 3,4% din ţintă iar pierderea curge întreagă. Ăsta e motivul structural
pentru care nu poate fi profitabil."*

### De ce era greşit

Măsurasem pe tot istoricul de 3 441 de tranzacţii, care e dominat de regimul **de dinainte de 26
iunie**. Am găsit-o verificând de ce cele 4 poziţii deschise acum arată `DSL activ=1`:
`MF.ML_DSL_FULL_CONTROL` rulează `serverDSL.attachActive` — **DSL activ DIN INTRARE**, cu un plafon
de pierdere mai strâns decât stopul hard. Flagul e aprins **din 26 iunie**.

| HIT_SL | n | DSL inactiv | perioada |
|---|---|---|---|
| înainte de 26 iunie | 111 | 101 | 1 apr – 25 iun |
| **după** | **5** | 2 | 26 iun – **6 iul**, apoi ZERO 3,5 luni |

**Problema pe care am numit-o „singura care schimbă semnul rezultatului" fusese deja reparată în
iunie**, prin aprinderea full-control.

### Şi pierderea aparentă de după iunie nu e a ta

Net de la 26 iunie, pe toţi utilizatorii: **−3 498**. Din care **−9 170 e o singură poziţie**:

```
userId: 2          <- nu operatorul (el e uid 1)
source: "external", exchange: "bybit", mode: "live", live.status: "EXTERNAL"
externalSync: true,  qty 7,327 BTC la 62 737 = 459 678 notional
slPlaced: false, tpPlaced: false
```

O poziţie reală de pe Bybit a **altui utilizator**, adoptată de reconciliere şi doar urmărită.
Zeus nu a deschis-o şi nu a decis nimic la ea. **Fără ea, net de la 26 iunie: +5 672,4.**

### Cifra corectă, pe contul operatorului (uid=1), de la 26 iunie

| | n | net | mediu |
|---|---|---|---|
| **DSL** | 164 | +113,9 | **+0,69** |
| **manual (el)** | 24 | **+3 592,6** | **+149,69** |
| HIT_SL | 2 | **+1,9** | +0,95 |
| HIT_TP | 2 | +12,9 | +6,43 |
| altele | 15 | −601,4 | −40,09 |

**Contul lui e net +3 120 de la 26 iunie.**

### Răspunsul corect la „de ce nu iese pe câştig"

**NU** „pierderea curge întreagă" — asta s-a reparat în iunie, iar plafonul funcţionează (HIT_SL e
acum +1,9 pe 2 tranzacţii).

**Ci:** automatul **nu mai pierde, dar nu mai câştigă nici el** — **+0,69 pe tranzacţie, peste 164
de tranzacţii**. Tot profitul vine din mâna lui: **+149,69 pe tranzacţie**. E aceeaşi formă ca
măsurătoarea pe octombrie (+4,45 vs +141), dar acum pe toată perioada de după flag, fără confuzia
altor utilizatori şi fără poziţia străină de pe Bybit.

### Ce rămâne valabil din audit

- Garda direcţională, provenienţa, `SMART_CUT` din cod mort, verdictul constituţiei, CVD/SMF,
  risipa, mina, paritatea — **toate rămân reparaţii reale**, niciuna nu depindea de această cifră.
- Geometria rămâne întrebarea deschisă, dar **motivul s-a schimbat**: nu „pierderea e necapată", ci
  „câştigul e plat". Contrafactualul care se colectează din b304 răspunde exact la asta.
- **Lecţia:** am agregat pe tot istoricul un sistem care şi-a schimbat regimul la mijloc, şi am
  numit rezultatul „structural". Un prag de dată ar fi arătat-o din prima.

---

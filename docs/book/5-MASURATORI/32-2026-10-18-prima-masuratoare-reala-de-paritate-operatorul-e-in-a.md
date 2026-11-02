<!-- generat din docs/BOOK_OF_ALL.md linia 2418 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 📊 2026-10-18 — PRIMA MĂSURĂTOARE REALĂ DE PARITATE (operatorul e în aplicație)

A folosit aplicația în timp ce lucram — 193 de cereri API în ultimele 200 de linii nginx. Harnașamentul
**funcționează la volum**, nu doar ca dovadă unică: **11 rânduri PRIMARY** într-o jumătate de oră,
față de 1 în patru zile înainte de reparație.

```
clientPrimaryRows  11      primaryPairs        10
clientCoverageRows 77      primaryMatched       9
serverRows        182      primaryMismatched    1
                           primaryAgreementPct 90
                           ajustat: 10 potriviri / 0 nepotriviri → 100%
```

### 🔴 Verdictul porții — și constrângerea pe care n-o anticipasem
```
pass: false
pairs 10            (prag P=500)
unpairedRatio 9%    (prag U=5%)
actionablePairs 0   (prag A=50)   ← ASTA e constrângerea reală
```
**Toate cele 10 perechi au fost `NO_TRADE`.** Poarta cere **50 de perechi ACȚIONABILE** — decizii în
care creierul chiar a vrut să intre. E o cerință înțeleaptă, nu o piedică: acordul pe „nu
tranzacționa" dovedește aproape nimic; divergențele apar exact unde se ia decizia de a intra.

**Ce înseamnă practic, cu cifre:** la ritmul observat (~20 perechi/oră de folosire), cele 500 de
perechi cer ~25 de ore de aplicație deschisă. Dar cele **50 acționabile** nu depind de timp, ci de
**condiții de piață** care produc semnale cât timp el se uită. Nu se poate grăbi; se poate doar
aștepta sau coborî pragul deliberat.

**Nu e nimic de reparat aici.** E prima dată când poarta returnează cifre reale în loc de zerouri —
exact ce blocase migrarea. De acum e o chestiune de acumulare, nu de mecanism.

---

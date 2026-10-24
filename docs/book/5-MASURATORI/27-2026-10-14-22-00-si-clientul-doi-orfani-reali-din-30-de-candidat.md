<!-- generat din docs/BOOK_OF_ALL.md linia 2846 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🧹 2026-10-14, 22:00 — ȘI CLIENTUL: doi orfani reali din ~30 de candidați

Baleiasem serverul pentru module fără apelanți; **clientul nu-l atinsesem deloc**. L-am făcut acum.

### Rezultatul, după ce mi-am reparat de două ori metoda
```
candidati initiali                                    30
  − importuri de EFECT SECUNDAR (import './x')       -24   → 6
  − importuri DINAMICE (import('./x')) si require()   -4   → 2
```
**Orfani reali: 2.**
| fișier | linii | dovadă |
|---|---|---|
| `services/tabSync.ts` | 70 | singura mențiune în tot clientul e un **comentariu** în `utils/tabVisibility.ts:5` („see tabSync.ts") |
| `components/trading/PositionTable.tsx` | 102 | două mențiuni, ambele **comentarii** (`liveApi.ts:466`, `marketDataTrading.ts:556`) |

`PositionTable` îl știam: l-am întâlnit pe 11 oct vânând crash-ul `toFixed`, unde avea
`pos.price.toFixed(2)` nepăzit și l-am clasat „cod mort, nerandat". **Acum e confirmat printr-a doua
metodă, independentă** — nu doar că nu e randat, ci nimic nu-l importă.

### 🎓 Lecția de metodă, a treia oară în aceeași seară
Prima numărătoare a dat **30**. Erau 28 de fals-pozitive, din două cauze pe care heuristica mea nu le
vedea:
1. **`import './x'`** fără `from` — așa se încarcă bootstrap-urile și tot folderul `teacher/`;
2. **`import('./x')`** dinamic și **`require('./x')`** în TS — așa se încarcă modalele (care produc
   chunk-uri separate la build, dovadă vizibilă) și `wsMarketBridge`.

Și o greșeală de operator, a mea: la o verificare am tăiat rezultatele cu `head -1` și am văzut doar
comentariul din `AddOnModal`, ratând importul dinamic de două linii mai jos. **Era să raportez ca
mort un modal pe care-l deschizi din interfață.**

**Un „orfan" e o afirmație care cere trei metode de căutare, nu una.**

### 🙋 Decizia lui
Cele două fișiere (172 de linii) se **șterg** sau se **păstrează**? `PositionTable` e deja de două ori
confirmat mort. Nu le-am atins — ștergerea de cod e decizia proprietarului, iar lecția din b267/b268
(panourile LIQ și S/R) e că el vrea să vadă lista înainte.

---

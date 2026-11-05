<!-- generat din docs/BOOK_OF_ALL.md linia 8880 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔍 2026-10-26 — Propria mea verificare dădea fals pozitiv: „418" era o milisecundă

Înainte de reload am numărat erorile de rată cu `grep -cE "429|418"` şi mi-a dat **3**. M-am oprit şi
m-am uitat la ele:

```
07:50:24.418  [WARN] [AT_ENGINE] Entry blocked ...
08:12:54.418  [WARN] [AT_ENGINE] Entry blocked ...
09:11:24.418  [INFO]  [BRAIN]    [C1300] DOGEUSDT ...
```

**Toate trei erau milisecunde din marcajul de timp.** Zero erori HTTP reale. Cu un tipar strâns
(`(HTTP|status|code)[ =:]*4(29|18)\b`) rezultatul e **0**, iar `banned_until` spune **NEBANAT**.

**De ce contează:** tiparul ăsta e în ritualul meu de început de sesiune şi înainte de fiecare reload,
de zile. Un `0` de la el a fost mereu adevărat — deci deciziile luate pe el au fost bune — **dar orice
cifră peste zero putea fi zgomot**, şi exact aia e citirea care ar fi oprit un reload necesar sau ar fi
pornit o căutare de o oră după un ban inexistent.

> **O măsurătoare care poate da fals pozitiv nu e o gardă, e o loterie.**
> Sursa de adevăr pentru ban rămâne `binance_rate_state.banned_until`, nu un `grep` prin jurnal.
> Jurnalul se foloseşte doar cu tiparul strâns, şi doar ca al doilea martor.

*A patra oară în două zile când greşeala era în întrebarea mea, nu în cod — şi prima dată când era
într-o unealtă pe care o folosesc la fiecare reload.*

---

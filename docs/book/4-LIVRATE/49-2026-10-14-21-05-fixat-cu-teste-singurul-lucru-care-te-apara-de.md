<!-- generat din docs/BOOK_OF_ALL.md linia 3112 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🛡️ 2026-10-14, 21:05 — FIXAT CU TESTE: singurul lucru care te apără de execuție dublă

Descoperit în timpul diagnosticului de mai jos, și e mai important decât el.

**`SERVER_AT_DEMO` și `CLIENT_AT` sunt AMÂNDOUĂ pornite în producție acum.** Mutex-ul din
`migrationFlags.js` **nu acoperă perechea** — păzește `SERVER_AT && CLIENT_AT` și
`SERVER_AT_DEMO && SERVER_AT`, dar nu și `SERVER_AT_DEMO && CLIENT_AT`. Deci la nivelul flag-urilor
nimic nu oprește motorul clientului și pe cel al serverului să tranzacționeze **amândouă** pe demo,
pentru același user.

Ce te apără de fapt sunt **trei gărzi în codul clientului** — și **niciun test nu le fixa**:
| funcție | linii | ce face |
|---|---|---|
| `runAutoTradeCheck` | 687 / 701 | iese înainte de motor |
| `placeAutoTrade` | 940 / 942 | *„[LOCKED] Server AT active — client trade blocked"* |
| `scheduleAutoClose` | 1485 / 1487 | nu gestiona și clientul ieșirile |

Cineva care „curăță" niște `return`-uri aparent redundante ar reintroduce execuția dublă **în
tăcere**, iar flag-urile ar arăta în continuare în regulă.

**6 teste** care fixează invariantul, inclusiv unul care verifică nu doar că garda **există**, ci că
e **înaintea** oricărui apel care poate ajunge la bursă. Mutație: scot garda din `placeAutoTrade` →
pică. Unul dintre teste afirmă deliberat că mutex-ul **nu** acoperă perechea, ca să se aprindă dacă
cineva o adaugă — atunci gărzile devin apărare în adâncime, nu singura apărare, iar comentariul
trebuie actualizat, nu testul șters.

**Client 885/885 (122 fișiere).**

### ✅ Verificat: fixul Telegram ține
Zero eșecuri de la reload-ul b273 (20:54 → 21:04). Ritmul anterior era ~9-10/oră, deci în fereastra
asta ne-am fi așteptat la 1-2. **Zece minute nu sunt o dovadă** — de reverificat mâine cu
`grep -c "TELEGRAM.*Send failed" data/logs/pm2-error.log`. Pe ore, azi: 13h→24, 14h→39, 15h→20,
16h→7, 17h→8, 18h→9, 19h→10, 20h→3 (toate înainte de reload).

---

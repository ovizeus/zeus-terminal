<!-- generat din docs/BOOK_OF_ALL.md linia 1063 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🧪 PREDICŢIE INFIRMATĂ — vetoul de `LiqDanger` NU explică desincronizarea — 2026-10-23

**Am făcut o predicţie din mecanismul de mai jos, am testat-o, şi a căzut. O las scrisă, fiindcă
eşecul spune mai mult decât ar fi spus o confirmare.**

### Ce am găsit şi ce am prezis

Clientul şi serverul folosesc acelaşi nume, `LiqDanger`, pentru **lucruri opuse**:

| | aproape de nivel | efect pe încredere |
|---|---|---|
| **server** (`liquidityGrabRisk`) | risc → **1,0** | penalizare **55%** → veto matematic |
| **client** (`MAGNETS.nearPct/100`) | `nearPct` ≈ 0,3 → **0,003** | penalizare **0,16%** → nimic |

Verificat în cod: `dist = ((price − m.price) / price) * 100`, deci clientul foloseşte o **distanţă**
(departe = periculos), serverul **proximitatea** (aproape = periculos). Inversiune semantică reală,
plus un factor de ~100 în magnitudine.

**Predicţia:** dacă vetoul loveşte serverul, atunci cele 52 de cazuri în care una voia să
tranzacţioneze ar trebui dominate de **„doar clientul voia"**.

### Măsurat: exact pe dos

| | n | |
|---|---|---|
| **doar SERVERUL voia** | **49** | **94,2%** |
| doar clientul voia | 3 | 5,8% |

Şi cifra care lămureşte: **când serverul voia, încrederea clientului era `0,0`.** Nu mică — zero.
(Invers, în cele 3 cazuri în care clientul voia: client 66,3, server 26,3.)

### Concluzia corectă — două lucruri separate, nu un lanţ

1. **Vetoul de pe server e real** (aritmetic, dovedit mai jos) şi îl barează în 68,5% din momente.
   Dar el produce `NO_TRADE`, deci **nu poate** cauza „serverul vrea, clientul nu".
2. **Clientul e inert**, nu vetoat: produce **0 confidence** exact în momentele în care serverul
   acţionează. Asta e consistent cu media lui de 3,97 şi cu ce ştiam deja ca „client brain inert"
   ([[brain-serverside-parity-truth]]), dar acum e localizat: nu e „mai prudent", e **mut**.

**Am greşit legându-le.** Inversiunea semantică a lui `LiqDanger` rămâne un defect real de
raportat — două creiere care numesc la fel două mărimi opuse — dar nu e explicaţia desincronizării.

---

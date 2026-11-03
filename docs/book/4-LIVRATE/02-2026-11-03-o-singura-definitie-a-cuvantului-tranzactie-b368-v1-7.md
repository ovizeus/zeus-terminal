<!-- generat din docs/BOOK_OF_ALL.md linia 10746 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🧮 2026-11-03 — O SINGURĂ definiţie a cuvântului „tranzacţie" (b368 v1.7.342)

După b367 am verificat dacă şi celelalte răspunsuri numără la fel. **Nu numărau.** Zeus avea **două** definiţii — şi eu tocmai adăugasem **a treia**.

| cine | ce excludea | cifra |
|---|---|---|
| rândul de cont (al meu, b360) | nimic | **18,5%** |
| răspunsul despre învăţăminte | doar `ENTRY_FAILED*` | **36,7%** |
| reparaţia mea (b367) | tot ce are PnL zero | **44,6%** |
| **corect** | ce n-a fost niciodată poziţie | **39,6%** |

**Trei părţi ale aceleiaşi aplicaţii, trei cifre despre acelaşi om.**

### Şi a mea era greşită, în cealaltă direcţie

Aruncând tot ce e la zero, aruncam **139 de închideri ADEVĂRATE** — `MANUAL_CLIENT`, `EMERGENCY_CLOSED`, `HIT_SL` — tranzacţii încheiate exact pe zero, nu eşecuri.

**Regula corectă nu e despre PnL, e despre ISTORIE: a fost vreodată o poziţie?**

| n-a fost | câte |
|---|---|
| `ENTRY_FAILED*` | 1.572 |
| `RESET` | 91 |
| `RECON_PHANTOM*` | 32 |

Tot restul e tranzacţie, inclusiv cea ieşită pe zero. Cifra lui adevărată: **1.366 de tranzacţii, 39,6% câştig.**

Definiţia stă acum într-un singur loc — o funcţie pură şi fragmentul SQL echivalent — şi e **folosită** şi de rândul de cont, şi de răspunsul despre învăţăminte.

### ⚠️ Lecţia

Mutaţia care întorcea învăţămintele la **propriul lor filtru** a **supravieţuit** prima oară. Aveam regula unică scrisă şi testată, dar **nimic nu cerea ca răspunsurile să o FOLOSEASCĂ**.

> **O definiţie comună pe care o foloseşte un singur apelant nu rezolvă nimic — e exact starea de dinainte.**

Testul cere acum ca nimeni să nu-şi mai scrie singur filtrul.

### Dovada

**5 mutaţii moarte:** resetul redevenit tranzacţie · reconcilierea redevenită tranzacţie · închiderile reale la zero aruncate iar · regula SQL nemaifiind de acord cu cea din cod · învăţămintele revenite la propriul filtru.

8 teste noi. Două teste ale mele de la b367 codificau regula greşită şi au fost **actualizate, nu şterse** — cu toate cele trei cifre păstrate în comentariu, ca să se vadă drumul.

Regresie: **10.196 verzi** pe 4 sharduri, 3 sărite, zero eşuate.

---

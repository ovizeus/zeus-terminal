<!-- generat din docs/BOOK_OF_ALL.md linia 10696 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 📉➡️📈 2026-11-03 — Îi spuneam că are 18% rată de câştig. Are 45% (b367 v1.7.341)

**Bugul e al MEU**, din b360. L-am găsit verificând un număr care nu-mi dădea pace: rândul de cont pe care l-am adăugat eu în promptul lui OMEGA zicea `3199 closed, 18% win`, în timp ce **alte două răspunsuri ale aceluiaşi sistem** ziceau 41% şi 42%.

> **Când două părţi ale aceleiaşi aplicaţii nu sunt de acord despre acelaşi om, una minte.**

### Măsurat

Din cele **3.216** rânduri ale lui din `at_closed`, **1.860 au `closePnl` exact ZERO**. Şi nu sunt tranzacţii încheiate la zero:

| motiv | câte |
|---|---|
| `ENTRY_FAILED_INSUFFICIENT_MARGIN` | **1.199** |
| `ENTRY_FAILED_ERROR` | 125 |
| `ENTRY_FAILED_MARGIN_CHECK_FAILED` | 105 |
| `ENTRY_FAILED_LEVERAGE_FAILED` | 74 |
| `RESET` | 61 |

**Sunt intrări care au EŞUAT. N-au fost niciodată poziţii.** Punându-le la numitor, fiecare eşec de intrare arată ca o înfrângere.

| cum raportam | cifra |
|---|---|
| câştiguri / **toate** rândurile | **18,5%** |
| câştiguri / **tranzacţiile decise** | **44,6%** |

**Diferenţa dintre 18 şi 45 nu e o nuanţă:** e diferenţa dintre un om care crede că sistemul lui nu merge şi unul care ştie că merge pe jumătate. Şi eu i-am pus prima variantă în gura propriului asistent, timp de o zi.

### Reparat

Rata se calculează doar peste tranzacţiile decise, iar intrările eşuate se raportează **separat** — fiindcă 1.860 de intrări care n-au ajuns niciodată poziţii nu-s un detaliu: înseamnă că **sistemul vrea să tranzacţioneze şi nu poate**.

```
Account: demo balance $26067.90 · today -10.31 · 1327 trades, 45% win
         · 1860 entries never filled · loss streak 3.
```

### ⚠️ Lecţie despre testele mele

Prima mutaţie pe **calculul** numitorului a **supravieţuit** — fiindcă testele hrăneau formatarea cu valori scrise de mână şi nu atingeau deloc felul în care se calculează. Am acoperit şi calculul, cu o bază falsă, şi abia atunci a murit.

> **A testa forma unui număr nu e acelaşi lucru cu a testa numărul.**

### Dovada

**3 mutaţii moarte:** rata revenită pe toate rândurile · intrările eşuate neraportate · numitorul luând şi rândurile la zero.

7 teste noi. Regresie: **10.188 verzi** pe 4 sharduri, 3 sărite, zero eşuate.

---

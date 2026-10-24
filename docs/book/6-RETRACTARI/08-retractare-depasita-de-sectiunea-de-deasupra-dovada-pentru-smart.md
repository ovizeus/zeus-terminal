<!-- generat din docs/BOOK_OF_ALL.md linia 1622 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ⚠️ RETRACTARE (depăşită de secţiunea de deasupra) — dovada pentru `SMART_CUT` aşa cum arăta înainte de calibrare — 2026-10-21

**Nu e o schimbare de cod. E o corecţie la ce ţi-am recomandat la b299.**

La b299 am justificat învierea lui `SMART_CUT` cu cohortul de umbră `lossside`: **380 de
observaţii, avantaj mediu +0,0519 pp, 40 de cazuri mai bune contra 2 mai rele.** Am verificat de
unde vin cifrele alea, şi nu susţin concluzia.

### Ce am găsit

Cohortul `shadow` (407 observaţii, aceeaşi perioadă) compară **realitatea** cu **simularea aceleiaşi
geometrii** — `dslArm` nu e atribuit nicăieri în cod, e doar citit, deci presetul simulat e identic
cu cel real. Rezultatul măsoară deci **cât de optimist e simulatorul**:

| preset | n | realitate − simulare | mai prost în realitate |
|---|---|---|---|
| `fast` (cel folosit) | 388 | **−0,0648 pp** | **358 din 388 = 92%** |

### De ce asta desface dovada de la b299

`_lsBaseFrac` (serverAT.js:2622) se calculează din **preţul real de închidere**. Deci la cohortul
`lossside`, **baza e realitatea** şi `SMART_CUT` e **simulat** — comparaţia moşteneşte integral
optimismul de mai sus.

```
optimismul simulatorului, măsurat : +0,0648 pp/tranzacţie
avantajul SMART_CUT, raportat     : +0,0519 pp/tranzacţie
avantaj CORECTAT                  : −0,0129 pp/tranzacţie
```

**Avantajul raportat e mai mic decât eroarea cunoscută a simulatorului.** Corectat, `SMART_CUT` ar
fi uşor **mai prost** decât a nu face nimic.

### Ce rămâne valabil şi ce nu

- **Reparaţia de cod din b299 rămâne corectă.** Un `ReferenceError` pe fiecare tick, înghiţit de un
  `catch` gol patru luni, trebuia reparat indiferent de ce spune cohortul. Şi blocul era intestabil;
  acum nu mai e.
- **Recomandarea mea de a-l aprinde pe REAL — o retrag.** Gardul de probe al lui b161 (`n>=30-50`)
  părea depăşit de 3 ori; de fapt nu e depăşit deloc, fiindcă proba era măsurată cu un instrument
  optimist. Rămâne `TESTNET`-only, cum l-a lăsat b161.
- **Consecinţă mai largă, pentru orice decizie viitoare:** `serverDSL.simulate` şi
  `_smartCutPnlPct` **nu pot fi folosite ca dovadă** fără să se scadă acest bias. Asta include
  orice contrafactual de geometrie DSL — inclusiv cel pe care m-am oferit să-l rulez. Un
  contrafactual onest trebuie mai întâi să explice de ce reluarea e cu 0,065 pp mai bună decât
  realitatea: probabil eşantionarea la 500 ms ratează mişcările din interiorul intervalului, plus
  alunecarea şi comisioanele.

*Precizie: cele două cohorturi nu sunt perfect comparabile (407 vs 382 de observaţii, aceeaşi
fereastră iunie–octombrie), deci scăderea e orientativă, nu riguroasă. Dar direcţia e clară, iar
92% din cazuri mai proaste în realitate nu e zgomot.*

---

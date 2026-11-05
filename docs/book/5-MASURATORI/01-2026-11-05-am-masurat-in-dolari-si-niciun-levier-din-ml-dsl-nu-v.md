<!-- generat din docs/BOOK_OF_ALL.md linia 11355 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 💰 2026-11-05 — Am măsurat în DOLARI, şi niciun levier din ML/DSL nu valorează nimic (măsurătoare, fără schimbare de cod)

După ce recompensa e curată (b378/b379), întrebarea rămasă e **cât valorează**. Am trecut tot din puncte procentuale în dolari, prin `size × lev`.

### Controlul ML tick-cu-tick: −10,81$ pe 403 închideri

| acţiune | n | total $ | $/tranz. |
|---|---|---|---|
| `ml:LOOSEN` | 178 | **−30,95** | −0,17 |
| `ml:HOLD` | 46 | −12,47 | −0,27 |
| `ml:BREATHER` | 27 | −5,72 | −0,21 |
| `ml:EXIT` | 7 | +17,03 | +2,43 |
| `ml:TIGHTEN` | 145 | **+21,30** | +0,15 |
| **TOTAL** | **403** | **−10,81** | **−0,03** |

**329 din 403 sunt EGALE** — controlul ML nu schimbă nimic în 82% din tranzacţii.

⚠️ **Corecţie la mine:** ieri am scris că „controlul ML pierde consecvent". Pe rata de câştig, da. **În bani, e −10,81$ pe 403 închideri, adică zgomot.** Am exagerat citind o rată ca pe o pierdere. Şi atenţie: `ml:HOLD` are avantaj mediu **pozitiv** în pp dar **−12,47$** în bani — pierderile au căzut pe poziţii mai mari. **Media în pp şi totalul în dolari pot avea semne diferite.**

### Unde sunt banii de fapt: ultimele 30 de zile

| motiv | n | total |
|---|---|---|
| `Manual close` | 71 | **+2.902,52** |
| `Close All Manual` | 2 | +653,06 |
| `DSL_PL` (automatul) | **184** | **−74,84** |
| `SL (reconnect verify)` | **3** | **−392,39** |
| `SL HIT` | 1 | **−223,36** |

**Patru tranzacţii = −615,75$.** De opt ori tot ce pierde DSL-ul pe 184 de închideri, şi de **60 de ori** toată discuţia despre controlul ML.

### 🔴 Şi cele trei au fost UN SINGUR eveniment

Toate la **2026-10-20 04:16:45**, la aceeaşi secundă. XRP singur: **−384,88$** pe 1.033,98$ la 5×.

Codul care le-a închis e **pe client**: `client/src/utils/guards.ts` → `closeDemoPos(pos.id, 'SL (reconnect verify)')`. Adică **stopul era păzit doar cât timp telefonul era conectat.** Clientul s-a reconectat, a verificat, şi a găsit trei poziţii deja trecute de stop — închise la un preţ mult mai rău.

| | |
|---|---|
| `reconnect verify`, tot istoricul | **29 închideri, −356,82$** |
| doar 20 octombrie | **−392,39$** (restul istoriei: **+35,57$**) |
| după 1 noiembrie | **0** |

S-a oprit după reparaţia de proprietate de la **b352** — pe care am livrat-o fără să ştiu că avea costul ăsta ataşat.

⚠️ **Onest:** patru zile de absenţă nu dovedesc singure cauzalitatea; se poate şi ca telefonul să nu se fi deconectat. Dar mecanismul se potriveşte exact, şi `computeServerDrivesAT` scoate clientul din ecuaţie prin construcţie.

### Concluzia pentru „ce facem să fie full functional"

Bucla ML-DSL e acum **corectă** şi va învăţa curat. Dar **nu e acolo levierul**: presetul valorează 0,0165 pp, controlul ML −11$ pe 403 închideri.

Ce a mişcat bani cu adevărat a fost **operaţional**, nu ML: proprietatea motorului şi păzirea stopului. Un eveniment de deconectare a costat 36 de ori cât tot ML-ul.

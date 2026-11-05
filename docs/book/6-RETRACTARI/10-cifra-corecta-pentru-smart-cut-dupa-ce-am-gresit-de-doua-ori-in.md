<!-- generat din docs/BOOK_OF_ALL.md linia 1565 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🎯 CIFRA CORECTĂ pentru `SMART_CUT` — după ce am greşit de două ori, în direcţii opuse — 2026-10-21

**Nu e cod. E calibrarea simulatorului, care lipsea — şi care face cifra utilizabilă.**

Secţiunea de dedesubt (retractarea) folosea un optimism de simulator **contaminat**. L-am
decompus, şi s-a văzut de unde venea.

### De unde vine optimismul — nu de unde credeam

Ipoteza mea era „eşantionarea la 500 ms ratează mişcările din interval, deci creşte cu durata".
**Infirmată:** pe quartile de durată, optimismul e −0,074 / −0,063 / −0,042 / −0,065 — fără nicio
tendinţă. Media (−0,061) era mult peste mediană (−0,014), deci nu un decalaj uniform, ci **o coadă**.

Coada e în motivul ieşirii:

| ieşire reală | n | optimism |
|---|---|---|
| `HIT_SL` | 45 | **+0,0020** — simularea e **exactă** |
| `DSL_PL` | 270 | −0,0487 |
| `Manual close` | 19 | −0,0274 |
| **`EXTERNAL_CLOSE`** | 22 | **−0,3717** |
| **`RECON_PHANTOM`** | 20 | **−0,2340** |
| `HIT_TP` | 16 | +0,1279 *(simularea e pesimistă)* |

Simulatorul e **precis când ieşirea e deterministă** (`HIT_SL`: +0,002) şi complet greşit când
ieşirea reală **nu a fost decizia DSL-ului** — `EXTERNAL_CLOSE` şi `RECON_PHANTOM` sunt închideri
venite din afară (bursă, reconciliere). Pentru acelea, întrebarea „ce ar fi făcut DSL" nu are
răspuns, fiindcă DSL n-a decis nimic. **42 de tranzacţii trăgeau toată media.**

### Cifra curată

Excluzând ieşirile care nu au fost deciziile DSL-ului (`EXTERNAL_CLOSE`, `RECON_PHANTOM`,
reconnect-verify, emergency — **47 excluse din 407**):

| | contaminat | **curat** |
|---|---|---|
| optimismul simulatorului | +0,0648 | **+0,0333** |
| avantajul `SMART_CUT` | +0,0519 | **+0,0543** |
| **corectat** | −0,0129 | **+0,0210** |

**Deci am greşit de două ori, în direcţii opuse:** afirmaţia iniţială (+0,052, „gard depăşit de 3
ori") era **umflată**; retractarea (−0,013, „niciun avantaj") era **prea dură**. Răspunsul e la
mijloc: **+0,0210 pp, adică circa 40% din ce am raportat prima dată**, pe 348 de observaţii curate.

**Şi o nuanţă care contează mai mult decât media:** mediana avantajului e **0,0000**. `SMART_CUT`
nu schimbă nimic în tranzacţia tipică; media vine dintr-o minoritate de cazuri — e o intervenţie
**pe coadă**, consistentă cu „acţionează pe ~11% din pierzători".

*Asumpţie declarată: lista de ieşiri excluse e judecata mea despre ce nu a fost o decizie a DSL-ului.
Dacă pui altceva pe listă, cifra se mişcă.*

**Verdict practic:** există un avantaj mic şi pozitiv, măsurat cu un instrument acum calibrat.
Rămâne `TESTNET`-only, şi rămâne decizia ta — dar acum cu o cifră în care se poate avea încredere,
nu cu una umflată de 2,5 ori.

---

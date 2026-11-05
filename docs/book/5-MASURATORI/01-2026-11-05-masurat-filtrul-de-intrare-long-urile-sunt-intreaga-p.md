<!-- generat din docs/BOOK_OF_ALL.md linia 11467 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🎯 2026-11-05 — Măsurat filtrul de intrare: LONG-urile sunt întreaga pierdere

Măsurătoare, zero schimbare de comportament. Şi **trei corecţii la mine pe parcurs** — le scriu pe toate, fiindcă tiparul e mereu acelaşi: **am amestecat populaţii.**

### ⚠️ Corecţia 1 — „aceleaşi tranzacţii" era fals

Spusesem că `DSL_PL` şi închiderile manuale sunt aceleaşi tranzacţii, doar închise de altcineva. **Nu.** Sunt **două motoare în două perioade:**

| | `controlMode` | motive | perioadă | net |
|---|---|---|---|---|
| tier NULL (79) | lipsă | `Manual close`×71, `SL (reconnect verify)`×3, `DSL PL Exit @$...`×5 | **12–31 oct** | +2.472,72 |
| tier setat (185) | `auto` | `DSL_PL`×183, `HIT_TP`, `DSL_ML_CUT` | 7 oct – 5 noi | −234,29 |

Primul e **motorul din client** — s-a oprit pe 31 octombrie, când serverul a preluat demo.

### ⚠️ Corecţia 2 — „manual bate botul" era o lună norocoasă

| lună | n manual | net |
|---|---|---|
| 2026-04 | **316** | **−657,42** |
| 2026-05 | **128** | **−619,28** |
| 2026-06 | 13 | −523,03 |
| 2026-10 | 73 | **+3.555,58** |
| 2026-11 | **0** | — |

Închiderile manuale au pierdut **1.800$ pe 457 de tranzacţii** în aprilie–iunie. **Octombrie e excepţia.** Prezentasem o lună ca pe un avantaj.

### ⚠️ Corecţia 3 — „noiembrie a regresat" era mărimea poziţiei

Normalizat pe expunere (`size × lev`):

| lună | n | câştig % | pierdere % | R:R normalizat |
|---|---|---|---|---|
| 2026-06 | 256 | 0,571 | 0,841 | 0,68 |
| 2026-10 | 128 | 0,671 | 0,502 | 1,34 |
| **2026-11** | 57 | **0,798** | **0,452** | **1,77** |

**Noiembrie e cea mai bună lună**, nu cea mai slabă. Expunerea a scăzut de la 8.872$ (apr) la 1.154$ (noi) — dolarii s-au micşorat, comportamentul s-a îmbunătăţit. **Normalizează ÎNAINTE de a citi un trend.**

### ✅ Şi atunci rămâne un singur lucru

**Ieşirile se îmbunătăţesc. Intrările se degradează.**

| lună | rată | prag (la R:R-ul lunii) | lipsă |
|---|---|---|---|
| 2026-06 | 46,5% | 59,5% | 13pp |
| 2026-10 | 29,7% | 42,7% | 13pp |
| 2026-11 | 26,3% | 36,1% | 9,8pp |

### 🎯 Unde e gaura: direcţia

1 oct – 5 noi, era serverului, 185 închideri:

| direcţie | n | rată | net |
|---|---|---|---|
| **LONG** | 63 | **17,5%** | **−273,69$** |
| SHORT | 122 | 34,4% | **+39,40$** |
| **total** | 185 | | **−234,29$** |

**Fără LONG: +39,40$ în loc de −234,29$.** Semnul se schimbă.

Statistic: 11 câştiguri din 63 faţă de un prag de ~36% → **z = −3,1**, o şansă la mie să fie noroc.

Pe regim: `LONG+BREAKOUT` **13,3%** (n=30, −153,42$) · `LONG+TREND` 23,1% (n=26) · `SHORT+TREND` 44,4% (n=45, +380,80$).

Şi nu e nou: LONG a fost **42,6%** în iunie (n=101), 18,2% în octombrie, **15,8%** acum. Problema longurilor a fost ridicată în iunie şi n-a fost închisă niciodată.

### ⛔ Ce NU e dovedit

**`SHORT+TREND` la 44,4% e cea mai bună celulă, dar z = +1,2 — în zgomot.** A alege o celulă *fiindcă* e cea mai bună din cinci e supraînvăţare manuală, exact greşeala care a produs cele trei corecţii de mai sus.

**Avem dovadă să STINGEM ceva, nu dovadă să alegem un câştigător.** Singura afirmaţie solidă e negativă: LONG e sub prag la 3 sigma.

### Ce ar lua

Nu există niciun filtru de direcţie. `stc` are `confMin`, `sigMin`, `adxMin`, `maxPos`, `maxDay`, `lev`, `size`, `slPct`, `rr`, `dslMode`. Ar fi o funcţie nouă, mică şi păzită, pe calea de intrare — **schimbare pe calea banilor, deci decizia lui.**

### ⏳ Rămas neverificat

Dovada pe date vii a recompensei curate (b378/b379): observatorul a expirat după 25 de minute **fără nicio închidere**. Vine la prima.

---

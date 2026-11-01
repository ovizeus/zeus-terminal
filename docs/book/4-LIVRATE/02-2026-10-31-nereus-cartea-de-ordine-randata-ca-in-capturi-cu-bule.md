<!-- generat din docs/BOOK_OF_ALL.md linia 9670 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🌊 2026-10-31 — NEREUS: cartea de ordine randată ca în capturi, cu bule, lichidări şi COB (b347 v1.7.321)

**Cererea lui:** *„uită-te la capturi de ecran, vreau şi eu indicatorul ăla cu date reale, făcut ca la carte, aceleaşi culori, gen copy-paste… dai ce nume vrei tu, la urmă îmi zici, dar vreau exact aşa, cu bule, culori, tot, lichidări, nu sări nimic"*. Despre culori, imediat după: *„bine, culorile pune-le de la tine, nu contează"*.

**Numele: NEREUS** — zeul mării care cunoaşte adâncurile şi răspunde numai adevărul. Se potriveşte cu un panou care refuză să arate o cifră pe care nu a măsurat-o. Scris în banda de sus a rubricii BOOK.

### Ce am măsurat ÎNAINTE să scriu cod — fiindcă a decis tot designul

| Întrebare | Măsurătoare | Ce a decis |
|---|---|---|
| De unde iau tranzacţiile? | WS tranzacţii Binance futures: **0 mesaje în 20 s**. Bybit 161, OKX 284. | **REST aggTrades**, aceeaşi piaţă ca harta. Nu de pe altă bursă — altfel bulele şi carnetul ar fi din două pieţe diferite. |
| Cât de des interoghez? | 1000 de tranzacţii acoperă **25,1 s**. | Interogare la **18 s**, legată pe `fromId`, fără găuri. |
| Cât de mari sunt bulele? | Mărimi de la 0,001 la 7,25 BTC — raport **7000×**. | Rază **logaritmică**, iar sub **2% din maxim** nu se mai desenează. Altfel harta e un zid de cercuri. |

### Grila a devenit ABSOLUTĂ, şi banda separată de preţ a fost scoasă

Bulele şi lichidările au **preţuri reale**. Grila relativă la mijlocul fiecărei coloane le-ar fi pus pe rândul greşit. Deci harta se desenează pe preţ absolut (`heatAbs`), iar **linia preţurilor se desenează chiar în hartă**, unde îi este locul. Banda separată de deasupra exista doar fiindcă grila era relativă — acum n-ar mai arăta nimic în plus, aşa că a dispărut.

### ⛔ DOUĂ LUCRURI GĂSITE RANDÂND CU DATE VII, nu citind cod

**(a) Tranzacţiile din afara ferestrei erau AGĂŢATE la margine.** `xOf` făcea `Math.max(0, Math.min(1, f))`, deci tot ce era mai vechi decât harta se stivuia într-o **coloană de bule pe marginea stângă**, la cel mai vechi moment, unde în realitate nu fusese nimic. În producţie inelul de tranzacţii ţine **20 de minute** şi fereastra implicită a hărţii e **10** — deci ar fi fost **jumătate din bule**, minţind. Pe axa de **preţ** aceeaşi minciună era deja închisă (`yOf` întorcea `null`); pe axa de **timp** nu era. Acum se aruncă, nu se agaţă: pe aceleaşi date vii, **91 de cercuri au devenit 13**, exact cele din fereastră.

**(b) Eticheta spunea „N trades drawn" folosind lungimea listei.** Dar desenul aruncă şi tranzacţiile mici (pragul) şi pe cele din afara ferestrei — deci anunţa o cifră pe care nu o desena. Era aceeaşi clasă ca fermitatea de 2450%: un număr care arată credibil şi nu e măsurat. Acum numără ce s-a desenat chiar: **„9 of 1000 trades drawn"**.

Amândouă au ieşit randând în ASCII şi uitându-mă. A cincea oară în sesiunea asta când metoda asta găseşte ce cititul codului nu a găsit.

### Un decalaj prins de testul de contract — şi cauza lui reparată

Ruta trecuse pe `heatAbs`, care **nu întorcea `bandPct`**, iar panoul îl citea: eticheta de bandă arăta banda **cerută**, nu cea desenată. Reparat la cauză, pe trei niveluri:

1. `heatAbs` întoarce lăţimea **măsurată** — pe datele vii, **±0,215%** (confirmă încă o dată: cartea care există e îngustă, zoom-ul merge adânc şi în timp, nu departe).
2. Testul de contract **nu mai scrie** numele funcţiei de hartă — îl **citeşte din rută** (`const heat = BM.<nume>(`). Versiunea anterioară verifica `heat()` după ce ruta trecuse pe `heatAbs()`: apăra o formă pe care nimeni nu o mai trimitea. Aşa nu mai poate rămâne în urmă.
3. Garda din panou compara `bandPct` doar cu `undefined`, iar acum poate fi `null` — **a patra oară în sesiunea asta** când `Number(null)` e `0` şi `null` nu e `undefined`. Acum se cere finitudine.

### Dovada

**20 de mutaţii moarte**, printre care: agăţarea la margine pusă înapoi, eticheta întoarsă pe lungimea listei, COB-ul scos, razele făcute egale, linia preţurilor făcută dreaptă, `bandPct` scos din ambele forme (plină şi goală) şi ruta întoarsă pe `heat` relativ.

⚠️ **O mutaţie a supravieţuit prima oară, şi o spun:** testul pe COB verifica doar „x maxim > 50", iar harta singură ajunge aproape de marginea dreaptă — deci nu discrimina. Acum geometria se **calculează** (`cobW = max(26, min(64, round(w·0,13)))`, `mapW = w − cobW − 2`) şi se cere o bară **dincolo** de hartă.

Teste: **15** pe `tradeFeed`, **12** pe `heatAbs`, **52** pe randare, **9** pe contract. Server **10.023** verzi pe 4 shard-uri, client **1.547**, `tsc` 0 erori. Verificat în **bundle-ul servit**: `return !Number.isFinite(n)||n<0||n>1?null:n*h` cu apelul gardat `i!==null&&(…)` — nu e cod mort.

### Rămâne

`heat()` (varianta relativă) e acum **cod mort** după trecerea rutei pe `heatAbs` — de curăţat separat, nu în aceeaşi livrare.

---

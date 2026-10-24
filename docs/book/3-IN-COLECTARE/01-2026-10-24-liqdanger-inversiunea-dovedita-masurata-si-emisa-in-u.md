<!-- generat din docs/BOOK_OF_ALL.md linia 6825 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🧲 2026-10-24 — LiqDanger: inversiunea dovedită, măsurată, şi emisă în UMBRĂ (b312 v1.7.286)

Operatorul: *„fa liqdanger da sami zici cei aia inainte"*. Deci: explicaţie întâi, apoi
lucrul.

### Corecţie la propria mea notă, înainte de orice

Spusesem: *„serverul tratează apropierea ca pericol (penalizare 55%), clientul distanţa
(~0,16%); acelaşi nume, sensuri opuse, ~100× diferenţă de magnitudine"*.

**Coeficientul e IDENTIC pe ambele părţi** — `0.55`, şi la `serverBrain.js:2108`, şi la
`autotrade.ts:642`. Partea cu „~100× diferenţă de magnitudine" era greşită. Inversiunea
e reală; magnitudinea pe care o invocasem, nu.

### Ce e LiqDanger

Magneţii de lichiditate sunt niveluri unde stau grămadă stopuri şi lichidări — vârfuri
şi minime anterioare, numere rotunde. Preţul e **atras** spre ele. A intra când preţul e
lipit de unul înseamnă şansă mare să fii măturat: preţul atinge zona, ia stopurile, se
întoarce.

Intră în creier ca tăiere de încredere, `confF *= (1 - liqDangerN * 0.55)`, iar din
încredere ies direct **dacă se intră** şi **cu ce mărime**. Calea e **vie**: al doilea
consumator din `autotrade.ts` e *„FUSION BRAIN v1 — final arbiter before exec"*, care
pune `FUSION_SIZE_MULT` (1,75 / 1,35 / 1,0) şi face `NO_TRADE → veto + return`.

### Inversiunea, dovedită

`MAGNETS.nearPct` e **DISTANŢA** până la cel mai apropiat magnet, în procente
(`arianova.ts:1470`: `dist = ((price - m.price) / price) * 100`). Deci **mic = aproape =
periculos**. Confirmat şi de felul în care o foloseşte ARIA la `arianova.ts:1639`:
`p < 0.25 ? -7 : p < 0.6 ? -3 : p < 1.5 ? 0 : +3` — aproape e penalizat, departe e
răsplătit.

Clientul o lua direct ca pericol — **sens invers** — şi o mai împărţea o dată la 100,
deşi era deja procent.

### Măsurat, nu dedus

Pe rândurile reale din `brain_parity_log`:

| | mediană | medie | sub 0,5% (lipit de magnet) |
|---|---|---|---|
| **client** | **0,00** | 0,00 | **99,7%** |
| server | 100,00 | 81,80 | 4,2% |

Deci: în 99,7% din cazuri preţul e la sub 0,5% de un magnet — adică exact situaţia
periculoasă — şi clientul aplică **zero penalizare**. **LiqDanger pe client e şi întors,
şi inert.**

### De ce NU am copiat serverul

Serverul calculează corect apropierea, dar are **mediana 100%**. Ar tăia ~45% din
încredere la **fiecare** decizie — o **taxă constantă**, nu un semnal care
discriminează. Şi oricum partea de server nu e pe calea vie: `_computeFusion` n-are
deloc `liqDanger` (retras tot azi).

A copia serverul pe client ar fi fost o **schimbare de comportament pe bani**, nu o
reparaţie. De-aia pragul rămâne **parametru**, nu constantă.

### Ce s-a livrat

Funcţie pură nouă `client/src/trading/liqDanger.ts`: pericolul din **apropiere**, cu
pragul parametrizat. Valoarea corectă se emite **alături**, ca `LiqDangerFix` în
`reasons`, deci ajunge în `brain_parity_log` şi se poate măsura pe date vii.

**Decizia rămâne pe valoarea veche.** `liqDangerN = _clampFB01(nearPct / 100)` şi
`confF *= (1 - (liqDangerN * 0.55))` sunt **neatinse** — verificat în diff şi în
bundle (`d=TC(t/100)`). Schimbări de comportament: **zero**.

În plus, eticheta veche scria `nearPct.toFixed(0)`, deci tot ce era sub 0,5% se rotunjea
la „0" şi **exact zona care contează era invizibilă în măsurătoare**. Acum două zecimale.

### Verificare

10 teste noi scrise înainte, inclusiv unul care pinuieşte chiar inversiunea: la 0,1%
distanţă, formula veche dă sub 0,01 (nicio penalizare), cea nouă peste 0,75. Mutaţie: 3
mutanţi ţintiţi — sensul redevine întors; dincolo de prag nu mai e zero; lipsa
măsurătorii cade pe 0 în loc de neutru — **toţi morţi**. 148 de fişiere, **1250 teste**
verzi, `tsc` curat.

### Rămas, şi e decizia lui

După câteva zile de colectare se citeşte distribuţia lui `LiqDangerFix` pe date vii, se
alege pragul, **apoi** se mută pe decizie. Acelaşi tipar ca `shadow_geom`: colectezi,
citeşti, abia apoi atingi ce tranzacţionează.

### Decizia operatorului (2026-10-24): *„lasa sa colecteze cateva zile"*

Deci nu se atinge decizia. `LiqDangerFix` se adună în `brain_parity_log`, iar citirea e
livrată **odată cu** colectarea, nu „mai târziu": `scripts/liqdanger-shadow.py` arată
distribuţia distanţei, pericolul de acum vs cel corect, penalizarea în puncte
procentuale pe fiecare, şi cât de des ar discrimina valoarea corectă.

Ce trebuie citit acolo: dacă valoarea corectă stă **mereu sus**, nu e un semnal care
alege, e o taxă constantă — şi atunci se strâmtează pragul `LIQ_PROXIMITY_PCT`, nu se
mută decizia pe ea. Exact capcana în care stă partea de server (mediana 100%).

Motivul pentru care cititorul vine acum, nu peste câteva zile: cohortul `shadow` a stat
patru luni cu semantică greşită fiindcă nimeni nu se uita la el. **Colectarea fără
citire nu e măsurătoare, e speranţă.**

---

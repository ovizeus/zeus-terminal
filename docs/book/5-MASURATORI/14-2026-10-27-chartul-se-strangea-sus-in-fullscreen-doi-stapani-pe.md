<!-- generat din docs/BOOK_OF_ALL.md linia 9462 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 📉 2026-10-27 — Chartul se strângea sus în fullscreen: DOI STĂPÂNI pe aceeaşi înălţime (b341)

**El, cu patru capturi — de pe telefon ŞI de pe PC:** *„când îl măresc pe tot ecranul e ok dar câteodată se strânge sus… pun un indicator şi se duce în sus… daimon de ex îl activez şi se duce în sus **dar nu la toţi**"*. Ca să revină, apăsa **T&S** o dată sau de două ori.

### Măsurat pe capturi
Pânza rămânea la **340px pe telefon** şi **400px pe PC** — adică exact `getChartH()`, **valoarea de NEfullscreen** — în timp ce cutia `#mc` rămânea întinsă pe tot ecranul. De aici golul negru uriaş sub chart şi panourile lipite jos.

### 🔴 Cauza: chartul avea DOI stăpâni pe aceeaşi proprietate

Găsită uitându-mă **în bundle**, după un `ResizeObserver` care nu era al meu.

| stăpân | ce face |
|---|---|
| `TradingChart.tsx` | observă containerul şi face `chart.resize()` din `contentRect` — **se potriveşte după cutie** |
| `applyChartLayout` / `_resizeCharts` | **impun** o înălţime calculată separat |

Când al doilea scrie **340 peste o cutie de 900**, chartul se strânge — şi **observatorul nu se trezeşte**, fiindcă s-a schimbat **pânza**, nu cutia. Rămâne strâns până când ceva schimbă chiar cutia.

### Şi de aici vine „DAR NU LA TOŢI" — care a fost cheia

| ce aprinzi | se vede bugul? |
|---|---|
| indicator **cu panou** (MFI, MACD…) | **nu** — panoul schimbă cutia ⇒ observatorul repară singur |
| indicator **doar overlay** (DAIMON) | **da** — e un sprite `position: absolute` în `#mc`, cutia nu se schimbă |

Şi **T&S repara** tocmai fiindcă schimbă cutia. Fără observaţia lui „nu la toţi" n-aş fi găsit asta.

### Reparat pe clasă, nu pe declanşator

**Cei doi stăpâni spun acum acelaşi lucru.** În fullscreen înălţimea impusă se ia din **cutia măsurată** (`#mc` e `flex: 1 1 auto`, deci browserul a calculat-o deja corect ţinând cont de toolbar, legendă şi fiecare panou aprins). Socoteala veche rămâne rezervă, iar o cutie absurd de mică nu e crezută.

**Plus o plasă de siguranţă:** un observator pe `#mc` care reaşază chartul la orice schimbare de cutie, pe `requestAnimationFrame` — adică exact ce făcea el manual apăsând T&S.

### Un test al meu nu putea cădea niciodată

Verifica garda din callback — dar `applyChartLayout` îşi prinde singur fiecare aruncare, deci n-o puteam declanşa din afară. **Scos.** Garda rămâne, **declarată ca gardă de graniţă fără test**, fiindcă o aruncare într-un callback de `ResizeObserver` opreşte în linişte toate notificările următoare.

**14 teste noi, 6 mutaţii moarte** — inclusiv cutia ignorată, adică exact bugul lui.

Backup înainte de orice atingere, cum a cerut: arbore curat pushuit + eticheta `backup/pre-chart-height`.

---

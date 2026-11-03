<!-- generat din docs/BOOK_OF_ALL.md linia 8826 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🕓 2026-10-26 — Heatmap-ul avea date şi părea stricat: axa desena fereastra CERUTĂ (b327 v1.7.301)

După ce am reparat scara, m-am uitat şi la cealaltă vedere. **Măsurat pe viu:** cu **1,3 ore** de istoric
într-o fereastră de **90 de zile**, toate cele 5 celule cădeau în **coloana 89 din 90**.

Harta era **89/90 goală**, cu o dungă subţire la margine. **Avea date şi părea stricată.**

### Aceeaşi clasă ca la scară

> **Dacă desenezi intervalul CERUT în loc de intervalul care EXISTĂ, ascunzi exact ce ai.**

`tMin` e acum cel mai vechi rând chiar existent, mărginit de fereastră. Pe aceleaşi date:

| | înainte | după |
|---|---|---|
| celule | 5 | **124** |
| coloane ocupate | **1** din 90 | **60** din 90 |
| lăţime folosită | **1%** | **98%** |
| fereastra desenată | 2 160 h (goale) | **11,9 h** (pline) |

### Dar atunci eticheta trebuie să spună CE a desenat

Altfel cineva citeşte 12 ore crezând că vede 90 de zile — **şi aia nu mai e o hartă goală, e una care
minte.** Legenda poartă acum intervalul real (`11.9h`, `45m`, `90d`), cu zecimală doar sub 10 ore, unde
chiar schimbă citirea.

**Şi un test al meu aştepta greşit:** cerea `11.9h` unde codul dă `12h`. **Codul avea dreptate** — peste
10 ore zecimala nu schimbă nimic. Corectat testul, nu codul. *A patra oară în două zile când greşeala
era în aşteptarea mea, nu în cod.*

### Cum arată acum, pe date reale

**1 132 de lichidări pe BTC, 334,46 M $**, toate trei bursele trag (bybit 522, okx 327, **gate 283**):

```
80804  +0.50%     $23.1K
80679  +0.25%    $101.2K
       PRICE 80489
80385  -0.25%    $29.66M
80019  -0.50%    $70.77M
79927  -0.75%   $147.11M   ← vârful cascadei
79663  -1.00%    $47.94M
79382  -1.25%    $34.18M
79369  -1.50%     $2.99M
79124  -1.75%    $681.8K
```

Asta e o **cascadă de lichidări** citită dintr-o privire: preţul a coborât, longurile au plătit, iar
cel mai scump nivel a fost la −0,75%.

Client: 157 de fişiere, **1 362 de teste verzi**, `tsc` 0 erori.

---

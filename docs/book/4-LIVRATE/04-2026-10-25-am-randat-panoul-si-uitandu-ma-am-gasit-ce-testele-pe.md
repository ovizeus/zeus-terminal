<!-- generat din docs/BOOK_OF_ALL.md linia 8711 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 👁️ 2026-10-25 — Am RANDAT panoul, şi uitându-mă am găsit ce testele pe sursă nu prinseseră (b325 v1.7.299)

Toate testele de până aici verificau **sursa**: că pictograma e cablată, că ruta e chemată, că nu
mai sunt cuvinte româneşti. **Niciunul nu randase panoul.** Deci nimic nu dovedea că **se vede**, că
**se citeşte**, sau măcar că nu aruncă la randare.

### Ce am făcut

**17 teste de randare**, dintre care două pe **datele REALE din baza vie** (exportate din `liqStore`, nu
inventate de mine). Ce dovedesc: că randează fără să arunce, că cifrele mari sunt **scurtate**
(`$18.09M`, nu `18094325`), că nu apare **niciodată** `$NaN`/`undefined`/`Infinity`, că taburile chiar
schimbă vederea, că o lichidare live apare în tape cu dolari şi parte, că banda de simboluri chiar
cere alt simbol, şi că gol înseamnă gol — cu explicaţia de ce.

**5 mutaţii, toate moarte:** cifre nescurtate, taburi moarte, tape fără ascultător, banda scoasă,
long şi short cu aceeaşi culoare.

### Şi lucrul pentru care a meritat

Testul de limbă trecea verde. Dar când am tipărit ce randează panoul şi **m-am uitat**, am văzut:

```
since 25/10/2026 21:24 · coverage +0.60% / -0.70% · okx bybit gate · 7z 30z 90z
```

**`7z 30z 90z`** — „z" de la **zile**. Română scăpată în interfaţă, pe care regexul meu n-a prins-o
**fiindcă nu e un cuvânt**. Reparat (`7D 30D 90D`) şi păzit cu un test care cade pe forma scurtă,
nu doar pe cuvinte — dovedit punând `z` înapoi.

> **O regulă de interfaţă nu se verifică citind sursa. Se verifică uitându-te la ce iese.**
> Un test pe sursă întreabă ce am scris; o randare întreabă ce vede omul.

### Cum arată, pe datele lui reale

```
LIQUIDATION MAP   BTCUSDT   MEASURED · NOT MODELLED
HISTORY  97 liquidations  $18.09M
since 25/10 21:24 · coverage +0.60% / -0.70% · okx bybit gate · 7D 30D 90D
BTC 97 · ETH 77 · SOL 28 · ZEC 28 · XRP 22 · NG 14 · DOGE 13 · PEPE 12

  80804  +0.50%   $23.1K
  80618  +0.25%    $1.8K
  80194  -0.25%  $12.77M
  80120  -0.50%   $5.27M
  79930  -0.75%   $33.1K
          PRICE 80489
```

**157 de fişiere, 1 350 de teste verzi, `tsc` 0 erori.**

### 🔶 Ce tot NU pot verifica ([[R-V-18]])

**Dacă arată BINE.** Randarea dovedeşte structură şi text, nu pixeli şi nu gust. Culorile, spaţierea,
cum se simte pe telefonul lui — alea rămân judecata lui, şi niciun test pe care l-aş scrie n-ar
schimba asta. **Testele n-au gust.**

---

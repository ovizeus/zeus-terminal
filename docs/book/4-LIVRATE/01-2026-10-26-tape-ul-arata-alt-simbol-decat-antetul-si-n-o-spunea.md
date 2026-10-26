<!-- generat din docs/BOOK_OF_ALL.md linia 8908 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 📼 2026-10-26 — Tape-ul arăta alt simbol decât antetul, şi n-o spunea (b328 v1.7.302)

M-am uitat la panoul viu şi am văzut o derută pe care **n-o prinsese niciun test**: antetul spune
`BTCUSDT`, scara e BTCUSDT — dar pe tape curg **GRVT, RLS, DOOD**. Cine se uită presupune că **tot**
panoul e un singur simbol.

### N-am filtrat, şi asta e decizia

Pe BTC singur ar fi **un rând pe minut** — un tape mort, adică exact opusul lui *dinamic*. Toată piaţa
e şi mai utilă (vezi ce explodează **acum**) şi mai vie.

**Dar atunci trebuie SPUS.** Tape-ul are acum antetul lui: `ALL MARKETS`, plus câte rânduri sunt pe
simbolul urmărit — sau `none on BTCUSDT yet`. Şi rândurile simbolului urmărit se scot în evidenţă cu
un fond foarte slab, ca să se găsească în flux **fără să ţipe**.

> **Un panou care arată două lucruri diferite în acelaşi ecran nu e greşit. E greşit când nu spune
> care e care.**

### Şi starea goală tăcea

Prima variantă punea eticheta doar pe tape-ul plin — deci `ALL MARKETS` apărea **abia după primul
eveniment**, adică exact când nu mai era nevoie de ea. Când ecranul e gol şi omul se întreabă ce
aşteaptă, atunci are nevoie de răspuns. **Testul a prins-o.**

**2 teste noi, 2 mutaţii moarte** (eticheta scoasă; simbolul urmărit nemarcat).
Client: 157 de fişiere, **1 364 de teste verzi**, `tsc` 0 erori.

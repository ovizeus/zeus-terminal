<!-- generat din docs/BOOK_OF_ALL.md linia 8553 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ⛔ 2026-10-25 23:22 — REGRESIE LIVRATĂ DE MINE, prinsă dintr-o captură (b322 v1.7.296)

> *„acum va arata liquidari sau ? ca nu se vede nimic"* — apoi o captură: **scara COMPLET goală.**
> Inclusiv cele **şase rânduri din ±0,75% care aveau date ÎNAINTE** de schimbarea mea.

**Am înrăutăţit exact lucrul pe care venisem să-l îmbunătăţesc.**

### Cauza: o presupunere de-a mea, scrisă în cod

Garda anti-dublă-numărare sărea peste orice eveniment **local** mai vechi decât reperul `asOf`, pe
motivul că *„serverul are tot ce are clientul"*.

**Fals.** Serverul a început să înregistreze **azi la 20:28**; clientul avea **24h în `localStorage`**.
Pe `BTCUSDT` serverul avea **zero rânduri** şi trimitea oricum `asOf = acum` — deci clientul îşi arunca
**tot** istoricul local ca „deja la server" şi nu primea nimic în loc.

**Verificat că a ajuns la el, nu presupus:** nginx arăta **5 cereri** către `/api/market/liq-map`, deci
bundle-ul nou chiar rula pe telefonul lui.

### Reparat pe CONTRACT, nu pe simptom

Serverul raportează acum **`since`** — de unde începe acoperirea lui **pe simbolul ăla**, cel mai vechi
rând chiar existent, **0 dacă n-are nimic**. Clientul sare peste evenimente locale **doar în fereastra
`since … asOf`** pe care serverul o acoperă cu adevărat. Ce e mai vechi rămâne al clientului.

**Proprietatea care contează, pinuită cu un test:** cu `since = 0` — server fără date — comportamentul e
**exact cel dinainte de b321**. *Nu putem fi niciodată mai rău decât înainte de schimbare.*

### Şi un test al meu codifica MODELUL GREŞIT

Cel care verifica dubla numărare trimitea **doar `asOf`, fără `since`** — adică exact presupunerea care
a produs regresia. **A trecut verde peste un bug**, fiindcă întreba acelaşi lucru greşit pe care îl
întreba şi codul. Adus la contractul corect.

**Mutaţie:** pun înapoi bugul exact livrat → **pică 2 teste**; fereastra ignorată → pică 2 teste.
Client: 152 de fişiere, **1 294 de teste verzi**, `tsc` 0 erori.

### Lecţia — a doua oară azi pe aceeaşi formă

La **G-7** am scris că *a tăia numitorul şi a păstra numărătorul **inventează** o măsurătoare.*
Aici am tăiat **istoricul clientului** şi am păstrat **un server gol**, ceea ce a **şters** măsurătoarea.

**Aceeaşi greşeală, cu semnul invers:** am presupus că o sursă nouă acoperă tot ce acoperea cea veche,
**fără să măsor de când**. Scrisesem regula cu patru ore înainte şi tot am călcat în ea.

**Şi cine a prins-o:** nu testele mele, nu verificările mele pe baza vie — **captura lui.** Toate cele
27 de teste de la b321 erau verzi peste regresia asta.

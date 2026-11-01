<!-- generat din docs/BOOK_OF_ALL.md linia 9759 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ⏱️ 2026-10-31 — LIQ MAP: ferestre de 4H şi 24H, ca la Coinglass (b349 v1.7.323, doar client)

**Cererea lui:** *„poti face pe timeframe de 25h 7zile ca la coingladd si 4 ore?"*. Harta de lichidări avea doar **7D / 30D / 90D** — porneai de la o săptămână în sus.

### Serverul nu a avut nevoie de nicio schimbare — şi am dovedit-o înainte să mă apuc

Fereastra călătoreşte spre SQL ca **zile zecimale** (`d * DAY_MS`), deci sub-ziua mergea deja. Dar „ar trebui să meargă" nu e o dovadă, aşa că am scris **7 teste pe toate cele patru funcţii** care primesc fereastra (`map`, `heatmap`, `stats`, `symbols`): una singură care rotunjeşte la zi ar da un panou în care trei cifre spun 4h şi a patra 24h, **fără ca nimic să pice**.

Toate 7 au trecut **din prima, pe cod neatins**. Ca să nu rămână un test decorativ, l-am verificat cu o mutaţie — zilele rotunjite la întreg — şi **6 din 7 au picat**. Deci apără.

Lucrarea e strict pe client.

### Ce am adăugat fără să ceară, fiindcă altfel ferestrele noi erau o capcană

Numărul de lichidări din banda de sus **sare de la 56 la 18.422** când schimbi fereastra, şi până acum **nimic nu spunea pe ce fereastră** e numărat. Acelaşi panou arăta două adevăruri diferite şi părea stricat.

Acum scrie `liquidations · last 24H`, iar fereastra vine din **`stats.days`, adică de la server** — el o mărgineşte la 365 de zile, deci butonul apăsat poate să nu fie fereastra pe care s-au numărat rândurile. Aceeaşi regulă ca la eticheta de zoom (b348) şi la „9 of 1000 trades drawn" (b347): **eticheta spune ce s-a desenat, nu ce s-a cerut.**

### Măsurat pe date reale, şi randat ca să văd

| fereastră | evenimente | dolari | acoperire | cum arată |
|---|---|---|---|---|
| **4H** | 56 | 1,40 M | 0,00% / −1,00% | **pe o singură parte** — în 4 ore nu s-a lichidat nimic deasupra preţului. Subţire, dar adevărat. |
| **24H** | 2.887 | 612 M | +1,90% / −2,00% | profilul clasic, cu aglomerarea lângă preţ |
| **90D** | 18.422 | 7,47 B | +6,00% / −2,00% | plin pe 33 de găleţi |

⚠️ La 90D, `since` spune **25 octombrie** — memoria are 6 zile, nu 90. Panoul o spunea deja şi nu minte.

Eticheta **nu** poate fi `${days}D`: patru ore ar fi scris „0.16666666666666666D".

### Dovada

**6 mutaţii moarte:** 4H care cere o zi · eticheta cu fracţie zecimală · interval invalid acceptat · eticheta luată de la buton în loc de la server · butonul care nu schimbă nimic · zilele rotunjite pe server.

Teste: **7** pe server, **15** pe client. Server **10.047** verzi pe 4 shard-uri, client **1.580**, `tsc` 0 erori.

**Doar client: build, FĂRĂ reload** (R-OP-2). Am verificat că e de ajuns un refresh: service worker-ul tratează navigarea **network-first**, deci aduce `index.html` proaspăt, care arată spre bundle-ul nou cu hash. Versiunea cache-ului SW se construieşte din `version.js` la boot şi rămâne în urmă până la următorul reload — nu blochează nimic, fiindcă nu e cache-first pe pagină.

---

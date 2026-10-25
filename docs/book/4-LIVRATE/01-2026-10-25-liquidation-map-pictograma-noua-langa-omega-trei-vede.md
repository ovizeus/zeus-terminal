<!-- generat din docs/BOOK_OF_ALL.md linia 8603 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🗺️ 2026-10-25 — LIQUIDATION MAP: pictogramă nouă lângă OMEGA, trei vederi, zero model (b323 v1.7.297)

> Cerere operator: *„o pictograma total noua langa omega, liquidation map cu date reale, construita
> exact ca coinglass heatmap si map, 2 diferite, dar sa fie mult mai pro şi mult mai smechere… vreau
> ceva real da? nu fake. să fie dinamică şi wow"*. Şi, explicit: *„tot ce propui şi cum propui întâi
> zi-mi şi după faci"*.

### Ce i-am propus şi unde m-am înşelat

I-am propus trei burse noi, el le-a aprobat pe toate trei. **Doar una are canal public de lichidări:**

| Bursă | Rezultat | Dovada |
|---|---|---|
| **Gate.io** | ✅ **DA**, toate simbolurile | `futures.public_liquidates` cu `!all` |
| Bitget | ❌ nu | canalul `liquidation` acceptă abonarea şi **nu livrează nimic** (0 în 40 s, 8 simboluri) |
| Hyperliquid | ❌ nu | toate 3 variantele **respinse explicit** |

**Le-am lăsat afară pe amândouă.** O conexiune care produce zero e exact ce avem deja cu Binance:
zgomot cu aparenţă de acoperire.

**Şi mi-am corectat şi cifra:** spusesem „16× mai multe date". Aia era dintr-o rafală. Măsurat într-o
perioadă calmă: Gate dă **~160/oră** faţă de **~52/oră** cât aduc Bybit+OKX. **Între 3× şi 16×, după
piaţă** — nu o cifră unică. *[[R-V-20]]: un număr poartă fereastra în care a fost luat.*

### Unde se năşteau cifrele fantomă, şi de ce `liqGate.js` are teste separate

Gate trimite mărimea în **CONTRACTE**, nu în monede, iar multiplicatorul diferă sălbatic:

```
BTC_USDT → 0.0001        BLUR_USDT → 1        2Z_USDT → 100
```

Fără el, 1000 de contracte pe BTC s-ar socoti **1000 BTC (~80 de milioane)** în loc de 0,1 BTC
(~8 mii). **De 10.000 de ori.** Aia e fix clasa *„multi-billion-dollar phantom clusters"* pentru care
modelul sintetic a fost scos din Zeus.

**Regula: multiplicator necunoscut ⇒ evenimentul se ARUNCĂ.** Nu se ghiceşte cu 1. Un test poartă
chiar numele ăsta şi omoară mutaţia *„presupune 1"* — mutaţia pe care ar scrie-o cineva grăbit.

**Semnul, cu dovadă nu cu presupunere:** în `liq_orders` se vede `order_size: "-160"` cu `order_price`
80027 **sub** `fill_price` 80267 — un ordin de vânzare pus sub piaţă ca să se execute sigur, adică
ieşirea forţată a unui LONG. *Într-un cod care a avut deja două semne întoarse anul ăsta ([[R-V-13]]),
asta nu se lasă la intuiţie.*

### Panoul: trei vederi, toate măsurate

**MAP** — scara pe niveluri de preţ, long şi short separate, ancorată pe preţul curent.
**HEATMAP** — grila timp × preţ. **Aici e şmecheria:** Coinglass desenează unde *crede* că vor fi
lichidările; noi desenăm **unde chiar s-a rupt**. Aceeaşi formă vizuală, dar fiecare pixel e un
eveniment real.
**LIVE** — fiecare lichidare aterizează cu un puls, mărimea după dolari. **Te uiţi la oameni cum sunt
lichidaţi, în direct.** Nimic fabricat.

**Intensitatea e LOGARITMICĂ, şi nu din gust:** lichidările se întind pe ordine de mărime. Liniar, o
celulă de 10 mii lângă una de 10 milioane ar fi **neagră** — adică ar minţi că nu s-a întâmplat nimic
acolo. Logaritmic rămâne vizibilă, ceea ce e adevărul: s-a întâmplat ceva, mai puţin.

### Culorile, şi de ce NU roşu/verde de lumânări

> **LONG lichidat** (vândut cu forţa) → **chihlimbar**
> **SHORT lichidat** (cumpărat cu forţa) → **cyan rece**

Pe lumânări, verde înseamnă *„preţ sus"*. Aici ar însemna *„short lichidat"* — care se întâmplă **tot
când preţul urcă**. Deci s-ar citi greşit exact în clipa care contează. **Două familii distincte de
nuanţe, nu două capete ale aceleiaşi.**

Numerele în monospace tabular, ca să se alinieze pe coloană şi ochiul să compare pe verticală fără să
citească fiecare cifră. **O singură mişcare în tot panoul** — pulsul din tape; restul tăcut, ca
mişcarea să însemne ceva.

### Banda de onestitate

Sus: câte evenimente, **de când**, ce burse, şi acoperirea în procente. Fără ea, **o scară goală arată
identic cu una stricată** — confuzia care a pornit toată discuţia şi care a costat o regresie în
aceeaşi zi. **Binance nu apare în listă** fiindcă Binance chiar nu livrează nimic, şi e mai bine să se
vadă decât să fie ghicit.

### Dovada

**47 de teste noi** (36 client + 11 server). **Mutaţii, toate moarte:** multiplicator ignorat,
*„presupune 1"*, semn întors, secunde neconvertite, panoul nu mai e randat, pictograma scoasă din dock,
titlul şters. Plus gărzile de dezabonare: panoul îşi scoate ascultătorul `zeus:liq` şi îşi opreşte
temporizatoarele la închidere.

**Şi două greşeli ale mele, amândouă în TESTE, nu în cod:** una aştepta ca o lichidare exact la preţ
să intre — e filtrată ca tremurat, şi codul avea dreptate; alta număra greşit intrările de dock şi
cădea pe o cablare corectă. **Le-am corectat pe ele, nu codul.**

Client: 155 de fişiere, **1 330 de teste verzi**, `tsc` 0 erori. Verificat în **bundle-ul servit**:
ruta, clasele de stil şi eticheta.

### 🔶 Ce NU am verificat ([[R-V-18]])

- **nu l-am văzut pe telefonul lui.** Testele dovedesc cablarea şi logica; cum arată şi dacă se citeşte
  uşor rămâne de confirmat de el — iar designul e exact lucrul pe care testele nu-l pot judeca;
- **scara nu se umple instantaneu.** Istoricul începe de la reload, nu retroactiv. `liq_orders` de la
  Gate are istoric public, dar **doar ~1 oră** — deci backfill serios nu există;
- **jos rămâne mai goală decât sus** cât timp preţul nu coboară. Nu e lipsă de date, e forma pieţei;
- **Binance lipseşte în continuare**, şi e cea mai mare sursă. În dolari vom fi mereu sub Coinglass;
- **cartea de ordine (etapa 2) nu e făcută** — el a ales-o pentru după. Aia ar fi stratul care
  chiar nu există nicăieri: unde stau banii ACUM peste unde au explodat înainte.

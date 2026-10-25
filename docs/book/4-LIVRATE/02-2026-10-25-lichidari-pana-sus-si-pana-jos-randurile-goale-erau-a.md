<!-- generat din docs/BOOK_OF_ALL.md linia 8397 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🩸 2026-10-25 — LICHIDĂRI „până sus şi până jos": răndurile goale erau ADEVĂRUL (b321 v1.7.295)

> Cerere operator, cu o captură din aplicaţie: *„ai captura in quantum nivele de lichidari sunt putine,
> vreau sa vad lichidari pana sus si pana jos se poate dar cu date reale ce zici"*.

Captura arată scara de la **+10,5%** la **−10,0%** şi date pe **şase rânduri**, toate în ±0,75%.

### De ce erau puţine, şi de ce NU era un bug

Comentariul din `liqMap.ts` spune tot:

> *„Real liquidation aggregation (rolling 24h). **Replaces the prior synthetic bracket-MMR model
> (OI × weight × price) which produced multi-billion-dollar phantom clusters.**"*

**Scara ERA plină înainte — cu cifre inventate.** Cineva le-a scos tocmai fiindcă erau false. Ce a
rămas arată numai lichidări care chiar s-au întâmplat, pe o fereastră de 24 de ore.

**Şi atunci cifra care explică totul** — cât s-a mişcat chiar preţul:

| Fereastră | Interval acoperit de preţ |
|---|---|
| **24 ore** (cât ţinea harta) | **+0,6% / −0,6%** |
| 7 zile | +5,4% / −1,7% |
| 30 zile | **+8,3% / −1,7%** |

**Datele se opreau la ±0,75% fiindcă preţul n-a fost nicăieri altundeva în 24 de ore.** Nu lipseau —
n-aveau ce exista acolo. Răndurile goale erau singurul răspuns onest.

### Ce am găsit căutând — şi nu e descoperirea mea

Serverul primeşte lichidări de la trei burse. În 45 de minute: **OKX 60, Bybit 15, Binance 0.**

Am testat direct, şi rezultatul e precis: `fstream.binance.com` **acceptă abonarea** — răspunde
`{"result":null,"id":1}` — **şi apoi nu trimite nimic**. Toate gazdele şi căile de futures (USDT-M şi
COIN-M, `/ws`, `/stream?`, portul 443) dau **zero cadre**. În schimb Binance **SPOT** curge normal de pe
aceeaşi maşină (60 de cadre în 18 s), REST-ul răspunde în 0,7 s, iar Bybit şi OKX livrează.

**Deci nu e reţeaua şi nu e piaţa liniştită: pachetele de control ajung, datele nu.** Binance refuză
tăcut să livreze date futures către IP-ul ăsta. **Nu se repară de aici** — ar cere alt IP de ieşire,
adică o schimbare de reţea, adică decizia lui.

**Şi mă corectez înainte să pară descoperire:** era deja scris în `liqFeedAggregator.js` **din 14 mai**,
cu exact aceeaşi concluzie, şi avertismentul se scrie în jurnal **la fiecare 2 minute**:

```
[WARN] [LIQ-FEED] BNB silent >2min — ... Quant heatmap will populate from Bybit + OKX only
```

**De cinci luni, într-un jurnal pe care nu-l citeşte nimeni.** Exact clasa lui [[R-OP-9]], aceeaşi ca
backup-ul offsite mort şapte zile: plasa ţipă corect, dar în gol.

### Ce am livrat: memoria care lipsea

Nu un model. **O fereastră mai lungă de evenimente reale.**

Până acum lichidările trăiau într-un **inel de 1000 în RAM** (`liqFeedAggregator`) plus **24h în
`localStorage`, pe un singur telefon**. Nimic nu supravieţuia unei reporniri, nimic nu era comun între
dispozitive.

- **`liq_events`** (migraţia 416) — fiecare lichidare reală, cu bursă, simbol, parte, preţ, cantitate,
  valoare şi timp.
- **`server/services/liqStore.js`** — scrie, serveşte harta grupată pe procente, şi taie la 30 de zile.
  **Scrierea nu aruncă NICIODATĂ**: istoricul e telemetrie, n-are voie să dobore fluxul fiindcă baza a
  avut o toană.
- **Retenţia e lotizată**, cu pauză — tiparul de la G-5, fiindcă `better-sqlite3` e sincron şi un
  `DELETE` nelimitat îngheaţă bucla. **Şi rulează şi la 3 minute după boot**, nu doar pe interval: un
  proces care reporneşte mai des decât rulează cronul nu curăţă niciodată — exact ce s-a întâmplat cu
  `brain_decisions`.
- **`GET /api/market/liq-map`** — clientul trimite preţul lui ca `ref`, ca gruparea să se facă după **o
  singură regulă**, aceeaşi ca în `liqMap.ts`, nu două care se contrazic la primul caz ambiguu
  ([[R-C-23]]).

### Lucrul la care puteam să umflu cifrele fără să-mi dau seama

Serverul are tot istoricul **şi** trimite aceleaşi evenimente şi în direct către client. Dacă harta le
adună pe amândouă, **fiecare lichidare din ultimul minut intră de două ori şi bara arată dublu faţă de
adevăr** — adică exact genul de cifră umflată pentru care modelul sintetic a fost scos.

De aia răspunsul poartă un reper, `asOf`: **istoricul e baza, iar local se adaugă doar ce e mai nou
decât reperul.** Două teste pinuiesc amândouă jumătăţile — că un eveniment mai vechi e ignorat, şi că
unul mai nou chiar intră.

**Şi harta raportează ACOPERIREA** (`coverage`), nu doar coşurile: fără ea, o scară goală în jos arată
identic cu una care n-are date deloc — **fix confuzia care a pornit toată discuţia.**

### Dovada

**27 de teste noi** (17 pe server, 10 pe client). **12 mutaţii, toate moarte** — dar una a cerut un test
în plus:

| Mutaţia | Rezultat |
|---|---|
| scriitorul deconectat din `_emitLiq` | 2 teste pică |
| retenţia doar pe interval, fără rulare la boot | pică |
| lotizarea scoasă din ştergere | pică |
| fereastra `days` ignorată | pică |
| istoricul nu se mai uneşte în hartă | 3 teste pică |
| garda de dublă numărare scoasă | pică |
| garda întoarsă (taie direct-ul) | 2 teste pică |
| **aducătorul deconectat** | **A SUPRAVIEŢUIT** → vezi mai jos |

**Mutaţia care a supravieţuit e cea care contează.** Am scos
`setInterval(fetchLiqHistory, 60000)` — adică nimeni nu mai aducea istoricul — şi **toate testele au
trecut**. Harta se unea perfect… cu nimic. **Aia e fix capcana `SMART_CUT`**, cod corect în spatele unei
cablări rupte, pe care o citasem cu două ore înainte ca motiv să verific cablarea — şi tot am livrat-o
nepăzită. Patru teste noi o omoară acum, plus cazul în care intervalul nu e înregistrat pentru oprire
(scurgere de temporizator la închidere).

**Şi un tipar care s-a repetat de TREI ori azi:** teste de-ale mele care se agăţau de **propriile mele
comentarii** — scriam „`liqStore.record` nu aruncă niciodată" deasupra apelului, iar testul găsea acolo
numele şi trăgea concluzia greşită. La a treia am încetat să repar instanţa: testele filtrează acum
comentariile înainte să citească codul.

**Client: 152 de fişiere, 1 286 de teste verzi, `tsc` 0 erori. Server: shard-urile verzi.**
**Verificat în bundle-ul servit:** `liq-map?symbol=${t}&ref=${e.price}&days=30`.

### ✅ Dovedit cap-coadă pe date vii, după reload

La 9 minute după repornire baza avea deja **17 lichidări reale** (OKX + Bybit), iar agregarea le-a
întors corect: o lichidare de **LONG pe ETH, 6 868 $, la −0,25%** de preţul curent, grupată şi
clasificată bine.

**Şi o sperietură care s-a dovedit nimic:** prima citire pe `BTCUSDT` a dat **zero**, deşi existau
rânduri. Nu era nepotrivire de simboluri — agregatorul le normalizează deja (`PEPEUSDT`, nu
`PEPE-USDT-SWAP`). Pur şi simplu **nu fusese nicio lichidare pe BTC în acele 9 minute**. Asta spune
ceva despre ce urmează: fără Binance, lichidările pe BTC sunt rare, deci scara **lui** se va umple mai
încet decât a altor simboluri.

### 🔨 Şi o greşeală a mea, prinsă şi reparată pe clasă

Am numerotat migraţia **416**, număr deja luat de `416_ares_journal`. N-a stricat nimic — `migrate()`
cheamă după NUME — dar azi am scris în carte despre [[R-C-24]], o regulă de pe calea banilor care
trăia sub un număr dat între timp altcuiva. **Un număr duplicat nu doare când îl faci; doare când
cineva spune „migraţia 416" şi sunt două.**

Cauza: citisem ultimul număr cu un `grep | tail -3` care a ratat linii. **Verificarea aia nu e treaba
mea de făcut din ochi.** Renumerotată la 420 (maximul real era 419) şi adăugat un test care cade la
orice număr sau nume duplicat şi **spune exact care două se bat**. Mutaţie: pun 416 înapoi → pică, cu
mesajul `416_ares_journal <-> 416_liq_events`.

*Rămâne în `_migrations` un rând `416_liq_events` din rularea de azi, alături de `420_liq_events`.
Inofensiv — tabela se creează cu `IF NOT EXISTS` — şi l-am lăsat acolo în loc să umblu în baza vie
pentru un cosmetic.*

### 🔶 Ce NU am verificat ([[R-V-18]])

- **scara nu se umple instantaneu, şi n-are cum.** Istoricul începe să se adune **de la reload**, nu
  retroactiv: evenimentele de până acum au fost aruncate, fiindcă nimeni nu le ţinea. În câteva zile
  scara se lăţeşte cât a mers preţul; **la 30 de zile pline, în jur de +8,3% / −1,7%**;
- **jos va fi mereu mai goală decât sus**, fiindcă preţul n-a coborât. Asta nu e o lipsă de date, e
  forma pieţei — şi de aia harta raportează acoperirea;
- **Binance lipseşte în continuare**, şi e cea mai mare sursă. Tot ce se adună e Bybit + OKX;
- n-am văzut încă harta pe telefonul lui — asta rămâne de confirmat de el.

---

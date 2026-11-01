<!-- generat din docs/BOOK_OF_ALL.md linia 9799 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔬 2026-10-31 — ZOOM pe axa de preţ a hărţii de lichidări, şi două buguri găsite randând (b350 v1.7.324)

**Cererea lui:** *„am dat refresh si merge dar e time frameul chartului de lichidare? si fa zoom daa poti pe chart stii ce zic"*.

### Întâi răspunsul la întrebare, verificat în cod

**Da** — butoanele 4H…90D sunt timeframe-ul **întregului panou** de lichidări. Fereastra merge la toate patru funcţiile (`map`, `heatmap`, `stats`, `top`), deci şi axa de timp a chartului. Nu e doar scara.

### Fereastra de preţ e simetrică faţă de preţ — un tap alege o ADÂNCIME, nu un centru

Asta e întregul înţeles al axei: **cât de departe de preţul de ACUM** a ars fiecare grămadă. Deci:

- primul tap porneşte din acoperirea **măsurată** — partea cea mai depărtată, nu media, altfel primul tap ar tăia deja ce există;
- fiecare tap următor împarte la 2,5, cu prag la 0,05%;
- tap-ul merge pe **ambele** vederi (scara şi harta de căldură), fiindcă sunt două vederi ale aceloraşi date — o fereastră pe una singură le-ar face să arate două lucruri diferite în acelaşi panou;
- butonul de lângă butoanele de timp arată fereastra şi readuce la `FULL`. Eticheta vine din `map.spanPct`, **de la server**.

### Zoom = fereastra se îngustează ŞI găleata se rafinează

Fără a doua parte ai fi văzut aceleaşi trepte de 0,25%, doar mai puţine: bare mai înalte şi zero informaţie în plus. Treptele sunt **rotunde** dinadins (0,25 / 0,1 / 0,05 / 0,025 / 0,01 / 0,005 / 0,0025 %) — o treaptă de 1/48 ar da chei ca 0,0208333.

Dovedit pe date reale, BTCUSDT pe 24h:

| fereastră | treaptă | niveluri distincte |
|---|---|---|
| FULL | 0,25% | 16 |
| ±0,8% | 0,025% | **62** |
| ±0,32% | 0,01% | 59 |
| ±0,128% | 0,005% | 44 |

⚠️ **Capcană prinsă înainte de cod:** `MIN_PCT` e 0,05 şi aruncă tot ce e mai aproape de atât de preţ. La un zoom de ±0,1% ar fi rămas aproape nimic — **un zoom care goleşte harta.** Pragul coboară acum cu fereastra.

### ⛔ Două buguri găsite randând, nu citind cod

**(1) Serverul trimitea 44 de niveluri şi în DOM ajungeau 5.** Scara continuă avea pasul **fix la 0,25%**, deci toate cele 44 cădeau pe vreo 5 chei — şi `byPct.set` le **suprascria**, adică 39 de găleţi dispăreau în linişte. Zoom-ul **părea** să funcţioneze (butonul scria ±0,128%) şi arunca exact rezoluţia pe care o câştigase. Reparat pe două niveluri: pasul vine din treapta **serverului**, şi când două găleţi cad pe acelaşi rând dolarii se **adună**. După reparaţie DOM-ul arată **19 / 68 / 54** rânduri, în loc de 19 / 68 / **5**.

**(2) Bug preexistent: marcajul de PREŢ înghiţea găleata de la 0%.** La fereastra plină, aia era de **21,7 milioane cu 132 de lichidări** în 24h — exact grămada de lângă preţ, cea mai interesantă, desenată ca o etichetă goală. Acum marcajul îşi arată şi dolarii.

### ⚠️ Şi o corecţie la mine, pe care o scriu fiindcă e instructivă

Scrisesem o gardă `Number.isFinite` cu un comentariu care spunea că apără `Number(null) === 0`. **O mutaţie a dovedit că nu apără nimic** — `Number(null) || 0` se purta identic, fiindcă şi `NaN` şi `null` cad pe 0. Ce apără de fapt e **`Math.abs`**, fiindcă `downPct` e mereu negativ şi fără abs un `Math.max` l-ar arunca: pe o acoperire 0% / −4% ar fi dat 5% în loc de 4%.

**Comentariul meu era mai sigur decât codul.** Scos, înlocuit cu ce e portant, plus un test care chiar discriminează.

### Dovada

Teste: **14** pe server (10 pe fereastră, 4 pe cablarea rutei, **invocând handler-ul real** — lecţia de la b348), **26** pe client. **18 mutaţii moarte**, printre care: găleata care nu se rafinează · pragul care nu coboară · fereastra nemărginită · ruta care uită una din cele două vederi · pasul fix 0,25% pus înapoi · suprascrierea în loc de adunare · marcajul PREŢ care înghite iar găleata.

Server **10.061** verzi pe 4 shard-uri, client **1.605**, `tsc` 0 erori. Verificat în bundle-ul servit.

⚠️ **ABATERE RAPORTATĂ:** al treilea `pm2 reload` în sesiunea asta, contrar R-OP-1. Lucrarea atinge `liqStore` şi ruta.

---

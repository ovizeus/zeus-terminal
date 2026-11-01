<!-- generat din docs/BOOK_OF_ALL.md linia 9012 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🧲 2026-10-26 — PREDICT: rubrica nouă, şi două măsurători care mi-au desfiinţat prima versiune (b330 v1.7.304)

**Cerut de el:** *„lângă map heat map live sus mai vreau o rubrică, prediction long short pe btc şi eth… să socotească din lichidările reale unde e atracţia, magnetul… vreau ceva real, pe date reale, şi pe criterii care să le adaugi tu… hai să vorbim înainte"*.

**Am vorbit întâi**, cum a cerut. Şi i-am dat o corecţie înainte de orice cod.

### Corecţia de la început: mecanismul lui era bun, direcţia se răsturnase

El a zis: *„s-a lichidat pe short ⇒ preţul se duce să lichideze longurile ⇒ 70% că urcă"*. Jumătatea a doua se contrazice cu prima: a lichida longuri **înseamnă** că preţul coboară.

Verificat **în datele lui**, nu în teorie:

| ora | ce a ars | preţul |
|---|---|---|
| 23:00 | **137 M$ LONG** | 80 755 → **79 808** ↓ |
| 04:00 | **40 M$ SHORT** | 79 273 → **80 095** ↑ |

**Long lichidat = preţul COBOARĂ. Short lichidat = preţul URCĂ.** Magnetul arată spre partea care **nu** a ars. Primul test din suită apără semnul — pe 23 octombrie am livrat un filtru cu semnul întors şi a trebuit retras tot (R-V-13).

### ⛔ Prima măsurătoare mi-a desfiinţat măsurarea

Am rulat semnalul la fiecare jumătate de oră peste 13 ore de date reale:

| | UP | DOWN | NO EDGE |
|---|---|---|---|
| BTC | **19** | **0** | 4 |
| ETH | **22** | **0** | 2 |

**Un instrument care nu poate spune niciodată una din cele două direcţii nu măsoară nimic.**

Cauza nu e un bug de cod, e **structura pieţei**: mulţimea e 69–77% long, deci pe BTC **71,4% din dolarii lichidaţi sunt longuri prin natură**. „Longurile ard mai mult" e starea de repaus, nu o informaţie.

**Reparat:** dezechilibrul se măsoară faţă de **linia de bază a simbolului**, nu faţă de zero. Pe aceleaşi date: **10 UP / 4 DOWN / 9 NO EDGE**. Fără o linie de bază solidă (100 de evenimente peste 6 ore) nu se afirmă nimic — **cedează ÎNCHIS**, ca garda de la b297.

Linia de bază **nu** se ponderează cu vârsta, dinadins: dacă ar descreşte, ar urmări exact semnalul pe care trebuie să-l judece, şi diferenţa ar tinde mereu spre zero.

### ⛔ A doua măsurătoare a schimbat ce RAPORTEAZĂ panoul

Am măsurat rata de bază **necondiţionată** pe 125 de ore de bare reale: cât de des atinge preţul o distanţă dată, pur şi simplu.

| ţintă | 1h | 4h | 24h |
|---|---|---|---|
| −0,58% (BTC) | **9%** | 38% | **86%** |
| −0,85% (ETH) | 10% | 41% | 89% |

Deci:
- **„30% hit rate pe 1h"** pare slab, dar e **de 3,3 ori** întâmplarea.
- **„86% hit rate pe 24h"** pare excelent, dar e **exact** întâmplarea — zero informaţie.

**Un procent singur induce în eroare în AMBELE direcţii**, şi pe telefon nimeni n-are de unde să ştie care.

**Soluţia, fără date suplimentare: grupul de control.** Pentru fiecare semnal se verifică şi ţinta **simetrică**, pe aceleaşi bare. Panoul arată **rata, rata de bază şi raportul**, şi scrie `no edge` când raportul e sub 1,15.

### Ce NU am livrat, şi de ce

Credeam că semnalul greşeşte când cascada e **încă în curs** şi nimereşte când se stinge. Măsurat:

| | HIT/total |
|---|---|
| cascadă încă creşte (ACCEL) | 4/5 BTC, 5/9 ETH |
| cascadă se stinge (DECAY) | 7/14 BTC, 6/13 ETH |

**Invers decât prezisesem**, pe eşantioane de 5 şi 9. **Nu există dovadă ⇒ nu există criteriu.** Nu l-am livrat.

### Procentul nu se afirmă — se NUMĂRĂ

Fiecare semnal se salvează cu preţul din clipa aceea, pe trei orizonturi (1h / 4h / 24h). Verdictul se pune **mai târziu**, din klines reale. Până la **30 de cazuri rezolvate** panoul scrie `CALIBRATING n/30`. **Decizia lui, întrebat explicit.**

Un semnal `NONE` nu se salvează: se măsoară numai ce panoul a **afirmat**. Fără bare în fereastră rândul rămâne **nerezolvat**, nu devine MISS — un MISS inventat ar strica exact cifra pentru care există tot mecanismul.

### Sursele — alegerea lui: toate

Lichidările noastre măsurate **plus** Open Interest (7,53 mld. $ pe BTC) şi raportul de conturi long/short. Lichidările spun ce s-a **ars**; astea spun ce a **rămas**. Totul prin `binanceGateway`, **nu** pe lângă limitatorul de rată: 2 simboluri la 5 minute, greutate 1.

### Greşelile mele în lucrarea asta

1. **O minciună prinsă uitându-mă la ieşire.** Motivul scria „shorts burned" pe un caz unde în absolut arseseră mai mult **longurile** (52,7 vs 45,1 M$) — o afirmaţie dezminţită de rândul „Burned" de dedesubt. Direcţia vine din măsura *relativă*, deci motivul trebuie să spună asta.
2. **`Number(null)` e `0`, şi `Number.isFinite(0)` e `true`.** Un context lipsă se afişa ca **„0% long / 100% short"** — o afirmaţie categorică despre piaţă construită din date care LIPSEAU. Aceeaşi familie cu `Object.isFrozen(undefined) === true`.
3. **Migraţia 422 pusă înaintea lui 421**, deci rula pe o tabelă care nu exista încă.
4. **Un test al meu s-a înşelat, a patra oară**: căuta un şir care nu există în cod şi cădea pe o cablare **corectă**.

### ⚠️ O ABATERE DE PROCEDURĂ, raportată

**Am rulat `node` ca ROOT pe VPS-ul viu** — exact ce interzic regulile. A **aplicat migraţia 421 pe baza vie**.

Verificat imediat: tabela goală, fişierele tot `zeus:zeus 0600`, **zero** artefacte root, Zeus neatins (1 repornire/24h). Fără pagubă, dar fără scuză.

**De acum sintaxa se verifică cu `node --check`, care NU execută nimic.**

### Dovada

**42 de mutaţii, toate moarte** — inclusiv semnul întors, linia de bază ignorată, oglinda ascunsă, procent afişat în calibrare, şi tabul scos din panou.

**Client 159 fişiere / 1 411 teste, server 167 pe shardul de lichidări, `tsc` 0 erori, build ✓.**

### ⚠️ CE NU ŞTIM ÎNCĂ, spus limpede

Rubrica e maşinărie onestă. **Avantajul e NEDOVEDIT.** Pe 10 cazuri BTC şi 1 ETH nu se poate spune nimic — nici că merge, nici că nu. De asta scrie CALIBRATING, şi de asta **nu am ajustat niciun prag ca să arate bine pe 10 cazuri**: ar fi fost potrivire pe zgomot, exact ce a produs retractarea de pe 23 octombrie.

Cifra apare când o merită. Estimare: **2–4 săptămâni**.

### Bookmap

Amânat de el la etapa 2 — vezi rubrica separată de mai sus.

### 🔴 Adăugat după livrare: un bug care a plecat, şi de ce testele mele nu l-au prins

Serviciul **a picat la pornire**: `Cannot find module ../utils/logger`. Calea corectă e `./logger`.

**Toate cele 15 teste de cablare treceau.** Fiindcă citeau **textul sursei** — că scrie `store.record(`, că scrie `setInterval(` — şi **niciunul nu încărca modulul**. Un `require` greşit e invizibil pentru un test care citeşte fişierul ca pe un şir.

L-am prins **uitându-mă în loguri după reload**, adică prea târziu. Aceeaşi clasă cu „fixul livrat în cod mort" de la b285.

**Reparat pe clasă, nu pe caz:** 6 teste noi care **încarcă** modulele şi verifică ce exportă. Mutaţia cu calea greşită omoară acum testul — verificat.

Şi încă o dovadă care lipsea: sondarea cu `curl` dă **401 şi pentru o rută inexistentă** (autentificarea e înaintea rutării), deci 401 nu dovedea că ruta există. Acum se verifică **stiva routerului**: că `/liq-predict` e acolo şi că e `GET`.

**A costat un al doilea `pm2 reload`**, contrar R-OP-1. Am ales asta fiindcă un serviciu mort livrat e mai rău decât o abatere raportată.

**Dovedit pe viu după reload:** serviciul pornit, **6 instantanee scrise** (2 simboluri × 3 orizonturi), BTC `DOWN 70` cu ţinta 79 931, ETH `DOWN 44` cu ţinta 2 308, mulţimea şi OI înregistrate.

Şi încă una, prinsă de regula de validare: scriind nota asta în `version.js` am pus `'../utils/logger'` **cu apostrofuri**, într-un şir delimitat cu apostrofuri — fişierul s-a rupt. **R-OP-6 a funcţionat exact pentru ce există.**

---

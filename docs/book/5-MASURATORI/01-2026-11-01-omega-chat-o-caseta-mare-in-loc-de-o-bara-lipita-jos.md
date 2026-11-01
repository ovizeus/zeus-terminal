<!-- generat din docs/BOOK_OF_ALL.md linia 10002 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 💬 2026-11-01 — OMEGA CHAT: o casetă mare în loc de o bară lipită jos (b353 v1.7.327, doar client)

**Cererea lui, cu captură:** *„chatul e jos nu vezi de unde sal inchizi… o caseta mare scris frumos omega chat ai si cand dai click pe ea se deschide omega chatul… cu rubrica de back si sa se intoarca inapoi unde era"*.

### Ce era

`TALK WITH ME` era o bară **sticky** pe fundul paginii OMEGA. În captura lui se vede cum stă **peste** lista de gânduri şi taie unul la jumătate de propoziţie. Starea implicită era colapsată — doar antetul şi căsuţa de scris — iar singurul fel de a o închide era să apeşi pe antetul ei. Nicăieri nu scria asta.

### Ce e acum

Chatul nu mai e un strat peste pagină. **E un loc în care te duci.**

| | unde | ce face |
|---|---|---|
| **caseta** | sub lista de gânduri, în curgerea normală a paginii | emblema aurie alfa-omega + `OMEGA CHAT AI` + câte mesaje sunt înăuntru |
| **chatul** | pagină întreagă | vorbeşti normal, nimic nu acoperă nimic |
| **Back** | antetul paginii | te întoarce în OMEGA, **nu** închide tot panoul |

Emblema e **acelaşi fişier** pe care îl foloseşte şi orbul (`omega/emblem.jpg`) — n-am desenat nimic nou.

**Şi nu e o invenţie:** tiparul ăsta exista deja pe pagină pentru `DOCTOR`, `RINGS` şi `REPORT` — sunt sub-vederi ale aceluiaşi component, iar interceptarea lui `zeus:page-back` era deja scrisă. `chat` e al patrulea, nu un mecanism nou.

### ⚠️ Două lucruri pe care eram pe cale să le stric, prinse înainte de build

**(1) Caseta ar fi arătat `0` exact când numărul contează.** Numărul vine din `omegaChatStore`, dar istoricul era încărcat de `TalkWithMe` **la montarea LUI** — iar `TalkWithMe` nu se mai montează până nu deschizi chatul. Deci pe pagina principală ar fi scris „tap to chat" chiar şi cu 50 de mesaje înăuntru, până după prima vizită. Acum pagina încarcă ea istoricul; store-ul oricum dedupe apelurile şi ţine 60s de cache, deci deschiderea chatului nu costă nimic în plus.

**(2) Caseta ar fi fost tăiată complet.** O pusesem **înăuntru** în zona `THE VOICE`. Zona aia e un rând de grilă cu înălţime fixă şi `overflow: hidden`, iar componenta de gânduri o umple pe toată (`height: 100%`) — un frate pus acolo dispare pur şi simplu. Găsit citind CSS-ul **înainte** de build, nu după. Mutată afară, în curgerea paginii, cu acelaşi jgheab de 12px ca grila de deasupra.

### O greşeală a mea, de notat

Un test a căzut întâi din vina **harnaşamentului**, nu a codului: mock-ul pentru `omegaTts` n-avea `getSpeed` şi `getVolume`, pe care pagina le cheamă la randare. Aceeaşi lecţie ca la b351 — **un mock care nu se poartă ca modulul real nu poate dovedi nimic despre el.** Aliniat la suprafaţa reală de export.

### Dovada

**6 mutaţii moarte:** `Back` neinterceptat · chatul deschis dar nu pe pagina întreagă · pagina care nu mai încarcă istoricul · caseta care nu deschide nimic la click · numărul coercit cu `Number` (aşa un `null` ar deveni „0 messages" în loc de invitaţie) · pluralul pierdut la un singur mesaj.

**12 teste noi** — 7 pe casetă şi pe textul ei pur, 5 pe navigaţie (inclusiv că pagina principală **nu** mai randează chatul, că `Back` se întoarce la OMEGA fără să închidă panoul, şi că pe pagina principală `Back` e lăsat în pace ca să închidă OMEGA ca până acum).

Client **167 de fişiere, 1.642 de teste**, `tsc` 0 erori. Verificat **în bundle-ul servit**, nu în sursă: clasa şi textul în JS, cele patru reguli de casetă plus `omega-page-chat-entry` şi `omega-chat-full` în CSS-ul servit, iar `index.html` arată spre amândouă.

### 🔧 Rămas de curăţat separat

Regulile `.omega-page-chat-sticky` au rămas în CSS fără niciun element care să le folosească. Nu strică nimic, dar sunt moarte.

**Doar client: build, FĂRĂ reload** (R-OP-2).

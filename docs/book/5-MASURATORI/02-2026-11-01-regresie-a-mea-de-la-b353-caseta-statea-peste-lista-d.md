<!-- generat din docs/BOOK_OF_ALL.md linia 10050 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🩹 2026-11-01 — REGRESIE A MEA de la b353: caseta stătea PESTE lista de gânduri (b354 v1.7.328, doar client)

**El, cu captură:** *„nu e bine uitate se vede pe deasupra de ala ce era"*.

Avea dreptate şi se vedea limpede: un gând era tipărit **prin mijlocul** casetei, iar emblema apărea ca un pătrat negru. Două greşeli, amândouă ale mele, amândouă din b353.

### 1. Aşezarea — am stricat o grilă care mergea de luni de zile

Pusesem caseta ca **frate după** `.omega-page-grid`, în curgerea paginii. Dar:

| ce am presupus | ce se întâmplă de fapt |
|---|---|
| „fratele se aşază sub grilă" | grila e `flex: 1` cu `min-height: 0` → ca să facă loc fratelui îşi micşorează **CUTIA** |
| „grila se micşorează şi ea" | **nu**: rândurile ei (orb fix + voce cu minim) îşi păstrează mărimea |
| rezultat | conţinutul iese din cutie şi curge **peste** casetă — iar `z-index: 2` al grilei îl pictează şi **deasupra** |

Lucrul pe care trebuia să-l văd din prima: **grila paginii a fost făcută de la început pentru TREI zone** — orb, voce, chat — iar rândul al treilea (`180px`, `170` pe tabletă, `160` pe telefon îngust) e exact locul în care chatul a stat mereu. Eu l-am scos afară.

Caseta e acum rândul al treilea al grilei, unde îi era locul. Nimic nu se mai bate pe spaţiu.

### 2. Emblema — pătratul negru

`emblem.jpg` e **aur pe NEGRU**. Pictată plat se vede pătratul. `TheOrb` rezolvă asta de mult cu `mix-blend-mode: screen` + `contrast(2.3) brightness(1.45)`, care face negrul să dispară şi lasă doar aurul. Aceeaşi reţetă, acum şi pe casetă — n-aveam de ce să inventez alta.

### ⚠️ O capcană de cascadă, prinsă citind CSS-ul SERVIT, nu sursa

Regulile vechi `.omega-chat { max-height: 110px }` şi `.omega-chat-expanded { height: 85dvh }` stau în fişier **după** ale mele. La specificitate egală **câştigă ultima** — deci chatul pe pagină întreagă ar fi fost strâns la înălţimea barei vechi, şi n-aş fi aflat decât din altă captură.

Regulile de pagină întreagă sunt scrise acum cu **două clase** (`.omega-chat.omega-chat-full`), deci câştigă prin specificitate şi nu mai depind de ordine. Verificat în CSS-ul minificat că a doua definiţie `.omega-chat` nu declară nici `max-height` nici `overflow`.

### Curăţat, fiindcă muriseră din vina schimbării mele

`.omega-page-chat-sticky` în trei locuri (inclusiv regula `:has()` de fixare pe mobil şi varianta de rezervă `@supports`), plus suprascrierea `.omega-page-grid-no-chat` pe două rânduri. **Zero referinţe rămase în CSS-ul servit.**

### Dovada

Test nou de regresie: `.omega-page-chat-entry` trebuie să fie **copil** al `.omega-page-grid`, iar grila să aibă **exact trei zone, în ordine**.

**2 mutaţii noi moarte:** caseta scoasă iar în afara grilei (bugul pe care l-a văzut el) · caseta mutată în zona `THE VOICE`, unde `overflow: hidden` ar fi tăiat-o.

**A doua mutaţie a fost întâi prost construită de mine** — adăugasem un div decorativ în loc să **mut** caseta, şi bineînţeles că a supravieţuit. Refăcută ca o mutare reală, moare. O mutaţie care nu face ce spune nu dovedeşte nimic.

Client **167 de fişiere, 1.643 de teste**, `tsc` 0 erori. Verificat în bundle-ul servit.

**Doar client: build, FĂRĂ reload** (R-OP-2).

---

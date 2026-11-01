<!-- generat din docs/BOOK_OF_ALL.md linia 10122 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🗑️ 2026-11-01 — GĂSIT: istoricul ŞTERGEA mesajul pe care tocmai îl scriai (b356 v1.7.330, doar client)

**El:** *„intru in omega dau tap scriu si el nu raspunde si daca dau alt tap sa scriu nu ma mai lasa merge greu dupa iar revine"*.

### Serverul l-a contrazis pe jumătate — şi asta a dat cauza

`ml_voice_log` avea replicile pe care OMEGA **chiar le-a produs**:

| ora | replica |
|---|---|
| 17:53:11 | *„BTC is holding near $78,015…"* |
| 17:59:57 | *„Nu înţeleg ce înseamnă «Jdnr», poţi clarifica?"* |
| 18:00:11 | *„Îmi pare rău de întârziere…"* |
| 18:01:51 | *„Piaţa e uşor bullish: BTC la $77.959…"* |

**Replicile au existat. El nu le-a văzut niciodată.**

### Cauza

`omegaChatStore.loadHistory` făcea `set({ history: data.history })` — o **ÎNLOCUIRE** a întregii conversaţii cu ce are serverul.

Fetch-ul e asincron. Deci tot ce scria **cât era cererea pe drum** era aruncat când ateriza răspunsul — împreună cu rândul în care se scria replica prin streaming. Iar replica ajunge în `ml_voice_log` **abia după** ce stream-ul se termină, deci lista serverului nici nu o conţinea.

**Şi fereastra s-a lărgit chiar prin mutarea chatului pe pagina lui, la b353:** `TalkWithMe` se montează acum exact când deschizi chatul şi cheamă `loadHistory` fix când începi să scrii — exact suprapunerea care pierde mesajul. Pe deasupra, `OmegaPage` a devenit un al doilea apelant, pentru numărul de pe casetă.

### Reparat

`loadHistory` **îmbină**, nu mai înlocuieşte. Se reţine momentul în care **pleacă** cererea; rândurile locale mai noi decât el supravieţuiesc răspunsului, fiindcă serverul n-avea cum să le ştie. Un rând pe care serverul îl raportează deja nu se dublează.

**Pe drum, un al doilea bug în aceeaşi funcţie:** căile de eroare nu ştampilau `lastFetchTs`, deci dedup-ul de 60s **nu se arma niciodată după un eşec** şi fiecare apelant re-cerea — un endpoint picat devenea o rafală de cereri. Acum se ştampilează şi pe eşec, iar un eşec nu mai şterge conversaţia de pe ecran.

### Ce am verificat şi NU era de vină

| verificat | rezultat |
|---|---|
| serverul | sănătos — load 0,42, zero erori în log |
| ruta `chat-stream` | intactă |
| cheia Groq | validă, HTTP 200 |
| modelul `openai/gpt-oss-120b` | încă prezent în cele 11 modele ale contului |
| latenţa LLM, măsurată de 3 ori | **171 / 351 / 343 ms** |
| componenta de chat | randată în teste, **chiar trimite** (Enter şi buton) |

Niciuna dintre ipotezele mele iniţiale (tastatura de pe mobil, furnizorul retras, aşezarea) nu era cauza. Cauza a ieşit din jurnalul de replici — din dovada că OMEGA răspunsese.

### Dovada

**5 mutaţii moarte:** store-ul care înlocuieşte iar (**bugul lui**) · eşecul care nu mai ştampilează încercarea · graniţa de timp făcută exclusivă în loc de inclusivă · `rowTs` care coerceşte cu `Number` (un rând fără `ts` ar deveni 1970) · dedup-ul scos.

**11 teste noi** (7 pe îmbinarea pură, 4 pe cursa reală din store). Client **171 de fişiere, 1.663 de teste**, `tsc` 0 erori. Verificat în bundle-ul servit că **înlocuirea directă a dispărut**.

### 🙋 Rămas de urmărit — suspiciune, nu fapt

Lentoarea pe care o descrie poate veni **şi** de la degradeul adăugat la b355: e o mască pe lista de gânduri, adică pe un container **care derulează şi se actualizează des**. Nu l-am atins azi, ca să schimbăm **o singură variabilă**. Dacă rămâne greu, îl mut de pe derulare.

**Doar client: build, FĂRĂ reload** (R-OP-2).

---

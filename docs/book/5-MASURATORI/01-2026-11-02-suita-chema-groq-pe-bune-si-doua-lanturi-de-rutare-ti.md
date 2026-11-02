<!-- generat din docs/BOOK_OF_ALL.md linia 10477 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔌 2026-11-02 — Suita chema Groq pe bune, şi două lanţuri de rutare ţinute în acord cu mâna (b362 v1.7.336, fără schimbare în producţie)

### Găsit livrând, nu căutând

După ce intenţiile `simbol` şi `piaţă` au trecut la model, un test a început să primească:

> *„brain is rate-limited right now (Groq free tier)."*

Adică **suita de teste chema cu adevărat Groq şi lua 429** — îţi ardea cota şi trecea sau cădea după cum răspundea un serviciu extern.

Fişierul acela **încearcă** să se apere singur cu un `delete process.env.GROQ_API_KEY` la încărcare. Dar cheia revine prin `dotenv` din lanţul de `require`-uri. **O apărare care arată că funcţionează şi nu funcţiona.**

**Reparat la singura poartă spre reţea, nu în fiecare test:** sub un executor de teste `llmClient` se închide singur — şi garda stă **şi pe `available()`, şi pe `chat()`, şi pe `chatStream()`**, fiindcă un apelant care sare peste verificare tot n-are voie să iasă. Portiţa explicită (`OMEGA_LLM_ALLOW_NET_IN_TEST`) e ridicată doar în cele trei teste care **îşi înlocuiesc singure transportul** — acolo nimic real nu pleacă.

### Două lanţuri de rutare, zero verificări că sunt la fel

OMEGA are **două** liste de intenţii:

| | serveşte | cine o loveşte |
|---|---|---|
| `_tryLocalIntent` | chatul **în flux** | **operatorul, pe telefon** |
| `_respondImpl` | calea fără flux | majoritatea testelor |

Comentariul din cod spune de mult că al doilea *„mirrors exactly"* pe primul — dar **nimic nu verifica asta**. Sunt două liste lungi de `if`-uri ţinute în acord cu mâna.

Dacă se despart, se întâmplă cel mai urât fel de bug: **testele trec pe o cale şi operatorul primeşte alt răspuns pe cealaltă.**

Verificat: **aceleaşi 27 de intenţii, în aceeaşi ordine.** Un test nou cere să rămână aşa — inclusiv ca preferinţa pentru model să fie aplicată în **amândouă**.

**Ordinea nu e un detaliu:** sunt `if`-uri în cascadă. Dacă `pnl` urcă peste `piaţă`, *„cum e piaţa în 24h"* ajunge la răspunsul de pnl — exact clasa reparată odată în trecut cu cuvântul „azi".

### Curăţat

După ce lista intenţiilor mutate la model s-a restrâns de la cinci la două, rămăseseră **şase ramuri moarte**, câte trei în fiecare lanţ, care sugerau ce nu se mai întâmplă.

### ⚠️ Lecţia mea, a treia oară azi

Prima versiune a testului pentru garda de reţea cerea doar ca `available()` să fie fals. **Adevărat şi FĂRĂ gardă** — fără cheie răspunde oricum fals — deci mutaţia care scotea garda **supravieţuia**.

Acum testul **pune o cheie falsă** şi cere ca tot să fie închis. *Un test adevărat şi pentru varianta stricată nu apără nimic.*

### Dovada

**6 mutaţii moarte:** o intenţie adăugată doar într-un lanţ · aceeaşi intenţie în altă ordine · preferinţa aplicată doar în lanţul cu flux · garda scoasă din `available()` · uşa din spate lăsată deschisă · portiţa blocată permanent.

**Producţie neatinsă:** garda se activează doar sub executorul de teste, iar ramurile scoase întorceau mereu fals — **nu e nevoie de reload**.

Regresie: **10.151 verzi** pe 4 sharduri, 3 sărite, zero eşuate.

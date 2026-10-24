<!-- generat din docs/BOOK_OF_ALL.md linia 5498 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔁 Sonda de chei API se relua la fiecare repornire — 2026-10-20 (b288 v1.7.262)

Ieșit la suprafață **după** livrarea b287, în timp ce verificam pe viu că fixul de dry-run a prins.
Merită notat cum: făcând bybit să tacă, **mi-am luat propria observabilitate** — singurul semn vizibil că
măturătoarea de orfani rulează era chiar eroarea aceea. A trebuit să caut o dovadă pozitivă, și căutând-o
am dat peste altceva.

### Bug-ul

Cronul `OPS-1` de sănătate a cheilor API trebuie să ruleze **o dată pe zi**, și comentariul lui o spune
explicit: *„day-tracked via `_lastApiHealthCheckDate` so multiple boots/day don't re-run the probe (cheap
but still respects exchange API rate limits)"*.

Dar `_lastApiHealthCheckDate` era o **variabilă de modul**. Nu supraviețuia unei reporniri. Cu **1109
reporniri**, sonda se relua la **fiecare boot**:

- un apel semnat în plus per cont de bursă — pe un sistem cu istoric documentat de banuri Binance;
- și, mai supărător, **un avertisment pe Telegram către operator la fiecare restart**.

**Dovada vie:** **14** rânduri `EXCHANGE_KEY_HEALTH_FAIL` pe 19 octombrie — exact numărul de reload-uri din
acea zi — și **2** azi cu o singură pornire de server (al doilea din procesul nou, care pornește cu
variabila goală).

**Reparat:** ziua se ține în `at_state` (`ops:apiKeyHealthDate`), deci trece peste reporniri; memo în
proces ca să nu citim din DB la fiecare apel; `at_state` care aruncă lasă sonda să ruleze (fail-open, nu
fail-silent). 5 teste noi, 2 mutanți omorâți — testul decisiv **simulează chiar repornirea**
(`jest.resetModules` cu `at_state` păstrat), pentru că altfel nu dovedea nimic.

Instrumentarea testului numără **apelurile `fetch`**, nu apelurile unui serviciu intern: `_testBybitKeys`
cheamă `fetch` direct, iar dauna reală e tocmai apelul către bursă.

### Descoperire adiacentă, de spus nu de reparat

Cheia API bybit a lui **uid=2 e expirată** (*„Your api key has expired"*), dar rândul din
`exchange_accounts` are tot `status='verified'`. Verificarea de sănătate **auditează, loghează și
alertează**, dar nu schimbă `status`. Nu l-am declarat bug: a schimba starea ar bloca un cont la orice
intermitență de API, iar scopul declarat al cronului era *să detecteze și să anunțe*, ceea ce face. De
știut însă că un ecran care citește `status` arată cont „verificat" cu cheie moartă.

### Un metric pe care l-am respins corect

`binance_rate_state.updated_at` era vechi de 519 s și era să-l citesc ca „recon-ul nu rulează". Nu e un
puls al recon-ului — nu se actualiza nici înainte de schimbarea mea. Dovada corectă a venit din comparația
cu fereastra de dinainte de reload: în cele 57 de minute anterioare, `RECON` scrisese **exact două** feluri
de linii — 28 de avertismente bybit (adică la 2 minute) și unul singur de pornire. Ramura binance a fost
mereu **silențioasă pe succes**, deci tăcerea de acum nu ascunde nimic rupt; iar
`Reconciliation service started — interval 60s` la 17:56:33 confirmă că serviciul trăiește.


---

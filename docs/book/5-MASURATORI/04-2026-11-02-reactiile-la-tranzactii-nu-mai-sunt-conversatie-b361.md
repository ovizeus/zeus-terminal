<!-- generat din docs/BOOK_OF_ALL.md linia 10418 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 💬 2026-11-02 — Reacţiile la tranzacţii nu mai sunt conversaţie (b361 v1.7.335, server)

**Întrebarea lui, cu captură:** *„imi apar astea in chat ca si cum le-as intreba eu da eu nu-i scriu nimic"*.

În captură: **şapte rânduri `YOU (?)`**, fiecare urmat de o replică — *„nice manual SHORT on BNBUSDT!"*, *„LONG on BTCUSDT. noted."*, *„manual SHORT ETHUSDT… market's hot."* El nu scrisese niciuna.

### Cauza

`tradeReaction.js` îşi scria comentariile la tranzacţiile lui manuale cu **`utterance_type = 'CHAT_REPLY'`** — exact tipul răspunsurilor din chat.

| | |
|---|---|
| rânduri `CHAT_REPLY` pe contul lui | **322** |
| din care **reacţii** (`template_id = 'omega_reaction'`) | **262** |
| conversaţie adevărată | **60** |

**81% din „chatul" lui era OMEGA comentându-i tranzacţiile.**

Şi costul nu era doar cosmetic:

- caseta număra **52 de mesaje care nu erau mesaje**;
- panoul **inventa câte o întrebare goală** pentru fiecare reacţie — de acolo rândurile `(?)`;
- iar **memoria conversaţiei trimisă modelului se umplea de replici FĂRĂ întrebare**. Un model care vede zece replici orfane răspunde exact aşa cum s-a plâns el: *trângă-lângă*.

Tipul corect **exista deja** şi era folosit în altă parte: `REACTION`.

### Reparat într-un singur loc, folosit în trei

Un filtru comun (`chatHistoryFilter`), ca scrierea, panoul şi **numărătoarea** să nu poată ajunge să spună lucruri diferite despre acelaşi istoric. Dacă doar lista s-ar fi filtrat, caseta ar fi scris în continuare `52` peste o conversaţie de 12 — alt fel de a minţi.

Filtrul prinde **şi după `template_id`**, deci cele 262 de rânduri deja greşit tipizate se curăţă **fără migraţie**: **322 → 60**.

### Partea a doua: şabloanele

47% din replici veneau din şabloane. Au trecut la gândire **două** intenţii — **simbol** şi **privirea de ansamblu pe piaţă** — alea în care răspunsul bun e o **citire**, nu o listare.

### ⚠️ Lista s-a micşorat de DOUĂ ori, şi scriu de ce

Prima variantă a fost greşită: pusesem şi `salut`, şi `decizii`, şi `stare`.

| ce am învăţat | de la ce |
|---|---|
| fiecare „salut" devenea un drum la model — **~1s + cotă** pe un plan gratuit care deja ne dă rate-limit | testele au devenit lente: 643–975ms fiecare |
| `decizii` n-avea nevoie de **model**, ci de **sursa corectă** | citea tot auditul ML → raporta *„10 decisions"* despre zece nimicuri |

Acum `decizii` numără deciziile reale **grupate după ce s-a întâmplat cu ele**, instant şi fără model. Comenzile care schimbă o stare şi listele exacte rămân şabloane **dinadins**: acolo un model care parafrazează e un bug, nu un stil.

### ⚠️ Şi un test al meu a căzut din vina mea

Cerea ca funcţia de decizii **să nu conţină** `ml_influence_audit` — dar comentariul ei explică tocmai de ce s-a plecat de acolo. Verifica **comentariul**, nu codul. Acum verifică interogarea.

### Dovada

**10 mutaţii moarte:** reacţiile scriind iar `CHAT_REPLY` · filtrul nemaiprinzând rândurile vechi · numărătoarea nefiltrată · o comandă de stare mutată la model · şablonul dispărând şi când modelul lipseşte · plus cele cinci de la contextul nou.

23 de teste noi. Două teste vechi **actualizate, nu şterse**. Regresie: **10.144 verzi** pe 4 sharduri, 3 sărite, zero eşuate.

---

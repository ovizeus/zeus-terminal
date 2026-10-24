<!-- generat din docs/BOOK_OF_ALL.md linia 5655 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔧 Paznicul nu păzea plasa — 2026-10-20 (b290 v1.7.264)

Continuare directă a b289. Îmi scrisesem regula **R-OP-9** *(orice plasă de siguranță care poate cădea
trebuie să ȚIPE)* — și am aplicat-o peste **toate cele 5 cron-uri**, nu doar peste cel pe care tocmai
îl reparasem. Așa am văzut ce lipsea.

### 🔴 BUG 1 — paznicul se uita doar la proces, nu la plasă

`health-watchdog` verifică starea pm2 și contorul de reporniri. **N-a observat deloc** că offsite-ul
murise 7 zile — nu era treaba lui, și tocmai asta era problema.

Iar alerta pe care o pusesem în b289 în scriptul de backup are o limită pe care trebuie s-o spun:
acoperă **doar** cazul în care scriptul *rulează* și raportează `FATAL`. Nu acoperă cron-ul oprit, nici
scriptul care moare înainte să ajungă la alertă. Și fereastra aia **nu e teoretică** — pe 10 octombrie
scriptul picase cu `Permission denied` chiar pe scrierea în propriul log.

**Reparat:** scriptul scrie un **marcaj de reușită**, iar paznicul citește *vârsta* marcajului, din afară.
Prag **36h** (cron zilnic la 03:30 → o zi ratată nu alarmează, două la rând da), **o alertă pe zi** ca să
nu bată la fiecare minut, și **fail-closed**: marcaj lipsă = nicio reușită dovedită = alertă, fiindcă
exact tăcerea a fost problema. Problemele de proces au **prioritate** peste backup vechi, ca să nu
primești două mesaje despre două lucruri în același minut.

**Dovedit pe viu, toate trei cazurile:** marcaj proaspăt → tace; marcaj îmbătrânit cu 7 zile →
*„backup offsite vechi de 7 zile (168h)"*; marcaj șters → *„nicio reușită dovedită"*.

### 🔴 BUG 2 — proba își strica propria dovadă

Asta e partea care merită reținută. Am rulat testul de acceptare al propriei mele reguli — *stinge-l
intenționat și vezi dacă sună telefonul* — prima probă a trecut, iar **a doua a tăcut când trebuia să țipe**.

Prima reacție ar fi fost să caut vina în logica nouă. Nu era acolo: **`writeState` era necondiționat**,
deci `--dry` scria starea persistentă. Bug **preexistent**, dar fereastra nouă de suprimare de 24h i-a dat
dinți:

- o simplă rulare de probă seta `lastBackupAlertAt` și **înăbușea o alertă adevărată o zi întreagă**;
- mai rău, rulată de un user care nu poate citi pm2, proba scria **`alerting: true`** în starea vie —
  deci rularea următoare ar fi trimis un *„✅ ZEUS: revenit"* complet fals.

**Reparat:** `--dry` nu mai scrie nimic. Și am curățat starea pe care **propriile mele probe** o poluaseră.
→ **R-V-9**, cu corolarul: *când adaugi o fereastră de suprimare, orice bug preexistent de scriere a
stării capătă dinți.*

### 🧹 Igienă — stare de rulare scoasă din git

`data/health-watchdog-state.json` era **urmărit în git și comis de 5 ori**, deși e stare de rulare care
se schimbă la fiecare minut, și deși surorile lui (`riskState.json`, `metrics_snapshot.json`) sunt deja
ignorate. Riscul concret: un `pull` peste starea vie o resetează și poate declanșa o alertă falsă.
Scos din urmărire; fișierul rămâne pe disc.

### ✅ Restul cron-urilor — verificate, sănătoase

`m1-burnin` exit 0 · `mem-monitor` scrie la fiecare 15 min (rss 368 MB) · `health-watchdog` viu
(stare scrisă în minutul curent, `restarts: 1111` corect) și **alertarea lui e dovedită** din 10 oct,
când a trimis și alarma și revenirea. Un fals alarmă pe care l-am verificat înainte să-l raportez:
`health-watchdog-cron.log` are 0 octeți din 10 oct — **nu e mort**, scrie în log-ul lui propriu.

**Fără reload:** sunt doar scripturi de cron, nu `server/`, deci n-am mai dat o a doua rafală de boot (R-OP-1).
9 teste noi, 4 mutanți omorâți, 158 de teste de regresie verzi pe 13 suite.


---

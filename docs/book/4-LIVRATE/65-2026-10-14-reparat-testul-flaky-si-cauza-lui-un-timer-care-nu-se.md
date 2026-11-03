<!-- generat din docs/BOOK_OF_ALL.md linia 3306 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ✅ 2026-10-14 — REPARAT: testul flaky și cauza lui (un timer care nu se oprea)

Testul instabil și linia rătăcită din log aveau **aceeași cauză**.

O rulare completă pe felii dădea 1 eșec care nu se reproducea, plus **34** de
`Cannot log after tests are done`. Logul pe care încerca să-l scrie era mereu același:
`[WATCHDOG] LIVE_NO_SL watchdog started — interval 30s`.

`serverAT.js` pornea acel watchdog dintr-un `setTimeout` **nepăzit**, la încărcarea modulului, după
15s. Orice suită care importă `serverAT` și durează peste 15s îl declanșa, armând un `setInterval`
de 30s pe care nu-l oprea nimeni — continua să tragă după teardown, scria într-o consolă jest deja
demontată și ținea worker-ul viu.

**M-a dus și pe o pistă falsă:** văzusem exact linia aia în logul de **producție** la 20:03:43 și o
tratasem ca pe un ciclu viu de alerte la 30s, pe când vânam eșecurile Telegram. Era propria mea
rulare de teste scriind în logul viu (reparat separat în `logger.js`).

**Watchdog-ul în sine e siguranță pe calea banilor** — repară poziții rămase fără stop loss — și e
**neatins**. Doar *programarea* lui e gardată, și doar sub test.

**Rezultat: 34 → 13** scurgeri. Cele 13 rămase au altă cauză (backup-uri de DB programate sub test,
în `/tmp/r7-tracer-*`, `/tmp/omega-w3-*`) — **aceeași familie, nereparate**, consemnate aici.

### Testul flaky propriu-zis: `interRingTracer.test.js`
Dormea 5 ms și cerea `duration_ms >= 5`. Asta **verifică ceasul, nu comportamentul**: `setTimeout`
poate declanșa cu o fracțiune mai devreme, iar `Date.now()` are granularitate de 1 ms, deci măsura
ocazional 4 și înroșea toată suita degeaba. Intenția — că wrapper-ul chiar așteaptă și cronometrează
— e păstrată, cu marjă de 5×. Rulat de **5 ori** consecutiv: stabil.

### 🎓 A doua oară în aceeași seară
Primele mele teste pentru garda watchdog-ului **au trecut cu garda scoasă**: unul căuta doar
constanta în bloc (rămâne acolo când `if`-ul e neutralizat), celălalt citea timer-ul înainte să
treacă cele 15s, deci era fals în ambele cazuri. Le-am rescris cu `jest.useFakeTimers()` +
`advanceTimersByTime(20000)` și cu verificarea că `setTimeout` e **înăuntrul** gardei.
Exact aceeași greșeală ca la testul logger-ului, de două ori într-o seară.
**Un test care trece înainte să existe reparația nu dovedește nimic.**

**9435 teste trecute pe felii, 0 picate.**

---

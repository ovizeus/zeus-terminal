<!-- generat din docs/BOOK_OF_ALL.md linia 2788 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ⏰ 2026-10-14, 22:10 — CRON-URILE: toate 7 sănătoase (verificat prin date, nu prin loguri)

Ultima zonă: cron-uri înregistrate care nu pornesc ar fi aceeași clasă — întreținere care tace.

| cron | stare |
|---|---|
| `coldPathCron` | ✅ ticăie, ultima 21:49 |
| `mlScanCron` | ✅ ultima 20:55 |
| `mlTelemetryRetention` | ✅ curăță **~90.000 rânduri/zi** la 04:00 |
| `omegaMemoryCleanup` | ✅ zilnic 02:06 |
| `posClassRetention` | ✅ programat săptămânal duminica (deci n-a tras încă — corect) |
| `diskMonitor` | ✅ programat la 5 min; loghează doar la prag |
| `r0SubstrateCron` | ✅ **vezi mai jos** |

Toate 7 sunt pornite din `server.js`; niciunul orfan.

### 🔍 Cel care m-a obligat să nu mă iau după loguri
`r0SubstrateCron` n-avea **nicio** urmă. Loghează **doar la eșec**, deliberat — comentariul autorului
spune că o linie pe minut e zgomot. Deci tăcerea ar însemna „zero eșecuri"… dar **același comentariu**
numește exact riscul: *„A failed heartbeat used to vanish into an empty catch ... the DR state keeps
looking maintained while nothing is maintaining it."*

Tăcerea e credibilă doar cu dovadă în altă parte. Am căutat-o: `ml_dr_state` conține rânduri
`HEARTBEAT` (`zeus-primary / PRIMARY / LIVE`) la **exact 60 de secunde** distanță, ultima cu câteva
zeci de secunde în urmă. **Heartbeat-ul aterizează.** Verificat, nu dedus.

### 🎓 Lecția, a patra oară azi
Prima mea căutare a dat „5 cron-uri fără nicio urmă". Erau zero. Căutasem după nume de componentă pe
care le **presupusesem** (`DISK`, `POS_CLASS`, `ML_TELEM`), când cele reale sunt `CRON` și `OMEGA`.
Numele corecte le-am scos din cod, nu din cap — și atunci au apărut toate.

---

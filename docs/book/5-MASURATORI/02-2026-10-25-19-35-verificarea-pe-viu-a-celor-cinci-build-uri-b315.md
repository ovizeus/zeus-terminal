<!-- generat din docs/BOOK_OF_ALL.md linia 8168 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ✅ 2026-10-25 19:35 — VERIFICAREA PE VIU a celor cinci build-uri (b315–b319)

Repornirea pentru G-9 a pornit şi b316, b317 şi b318, care stăteau pushuite şi neservite. Deci
toate cele cinci rulează acum. **Ce am promis la fiecare că rămâne de văzut, am văzut — sau spun că
încă nu.**

### Ce e DOVEDIT pe date vii

**G-5 — retenţia.** Prima rulare, la 18:27, a şters **81 057** de rânduri blocate şi **7 384** `no_trade`.
`entry_blocked` mai vechi de 90 de zile: **0** (erau 128 744). Istoricul legat intact: `entry` 1 325,
`pending_fill` 451, `pending_momentum` 62, `at_closed` 3 493. Zero 429/418, nicio plângere de buclă
blocată.

**G-7 — tierul nou există şi a rulat.** Linia de jurnal de la 19:38 e cea nouă:

```
[G-5] brain_decisions prune: no_trade=469 blocked=284 trade=0 pending_terminal=0
```

**`pending_terminal=0` e exact ce prezisesem**, şi în carte scrie de ce: cel mai vechi rând pending are
165 de zile, fereastra e 365, deci **prima rulare şterge zero prin construcţie**. Nu e o curăţenie, e un
plafon. **Dar acum e un plafon care s-a executat o dată**, nu unul scris şi necitit.

**G-6 — eticheta ML, dovedită curat.** Restrâns la rândurile scrise **după** repornire, deci garantat
de codul nou:

| Scris în `ml_decision_snapshots` după 19:35:33 | |
|---|---|
| `ABSTAIN_CRITIC` | **70** |
| `TRADE` | **0** |

Şi acţiunile din aceeaşi fereastră: `blocked_gates` 43, `no_trade` 21, **`entry_blocked` 3**,
`pending_created` 2, `pending_expire` 1 — **suma 70, fără rest**. Cu codul vechi, cele 3 `entry_blocked`
plus `pending_created` şi `pending_expire` — **şase rânduri** — ar fi fost etichetate `TRADE`. Acum zero.

*Şi o capcană de măsurare prinsă la timp:* prima mea interogare a luat ultimele 5 minute şi a găsit
`TRADE|1`. Rândul ăla era de **înainte** de repornire, scris de codul vechi. **O fereastră de timp care
trece peste o repornire amestecă două versiuni de cod** — exact clasa [[R-V-20]]. Refacută de la
`pm_uptime`, nu de la „acum minus cinci minute".

**G-9 — legarea.** `ss` arată `127.0.0.1:3000`; prin nginx 302; loopback 302; IP public **refuzat**.
Bannerul: `Network: (not exposed — bound to 127.0.0.1; set BIND_HOST=0.0.0.0 for LAN)`.
`recoveryBoot`: 1/1 useri OK, 0 orfane, 0 SL puse, 0 erori.

### Ce NU e dovedit — şi n-are cum să fie încă

**G-8: `pending_blocked` are ZERO rânduri după patru minute, şi asta nu înseamnă nimic.**

Ramura nouă se execută doar când un pending **se declanşează** şi garda îl refuză. Umplerile sunt rare:
**451 în cinci luni, adică vreo 3 pe zi.** În patru minute s-a scris **un singur** `pending_expire` şi
două `pending_created`. **Ramura n-a avut ocazia să ruleze.** A spune „merge" acum ar fi exact genul de
afirmaţie pe care o retrag a doua zi.

**Şi o distincţie care strică măsurătoarea grăbită:** `pending_created` a crescut cu 2, dar **alea nu
sunt orfani** — sunt pending-uri **deschise acum**. Un pending în aşteptare şi un orfan arată **identic**
în tabelă până când primul se rezolvă. Deci rata de orfani nu se poate citi în minute, oricum aş privi-o.

**Criteriul, scris înainte ca datele să existe** — de citit peste câteva zile:

> Se numără `pending_blocked` şi `pending_created` scrise **după 19:35 pe 25 octombrie**.
> • Dacă `pending_blocked` creşte şi proporţia de `pending_created` care rămân nerezolvate scade
> aproape la zero → **ipoteza de la G-7/G-8 era corectă**: refuzul gărzii era cauza dominantă a celor
> 33 677.
> • Dacă orfanii continuă la 33–52% iar `pending_blocked` rămâne mic → **ipoteza era greşită**, cauza e
> alta — cel mai probabil simboluri scoase din selecţie, unde `checkPending` nu mai e chemat deloc —
> **şi o scriu ca retractare, nu ca notă de subsol.**

**Poziţii deschise 2, `banned_until` 0, zero 429/418 după reload.**

---

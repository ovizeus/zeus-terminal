<!-- generat din docs/BOOK_OF_ALL.md linia 7551 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔭 GĂSIT, NEREPARAT — două descoperiri din lucrarea la G-5

### G-6. Eticheta `TRADE` pentru ML e pusă pe 179 452 de rânduri care nu sunt tranzacţii (99,07%)

Acelaşi `startsWith('blocked_')`, dar în **scriitor**, nu în retenţie. `brainLogger.js:125` decide ce
tip de eveniment ajunge în `ml_decision_snapshots`:

```js
if (finalTier === 'NO_TRADE' || finalAction.startsWith('blocked_')) eventType = 'ABSTAIN_CRITIC';
else if (conf >= 50 && conf < 60) eventType = 'NEAR_THRESHOLD';
else eventType = 'TRADE';
```

`entry_blocked` nu trece niciun test, deci cade pe `else` → **`TRADE`**. Rulat cu aceeaşi regulă peste
tabelă, compoziţia etichetei `TRADE` e:

| `final_action` | Rânduri etichetate `TRADE` | Chiar e o tranzacţie? |
|---|---|---|
| `entry_blocked` | **110 678** | nu — AT a refuzat |
| `pending_expire` | **38 260** | nu — a expirat |
| `pending_created` | **30 514** | nu — nerezolvat |
| `entry` | 1 220 | **da** |
| `pending_fill` | 409 | **da** |
| `pending_momentum` | 54 | **da** |

**Total 181 135, din care tranzacţii adevărate 1 683. Adică 0,93%.**

> ### ⛔ CORECŢIE, scrisă două ore mai târziu — am spus-o mai tare decât e
>
> Scrisesem aici: *„ML-ul a învăţat luni de zile dintr-o clasă numită TRADE care e 99% ne-tranzacţii."*
> **Am verificat fiecare cititor al coloanei, şi nu există niciunul.** `snapshot_event_type` nu e filtrat,
> nu e ramificat, nu e citit: `omega.js` cere `auditTrail` şi **nu-l apelează niciodată**, `replayEngine`
> nu pomeneşte coloana deloc, `serverAT` citeşte doar digestul, iar funcţiile de citire din `auditTrail`
> n-au niciun apelant. Şi `mlTelemetryRetention` taie tabela la **30 de zile** — confirmat pe date, cel
> mai vechi rând e din 2026-09-25 — deci nici „luni de zile" nu stă.
>
> **Deci nu e otrăvire de ML. E o coloană scrisă greşit pe care n-o citeşte nimeni** — scrisă, indexată,
> cu `CHECK`, şi niciodată interogată. Ceea ce face reparaţia **fără nicio schimbare de comportament**,
> exact pe dos de cum ţi-o prezentasem („schimbă ce consumă ML-ul, deci e decizia ta"). Cifra de 99,07%
> rămâne corectă; **consecinţa pe care i-o atribuisem, nu.** [[R-V-18]] cere să spun ce n-am verificat;
> aici n-am verificat **dacă cineva citeşte**, şi am dedus efectul din volum.

**Şi mai e o scăpare în acelaşi `if`,** la `brainLogger.js:79`: decizia dacă rândul trece prin
**eşantionarea** NO_TRADE. `entry_blocked` are tier `SMALL`/`MEDIUM`/`LARGE` — verificat, niciun rând cu
`NO_TRADE` — deci nu intră nici pe prima condiţie, nici pe a doua: **se stochează toate, neeşantionate.**

> ### ⛔ A DOUA CORECŢIE — „de aia sunt atât de multe" e greşit
>
> Scăparea de la eşantionare e reală în cod, dar **măsurat, aproape că n-are efect.**
> `_shouldStoreNoTrade` păstrează **tot** ce are încrederea ≥50, iar **52 893 din 54 268** de rânduri
> `entry_blocked` (97,5%) sunt la ≥50. Deci trecerea lor prin eşantionator ar schimba **cel mult 2,5%**
> din rânduri, şi chiar şi acelea mai trec prin celelalte condiţii (`confScore ≥ 60`, bătaia de inimă
> la 10 cicluri, schimbarea de regim).
>
> **Sunt multe fiindcă AT refuză mult, nu fiindcă scapă de eşantionare.** Şi fiindcă acele 2,5% sunt
> refuzuri pe calea banilor — exact rândurile care merită păstrate — **nu e un bug de reparat, e un
> comportament de păstrat.** L-am lăsat neatins, dar l-am făcut **deliberat**: comentariu la locul lui
> şi un test care cade dacă cineva „face ordine" fără să citească raţionamentul. Acelaşi tipar ca G-4.

*De ce nu l-am făcut:* schimbă ce consumă ML-ul la antrenare, pe un sistem cu bani. E decizia ta, şi e
exact ce cere „nu înlănţui schimbări riscante". Reparaţia e o linie în fiecare loc, odată ce modulul
comun există — care acum există.

### G-7. 77 688 de rânduri de telemetrie fără nicio regulă de retenţie

Rămase în afara oricărui tier, după ce `entry_blocked` a intrat în cel de 90 de zile:

| `final_action` | Rânduri | Legate | Cel mai vechi |
|---|---|---|---|
| `pending_expire` | 44 013 | 0 | 2026-05-13 |
| `pending_created` | 33 675 | 0 | 2026-05-13 |

**Şi o corecţie la propria mea citire de ieri:** scrisesem că un `pending_created` care se umple ar
rămâne nelegat, deci ştergerea lor ar pierde actul de naştere al tranzacţiilor reale. **E greşit.**
`brainLogger.updateAction` **mută acelaşi rând** din `pending_created` în `pending_fill`, şi abia atunci
`linkSeq` îl leagă. Deci un `pending_created` rămas nelegat chiar n-a devenit niciodată tranzacţie.
Argumentul meu de ieri împotrivă nu stă.

*Două lucruri de spus şi care tot nu-l fac o urgenţă:* `pending_cancel` se scrie în cod
(`serverBrain.js:1059`) şi are **zero rânduri de când există tabela** — ori ramura nu se atinge, ori nu
ajunge să fie scrisă; şi `unknown`, valoarea de rezervă din `brainLogger.js:75`, n-are nici el retenţie,
cu zero rânduri acum.

### 🔶 Ce NU am verificat ([[R-V-18]])

- **n-am rulat suita completă de server**, doar shard-ul de retenţie — 21 de fişiere, 258 de teste
  ([[R-OP-8]]);
- n-am verificat retenţia **pe baza vie** — tot ce am măsurat distructiv a fost pe copii, iar prima
  rulare adevărată va fi la 180 de secunde după reload. Jurnalul va spune `[G-5] brain_decisions prune:`
  cu cele trei cifre; **asta rămâne de citit după reload**, n-am citit-o încă;
- cele **114 ms** sunt măsurate pe o copie, nu pe baza vie sub trafic: pe baza vie scriitorul concurent
  poate face lotul mai lent;
- cifrele din G-6 sunt calculate aplicând regula scriitorului peste `brain_decisions`, **nu** citite din
  `ml_decision_snapshots` rând cu rând — digestul MD5 nu se poate potrivi ieftin pe 376 000 de rânduri,
  deci e o reconstituire a regulii, nu o numărătoare a efectului ei.

---

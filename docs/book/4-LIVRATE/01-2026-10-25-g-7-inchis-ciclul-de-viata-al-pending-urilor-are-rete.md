<!-- generat din docs/BOOK_OF_ALL.md linia 7730 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ⏳ 2026-10-25 — G-7 ÎNCHIS: ciclul de viaţă al pending-urilor are retenţie, dar nu cea evidentă (b317 v1.7.291)

> Cerere operator: *„fa si g7 daca zici ca e ok"*. Ţi-o dădusem ca întrebare de produs — *ce fereastră de
> analiză vrei* — şi măsurătoarea a răspuns în locul tău, de două ori, în direcţii pe care nu le
> prevăzusem.

**Ce era:** 77 692 de rânduri în afara oricărui tier — `pending_expire` 44 015 şi `pending_created`
33 677, amândouă cu zero `linked_seq`. Mutarea evidentă era să le pun în tierul blocate, la 90 de zile,
cum făcusem cu `entry_blocked` la G-5. **Ar fi fost greşit, din două motive diferite.**

### Prima măsurătoare: la 90 de zile pâlnia nu s-ar fi scurtat, s-ar fi STRÂMBAT

`pending_fill` şi `pending_momentum` sunt **legate**, deci [[R-C-21]] le păstrează pentru totdeauna.
`pending_expire` e numitorul. **A tăia numitorul şi a păstra numărătorul nu scurtează o măsurătoare, o
inventează:** cine ar calcula rata de umplere pe o fereastră mai veche ar vedea **numai umpleri** şi ar
raporta 100%, cu încredere.

O fereastră scurtă **pierde** informaţie. Asta ar fi **fabricat** informaţie. Sunt lucruri diferite, şi al
doilea e cel care m-a costat de atâtea ori în cartea asta.

Măsurat pe o copie a bazei vii, şi diferenţa e exactă:

| Fereastra | Ce şterge la prima rulare |
|---|---|
| 90 de zile | **24 993 de rânduri de numitor** |
| **365 de zile** | **0 rânduri** |

Deci am pus **365**, acelaşi tier ca un `entry` nelegat — şi e şi analogia mai bună: **un pending expirat
A ÎNCERCAT**, a stat la coadă şi i s-a terminat timpul, pe când un `blocked_*` a fost oprit înainte să
încerce.

**Preţul ferestrei mai lungi, măsurat:** 265 de rânduri pe zi la ~1 438 de octeţi → **~139 MB pe an**,
faţă de 72 GB liberi. **Şi spun răspicat ce NU face:** prima rulare şterge **zero** rânduri, fiindcă cel
mai vechi rând pending e din 13 mai, adică 165 de zile. **Asta nu e o curăţenie, e un plafon** — unul
care se declanşează în vreo 200 de zile. Merită oricum, fiindcă e diferenţa dintre o politică şi un
accident, exact lecţia de la G-4.

### A doua măsurătoare: `pending_created` nu e telemetrie cu sfârşit necunoscut

**Sfârşitul lui e cunoscut şi doar nu se scrie.** Pe calea pending, `serverBrain.js:~1045` cheamă
`linkSeq` şi `updateAction` **doar înăuntrul lui `if (entry)`**. Deci când AT refuză umplerea declanşată,
rândul rămâne `pending_created` **pe veci**.

Pe calea directă, acelaşi refuz scrie `entry_blocked`. **Pe calea pending nu scrie nimic.**

Deci cele 33 677 de rânduri sunt **singura urmă a unor decizii pe care nimic altceva nu le-a înregistrat.**
A le şterge pe un cronometru ar fi distrus dovada unei găuri de jurnalizare. **Nu au nicio retenţie, şi
asta e deliberat**, scris atât în `brainActions.js` cât în `database.js`, cu un test care cade dacă
cineva le adaugă în clasă.

### Ce am livrat

**`PENDING_TERMINAL_ACTIONS`** în `brainActions.js` — **o rafinare a clasei de telemetrie, nu o a patra
clasă**: `pending_expire` şi `pending_cancel`, stările care sunt un **sfârşit**. Un test verifică că e
submulţime a telemetriei, ca să nu se rupă clasificarea de la G-5.

**`bdPrunePendingTerminal`** în `database.js` — lotizată, cu `+linked_seq IS NULL` şi plusul de la G-5.
Planul verificat pe instrucţiunea reală: `SEARCH ... USING INDEX idx_bd_action (final_action=?, ts<?)`.

**Şi jurnalul**, care ar fi tăcut: garda era `if (r.no_trade || r.blocked || r.trade)`, deci odată ce
tierurile vechi ajung la regim staţionar, o rulare care ar fi şters **numai** rânduri pending ar fi
făcut-o **în linişte**. Acum `pending_terminal` e şi în gardă şi în mesaj.

### Dovada

**19 teste noi**, zece pe o bază de date reală. **7 mutaţii, toate moarte:**

| Mutaţia | Ce a picat |
|---|---|
| fereastra 365 → 90 (exact greşeala evitată) | 2 teste |
| `pending_created` băgat în clasa terminală | 3 teste |
| `pending_fill` (istoric!) băgat în clasa terminală | 3 teste |
| `+` scos din `+linked_seq` | testul de plan |
| garda `linked_seq` scoasă | 2 teste |
| lotizarea scoasă | 5 teste |
| `pending_terminal` scos din garda jurnalului | testul de jurnal |

**Şi un test al meu care trecea în GOL:** `Object.isFrozen(undefined)` întoarce `true`, deci
*„lista e îngheţată"* trecea înainte ca lista să existe. Întărit: verifică întâi că e tablou şi că are
elemente. A treia dată în două zile când propriul test se dovedeşte decor — [[R-V-11]].

**Verificat:** 347/347 pe shard-ul afectat (27 de fişiere), `node --check` curat pe toate trei fişierele.

---

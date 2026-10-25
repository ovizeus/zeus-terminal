<!-- generat din docs/BOOK_OF_ALL.md linia 7432 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🗃️ 2026-10-25 — G-5 ÎNCHIS: retenţia nu mai întreabă NUMELE dacă o decizie a fost blocată (b315 v1.7.289)

> Cerere operator: *„fa si g5 daca zici ca e bine"*. I-am spus cu o zi înainte că nu e urgent şi că
> momentul potrivit e data viitoare când cineva umblă oricum la retenţie. A cerut-o, deci asta e data viitoare.

**Ce era.** Regula de 90 de zile întreba un şir de caractere:

```sql
DELETE FROM brain_decisions WHERE final_action LIKE 'blocked_%' AND ts < ?
```

`entry_blocked` înseamnă exact ce spune numele — stratul AT a refuzat intrarea, `serverBrain.js:1655` —
dar **nu începe cu `blocked_`**, deci regula nu l-a văzut niciodată. **128 744 de rânduri, cel mai vechi
de 152 de zile, pe o tabelă a cărei proprie regulă spune 90.**

**O potrivire pe prefix nu e o clasificare.** Aia e toată cauza, şi e [[R-C-22]] încă o dată.

### Ce s-a livrat

**`server/services/brainActions.js`** — o singură sursă de adevăr pentru numele de acţiuni, în trei clase:

| Clasa | Nume | Ce înseamnă | Retenţie |
|---|---|---|---|
| **blocate** | `blocked_gates`, `blocked_reflection`, `blocked_reflection_penalty`, `blocked_correlation`, `blocked_correlation_penalty`, `blocked_session`, `blocked_drawdown`, **`entry_blocked`** | o intenţie care n-a devenit tranzacţie, nu poate purta `linked_seq` | **90 de zile** |
| **ISTORIC** | `entry`, `pending_fill`, `pending_momentum` | **pot** purta `linked_seq` → sunt istoric de tranzacţionare | **niciodată, cât timp sunt legate** ([[R-C-21]]) |
| telemetrie | `no_trade`, `pending_created`, `pending_expire`, `pending_cancel`, `unknown` | ciclu de viaţă fără tranzacţie | 30 de zile doar pentru `no_trade`, pe tier; restul — vezi **G-7** |

**Trei nume din listă n-aveau niciun rând în baza de date:** `blocked_session`, `blocked_drawdown`,
`blocked_reflection_penalty`. Se scriu în cod, nu s-au declanşat încă. Erau acoperite de potrivirea pe
prefix; dacă aş fi trecut la o listă fixă fără ele, le-aş fi scos din retenţie **fără să observ nimeni**.
De aceea lista nu e scrisă din ce arată baza, e scrisă din ce scrie **codul**, şi un test o verifică.

### Trei schimbări în retenţie, fiecare măsurată înainte de a fi scrisă

**(1) Filtrul citeşte lista**, nu forma numelui. Rămâne pe coloana `final_action`, deci pe index — exact
a treia opţiune pe care o recomandasem în G-5, nu una din cele două false.

**(2) `+linked_seq IS NULL`** — plusul e deliberat. Cu garda adăugată naiv, **planificatorul alege
indexul greşit**:

| Interogare | Planul | Timp |
|---|---|---|
| `linked_seq IS NULL` | `idx_bd_linked (linked_seq=?)` — potriveşte ~750 000 de rânduri | **0,72 s** |
| `+linked_seq IS NULL` | `idx_bd_action (final_action=?, ts<?)` | **0,14 s** |

Plusul spune SQLite să nu folosească index pentru termenul ăla. Verificat pe instrucţiunea **reală**,
pregătită din cod, nu pe una scrisă de mână: `SEARCH … USING INDEX idx_bd_action`.

**(3) Lotizare — şi aici am găsit ceva ce nu căutam.** Am măsurat `DELETE`-ul pe o copie a bazei vii:

| | Rânduri | Timp |
|---|---|---|
| retenţia **de acum**, aşa cum rulează azi | 6 491 | **8,666 s** |
| regula lărgită, într-o singură instrucţiune | 80 970 | **6,8 s** |
| regula lărgită, **lotizată** | 80 985 în 41 de loturi | **cel mai lung lot: 183 ms** |

**`better-sqlite3` e sincron.** Adică retenţia care rulează azi, la fiecare 24 de ore şi la 180 de
secunde după fiecare boot, **îngheaţă bucla de evenimente aproape nouă secunde**. Procesul are 1 116
reporniri. Asta e exact clasa incidentului din **7 octombrie**, când un `PRAGMA integrity_check` inline
în tick-ul doctorului a oprit Zeus — doar că de data asta nimeni nu s-a uitat.

Mărimea lotului a fost **aleasă pe date, nu din gust**, pe copii proaspete ale bazei de 2,9 GB:

| Lot | Loturi | Cel mai lung | Mediu |
|---|---|---|---|
| 500 | 162 | 196 ms | 37 ms |
| **1000** | **81** | **114 ms** | **84 ms** |
| 2000 | 41 | 183 ms | 124 ms |

Cel mai lung lot e dominat de un checkpoint WAL şi apare la orice mărime; media creşte cu mărimea.
1000 a avut cea mai mică îngheţare observată şi jumătate din media lui 2000. **De la o îngheţare de
8,7 s la bucăţi de ~114 ms, cu 80 ms de pauză între ele în care scriitorul viu trece.**

`bdPrune` e acum `async` şi întoarce câte rânduri a şters pe fiecare tier, deci jurnalul spune ce s-a
întâmplat în loc să presupună. Tiparul e copiat din `pruneParityLogs`, care stă cu câteva sute de linii
mai jos în acelaşi fişier şi făcea deja exact asta ([[R-C-23]]).

### Dovada că testele apără, nu decorează

**20 de teste noi** (`tests/unit/brain-actions-retention.test.js`), şapte dintre ele pe o bază de date
reală. **Şapte mutaţii, toate moarte:**

| Mutaţia | Ce a picat |
|---|---|
| scot `entry_blocked` din lista blocate | 4 teste |
| bag `entry` în lista blocate (ar şterge istoric) | 3 teste |
| scot `+` din `+linked_seq` | testul de plan |
| scot lotizarea | 3 teste |
| scot garda `linked_seq` din tierul blocat | **testul funcţional**, pe baza reală |
| un nume de acţiune nou, neclasificat, în `serverBrain` | testul de clasificare |
| listă literală de nume în loc de modulul comun | testul de sursă unică |

**Şi o greşeală a mea, prinsă de mutaţie.** Trei teste citeau 600 de caractere după `bdPruneBlocked`.
Fereastra aia intră în instrucţiunea **următoare**, `bdPruneTrade`, care are propria ei gardă
`+linked_seq IS NULL` — deci scoţând garda din tierul blocat, **testul de text trecea senin**, şi doar
testul funcţional a omorât mutantul. Exact lecţia scrisă deja în testul vecin: **vecinătatea nu e
cablare.** Testele taie acum instrucţiunea exact, şi un assert verifică însăşi tăietura.

### Ce NU am atins, deliberat

`brainLogger.js` decide **şi el** „a fost blocat?", în două locuri, tot cu `startsWith('blocked_')`.
**Nu le-am mutat pe modulul comun**, deşi ar fi fost o linie fiecare, fiindcă amândouă schimbă ce
consumă ML-ul. E **G-6**, decizia ta. Comentariul din `brainActions.js` spune explicit să nu fie
„făcute ordine" fără să citeşti G-6.

**Verificat:** 258/258 pe shard-ul de retenţie (21 de fişiere), `node --check` pe toate trei fişierele
atinse, planul confirmat pe instrucţiunea reală, cele 7 mutaţii moarte, fişierele restaurate bit cu bit
după fiecare.

---

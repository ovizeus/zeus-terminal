<!-- generat din docs/BOOK_OF_ALL.md linia 7190 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔭 GĂSIT, NEREPARAT — registrul cerut de R-P-6

> Lucruri pe care le-am văzut **în afara sarcinii** şi **nu** le-am atins. Fiecare aşteaptă cuvântul tău.
> Regula care le-a creat locul: [[R-P-6]] — ce găsesc pe lângă se notează, nu se repară, altfel o sesiune
> de o oră devine şase schimbări înlănţuite ([[R-C-3]]).
>
> **Deschis pe 2026-10-24.** Nu e o listă de bug-uri grave; e exact ce am văzut cu coada ochiului azi.

**G-1. `tsc` are 68 de erori preexistente pe client.** Verificat azi, de două ori, înainte şi după
munca mea: 68 înainte, 68 după, **zero** în fişierele pe care le-am atins. Sunt în `ChartControls.tsx`
(patru apeluri cu un argument în plus), `ModeBar.tsx`, `DoctorPanel.tsx` (variabile nefolosite),
`bootstrapMisc.ts` (un `m` posibil `null`) şi în câteva teste de MultiExchange cărora le lipseşte un câmp
devenit obligatoriu. Niciuna nu opreşte build-ul, fiindcă build-ul nu rulează `tsc`. **Ce înseamnă
practic:** verificarea de tipuri nu poate fi folosită ca poartă — nu pot spune „tsc e curat", ci doar
„n-am adăugat erori", ceea ce e o poartă mult mai slabă. Reparate, ar deveni o poartă adevărată.
*Nereparat: sunt în cinci fişiere care n-au nicio legătură cu ce mi-ai cerut.*

**G-2. Orice rută inexistentă sub `/api/admin/` răspunde 401, nu 404.** Observat azi când mi-am testat
rutele noi: `/api/admin/book/nope` întoarce **401**, la fel ca o rută reală fără autentificare. Deci nu
pot distinge „ruta nu există" de „nu eşti autentificat" dintr-un răspuns — iar azi era să iau asta ca
dovadă că rutele mele sunt înregistrate, ceea ce ar fi fost o dovadă falsă. Am verificat altfel, prin
modul. **Nu e o gaură de securitate** (401 spune *mai puţin*, nu mai mult), e o problemă de diagnostic:
o rută scrisă greşit va arăta ca o problemă de login şi va trimite pe cineva să caute în partea greşită.
*Nereparat: atinge middleware-ul de autentificare al întregului `/api/admin`, deci e exact genul de
schimbare care nu se face „cât sunt pe-aici".*

**G-3. `changelog` din `version.js` e un singur şir de 297 KB.** Măsurat azi: `typeof` e `string`,
297 431 de octeţi, şi creşte cu fiecare build — intrarea de azi singură are peste 2 KB.
🔶 **Neverificat, şi o spun ca atare ([[R-V-18]]):** n-am verificat dacă şirul ăsta ajunge vreodată la
client. `grep` pe rutele de server nu l-a găsit nicăieri în afară de propriul fişier, ceea ce **sugerează**
că nu pleacă nicăieri, dar nu e o dovadă — n-am căutat în servicii şi nici în client. Dacă pleacă, e
aproape un sfert de megabyte pe fiecare încărcare a aplicaţiei, pe telefonul tău. **De verificat înainte
de a propune ceva**, nu de reparat acum.

**G-4. `atPruneClosed` e cod mort, şi e o mină.** Ar păstra doar ultimele 500 de poziţii închise pe
utilizator. Exportată, necheamată de nimeni — verificat azi. Dacă o cablează cineva „ca să nu crească
tabela", taie tăcut istoricul de tranzacţionare, clasa declarată intangibilă de [[R-C-21]].
*Nereparat: n-o şterg şi n-o cablez fără cuvântul tău. Opţiunile sunt trei — o ştergem, o lăsăm cu un
comentariu care spune de ce nu se cheamă, sau îi punem un test care îi interzice să aibă apelant.*

**G-5. 205 989 de rânduri din `brain_decisions` fără nicio regulă de retenţie — desfăcute acum.**
Scrisesem mai devreme că nu ştiu ce sunt. Le-am desfăcut, e o simplă citire, şi suma dă exact:

| Ce | Rânduri | Legate de o poziţie | Cea mai veche | Clasa după [[R-C-21]] |
|---|---|---|---|---|
| `entry_blocked` (SMALL/MEDIUM/LARGE) | **128 187** | 0 | 2026-05-26 | telemetrie |
| `pending_expire` | 43 743 | 0 | 2026-05-13 | telemetrie |
| `pending_created` | 33 549 | 0 | 2026-05-13 | telemetrie |
| `pending_fill` | 448 | **toate 448** | 2026-05-13 | **ISTORIC** |
| `pending_momentum` | 62 | **toate 62** | 2026-05-18 | **ISTORIC** |

128 187 + 43 743 + 33 549 + 448 + 62 = **205 989**, fără rest.

**Şi aici e lucrul care merită spus:** `entry_blocked` **este** un blocaj. Se scrie la
`serverBrain.js:1655`, când `serverAT.processBrainDecision` refuză intrarea, cu `blockedReason:
'at_rejected'`. E acelaşi lucru ca `blocked_reflection` sau `blocked_gates` — o intenţie care n-a devenit
tranzacţie — doar că blocajul vine de la stratul AT, nu de la porţile creierului.

Regula de retenţie de 90 de zile prinde `final_action LIKE 'blocked_%'`. **`entry_blocked` nu începe cu
`blocked_`, deci scapă.** Rezultatul măsurat: două clase identice ca înţeles au retenţii complet
diferite — una tăiată la 90 de zile, cealaltă neatinsă de cinci luni. **62% din rândurile fără plafon
sunt o nepotrivire de nume, nu o lipsă de politică.**

E exact clasa numită de [[R-C-22]] şi de corolarul ei: **o potrivire pe prefix nu e o potrivire pe
înţeles.** Acelaşi tipar ca „NEREPARAT" care ateriza în coşul LIVRAT, doar că aici costă 128 187 de
rânduri care cresc la nesfârşit.

*Nereparat, şi nu din lene.* **Dar corectez ce scrisesem acum o oră: pusesem două opţiuni, şi pe cea
greşită o numisem „mai sigură".**

Scrisesem că retenţia s-ar putea uita la `blockedReason` în loc de forma numelui, şi că asta ar fi
varianta sigură. **Am verificat, şi e pe dos:** `blockedReason` **nu e coloană** — stă în blob-ul JSON din
`data`. Măsurat pe baza vie, doar cu `SELECT`:

| Filtru | Timp |
|---|---|
| `json_extract(data,'$.blockedReason')='at_rejected'` | **2,254 s** |
| `final_action='entry_blocked'` | **0,030 s** |

**De 75 de ori mai lent**, şi `better-sqlite3` e **sincron**: un `DELETE` cu filtrul pe JSON ar îngheţa
bucla de evenimente ~2 secunde la fiecare rulare de retenţie. Aia e exact clasa incidentului din
**7 octombrie**, când un `PRAGMA integrity_check` pus inline în tick-ul doctorului a oprit Zeus. Iar
comentariul din `database.js` avertizează deja, cu propriile lui cuvinte, că un `DELETE … WHERE` peste
milioane de rânduri e sincron.

**Deci cele două opţiuni pe care ţi le dădusem erau o falsă alegere**, şi cea pe care o recomandam era
periculoasă. A treia, pe care n-o scrisesem, e şi curată şi ieftină:

> **Retenţia şi scriitorul citesc aceeaşi listă de acţiuni „blocate".** Un singur loc care spune ce
> înseamnă blocat, folosit şi de cine scrie, şi de cine şterge. Filtrul rămâne pe coloana `final_action`
> — deci viteză de coloană — iar `entry_blocked` intră în listă, nu într-un `OR` lipit la coadă.

Asta e [[R-C-22]] aplicată corect (reparaţie pe clasă, nu pe instanţă) **şi** [[R-C-23]] (o singură sursă
de adevăr pentru „ce e blocat"), fără să atingă ce se scrie pe calea vie. **Rămâne decizia ta**, dar
recomandarea mea nu mai e cea de acum o oră.

*Cele două clase ISTORIC — `pending_fill` şi `pending_momentum`, 510 rânduri, toate legate de poziţii
reale — nu se ating în niciun scenariu.*

**Cât de urgent e, măsurat şi nu simţit:** `entry_blocked` creşte cu **849 de rânduri pe zi**, media unui
rând e **1 475 de octeţi**, deci **~1,25 MB pe zi** şi **~457 MB pe an**. Acum ocupă **180 MB**, adunaţi
în cinci luni. Discul are **72 GB liberi**. **Argumentul cu spaţiul nu există** — motivul pentru care
merită reparat cândva e consecvenţa, nu locul pe disc. Deci nu e o urgenţă, şi momentul potrivit e data
viitoare când cineva umblă oricum la retenţie, nu ca schimbare de sine stătătoare azi.

**Costul real din zona asta nu e discul, e ce pot măsura.** `NO_TRADE` se taie la 30 de zile, deci orice
afirmaţie de-a mea despre pâlnie e oarbă dincolo de o lună. Dacă vrei vreodată analize pe ferestre mai
lungi, decizia nu e „reparăm retenţia", e **„ce fereastră de analiză vrei, şi eşti de acord cu preţul ei
în spaţiu"** — o întrebare de produs, nu de cod.


---

<!-- generat din docs/BOOK_OF_ALL.md linia 8239 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ⏰ 2026-10-25 — CUM se va răspunde la G-8, pregătit înainte ca datele să existe

> Cerere operator: *„peste cateva zile sa verifici g8 si sami zici"*.

### Ce am încercat întâi şi am respins

Am pornit să programez un agent care să ruleze singur peste câteva zile. **L-am oprit înainte să-l
creez:** agenţii programaţi rulează **în cloud**, cu propriul lor checkout al depozitului, şi **nu pot
atinge serverul ăsta**. Ar fi clonat codul şi n-ar fi găsit `data/zeus.db`. **Un mecanism care se preface
că măsoară e mai rău decât niciun mecanism**, fiindcă îi dai încredere şi te uită în altă parte.

### Ce am făcut în loc

**`scripts/g8-check.sh`** — doar `SELECT`, nu scrie nimic ([[R-OP-13]]), cu criteriul şi ambele
ramuri scrise **în capul fişierului**, nu în capul meu ([[R-V-19]]: o cifră fără comanda care o produce
e o amintire, nu o măsurătoare).

**Şi un instantaneu zilnic la 06:30**, în crontab-ul lui `zeus`, care adaugă în
`data/g8-watch.log`. Nu ca să am date mai repede, ci fiindcă **criteriul cere o evoluţie, nu o poză**:
o singură citire peste trei zile nu distinge „orfanii au scăzut" de „ziua aia a fost liniştită". Linia
de cron îşi spune singură că se şterge când G-8 primeşte verdict.

### Două capcane de măsurare, amândouă deja plătite azi

**1. Un pending DESCHIS şi un orfan arată IDENTIC.** Rândul se mută prin `updateAction`, deci
`pending_created` înseamnă şi „încă se întâmplă" şi „n-a ajuns niciodată nicăieri". Scriptul taie
fereastra la **mai vechi de două ore** — mult peste durata unui pending — ca ce rămâne acolo să fie
chiar orfan.

**2. O fereastră de timp care trece peste o repornire amestecă două versiuni de cod.** M-a prins azi la
G-6: am citit „ultimele 5 minute" şi am găsit un `TRADE` care părea să contrazică fixul — era un rând
scris de codul **vechi**. Reperul scriptului e `ts > 1792956933593`, momentul pornirii b318, nu
„acum minus N minute". *Clasa [[R-V-20]].*

### Prima citire, la zece minute după repornire

**`pending_blocked` = 1.** Deci **ramura chiar se execută şi scrie** — asta e dovedit. **Dominanţa, nu**,
şi n-are cum: umplerile sunt vreo 3 pe zi, deci în zece minute ramura abia a avut o ocazie.

### Verdictul, când va veni

> • `pending_blocked` creşte **şi** rata orfanilor scade aproape la zero → **ipoteza era corectă**.
> • orfanii rămân la 33–52% iar `pending_blocked` stă mic → **ipoteza era greşită**, cauza e alta — cel
> mai probabil simbolurile scoase din selecţie, unde `checkPending` nu mai e chemat deloc — **şi se
> scrie ca RETRACTARE, cu numele ei, nu ca notă de subsol.**

**Ramura a doua e scrisă cu aceeaşi apăsare ca prima, dinadins.** Un criteriu care admite doar un
rezultat nu e un criteriu, e o aşteptare.

---

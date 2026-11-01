<!-- generat din docs/BOOK_OF_ALL.md linia 9853 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ↩️ 2026-10-31 — Ieşirea din zoom, un pas o dată, pe ambele hărţi (b351 v1.7.325, doar client)

**Cererea lui:** *„zoom pot da mare da mic cum il fac inapoi"*.

Se putea doar **intra**. Ieşirea exista, dar era numai „tot înapoi" (butonul `FULL` / `FIT`) — uşor de ratat, şi oricum nu e ce vrei după trei tapuri. Acum apare un buton **`−`** lângă etichetă, **doar când e zoom**, şi fiecare apăsare scoate exact un pas. Când ajunge la capăt, butonul dispare şi eticheta scrie iar `FULL` / `FIT`.

### Partea grea a fost REPERUL

Un pas înapoi trebuie să ştie **de unde s-a plecat**. Amândouă valorile aflate la îndemână sunt otrăvite:

| hartă | valoarea „evidentă" | de ce nu merge |
|---|---|---|
| lichidări | acoperirea raportată | e **tăiată** la fereastra curentă → scade odată cu zoom-ul → n-ai mai ieşi niciodată |
| NEREUS | banda raportată | când harta e focalizată, banda raportată **ESTE** fereastra curentă → primul pas înapoi ar sări direct la FIT |

Deci reperul se fixează **o singură dată**, la primul tap, şi se ţine în stare.

### ⚠️ Două mutaţii au supravieţuit, şi le scriu fiindcă sunt aceeaşi lecţie de două ori

Amândouă fiindcă **harnaşamentul meu era o conservă**:

**(1) Mock-ul întorcea mereu aceeaşi formă, oricare ar fi fost cererea.** Dar eticheta şi butonul de ieşire sunt conduse **dinadins** de ce a desenat serverul — deci un mock care nu răspunde la `span` / `focusPct` nu putea dovedi nimic despre ele. Acum ecoul există, ca la server, şi **respectă o formă pusă explicit**: aşa rămâne apărat şi faptul că eticheta urmează serverul chiar fără niciun tap.

**(2) Mock-ul nu TĂIA acoperirea la fereastra cerută, cum face serverul.** Asta ascundea un bug real: reperul recalculat din acoperire ar fi **părut** stabil, fiindcă acoperirea nu se micşora niciodată. Cu tăierea pusă, mutaţia moare.

Un test care nu se poartă ca sistemul nu apără sistemul — chiar dacă e verde.

### Dovada

**6 mutaţii moarte:** ieşirea care nu se opreşte la reper · ieşirea care intră mai adânc (pe amândouă hărţile) · reperul remutat la fiecare tap (pe amândouă) · butonul de ieşire scos.

Teste: **12** pe ajutoarele pure, **6** pe panouri. Server **10.061** verzi, client **1.623**, `tsc` 0 erori.

**Doar client: build, FĂRĂ reload** (R-OP-2).

---

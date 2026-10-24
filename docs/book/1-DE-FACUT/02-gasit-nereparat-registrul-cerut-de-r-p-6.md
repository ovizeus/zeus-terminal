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

**G-5. 205 989 de rânduri din `brain_decisions` fără nicio regulă de retenţie.** Cele trei reguli acoperă
`NO_TRADE`, `blocked_*` şi `entry`; restul creşte nelimitat. Nu e urgent — discul e la 47% — dar e
singura clasă fără plafon dintr-o tabelă care ia 17 000 de rânduri pe zi. *Nereparat: înainte de orice
retenţie nouă trebuie stabilit în ce clasă din [[R-C-21]] intră rândurile alea, şi eu nu ştiu încă ce
sunt — n-am desfăcut `final_tier`-urile.*


---

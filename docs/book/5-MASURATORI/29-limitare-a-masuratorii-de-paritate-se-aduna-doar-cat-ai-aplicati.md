<!-- generat din docs/BOOK_OF_ALL.md linia 1461 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 📌 LIMITARE a măsurătorii de paritate — se adună doar cât ai aplicaţia deschisă — 2026-10-22

**Nu e un bug. E o constrângere pe cifra pe care ţi-am dat-o, şi trebuie ştiută.**

Dupa reload-ul de la 01:51 am observat zero rânduri noi de paritate şi am verificat dacă nu
stricasem ceva cu `--update-env`. **Nu.** Flagul `PARITY_SHADOW_ENABLED` nu e variabilă de mediu, e
flag persistat în `data/migration_flags.json`, şi e `true`, intact din 21 oct 21:47.

Cauza reală: `_hasRecentClientParity()` (serverBrain.js:462) **păzeşte emisia**. Serverul scrie
rânduri de paritate **doar pentru utilizatorii al căror client a trimis recent** — proiectat aşa pe
2026-10-18, ca rândurile server să aibă o pereche client. Ultimul rând e **21 oct 21:32**: când ai
închis aplicaţia, setul activ s-a golit şi serverul a încetat corect.

### Ce înseamnă pentru cifrele mele

- **Cele 45,1% acord / 28,6% opuse** s-au măsurat pe 1 678 de perechi adunate **doar în ferestrele
  în care aveai aplicaţia deschisă.** Rămâne o constatare validă — două creiere care se contrazic
  pe direcţie în peste un sfert din cazuri — dar e un eşantion din sesiunile tale, nu din tot timpul.
- **Acelaşi lucru pentru paritatea DSL pe care am aprins-o în b298:** va colecta doar cât priveşti.
- **Curăţarea e corectă**, verificat: cel mai vechi rând e exact la 7 zile (`parity prune … keep 7d`),
  286 156 de rânduri. Nu şterge nimic recent.

**Nu propun să fie schimbat.** Gardul are un motiv bun (un rând server fără pereche client
strică rata de nepotrivire, care e un prag de gard). Dar dacă vrei vreodată o măsurătoare continuă,
ăsta e locul — şi atunci rândurile neperechizate trebuie numărate separat, nu amestecate.

---

<!-- generat din docs/BOOK_OF_ALL.md linia 8988 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 📙 AMÂNAT DE OPERATOR — BOOKMAP (cartea de ordine): etapa 2, nu acum

**Decizia lui, 2026-10-26:** *„treci bookmap în carte, să-l facem mai târziu"*. Deci nu e uitat şi nu e respins — e **programat**.

### Ce ar fi

Harta de lichidări arată **unde au explodat** banii. Bookmap arată **unde stau banii ACUM**: cartea de ordine pe niveluri, în timp, ca o hartă de densitate. Suprapuse, cele două răspund la întrebarea care contează: *preţul se duce spre un nivel unde e combustibil, sau spre un perete de ordine?*

### De ce e stratul care nu există nicăieri

Coinglass **modelează** lichidările. Bookmap (produsul) desenează cartea, dar separat de lichidări. Noi am avea **amândouă din date măsurate, în acelaşi ecran** — şi asta chiar nu se găseşte.

### Ce ştiu deja că va fi greu, ca să nu descopăr târziu

1. **Volum de date de alt ordin.** Lichidările sunt evenimente rare (~10 000 în 13 ore). Cartea de ordine e un flux continuu de diferenţe — mii de actualizări pe secundă pe un singur simbol. **Nu intră în SQLite ca rânduri.** Trebuie agregare în memorie şi persistat doar instantanee pe niveluri.
2. **Binance futures WS e mort către acest VPS** (documentat din 14 mai). Cartea de ordine de futures Binance **nu o putem lua pe stream**. Rămâne REST cu interogare periodică (adâncime limitată) sau bursele care funcţionează: Bybit, OKX, Gate.
3. **Spoofing.** Un perete de ordine care dispare când preţul se apropie nu e un perete. Un instantaneu static **minte**. Trebuie urmărit dacă nivelul **rezistă** — altfel desenăm fantome, exact greşeala de care am scăpat la lichidări.

### Condiţia de pornire

Nu începem până harta de lichidări nu are **cel puţin câteva zile de istoric** şi nu e judecată de el ca bună. Altfel construim strat peste strat fără să ştim dacă primul ţine.

---

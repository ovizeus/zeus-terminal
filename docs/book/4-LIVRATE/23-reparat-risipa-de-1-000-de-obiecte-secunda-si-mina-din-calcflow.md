<!-- generat din docs/BOOK_OF_ALL.md linia 1725 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🧹 REPARAT — risipa de 1 000 de obiecte/secundă şi mina din `calcFLOW` — 2026-10-21 (b302 v1.7.276)

**Client-only → build, fără reload.** Amândouă din auditul b294. **Niciuna nu schimbă vreun număr
pe care îl citeşti:** una taie muncă inutilă, cealaltă dezarmează o capcană.

### 1. Remap-ul de klines — 3,6 milioane de obiecte pe oră, degeaba

`runAllEngines` remapa **tot** vectorul la fiecare 500 ms. Garda nu se putea stinge **niciodată**:
testa `klines[0].open !== undefined`, iar remap-ul **păstra** `open` — intenţionat, ca graficul
Zeus să-şi găsească formatul. Deci condiţia rămânea mereu adevărată.

**Partea de verificat înainte de „optimizare":** inversarea naivă a gărzii (pe `klines[0].o`) ar fi
**stricat date.** `marketDataChart.ts` (142/162/193) **înlocuieşte lumânarea vie** cu un obiect
proaspăt în format Zeus — merge direct la `cSeries.update`, deci are `open/high/low/close`, nu
`o/h/l/c`. Cu o gardă pusă doar pe elementul 0, bara în curs n-ar fi primit niciodată formatul QM,
şi motoarele ar fi citit `undefined` **exact pe bara care contează cel mai mult**.

Modul pur nou `engines/klinesNorm.ts` converteşte doar ce are nevoie: tot vectorul la o aducere
proaspătă, şi numai coada când lumânarea vie e înlocuită. **Dovedit în test:** primul apel
converteşte 500 de bare, următoarele **100 de apeluri converteşc zero**, iar lumânarea vie
înlocuită e prinsă singură.

### 2. Mina din `calcFLOW`

```js
const winSlice = win.slice(0, -3); if (winSlice.length < 1) return
```

Un `return` care ieşea din **toată funcţia**, nu din bloc. Azi nu se declanşa — `buf.length >= 30`
garanta 27 de elemente — dar **o coborâre a pragului ar fi tăiat în linişte EXHAUST, VOID, STOP şi
SMF.** Patru motoare stinse de o decizie care arată nevinovată, fără nicio eroare.

Mina nu se putea testa cât timp stătea îngropată, fiindcă pragul e o constantă în cod. Acum
fereastra e o funcţie pură exportată care **refuză cu `null` în loc să oprească**, iar apelantul
sare doar blocul MMTRAP. Filtrează şi valorile nefinite: `Math.max` cu un `NaN` întoarce `NaN`, iar
un `hi` NaN ar face toate comparaţiile de mai jos false **pe tăcute** — aceeaşi tăcere, mutată cu
un pas mai departe.

**16 teste noi**, inclusiv graniţa exactă la care mina s-ar fi declanşat. Client: **142 de fişiere,
1 167 de teste verzi**, `tsc` curat.

**De notat:** prima mea verificare în bundle a raportat garda veche ca încă **prezentă** — dar
potrivirea venea din `lightweight-charts` minificat, nu din codul nostru. **Grep-ul naiv minte şi
pe bundle; se citeşte contextul.**

---

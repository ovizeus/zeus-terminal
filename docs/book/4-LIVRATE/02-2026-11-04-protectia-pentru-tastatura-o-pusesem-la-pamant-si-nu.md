<!-- generat din docs/BOOK_OF_ALL.md linia 10892 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ⌨️ 2026-11-04 — Protecţia pentru tastatură: o pusesem la pământ şi nu se vedea (b372 v1.7.346)

Asta e **regresia mea**, nu o decizie de-a ta. La **b354**, când chatul a ieşit din bara lipită de fundul paginii OMEGA, am şters protecţia de atunci — un pin pe `dvh` prin `:has(.omega-chat-expanded)` — şi **nu am pus nimic în loc**. Am notat-o atunci ca rămăşiţă şi am trecut mai departe.

Când am venit s-o înlocuiesc, am găsit ceva mai rău dedesubt.

### Nu lipsea o regulă de CSS. Nu rula codul.

Efectul care se ocupă de tastatură era păzit de `expanded`:

```
useEffect(() => {
    if (!expanded) return        // ← aici
    ...
    vv.addEventListener('resize', onResize)
}, [expanded])
```

Pe pagina întreagă `expanded` **nu devine NICIODATĂ `true`**: ambele locuri care îl setează sunt păzite cu `!fullPage`, iar antetul care îl comuta nu se mai randează. Componenta are deja `isOpen = fullPage || expanded` pentru exact asta — doar că efectul ăsta a rămas pe variabila veche.

Deci **de la b353 până acum, pagina de chat nu avea niciun ascultător de viewport.**

| de ce nu s-a văzut | |
|---|---|
| scroll-ul la mesaj nou mergea | e pe `[history]`, efect separat |
| scroll-ul la scris mergea | e pe `[input]`, efect separat |
| singurul lucru pierdut | reacţia la **tastatură** — care se vede doar pe telefon, cu mâna pe ecran |

Un simptom care apare numai pe dispozitivul lui, numai în timpul scrisului, e exact felul de gaură care stă luni întregi.

### Cauza de fond: tastatura nu mişcă viewportul de layout

O tastatură virtuală **nu** schimbă `window.innerHeight`. Micşorează doar viewportul **vizual**. Pagina de chat îşi ia înălţimea de la strămoşii flex (`height: 100%`), care nu ştiu nimic despre asta — aşa că randul de scris ajunge **sub** tastatură şi scrii pe orbeşte.

Măsurătoarea e `innerHeight - visualViewport.height - offsetTop`, cu două garduri:

| gard | de ce |
|---|---|
| prag **90px** | aşezarea barei de browser dă deltă mică; nu e tastatură |
| plafon **75%** | o citire absurdă nu are voie să strângă chatul la zero |
| se scade `offsetTop` | iOS **panează** viewportul; panare ≠ tastatură |

Rezultatul se publică pe secţiune ca `--omega-kb-inset`, iar CSS-ul îl dă înapoi ca **`padding-bottom`, nu ca înălţime**: cu `box-sizing: border-box` padding-ul micşorează cutia de conţinut, deci zona care derulează cedează şi randul de scris urcă deasupra tastaturii. Regula e scrisă cu **două clase** (`.omega-chat.omega-chat-full`), ca să câştige prin specificitate şi nu prin poziţie în fişier — capcana de la b354.

Se ascultă **şi `scroll`** pe viewport, nu doar `resize`: iOS panează fără să redimensioneze când trec între casete, iar fără asta inset-ul rămâne vechi în timpul scrisului.

### Două buguri ale mele, prinse de probe înainte de livrare

**1. O gardă care nu păzea nimic.** Pusesem un `typeof x !== 'number'` invocând capcana `Number(null) === 0`. Capcana e reală — dar e la **`isFinite` global**. `Number.isFinite` **nu converteşte**, deci respinge deja `null`. Mutaţia care scotea garda a **supravieţuit**, şi asta a fost răspunsul: am **scos codul**, nu am adăugat un test care să-l acopere.

**2. Curăţarea citea un ref deja desprins.** Scrisesem `sectionRef.current?.style.removeProperty(...)` în curăţare. React desprinde ref-urile **înainte** de a rula curăţările, deci inset-ul rămânea agăţat pe element. Contează în modul bară, unde `isOpen` devine `false` cu componenta **încă montată**. Acum elementul e capturat o dată, în closure.

### Dovada

**5 din 5 mutaţii moarte** pe legătura din componentă:

| mutaţie | efect |
|---|---|
| gardul înapoi pe `expanded` (bugul original) | **6 teste cad** |
| fără ascultător de `scroll` | 2 cad |
| fără curăţare la ieşire | 1 cade |
| curăţarea citeşte iar ref-ul | 13 cad |
| secţiunea fără `ref` | 5 cad |

Pe funcţia pură: **5 din 6**. A şasea e un **mutant echivalent** — `NaN || 0` dă acelaşi `0` ca ternarul cu `isFinite`, pentru fiecare intrare care contează. O spun ca 5 din 6; nu rotunjesc la 6.

**16 teste noi** (9 pe funcţia pură, 7 pe componenta reală). Suita de client: **174 fişiere, 1.694 teste, toate verzi**. Verificat în **bundle-ul servit**, nu în sursă: `if(!h)return` cu `h=n||d`, plus `padding-bottom:var(--omega-kb-inset,0px)` în CSS-ul livrat.

Schimbare doar de client → build, **fără** reload (R-OP-2).

### Ce rămâne de confirmat

Pragul de 90px şi plafonul de 75% sunt judecata mea, nu măsurători pe telefonul tău. Dacă la scris randul sare sau rămâne ascuns, cifra de ajustat e `KB_MIN_INSET_PX` din `client/src/components/omega/chatViewport.ts`.

---

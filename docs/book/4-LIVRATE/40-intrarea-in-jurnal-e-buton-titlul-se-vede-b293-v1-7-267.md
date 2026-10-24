<!-- generat din docs/BOOK_OF_ALL.md linia 5842 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔘 Intrarea în jurnal e buton, titlul se vede — (b293 v1.7.267)

Cererea ta după ce ai văzut casetele: *„să mărești și scrisul de la titlu… e mic, să fie mai mare, gen buton apăs și intru."*

**Intrarea** era un `<a className="zi-lbl">` în `AutoTradePanel.tsx`: **9 px**, uppercase, subliniat, lipit
în dreapta jos a panoului. Singura ușă spre toată pagina de jurnal, și cât o scamă de apăsat cu degetul mare.

Acum e **buton pe toată lățimea**, din aceeași familie cu butonul **Arm** — aceleași `var(--zi-raise)`,
`var(--zi-edge)`, `var(--zi-val)` și același radius, deci nu arată lipit din altă parte. Înălțime **40**,
scris **12 px**, o săgeată discretă, și `aria-label` ca să fie clar unde duce.

**Titlul paginii** de jurnal a crescut de la **18 px la 28 px** (22 px pe telefon — lângă butonul Export,
28 ar înghesui capul paginii).

### Ce am găsit verificând, și de ce a devenit regulă

`zi-lbl` e folosit **de 37 de ori** în client. Primul reflex ar fi fost „deci clasa e prost dimensionată,
o măresc". **Greșit** — toate celelalte 36 sunt titluri de secțiune pe `div`/`span`, unde 9 px e exact
potrivit. Linkul spre jurnal era **singurul `<a>`** pe clasa aia.

Deci greșeala era de **rol**, nu de valoare: o clasă de *etichetă* pusă pe ceva de *apăsat*. Dacă aș fi
mărit clasa, aș fi stricat 36 de titluri ca să repar un buton. → **R-C-14**.

### Verificat în bundle, nu în sursă *(lecția b286)*

Obiectul de stil minificat din `index-DgdYmOMu.js` chiar are `width:100%, height:40, fontSize:12,
border:1px solid var(--zi-edge), cursor:pointer`; vechiul link subliniat cu `zi-lbl` **nu mai apare deloc**;
iar `public/app/index.html` trimite la exact bundle-ul nou. Build rulat **ca zeus**, deci zero artefacte
root-owned în `public/app` *(regula R8 — root a mai blocat tăcut procesul zeus o dată)*.

**4 teste noi** care randează chiar panoul și fixează **ținta, nu aspectul**: înălțime minim 36, scris minim
12 px, lățime completă, cursor de apăsat. Așa pot schimba culorile oricând fără să pice nimic. **2 mutanți
omorâți**, inclusiv punerea la loc a etichetei de 9 px. Suita de client **1061 de teste pe 131 de fișiere**
verde, `tsc` curat.

**Fără reload pm2:** schimbare doar de client — build-ul rescrie bundle-ul, serverul doar îl servește
*(R-OP-2)*. Fișierele de jurnal sunt livrate cu `no-cache`, deci nici refresh forțat nu-ți trebuie.


---

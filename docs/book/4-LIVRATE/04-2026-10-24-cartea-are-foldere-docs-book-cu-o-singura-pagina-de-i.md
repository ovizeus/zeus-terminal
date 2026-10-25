<!-- generat din docs/BOOK_OF_ALL.md linia 6998 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🗂️ 2026-10-24 — CARTEA ARE FOLDERE: `docs/book/`, cu o singură pagină de intrare

> *„vreau sami faci foldere cand intru sa fie toate puse la punct cu ce fa facut ce e de facut ce urmeaza
> etc toate pe categorii sa fie ordine citestele pe toate si fa categorii cand intru sa stiu unde"*

Cartea avea **108 secţiuni pe ~7 000 de linii**, în ordine cronologică. Ordinea cronologică e corectă pentru
istoric şi inutilă pentru „unde stă lucrul care mă interesează acum": ultima secţiune livrată stătea lângă
o retractare de acum trei zile, iar lista de decizii ale lui era la linia 37, sub patru ecrane de audit.

### Ce am făcut

**Nimic nu s-a şters şi nimic nu s-a rescris.** Cartea rămâne sursa. Peste ea am pus navigaţia:

```
docs/book/
  START.md               ← singura pagină scrisă de mână; se citeşte doar ea
  INDEX.md               ← toate cele 107 secţiuni într-un tabel, cele mai noi primele
  0-PREAMBUL.md
  1-DE-FACUT/            3   munca deschisă + planurile pe viitor
  2-DECIZII-ALE-TALE/    5   ce nu pot continua singur
  3-IN-COLECTARE/        3   măsurători care adună date acum
  4-LIVRATE/            42   livrat ŞI dovedit pe sistemul viu
  5-MASURATORI/         36   audituri, constatări, fără schimbări de cod
  6-RETRACTARI/         11   unde am greşit şi m-am corectat
  7-INCIDENTE/           6   ce s-a stricat, cine, şi ce regulă a ieşit
  8-REGULI/              1   regulile, fiecare cu incidentul care a produs-o
  9-ARHIVA/              1   închise, păstrate pentru istoric
```

Fiecare coş are propriul `README.md` cu tabel data + titlu. Fiecare fişier de secţiune poartă în cap linia
exactă din care a fost extras, ca să se poată întoarce cineva la original.

### De ce un script şi nu o mutare manuală

`scripts/book-split.py` sparge cartea, clasifică fiecare secţiune după titlu şi scrie tot. Se poate rula
oricând şi regenerează totul — deci folderele nu pot rămâne în urmă faţă de carte, care creşte la fiecare
sesiune. O reorganizare făcută manual ar fi fost corectă azi şi minciună în trei zile.

Clasificarea are trei straturi, în ordine: **excepţii explicite** (patru titluri care nu se lasă prinse de
nicio regulă de cuvânt — scrise pe faţă, ca să nu strâmb regulile până prind şi altceva), apoi **reguli pe
cuvinte din titlu**, apoi **numărul de build**: un titlu care poartă `(bNNN v1.7.NNN)` e, prin definiţie,
ceva livrat — deci build-urile viitoare se clasifică singure.

Ordinea regulilor contează şi e deliberată: **„colectează" bate „livrat"**. b312 e şi livrat, şi în
colectare; ce ne interesează despre el e că **aşteaptă date**, nu că are cod scris. La fel, „retractare"
bate orice: o secţiune în care m-am corectat trebuie găsită ca retractare, nu ca măsurătoare.

### Gardă împotriva rătăcirii în linişte

Scriptul **nu** înghite ce nu ştie să clasifice. La final tipăreşte pe nume fiecare secţiune neclasificată,
cu linia din carte. La prima rulare au fost 8; le-am rezolvat pe toate — cinci prin regula de build, trei
prin excepţii explicite. Apoi a prins-o pe **a mea, secţiunea asta** — a noua, şi cea mai bună dovadă că
garda funcţionează: am scris-o, am rulat scriptul, şi mi-a spus că n-o poate clasifica. Acum sunt **zero**. Dacă o secţiune viitoare nu se potriveşte, o spune în loc să o
îndese tăcut în cel mai mare coş — exact clasa de greşeală care a ţinut `shadow` patru luni cu semantică
greşită fiindcă nimeni nu se uita la el.

### Ce am scris de mână, şi de ce doar atât

`START.md`. Starea vie, cele trei măsurători care colectează şi când se citesc, cele 15 lucruri care
aşteaptă o decizie de la el, ultimele şapte build-uri, şi harta folderelor. Scriptul nu-l atinge: starea de
acum nu se poate deduce din titluri, iar un rezumat generat ar fi sunat sigur pe el şi ar fi fost vechi.

### Un defect al meu, prins imediat după livrare

Primul commit a dus **200 de fişiere** în loc de 120. Scriptul scria, dar nu **ştergea**: numele poartă un
indice (`07-...`), indicele se schimbă când adaug o secţiune, deci rularea de azi lăsa în urmă fişierele de
la rularea de acum zece minute. `4-LIVRATE/` avea două copii ale lui b311, cu indici diferiţi.

Ironia e fix clasa de greşeală pe care scriptul o păzeşte: ceva rătăcit, în linişte, într-un folder pe care
nu te uiţi de două ori. Un generator care nu curăţă nu e un generator, e un acumulator. Acum şterge tot ce
generează înainte de a scrie, cu o singură excepţie scrisă pe faţă (`START.md`, singurul fişier de mână).
**Verificare, nu încredere:** 120 de fişiere, zero nume duplicate după tăierea indicelui.

Cifrele din START vin din sistemul viu, nu din carte: 17 218 decizii în ultimele 24h, 750 811 în total,
4 poziţii deschise, 165 de rânduri adunate pe geometrie, HEAD b312 dar **servit b310** — scris la vedere,
fiindcă e genul de nepotrivire care produce o oră de vânătoare la următoarea sesiune.

---

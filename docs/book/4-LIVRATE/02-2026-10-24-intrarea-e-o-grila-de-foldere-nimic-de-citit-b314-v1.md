<!-- generat din docs/BOOK_OF_ALL.md linia 7160 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🗂️ 2026-10-24 — INTRAREA E O GRILĂ DE FOLDERE, nimic de citit (b314 v1.7.288)

> *„eu vreau pictograme cu titlurile gen foldere eu cand intru sa cad doar folderele
> si cand intru in folder sa vad continutul stii cum vreau asa le reperez mai repwde"*

La b313 intrarea randa `START.md` întreg şi abia sub el punea coşurile. Adică tot un perete de text,
doar mai scurt. El vrea altceva, şi a spus de ce: **le reperează mai repede** dintr-o grilă de pictograme
decât citind.

### Ce s-a schimbat

Intrarea e acum **numai plăcuţe**: pictogramă mare, titlu scurt, numărul de secţiuni în colţ, fiecare cu
propria culoare ca să se prindă din ochi — albastru de făcut, chihlimbar deciziile tale, verde livrate,
roşu retractări şi incidente. `START` a devenit şi el o plăcuţă, prima. `CARTEA ÎNTREAGĂ`, ultima.

Un tap intră în folder şi vede conţinutul; un tap pe o secţiune o deschide. Butonul de întoarcere spune
acum **„Foldere"**, fiindcă acolo se întoarce.

### Testul care fixează cererea

6 teste de componentă, iar cel care contează verifică exact ce a cerut: **textul din `START.md` NU apare
pe grilă**. Mutaţia — randarea lui pusă la loc deasupra plăcuţelor — pică **3 din 6**. Deci cererea e
prinsă în cod, nu doar în intenţia mea de azi.

Celelalte cinci: plăcuţele îşi arată numărul, `START` deschide starea de acum, un folder deschide
conţinutul lui şi nu cartea întreagă, titlurile se arată fără marcaje, din folder se revine la grilă, iar
dacă folderele lipsesc de pe disc se vede tot cartea întreagă.

**Verificat:** client **1276/1276** (150 de fişiere), şirurile noi găsite în **bundle**, zero artefacte
root. Client-only, deci **fără reload** — [[R-OP-2]].

---

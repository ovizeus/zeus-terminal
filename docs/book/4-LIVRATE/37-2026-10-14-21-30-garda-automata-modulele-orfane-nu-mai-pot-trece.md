<!-- generat din docs/BOOK_OF_ALL.md linia 2919 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🧪 2026-10-14, 21:30 — GARDĂ AUTOMATĂ: modulele orfane nu mai pot trece neobservate

Lecția cea mai scumpă a serii, transformată în test.

`pooledEvidence.js` avea **teste care treceau** în timp ce **nimic nu-l chema**. Testele dovedeau că
funcțiile sunt corecte, nu că le folosește cineva. Pe orice tablou de bord, cod mort cu acoperire
verde arată identic cu cod viu.

**Întâi am măsurat cât de răspândit e:** din cele **11 module** din `_ring5`, `pooledEvidence` e
**singurul** orfan. Restul au între 1 și 4 apelanți. Deci e un caz izolat, nu putregai — merita
știut înainte de a trage concluzii mari.

`tests/unit/ml/ring5-no-orphan-modules.test.js` verifică acum că fiecare modul din `_ring5` e cerut
de cod de producție. Trei detalii deliberate:
1. **Orfanul existent e listat ca datorie cunoscută**, nu lăsat să înroșească suita — cablarea sau
   ștergerea lui e decizia operatorului, nu ceva de forțat la 21:30.
2. Lista de orfani cunoscuți e **ea însăși fixată** (`expect(KNOWN_ORPHANS).toEqual([...])`), ca să
   nu crească în tăcere — adăugarea unui orfan nou cere o modificare vizibilă în diff.
3. Un test verifică **că directorul e chiar scanat** (>5 module, >50 fișiere), altfel toată suita ar
   trece vacuu dacă o cale se strică — exact greșeala pe care am făcut-o de trei ori azi.

**Dovedit prin mutație:** am rupt apelanții lui `reflectionGate` ca să simulez un orfan nou →
testul pică. Restaurat → 13/13.

---

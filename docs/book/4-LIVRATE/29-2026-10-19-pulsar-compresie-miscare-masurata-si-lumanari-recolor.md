<!-- generat din docs/BOOK_OF_ALL.md linia 5142 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 💥 2026-10-19 — PULSAR: compresie, mișcare măsurată și lumânări recolorate pe chartul mare (b283 v1.7.257)

> *„mai vreau unul dar si pe chart sa se schimbe culorile … compresie zona de extindere masuratori …
> linii sa arate tot culori diferite la candele … ceva ce nu exista"*

### Întâi am verificat că nu e o repetare

- **ASTRAPE** măsoară deja încărcarea din compresie și aprinde la expansiune — dar e un **oscilator în
  panou**: nu știe *unde* e cutia și nu proiectează nimic.
- **KERAUNOS** desenează plicul de squeeze (Bollinger în interiorul Keltner) — dar e un **plic continuu**,
  nu o cutie măsurată cu ținte.

PULSAR e **geometric**, nu doar un semnal. Asta e golul.

### Ce face

1. **Cutia de compresie** — sus și jos, desenată pe exact barele în care s-a strâns.
2. **Măsurătorile** — înălțimea în procente, durata în bare, strâmtimea față de ATR.
3. **Mișcarea măsurată** — la ieșire proiectează înălțimea cutiei din punctul de ieșire (**T1**), plus
   extensia **1,618** (**T2**), și marchează nivelul de **invalidare**.
4. **Lumânările recolorate pe faze** — violet cu atât mai adânc cu cât e mai încărcat, **flash cu contur
   alb** pe bara de ieșire, aprins pe expansiune, palid pe epuizare.

Două reguli pe care le-am preluat de la TERMINATOR: barele fără fază **nu primesc câmpuri de culoare**,
deci culorile tale rămân și stingerea le restaurează peste tot; iar Heikin Ashi se colorează **după**
transformare, nu se exclude.

Și două decizii de fond: compresia se judecă pe **percentila proprie** a strâmtimii, nu pe un prag absolut
(altfel un simbol liniștit e „mereu comprimat"); iar cutia se ia de **dinainte** de bara care sparge —
altfel bara își mută singură marginea și nicio ieșire nu s-ar detecta vreodată.

### ⚠️ Trei teste ale mele au fost decor, și mutanții le-au trecut

Cele 17 teste au trecut **din prima**, ceea ce m-a făcut suspicios. Bine că am verificat:

- **pragul absolut în loc de percentilă** a trecut testul, pentru că metrica de strâmtime e deja raportată
  la ATR, deci scale-free — testul meu cu „două volatilități diferite" nu discrimina nimic;
- **cerința de expansiune scoasă de tot** a trecut, pentru că bara „mică" din test nici măcar nu depășea
  marginea cutiei, deci nu testa nimic;
- (al treilea, cu NEUTRAL, s-a dovedit **mutant echivalent** — cade oricum pe `default` și întoarce null.)

Rescrise cu fixture-uri care chiar discriminează, inclusiv o piață în zigzag unde strâmtimea **nu coboară
niciodată sub pragul absolut** (3,29), deci pragul fix n-ar găsi nimic iar percentila găsește două cutii.

### 🔴 Găsit pe date vii, nu în teste

Rulând pe klines reale: pe **4h** exista o ieșire UP de la 86064 cu invalidarea la 82724 — iar prețul e la
~81900, **demult sub ea**. Chartul ar fi desenat ținte pentru un scenariu care **eșuase deja**. Exact genul
de minciună pe care o vânez prin codul vechi, de data asta a mea.

Adăugat steagul de invalidare: țintele nu se mai desenează, iar panoul nu mai raportează țintă pentru o
ieșire care și-a rupt nivelul.

### Ce arată acum, pe BTC

```
5m   faza=COMPRESSION  incarcare=94  cutii=13  cutie=0,35% pe 3 bare (stramtime 3,1)
     ultima iesire: DOWN la 82651 | T1 82253 | T2 82007 | facut 183% din miscare
1h   faza=COMPRESSION  incarcare=92  cutii=14  cutie=1,83% pe 3 bare
4h   faza=COMPRESSION  incarcare=90  cutii=13  cutie=3,10% pe 4 bare
```

Compresie pe toate trei timeframe-urile, cu încărcare 90–94 — adică cel mai strâns față de propriul
istoric. Iar pe 5m, ultima ieșire în jos a mers **183% din mișcarea măsurată**: ținta a fost atinsă și
depășită.

**20 de teste noi, opt mutanți omorâți.** Client **1004 teste / 127 fișiere** (de la 984), typecheck 67
neschimbat, build curat.

---

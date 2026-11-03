<!-- generat din docs/BOOK_OF_ALL.md linia 2569 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ✂️ 2026-10-16 — ÎNGUSTAT SCOPUL PARITĂȚII (comis; **așteaptă reload**)

Cu cifra de 98,2% risipă, decizia a încetat să fie intuiție. Serverul emite acum paritate **doar
pentru userii care au produs un rând de client recent** — singurii cu care se poate forma o pereche.

**Două direcții, deliberat ASIMETRICE:**
- **necunoscut** (`null`, înainte de prima interogare) → **permisiv**. O pornire la rece nu are voie
  să piardă tăcut singura pereche care contează; câteva rânduri în plus e greșeala ieftină.
- **cunoscut și gol** → **nimeni**. A citi „gol" ca „fără filtru" ar fi reintrodus risipa de 56×
  fără urmă — exact clasa de bug de care e plin fișierul ăsta. **Mutația o confirmă:** inversez
  direcția → testul pică.

Interogarea e una indexată la 5 minute, nu una per user per ciclu. Verificată pe date reale, direct
pe bază: ultimele 30 min → **nimeni** (aplicația e închisă); ultimele 72h → **uid 1**.
Comportament rezultat: cât timp aplicația e închisă nu se scrie nimic; la ~5 minute după ce o
deschizi, revin.

**Două teste existente au picat — și au avut DREPTATE.** Cele din 14 oct verificau *scopul*
(demo + testnet-live, REAL exclus); filtrul nou le golise rezultatul. Nu le-am mușamalizat: am
neutralizat condiția ortogonală în ele (`setActiveParityUsersForTest(null)`), ca fiecare suită să
testeze un singur lucru. **Sistemul a funcționat: testele au prins o schimbare reală de comportament.**

**Și o greșeală de construcție a mea, prinsă tot de ele:** cârligul de test punea setul, dar
`_runShadowForUsers` îl reîmprospăta la începutul fiecărui ciclu și îl suprascria înainte de
aserțiune. Am adăugat o înghețare explicită.

**9476 teste pe felii, 0 picate.**

### ✅ LIVRAT ȘI MĂSURAT PE SISTEMUL VIU (reload 17:43, restart 1096)
Fereastră de 100 de secunde, aceeași lungime, înainte vs după:
| | useri | rânduri |
|---|---|---|
| înainte de reload | 8 | **224** |
| după reload | **0** | **0** |

Zero fiindcă aplicația operatorului e închisă — exact rândurile care nu puteau forma nicio pereche.
Se auto-corectează: deschide aplicația → apar rânduri de client → în ~5 minute revin cele de server,
dar **doar pentru el**.

Fereastra de reload a fost ideală și aleasă, nu nimerită: ban `0`, warm expirat de mult,
`consecutive_ban_count` coborât 19 → 1, **44,8h** de la reload-ul anterior și **zero poziții
deschise**.

---

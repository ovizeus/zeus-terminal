<!-- generat din docs/BOOK_OF_ALL.md linia 1772 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🫁 REPARAT — CVD Divergence şi SMF pot semnala, în sfârşit — 2026-10-21 (b301 v1.7.275)

**Client-only → build, fără reload.** Auditul b294 dovedise că două motoare din Quant **nu puteau
semnala niciodată**. Acum se vede şi de ce.

`S.obBV` / `S.obAV` — volumul total pe bid şi pe ask — erau **citite în 11 locuri** (`runAllEngines`,
`intel.ts` de 6 ori, `flow.ts:88`, `frame.ts` prin aliasuri) şi **scrise în zero**. Nu lipsea un
alias, ca la cele 28 de punţi reparate în b294: **lipsea însumarea.** Datele soseau tot timpul în
`S.bids` / `S.asks` din fluxul `depth20`.

**De ce mureau exact acele două motoare:**

- **CVD Divergence** primea `_qmDeltaHist` cu `0 − 0` la fiecare tick. Pe o serie constantă de
  zerouri, nici `dUp` nici `dDn` nu pot deveni `true` — divergenţa nu putea apărea **niciodată**.
- **Scorul SMF** rămânea blocat pe `NEUT`, fiindcă `flow.ts` compară `obBV` cu `obAV`, iar `0 > 0`
  e fals **în ambele sensuri**.

**Fixul:** modul pur nou `engines/depth.ts`, cablat în `_syncQmVars` — acolo stau toate punţile, şi
rulează imediat înaintea motoarelor în bucla de randare, deci acestea citesc exact aceleaşi valori
ca înainte, doar că nu mai sunt zero. Scrie pe `S`, nu local, ca să ajungă la **toţi** cei 11
cititori. Istoricul de delta s-a mutat lângă punte, fiind stare derivată din ea.

**Două surse, nu una** — şi aici era capcana: fluxul direct scrie obiecte `{p, q}`, iar proxy-ul
scrie `msg.bids`, a cărui formă nu e garantată. Ajutorul acceptă ambele forme plus şiruri numerice.
Altfel puntea ar fi mers pe o cale şi ar fi tăcut pe cealaltă — **exact felul de bug pe care îl
reparăm.**

Respinge negativ şi `Infinity`, nu doar `NaN`: o carte nu are volum negativ, iar un `Infinity`
scăpat în total ar face `obBV/tot` să dea `NaN` în `intel.ts`, şi atunci toate cele 11 citiri ar
cădea pe `|| 0` — aceeaşi tăcere de dinainte, dar mai greu de găsit.

**15 teste noi** (8 pe ajutorul pur, 7 pe cablaj) — inclusiv regresiile care **cad** fără fix:
istoricul de delta nu mai e numai zerouri, delta **îşi schimbă semnul** când cartea se întoarce, şi
SMF are acum o parte dominantă de comparat. Client: **140 de fişiere, 1 151 de teste verzi**, `tsc`
curat. Verificat **structural** în bundle (minificatorul rescrie în
`let t=dU(e.bids),n=dU(e.asks);e.obBV=t,...`), asset servit **HTTP 200**.

---

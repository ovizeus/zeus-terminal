<!-- generat din docs/BOOK_OF_ALL.md linia 7819 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔍 GĂSIT, NEREPARAT — G-8: pe calea pending, refuzul gărzii nu se scrie nicăieri

`serverBrain.js:~1045`, calea pending:

```js
const entry = serverAT.processBrainDecision(pendingResult.pending.decision, pendStc, userId, _userIntentPending);
if (entry) {
    const _pendSnapId = pendingResult.pending._snapId;
    if (_pendSnapId && entry.seq) {
        brainLogger.linkSeq(_pendSnapId, entry.seq);
        brainLogger.updateAction(_pendSnapId, pendingResult.action === 'FILL' ? 'pending_fill' : 'pending_momentum');
    }
}
// nu există `else`
```

**Nu există `else`.** Pending-ul s-a declanşat, AT l-a refuzat, şi jurnalul de decizii rămâne la
*„creat"* pentru totdeauna. Calea directă scrie `entry_blocked` pentru exact acelaşi refuz
(`serverBrain.js:1655`). **Calea pending nu are echivalent.**

### Ce am dovedit, şi ce doar coroborez

**Dovedit, din cod:** ramura lipseşte, şi `updateAction` iese imediat pe `if (!snapId || !action) return`.

**Coroborat, nu dovedit** — că asta e cauza DOMINANTĂ a celor 33 677:

| | Acceptate | Refuzate | Rata |
|---|---|---|---|
| calea directă | `entry` 1 325 | `entry_blocked` 128 744 | **1,0%** |
| calea pending | `pending_fill` 451 | orfani 33 677 | **1,3%** |

Aceeaşi gardă, aceeaşi rată. Şi distribuţia în timp e **uniformă, nu în vârfuri** — 33–52% orfani
în fiecare lună din şase — ceea ce arată o cauză **per-decizie**, nu evenimente rare.

**Ipoteza pe care am avut-o întâi şi am respins-o pe date:** credeam că orfanii vin din ştergerea
pending-urilor la restart, care e **deliberată şi corectă** (`_loadFromDisk`: *„intrările pending NU se
restaurează — sunt sensibile la timp după restart"*). **Dar auditul are doar 136 de rânduri
`PENDING_WIPED_ON_RESTART`, nu 33 677.** Restartul explică 0,4% din orfani. Ipoteza era greşită şi am
aflat-o întrebând baza, nu citind codul mai departe.

**Ce ar dovedi-o:** o ramură `else` care scrie starea — adică chiar reparaţia — şi o zi de date. Pot şi
altele mai mici: un simbol scos din selecţie face ca `checkPending` să nu mai fie chemat deloc pentru el
(`continue`-ul de la [MULTI-SYM]), şi atunci pending-ul zăboveşte în memorie fără sfârşit.

### De ce nu am făcut-o

E a **treia** schimbare de server din sesiunea asta şi prima care ar atinge **bucla interioară din
`serverBrain`**, pe calea banilor. *„Nu înlănţui schimbări riscante"* e regula ta, şi aici se aplică
exact. Reparaţia e mică — un `else` care cheamă `updateAction` cu un nume nou, plus numele în
clasificare — dar merită o revizie de cale a banilor de la zero, nu coada unei sesiuni.

**Şi e utilă dincolo de jurnal:** o dată scrisă starea, pâlnia pending devine măsurabilă în sfârşit, şi
abia atunci cele 33 677 de rânduri pot intra într-un tier de retenţie, fiindcă nu mai sunt singura lor
urmă.

### 🔶 Ce NU am verificat ([[R-V-18]])

- **n-am făcut reload**, al treilea ar fi fost în aceeaşi sesiune ([[R-OP-1]]). Codul e **pushuit, nu
  servit**; b316 şi b317 intră împreună la prima repornire naturală sau la primul reload din sesiunea
  următoare;
- deci **n-am văzut linia de jurnal cu `pending_terminal=` pe viu** — doar în teste;
- pe baza vie regula asta nu are nimic de şters încă, deci **nu-i pot vedea efectul** decât pe o copie cu
  rânduri făcute de mână;
- cauza dominantă a orfanilor din G-8 e **coroborată, nu dovedită**, şi am scris mai sus exact ce ar
  dovedi-o;
- n-am rulat suita completă de server ([[R-OP-8]]).

---

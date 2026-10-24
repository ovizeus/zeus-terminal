<!-- generat din docs/BOOK_OF_ALL.md linia 2232 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🔬 2026-10-14, 21:45 — AM COSTAT IEȘIREA 2: nu e „mută o linie", sunt DOUĂ forme, cu preț diferit

Am dus analiza de siguranță până la capăt ca să pot implementa, și am descoperit că recomandarea mea
de acum o oră („mută blocul PRIMARY deasupra gărzilor") ascundea o alegere.

### ✅ Ce am verificat și e SIGUR
Blocul PRIMARY cheamă `computeFusionDecision()` și scrie `w.FUSION_CACHE`. Am urmărit **toți**
consumatorii: `orderflow.ts:94` (`computeMLSnapshot`) și `orderflow.ts:186` (diagnostic).
`computeMLSnapshot` ajunge **exclusiv** în `badge.textContent` + `data-hot`/`data-cold` — **pur
afișare**, `if (!badge && !dot) return`. Niciun ordin, nicio înregistrare.

Efect secundar al mutării: insigna ar trece din `ML:IDLE` în `ML:FUSION …`. E o afișare care devine
**mai corectă**, nu mai greșită. Deci partea asta nu blochează nimic.

### ⚠️ Ce NU e banal — ordinea gărzilor
```
671  runAutoTradeCheck()
672-686  detectie de deriva a store-ului (dispatch 'zeus:atStateChanged')
687  if (w._serverATEnabled) return            ← autoritate
701  if (_isServerDemoATActive()) return       ← autoritate
708  if (!TabLeader.checkLeader()) return      ← un singur tab
712  if (AT.running) return                    ← reintrare
714  if (!getATEnabled()) return
717  blocul PRIMARY
```
Ca emitul să ruleze **păstrând** `TabLeader` și `AT.running` (altfel fiecare tab emite dublat), cele
două trebuie urcate **deasupra** gărzilor de autoritate. Dar asta sare și peste logica de deriva de
store din 672-686 pentru tab-urile ne-lider — **o schimbare reală de flux** într-o funcție de pe
calea banilor, nu o mutare de linie.

### 🙋 Deci ieșirea 2 are DOUĂ forme — alegerea lui
**2a — reordonare în `runAutoTradeCheck`.** Urci `TabLeader` + `AT.running` deasupra gărzilor de
autoritate, pui emitul între ele și gărzi. *Avantaj:* o singură sursă pentru PRIMARY, exact cum e
proiectat. *Preț:* schimbi fluxul funcției de AT, iar deriva de store nu mai rulează în tab-uri
ne-lider.

**2b — emit din scanner, aditiv.** `klines.ts` emite deja COVERAGE pentru `sym !== getSymbol()` și
**rulează indiferent de cine deține AT** (a produs 101 rânduri azi, cu serverul stăpân). Adaugi
ramura `sym === getSymbol()` care emite PRIMARY prin `computeFusionDecision()`. *Avantaj:* **nu
atingi deloc** `autotrade.ts`; zero risc pe calea banilor. *Preț:* dacă AT-ul de client e vreodată
pornit, ambele emițătoare trag pe simbolul de chart → dublare, deci cere o gardă de exclusivitate.

**Recomandarea mea se mută pe 2b.** Beneficiul e identic (perechi PRIMARY), iar prețul se plătește
într-un fișier de date, nu în funcția care plasează ordine. Dublarea se rezolvă cu o condiție, nu cu
o reordonare.

**Niciuna nu e implementată.** Ambele sunt client-only → rebuild de bundle, **fără reload**.

---

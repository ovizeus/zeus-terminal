<!-- generat din docs/BOOK_OF_ALL.md linia 6339 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## ✏️ 2026-10-24 — „dungile nu se pun": desenul se dezarma în secret (b306 v1.7.280)

Operatorul: *„dungile de pe chart nu se pun nu pot desena te poti uita dar atent
backup inainte si cauta buguri"*. Backup făcut înainte de orice:
`/root/zeus-backups/chart-draw_20261024_051809` (bundle-ul servit, fiindcă
`public/app/` e în `.gitignore` şi git nu îl protejează) plus tag `pre-chart-draw-fix`.

### Ce am exclus înainte, ca să nu repar simptomul

Primele două ipoteze au picat, verificate nu presupuse:

- **`_mc()` nu mai găseşte containerul** (`document.getElementById('mc')`) — ar fi
  făcut `_isOnChart` să întoarcă mereu `false` şi clicul să iasă din handler fără
  nicio eroare. FALS: `id="mc"` există, în `PanelShell.tsx:468`.
- **API de chart schimbat** — `addLineSeries` e v4, iar v5 l-a scos. FALS:
  `lightweight-charts` instalat e **4.1.3** şi metoda există în build.

### Cauza principală: două surse de adevăr pentru „ce unealtă e armată"

| cine | ce ţine | de ce atârnă |
|---|---|---|
| React, `ChartControls.tsx:831` | `drawTool` | aspectul butonului **şi aritmetica de toggle** |
| modul, `drawingTools.ts:21` | `_activeTool` | **dacă un clic pe chart desenează** |

`_handleChartAction` cheamă `_deactivate()` după fiecare plasare (hline, tline,
eraser). Modulul se dezarmează singur — şi **nimic nu anunţa React-ul**: zero
evenimente între cele două, `setDrawTool` era apelat doar din propriile handlere.

Deci secvenţa trăită de operator:

1. apasă unealta → ambele armate, merge;
2. dă clic pe chart → linia se pune, modulul se dezarmează, **React rămâne aprins**;
3. dă clic iar pe chart → `_activeTool` e `null`, se intră pe ramura de
   selectare/deselectare, **nu se desenează nimic**, fără nicio eroare;
4. apasă butonul ca să re-armeze → React calculează `drawTool === tool` → trimite
   **`null`** → `_activate(null)` dezarmează din nou. **Prima apăsare nu face nimic.**
   Abia a doua armează.

Reparat făcând modulul singura sursă de adevăr, iar React oglinda lui prin
`zeus:drawToolChanged` — tiparul deja folosit de `zeus:atStateChanged`,
`zeus:dslStateChanged` şi fraţii lor, nu unul inventat. React nu mai calculează
nimic: trimite unealta apăsată şi află rezultatul din eveniment. Acoperă şi **tasta
H** (`hotkeys.ts:285`), care arma modulul direct, fără să treacă prin butoane, deci
desincroniza în sens invers.

### Bug 2: starea armată nu avea nicio indicaţie vizuală

React randa clasa **`act`**. `app.css` stilează **numai `.dt-btn.on`** (linia 639);
`.dt-btn.act` **nu există**. Pe lângă asta, `_updateBtnStates()` punea corect `on`
prin `classList`, dar React stăpâneşte `className` şi îl ştergea la re-randare.

Deci operatorul **nu avea cum să vadă** dacă unealta e armată — care e exact ce îţi
trebuie ca să înţelegi de ce un clic nu desenează. Toate patru butoanele (`hline`,
`tline`, `eraser`, ochiul) emit acum `on`.

### Bug 3: trendline invizibilă când ambele clicuri cad pe aceeaşi lumânare

`_timeAtX` rotunjeşte la **index de lumânare** (`Math.round(log)`), deci pe un chart
depărtat două clicuri la câţiva pixeli dau **acelaşi timp**. `_addTLine` trimitea
atunci în `setData` două puncte cu timpi identici.

Ce face biblioteca: `checkItemsAreOrdered(data, bh, allowDuplicates = false)` →
`assert(prevTime < currentTime)`. Dar verificarea e **eliminată în producţie** —
verificat în `dist`, unde `setData` se reduce la
`setData(t){this.N_,this.Is.Yh(),this.Kb.Jb(this.Is,t),this.Qb("full")}`. Deci **nu
aruncă nimic**: punctele se colapsează într-unul singur şi linia are lungime zero.
Adică *„am desenat şi nu s-a pus"*, fără urmă în consolă.

Şi partea care doare: garda exista **deja** în funcţia-soră `_updateTLineSeries`
(`if (t1 === t2) t2 = t1 + 1`, calea de drag) şi lipsea de pe calea de creare.
**Reparat într-un loc din două** — acelaşi tipar ca filtrul dry-run cablat la unul
din două locuri (b287). De-aia garda e acum o funcţie pură folosită de calea de
creare, nu o linie copiată.

Pe creare refuzăm limpede, cu mesaj, în loc să producem un artefact invizibil; iar
datele se pregătesc **înainte** de a crea seria, ca un refuz să nu lase o serie
orfană pe chart.

### Bug 4 (întărire, nu cauză dovedită): containerul de mânere putea fi detaşat

`_handleContainer` era memorat o dată (`if (_handleContainer) return`) şi niciodată
revalidat. Panoul de chart se re-montează, `#dt-handles` iese din document dar
rămâne în variabilă, şi de atunci mânerele, butonul de ştergere şi cel de setări se
adăugau **în afara paginii**: linia se vedea, dar nu puteai nici să o muţi, nici să
o ştergi. Acum se verifică `isConnected` şi mânerele existente se mută în
containerul nou, altfel liniile vechi ar rămâne fără mânere.

**Nu am dovadă că asta i se întâmpla lui** — e o gardă, şi o declar ca atare.
Cauzele dovedite sunt 1, 2 şi 3.

### Cum a fost făcut

Modul pur nou `client/src/ui/drawToolArming.ts`, din acelaşi motiv ca
`drawingScope.ts`: `drawingTools.ts` e un IIFE care cere un chart viu, deci altfel
nimic din asta nu ar fi testabil.

- **TDD**: 15 teste scrise **înainte**, căzute pe import.
- **Mutaţie**: patru mutanţi ţintiţi pe gărzi (toggle-ul nu mai dezarmează; timpii
  egali acceptaţi; nodul detaşat considerat bun; nu se mai emite nimic) — **toţi
  patru morţi**. Testele muşcă, nu sunt decor.
- **Regresie**: 144 de fişiere, **1197 de teste** verzi, zero eşuate; `tsc --noEmit` curat.
- **Verificat în BUNDLE-UL SERVIT**, nu în sursă: `zeus:drawToolChanged` prezent,
  mesajul de refuz prezent, `isConnected!==!0` prezent, şi toate patru butoanele
  emit `` ` on` ``. (Lecţia din b285: propriul fix livrat în cod mort.)

Client-only, deci **build, nu reload** — R-OP-2. Reload-ul de server s-a făcut doar
pentru ca `version.js` să arate b306.

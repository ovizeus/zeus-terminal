<!-- generat din docs/BOOK_OF_ALL.md linia 4139 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 🧠 ML — unde suntem (verificat azi, 2026-10-09)

**Ce merge, dovedit:**
- **Brain-ul e viu** — decizii la fiecare 30s, scrise în `brain_decisions` (ultima: acum). Nu e doar „pornit": în fiecare decizie se văd multiplicatorii ML din fuziune (`modStructure`, `modLiquidity`, `modKnn`, `modJournal`, `modSession`, `modTrapRisk`…), deci **influenţa ML chiar ajunge în decizie**, nu stă pe margine.
- **Ingest + pipeline + atribuire** — 755 evenimente în `ml_attribution_events`, 749 rânduri de evidenţă bandit, scrise chiar azi.
- **OMEGA** — Doctor-ul porneşte curat (64 module, DAG valid), cron-ul de memorie rulează zilnic la 02:00. Zero erori în loguri.
- **Opt-in LIVE** — uid=1 a dat opt-in (ultimul 2026-07-09), deci poarta `ML_LIVE_OPTIN_REQUIRED` e trecută.

**Aprinse:** `ML_INGEST_ENABLED`, `ML_PIPELINE_SHADOW`, `ML_DEMO_INFLUENCE_ENABLED`, `ML_TESTNET_INFLUENCE_ENABLED`, `ML_LIVE_INFLUENCE_ENABLED` (+ `ML_LIVE_OPTIN_REQUIRED` ca poartă), `ML_HYBRID_POOLING_ENABLED`, `ML_OVERRIDE_RESOLVER_ENABLED`, `ML_CRON_SCAN_ENABLED`.

**Stinse — toată familia DSL:** `ML_DSL_SHADOW_ENABLED`, `ML_DSL_LEARN_ENABLED`, `ML_DSL_LOSSSIDE_SHADOW`, `ML_DSL_LOSSSIDE_ACTIVE`, `ML_DSL_FULL_CONTROL`, `DSL_PARITY_SHADOW_ENABLED`, plus `ML_BANDIT_AUTO_APPLY_MINOR`. La fel `SERVER_BRAIN` şi `SERVER_AT` globale (variantele DEMO/TESTNET sunt aprinse — de-asta serverul tradează singur pe demo).

**Ce mai trebuie activat, concret:**
1. **Nimic, ca să meargă ML-ul de bază** — merge deja. Singurul lucru care-l ţinea inert era cronul de carantină, reparat azi.
2. **P2 de mai sus** (calibrarea) — altfel stratul de guvernanţă rulează, dar nu decide nimic.
3. **ML-DSL** — dacă vrei să revii la el, ordinea e `ML_DSL_SHADOW_ENABLED` → `LEARN` → `LOSSSIDE_SHADOW` → `LOSSSIDE_ACTIVE` → `FULL_CONTROL`, cu soak între trepte. **Atenţie:** Book-ul scria „flag APRINS, 34 poziţii, net +810" — flag-ul e **stins** acum. Nu ştiu când/de ce s-a stins; nota aia era depăşită.
4. **REAL** — rămâne decizia ta (chei LIVE + flip `SERVER_BRAIN`/`SERVER_AT`), gated pe P&L testnet verde şi pe SP1.5 sizing-parity. Nimic de aprins din partea mea.

---

### 📏 CÂT DIN ML E CHIAR CONECTAT — măsurat 2026-10-09

> Întrebarea ta: „funcţionează tot, toate ringurile cu toate punctele?" Răspunsul scurt: **nu — un nucleu lucrează, restul e schelă.** Mai jos sunt cifrele, nu impresii.

**Dimensiune:** 284 de fişiere, **68.392 de linii**, 367 de tabele `ml_`.

**Cod — cât se atinge pornind de la `server.js`** *(graful complet de `require`; în tot serverul există un singur `require` dinamic, în `coldPathCron`, deci graful e exact)*:
- **74 din 284 de fişiere sunt conectate. 210 nu.**

**Date — ce scrie efectiv** *(ultimul rând din fiecare tabelă)*:
- **198 din 367 de tabele sunt GOALE** — n-au avut niciun rând vreodată (54%)
- **30 sunt scrise în ultimele 7 zile** (8%)
- 105 au date vechi de peste 7 zile · 34 n-au coloană de timp

**Ringurile care chiar lucrează** (au şi cod conectat, şi tabele scrise recent): `R0_substrate` (9/9 conectate), `R1_constitution` (3/3), `R3B_safety` (3/3), `_doctor` (18/20), `_ring5` (10/11, bandit-ul scrie), `_voice` (9/10), `R7_meta`, `R7_communication`. Plus nucleul de decizii: `ml_decision_snapshots`, `ml_decision_light`, `ml_attribution_events`, `ml_bandit_posteriors`, `ml_diagnostic_events`.

**Zonele moarte, în ordinea mărimii:**
- **`_meta` — 70 de fişiere, 16.494 de linii, ZERO conectate.** Nimic din server nu-l referenţiază. E cel mai mare bloc din tot ML-ul. *(Atenţie la confuzie: `R7_meta` e alt director şi ĂLA e viu.)*
- **`_operator` — 10 fişiere, 1.920 de linii, ZERO conectate.** Nimic nu-l referenţiază.
- `R3A_safety` — 25 din 26 neconectate (7.418 linii)
- `R2_cognition` — 26 din 30 neconectate (9.028 linii)
- `R5A_learning` — 25 din 28 neconectate (7.478 linii)
- `R5B_governance` 10/13 · `R4_execution` 12/15 · `R6_shadowMeta` 8/9 · `_crosscutting` 9/10
- `R2_brain` şi `R3B_validation` — **directoare complet goale**

**De ce contează:** cele două subsisteme moarte găsite azi (cronul de auto-carantină, inert de când există; cold path-ul care apela funcţii inexistente) **nu erau accidente izolate** — sunt simptomele aceluiaşi lucru: un strat scris după specificaţie, din care o mare parte n-a fost niciodată legată la sistem. Iar cele 11 module pe care cold path-ul le „rula" erau doar *încărcate*, nu apelate — de aceea raporta `11 modules, 0 failed` cu rezultat zero.

**Ce NU spun cifrele astea:** că e cod greşit sau de aruncat. Spun doar că **nu rulează**. Înainte de a decide ceva — conectăm, tăiem, sau lăsăm ca referinţă — ar trebui să ştim care bucăţi au fost testate vreodată pe date reale. Asta cere o sesiune separată, pe ringuri, nu o măturare.

### 🩺 DOCTORUL OMEGA — verificat cap-coadă 2026-10-09

**Verdict: funcţionează.** 61.501 evenimente de diagnostic, scrise activ; 64 de module înregistrate, DAG valid la fiecare boot.

**Ce raportează, pe severităţi:**
- **P0 — 10.786**, din care **10.775 sunt alerte `serverAT.globalHalt`**, aproape toate istorice (oprirea de 2 luni şi incidentul demo-opreşte-live din 8 octombrie). Nu e o avalanşă nouă.
- **P2 — 50.682**, iar cele recente sunt `serverBrain.reflection`: brain-ul îşi blochează singur intrările (`anti_pattern`), adică exact funcţia S9 livrată în b240. **51 azi**, toate pe XRPUSDT LONG. Funcţionează cum trebuie. *(Cosmetic: lista de motive apare duplicată — `["anti_pattern","anti_pattern"]`.)*
- P1 — 2, P3 — 31.

**Ce pare gol dar NU e bug:**
- **coloana `verdict` e goală la toate cele 61.501** — se scrie exclusiv din `falsePositiveAuditor.setVerdict`, accesibil doar prin ruta ta de operator (`/api/omega/doctor/...`). Înseamnă că n-ai triat niciodată manual o alertă ca fals-pozitiv. Unealtă neapăsată, nu cod mort.
- **`ml_cognitive_checkpoints` = 0** şi **`ml_doctor_override_journal` = 0** — la fel, declanşate doar manual din rutele doctorului.

**Un incident real, provocat de mine:** la **05:16** doctorul a trecut singur `HEALTHY → COMPROMISED` („self-heartbeat stale >30s"), iar la **05:19:15** s-a armat halt global prin dead-man switch (`brain_heartbeat_stale_63s`). Cauza: rulam suitele de teste complete pe VPS-ul viu şi am înfometat event loop-ul (acelaşi lucru a produs şi falsa derivă de ceas de -15,7s). **Şi-a revenit singur la 05:20:15** — `brain_recovered_after_6_healthy_checks`, exact plasa de auto-recovery construită pe 7 octombrie. A durat un minut, pe demo. Dovadă că mecanismul e bun, şi încă un motiv să nu rulez suita completă pe maşina vie.

---

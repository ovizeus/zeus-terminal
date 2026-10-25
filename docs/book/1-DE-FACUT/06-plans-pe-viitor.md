<!-- generat din docs/BOOK_OF_ALL.md linia 4332 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## PLANS — pe viitor

1. **Hyperliquid (exchange backup)** — în caz că Binance are probleme de licență după 1 iulie. E DEX (auth = wallet Ethereum + EIP-712, nu key/secret). Plan complet scris, NU se construiește încă.
2. **Bybit proof-first** — dovedește Bybit întâi (e CEX, aproape gata) ca plasă de rezervă rapidă, înainte de efortul mare Hyperliquid.
3. **ML-DSL Faza 2 (measurement real)** — `simulateMlPath` conduce DSL live pe testnet, după ce edge-ul ML e dovedit cu date reale.
4. **Demo în fundal** — demo să tradeze în paralel cu live (nu doar engine=demo). Probabil în SP2.
5. **Roadmap server-autonomy „telefon închis" (S8-S12 / SP1-SP3) — ce-a RĂMAS până la REAL:** *(făcut până la S9 = vezi FĂCUTE; serverul tradează singur pe DEMO+TESTNET, calea REAL e construită dar inertă — 0 chei LIVE)*
   - 📊 **Garduri de dovadă înainte de real:** P&L testnet verde 2-3 săpt (monitoring #2, acum NU verde) + SP1.5 sizing-parity proof.
   - 🔴 **S10 — Flip LIVE uid=1 (decizia + cheile TALE):** conectezi chei LIVE (MultiExchange UI) + pre-flight safety + aprinzi `SERVER_BRAIN`+`SERVER_AT`=true pe live → primul trade pe bani reali condus de server → soak live 14 zile (SL 100%, PnL rezonabil, zero incidente).
   - ⚪ **S11 — Rollout global:** toți userii, în trepte 25%→50%→100% (DUPĂ ce uid=1 real e dovedit 14z). Infra multi-user + scale-monitoring.
   - ⚪ **S12 — Cleanup client:** ștergi codul client de execuție (serverul = singurul executor). Ultimul pas, opțional.
   - *Sursă:* `docs/superpowers/plans/2026-05-28-s8-s12-server-autonomy.md` + specs SP1/SP2. (Planul S8-S12 din 28 mai = re-etichetat SP1/SP2/SP3.)

---

---

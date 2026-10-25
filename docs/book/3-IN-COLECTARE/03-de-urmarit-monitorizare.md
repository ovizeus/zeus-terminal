<!-- generat din docs/BOOK_OF_ALL.md linia 4275 — NU edita aici, editeaza cartea si rulezi scripts/book-split.py -->

## 👀 DE URMĂRIT — monitorizare

> Am verificat fiecare punct pe starea vie azi. Unde nota veche contrazicea realitatea, am corectat şi am spus ce.

1. ⚠️ **ML-DSL Full Control — nota veche era greşită.** Scria „flag APRINS, 34 poziţii, net ≈ +810". Verificat azi: `ML_DSL_FULL_CONTROL` = **stins**, ca toată familia DSL. Cifrele alea rămân istorice, nu curente.
2. **Brain/AT flip la REAL — nu e gata, prin proiectare.** Server-side e făcut (SP1+SP2): pe DEMO+TESTNET serverul decide şi gestionează singur, cu telefonul închis. Calea REAL e construită dar inertă (zero chei LIVE). Rămâne: P&L testnet verde 2-3 săpt + SP1.5 sizing-parity + flip-ul tău.
3. **DSL_ML_CUT = 0** — n-a tras încă. Irelevant cât DSL e stins (vezi 1); redevine de urmărit când îl reaprinzi.
4. ⚠️ **Cron P&L testnet (23:58)** — tot fără urmă în loguri. Neconfirmat că produce date; de verificat la următoarea fereastră.
5. **Lever B Smart Loss-Cut** — testnet, 0 tăieri (volum mic). De urmărit când creşte.
6. ⚠️ **Bybit soak — nota veche era greşită.** Scria `BYBIT_DRY_RUN_ONLY`=OFF. Verificat azi: e **ON**, deci Bybit nu trimite HTTP real; plus cheia uid=2 e expirată (P3). Soak-ul Bybit **nu rulează**.
7. **Chei LIVE pentru REAL ML-DSL** — când decizi tu (MultiExchange UI). Primele trade-uri reale mici şi vegheate.
8. **Radar top300 / OI la următorul ban Binance** — fix livrat, neconfirmat la un ban real.
9. **„Margin insufficient" testnet uid=1** — limitare de cont, nu bug. De urmărit dacă strânge volumul de soak.
10. **CI GitHub Actions roşu = billing-ul contului GitHub** — de rezolvat de tine. (N-am putut reverifica azi: `gh` nu e autentificat pe VPS.)
11. ✅ **„Position side cannot be changed"** — zero apariţii în ultimele 5000 de linii. Pare stins; îl las sub observaţie încă o rundă înainte să-l scot.
12. ✅ **Arhivare tăcută → orfan** — zero orfani reali în loguri; `RECOVERY_BOOT` raportează `1/1 users OK, 0 orphaned`. Garda pasivă rămâne pusă.
13. **Vault — confirmă download-ul pe Chrome desktop** (creare + descuiere + adăugare sunt deja confirmate de tine).

---

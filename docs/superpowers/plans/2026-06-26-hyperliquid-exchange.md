# Hyperliquid Exchange — Implementation Steps (roadmap)

> **Status:** PLAN ONLY (no code yet). Strategic hedge in case Binance has licensing issues after 2026-07-01.
> **Context:** Hyperliquid is already in the `exchangeAdapter.js` EXCHANGES registry (metadata only — ws/rest endpoints, symbolFormat 'base-only'). There is ZERO trading implementation. Only `binance` + `bybit` have real ops (`exchangeOps.js`). Bybit is the structural template, BUT Hyperliquid is a DEX, so auth + signing are fundamentally different.

## The big difference (why this is NOT just "copy Bybit")
| | Binance/Bybit (CEX) | Hyperliquid (DEX) |
|---|---|---|
| Auth | API key + secret, HMAC-SHA256 signing | **Ethereum wallet** — address + an API/agent private key, **EIP-712 typed-data signing** |
| Order endpoint | REST signed with HMAC headers | POST `/exchange` with an action-hash + EIP-712 signature + nonce |
| Market data | REST + WS | POST `/info` (read) + `wss://api.hyperliquid.xyz/ws` |
| Symbols | BTCUSDT | base-only "BTC" + an **asset index** from the `meta` endpoint |
| Orders | true market + SL/TP | **no true market** (use IOC aggressive-limit); SL/TP = **trigger orders** |
| Collateral | per-exchange | **USDC**, cross/isolated, perps |
| New dependency | — | an Ethereum signing lib (**ethers v6** or **viem**) for EIP-712 |

Per-exchange file set to mirror (Bybit template): `bybitSigner / bybitOps / bybitRest / bybitFeed / bybitOrderTranslator / bybitRateState / bybitParityShadow` → create `hyperliquid*` equivalents.

---

## STEP-BY-STEP

### Phase 0 — Decisions + research (no code)
1. Pin the signing approach: Hyperliquid **API agent wallet** (user generates an agent key on HL that can trade but not withdraw — safer than the main key). Decide: store the agent **address + private key**, encrypted like API secrets.
2. Pick the signing lib: **ethers v6** (well-known) vs viem. Add as a server dependency.
3. Read the current Hyperliquid API docs (endpoints evolve): `/info` actions (meta, metaAndAssetCtxs, clearinghouseState, l2Book, userFills, orderStatus), `/exchange` actions (order, cancel, modify, updateLeverage, updateIsolatedMargin), the EIP-712 signing scheme + nonce rules.
4. **Use TESTNET first:** `https://api.hyperliquid-testnet.xyz` + `wss://api.hyperliquid-testnet.xyz/ws`. Prove everything there before mainnet.
5. Add a master flag `HYPERLIQUID_ENABLED` (default OFF) + `HYPERLIQUID_DRY_RUN_ONLY` (default ON) — same fail-closed pattern as Bybit.

### Phase 1 — Read-only foundation (market data + account read)
6. `hyperliquidRest.js` — POST `/info` helpers: `meta` (asset list + szDecimals + asset index map), `metaAndAssetCtxs` (mark prices, funding), `clearinghouseState(address)` (positions + balance/margin), `userFills(address)`, `l2Book(coin)`.
7. Symbol mapping: base-only "BTC" ↔ asset index (from `meta`); store the szDecimals/pxDecimals per asset (needed for rounding).
8. `hyperliquidFeed.js` — WS subscribe (`l2Book`/`trades`/`allMids`) → feed prices into the existing price plumbing (mirror `bybitFeed.js`); + user-event subscription for fills.
9. Wire HL into the read paths: price/mark feed + balance read (the registry descriptor already exists; the feed aggregator already special-cases exchanges).
10. Prove Phase 1: read meta, mark prices, a test wallet's positions/balance — no signing yet.

### Phase 2 — Signer + credentials (the hard part)
11. `hyperliquidSigner.js` — build the action hash (msgpack/keccak per HL spec) + EIP-712 typed-data + sign with the agent key (ethers). Cover the nonce/expiry rules. Pure + unit-tested (sign a known action, compare to a reference vector).
12. Credential model: extend the credential store to hold `{ exchange:'hyperliquid', walletAddress, agentPrivateKey(encrypted) }` instead of key/secret. New validation: sign a no-op / read `clearinghouseState` to confirm the agent works.
13. New connect path: the MultiExchange UI needs a Hyperliquid form (wallet address + agent key + testnet/mainnet toggle), distinct from the key/secret form.

### Phase 3 — Trading ops (money-path)
14. `hyperliquidOrderTranslator.js` — map Zeus order intent → HL order: asset index, sz rounded to szDecimals, px rounded to pxDecimals, tif (Gtc/Ioc/Alo), reduceOnly, trigger (for SL/TP: `triggerPx`, `isMarket`, `tpsl`).
15. `hyperliquidOps.js` — implement the ops interface Zeus expects (mirror `bybitOps.js`): placeOrder (limit; market = IOC aggressive-limit), cancel, modify/replace, setLeverage (updateLeverage), set margin mode, close (reduce-only), getPositions, getBalance, getOpenOrders, set SL/TP as trigger orders.
16. `hyperliquidRateState.js` — HL weight/rate limits (mirror `bybitRateState.js`).
17. Register HL in `exchangeOps.js` (`if (creds.exchange === 'hyperliquid') return { ops: require('./hyperliquidOps'), creds }`).

### Phase 4 — Integration + safety
18. Verify the existing exchange-agnostic money-path (`serverAT` → `exchangeOps`) routes HL correctly — entries, SL/TP, DSL-driven closes, ML-DSL cuts. Confirm HL's trigger-order model works for SL/TP and the DSL stop updates.
19. Reconciliation / driftChecker: HL positions reconcile vs Zeus state (mirror the Bybit recon path).
20. `hyperliquidParityShadow.js` — shadow-compare HL behaviour vs Binance (mirror `bybitParityShadow.js`), to validate without risking money.
21. Fail-closed gates honored everywhere: `HYPERLIQUID_ENABLED` + `HYPERLIQUID_DRY_RUN_ONLY`; REAL only after testnet proof.

### Phase 5 — Soak + prove (testnet → mainnet)
22. Connect a Hyperliquid **testnet** wallet on a TEST user; soak: orders place/fill/cancel/close, SL/TP triggers, leverage, recon, fail-closed — all green for days.
23. Then mainnet with **tiny** size, watched (same discipline as the Binance/Bybit real go-live).

### Phase 6 — UI polish
24. MultiExchange UI: Hyperliquid card (wallet+agent key, testnet/mainnet), connect/disconnect, status badge.
25. Exchange switch + labels show "Hyperliquid" everywhere (the registry label already says "Hyperliquid").

---

## Honest caveats (read before committing time)
- **Bybit is still unproven** (mature code, fail-closed, but ZERO real runs — see memory). Adding a 3rd exchange that is ALSO a DEX is a large lift on top of that. The operator's reason (Binance license risk after July 1) is a valid strategic hedge — but the realistic fastest fallback might be **proving Bybit first** (it's a CEX, closer to done) rather than a full Hyperliquid build.
- The **signer (EIP-712) + the DEX credential model** are the genuinely new, highest-risk pieces — budget most of the effort there.
- New dependency (ethers/viem) on the server — vet it.
- Hyperliquid order semantics (no market orders, trigger-based SL/TP, asset-index symbols, USDC) differ enough that the order translator needs care + testnet proof.

## Rough effort order (smallest risk first)
0 (decisions) → 1 (read-only feed/balance) → 2 (signer+creds) → 3 (ops) → 4 (integrate+safety) → 5 (testnet soak) → 6 (UI). Phases 1 and 2 are independent and can start in parallel; everything downstream needs the signer.

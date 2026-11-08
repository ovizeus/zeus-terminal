# BYOI — spec form expansion, and tying price to scope

**Date:** 2026-11-07 · **Status:** approved by the operator (scope: "tot ce am propus")

## Why

Two holes found by reading the form against the engine behind it.

**1. The form said what an indicator *draws* and what it *reads*, never how it
*calculates*.** The most expensive part of a build was left entirely to free
text, which is exactly where a fixed-price order turns into a negotiation.

**2. Price did not depend on scope.** `evaluateSubmission` took only
`{tier, mode, isAdmin, paymentRef}` — nothing from the spec. The Signature tier
($29) promises "your name and your colours on an existing engine", but nothing
stopped a buyer picking order book + higher timeframes + liquidations + a
readout table at that price. That is Custom-tier work ($149) sold at $29.

A third thing was mistaken on my side and is recorded here so it is not
re-litigated: `Alerts` and `Sound` looked like promises with nothing behind them,
because no indicator alert pipeline exists. But BYOI is an **order form**. A
ticked box is a specification to be honoured **when that indicator is built**,
after payment — not a feature that must already exist. The honest fix is not to
remove them; it is to price them. Both now require the Custom tier, because they
need infrastructure that does not exist yet.

## Design

### One source of truth, still on the server

Fields stay in `server/services/byoiSpec.js`, rendered by the client from
`/api/byoi/config`. Two new properties per field drive everything new:

- `requiresTier` — on a field, or on a single option, naming the minimum tier.
- `showIf` — `{ key, in: [...] }`, so a field appears only when it is relevant.

Both are **data**, so the client renders them and the server enforces them from
the same definition. A new field remains a server edit.

### New fields

**Calculation — the real gap**
| key | type | what it pins down |
|---|---|---|
| `smoothing` | select | none / SMA / EMA / WMA / HMA / RMA |
| `normalize` | select | raw / 0–100 / z-score / percentile rank |
| `signalLogic` | multi | line crossover / threshold cross / divergence vs price / slope flip / level breakout / state change |
| `conditions` | rows (3 cols) | "when ___ ___ ___", max 6 — the spec in its own words, with edges |

**Honesty — worth more than any drawing option**
| key | type | what it pins down |
|---|---|---|
| `confirmOn` | select | **bar close (no repaint)** / live intrabar. The single biggest source of disputes over a paid indicator: a buyer who watches arrows move will call it broken. Settled before the build, not after. |
| `acceptance` | text | "I will consider it correct if ___". One line, and the cheapest protection either side has. |
| `likeExisting` | select | "like X, but…", from the real indicator registry. Conveys intent better than prose. |

**Display**
| key | type | notes |
|---|---|---|
| `levels` | rows (value + label) | horizontal guide lines, max 6 |
| `scale` | select | own scale / price scale / fixed 0–100 — `showIf` placement is pane or both |
| `barColoring` | bool | colour the candles by state |

**Context**
| key | type | notes |
|---|---|---|
| `symbols` | select + text | all markets / specific ones |
| `defaultOn` | bool | on by default in the list |
| `creditLine` | text | `showIf` visibility is `public_request` — the name shown to everyone |

**Alerts (Custom tier)**
| key | type | notes |
|---|---|---|
| `alertWhere` | multi | in-app / Telegram (`telegram.sendToUser` exists) |
| `alertText` | text | the message itself |
| `alertRate` | select | once per bar / every signal |

### Tier gating

A map from option to minimum tier, next to the prices in `byoiPricing.js`:
Custom ($149) is required by `oi`, `funding`, `liq`, `book`, `mtf`, the readout
table, alerts, sound, divergence and state-change logic, and public visibility.

- **Client:** each gated option carries a badge, and picking one offers to move
  the order up rather than silently blocking it. A lost sale is worse than an
  upsell.
- **Server:** `evaluateSubmission` takes the clean spec and **fails closed** —
  an under-tiered order is refused with the reason and the tier it needs. The
  client is a courtesy; the server is the rule. This is the money path.

### Error handling

Unknown keys are still dropped, not rejected, so a client one version ahead
degrades instead of failing. A missing answer still means the safe value:
`private`, `bar close`, no alerts. Drafts stay savable half-filled.

### Testing

- Validation per new field, including every reject path.
- Tier gating: each gated option refused at Signature, allowed at Custom;
  an empty/garbage spec cannot buy its way past; admin bypass still works.
- `showIf`: a hidden field's value is ignored rather than trusted.
- Mutation checks on the gate — removing the check must kill a test.

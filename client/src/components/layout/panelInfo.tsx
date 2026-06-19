import { useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Per-panel "what is this?" info. A pink (i) button in the page-view header opens a card
 * explaining, for a brand-new user, exactly what the panel does. UI-only / read-only.
 * Content keyed by dock id (see DOCK_TITLES in PanelShell). Only panels with an entry here
 * render the (i) button — others simply omit it until their copy is written.
 */
export const PANEL_INFO: Record<string, { title: string; body: string }> = {
  theia: {
    title: 'THEIA — The All-Seeing Oracle',
    body: `THEIA is Zeus's bird's-eye view. It gathers everything — live and historical — into one place so you can read the whole machine at a glance, without opening ten panels.

At the top is THE VERDICT: a single honest light — green, amber or red — answering "is Zeus fit to run autonomously right now?" with the one reason holding it back. It blends the safety circuit, trading halt, data freshness, kill-switch, brain↔server parity, regime stability and testnet P&L trend.

Below it, modules: what happened since you last looked (engine trades, stop moves, P&L); the brain's live pulse (regime, direction, confidence, gates); engine & open positions; safety & feed health; the market lens (regime, movers, funding, open interest); an ML/OMEGA digest; and a memory section with the P&L curve and recent decisions.

THEIA is read-only — it shows and explains, it does not trade. Every number is live from Zeus's real systems; nothing here is mocked. Tap through to the relevant panel when you want to act.`,
  },

  autotrade: {
    title: 'AutoTrade',
    body: `AutoTrade is Zeus's fully autonomous trading engine. When it is ON, it decides and places trades by itself — no manual input needed.

How it decides: the "brain" fuses several market signals (RSI, SuperTrend, MACD, funding rate, open interest) into a market regime (trend / range / breakout) plus a direction and a confidence score. It only opens a trade when that confidence clears your threshold.

What you control here:
• Confidence floor — the minimum conviction required before it trades.
• Position size / Risk % — how big each trade is.
• Leverage — the multiplier applied to each position.
• Stop-Loss % — where the protective stop sits.
• Risk:Reward — how far the take-profit is, relative to the stop.
• Max positions — how many trades it can hold at once.
• Kill-Switch — an automatic halt if losses hit a set %.
• Multi-Symbol Scan (MSCAN) — lets the engine watch several coins at the same time and pick the best setups.

Brain Vision & Dashboard show you, live, what the brain is thinking — the chosen direction, its confidence, the current regime, and the signals behind each decision.

Every automatic position is opened with a protective Stop-Loss and Take-Profit, and is sized by tier (SMALL / MEDIUM / LARGE) according to how strong the signal is. The engine runs on the server, so it keeps trading even when the app or your phone is closed. Changes to the settings above take effect only after you press Save.`,
  },

  'manual-trade': {
    title: 'Manual Trade',
    body: `Manual Trade is where YOU place orders by hand, with full control — separate from the autonomous engine.

What you control:
• Side — LONG or SHORT.
• Order type — MARKET (instant) or LIMIT (at your price).
• Leverage — 1x up to 125x (or custom), and margin mode.
• Entry price & Position size — with quick size shortcuts (25 / 50 / 75 / 100% of balance).
• Optional Take-Profit and Stop-Loss levels.

It shows a live liquidation-price estimate as you set up the order. Below the order ticket you see your pending orders, open positions (separated by demo vs live engine mode), cumulative P&L stats, and a trade journal (time, side, entry→exit, PnL, reason). In live mode it also lists the real positions on the exchange, and warns you if you have positions hidden in the opposite mode (demo/live) so nothing is missed.`,
  },

  dsl: {
    title: 'DSL — Dynamic Stop Loss',
    body: `DSL is an autonomous stop-loss manager that protects and optimizes your OPEN positions in real time. Instead of a fixed stop, it moves intelligently through three phases:

1) Activation — it stays out of the way until the trade reaches a set profit target; only then does it "arm".
2) Pivot Tracking — once armed, it trails the stop upward (by a configured %) as price makes higher pivots, locking in gains while leaving room to run.
3) Impulse Validation — on a sudden momentum spike it extends protection so a sharp wick doesn't stop you out of a strong move; when price just taps the stop on a breather (not a real reversal), it can hold instead of exiting.

The panel is the animated "liquid" view — neon pipes and bubbles flow while a central radar waits and watches your positions. When a position qualifies it shows ARMED, the current phase, the live SL price and progress. You can toggle DSL on/off manually; when ASSIST-ARM (auto) is on, lock badges show the brain is arming/managing DSL for you. A hidden config section tunes the activation threshold, pivot-trail %, impulse extension and pivot-suspension behaviour.

DSL protects what AutoTrade or Manual Trade opened — it never opens trades itself.`,
  },

  'dsl-drive': {
    title: 'DSL Drive — ML Stop Policy (Shadow)',
    body: `DSL Drive is the machine-learning brain on top of DSL. While DSL uses fixed rules, DSL Drive LEARNS the best way to manage each stop — and right now it runs in SHADOW: it proposes what it WOULD do and scores itself against the normal DSL, WITHOUT ever touching your real stop. Pure, risk-free learning.

For each open position it shows: symbol, side, entry, current SL, the DSL arm status, and the ML's recommended action — LOOSEN (give the stop room), TIGHTEN (lock profit), EXIT (get out), or BREATHER (a tap is just noise, hold). Three bars animate the ML's proposed Pivot-Left (PL), Pivot-Right (PR) and Impulse-Value (IV) widths, plus momentum and Max-Favorable-Excursion (how far the trade ran in your favor).

At the top, a scoreboard compares ML vs baseline over recent trades: average advantage % and win-rate for each. This is how we'll know, with evidence, whether the ML stop is actually better before ever letting it control a real stop. If a position isn't armed yet, it means the shadow flag is off or the trade is too new for the ML to evaluate.`,
  },

  omega: {
    title: 'OMEGA — The Brain\'s Voice',
    body: `OMEGA is the window into the ML system's "mind" — its mood, its inner monologue, and a place to talk to it. Three zones:

• The Orb (top) — a living, alien-light animation that pulses and shifts color with the brain's live mood: CALM, ALERT, CAUTIOUS, NERVOUS, WILD or PANIC, scaled by intensity. It refreshes every ~2s so it always feels alive.
• The Voice (middle) — a real-time stream of the brain's thoughts and reasoning (its internal monologue) as it watches the market and makes decisions.
• Talk with Me (bottom) — a chat where you can converse with the brain directly.

Optional text-to-speech reads the voice aloud (with speed/volume controls). A mode badge shows DEMO / TESTNET / REAL / LOCKED. For deeper inspection, OMEGA also hosts intelligence dashboards (some admin-only): Ring5 (the learning system's stats + how its influence flows into decisions), Doctor (cognitive-health diagnostics of the brain), and a Report performance card. It's read-only insight — OMEGA shows you what the brain feels and thinks; it doesn't place trades.`,
  },

  'multi-exchange': {
    title: 'MultiExchange',
    body: `MultiExchange is the hub for connecting and switching between exchange accounts. Today: Binance and Bybit (OKX, Hyperliquid, Bitget, MEXC, HTX are coming).

Each exchange shows as a card with its status: ACTIVE (currently receiving new orders), SWITCHABLE (connected but idle), or INACTIVE (not connected yet). The header shows how many are connected. Tap a card to manage that account's API keys / details.

Important when you switch: if the currently active exchange has OPEN positions, a confirmation warns you that those positions STAY on the old exchange under DSL management — only NEW orders, AutoTrade and the brain move to the new exchange. After switching, a toast confirms the swap and notes any positions still being managed elsewhere. This lets you move where Zeus trades next without abandoning trades already running.`,
  },

  ares: {
    title: 'ARES — Independent Trading Brain',
    body: `ARES is a SECOND, fully independent trading engine with its OWN wallet and its OWN capital — it thinks and trades completely separately from AutoTrade. Think of it as a sister AI you can watch competing in parallel.

The centerpiece is a 136-node neural-network visualization with six anatomical zones, each a real responsibility: Frontal (decision & planning), Parietal (motion & senses), Temporal (memory & hearing), Occipital (vision & chart), Cerebellum (balance & SL/TP), Brain-stem (autotrade & kill-switch). Connections animate and particles flow along the "hot" pathways it's currently using.

A strip shows its stage (IDLE / ACTIVE / EXECUTING), wallet size, confidence and current emotion. Core stats: Capital, Sessions, Trades, Fails. ARES keeps its OWN positions list (separate from AutoTrade), runs an "Arc" mission view, streams its impulse-level thoughts, records lessons learned from memory, and tracks a history bar. A Cognitive-Clarity meter (0–100%) shows how clean its decision pipeline is right now. ARES runs server-side and manages its own money — it does not touch AutoTrade's capital or positions.`,
  },

  postmortem: {
    title: 'Post-Mortem',
    body: `Post-Mortem is a deep-analysis view for a CLOSED trade. Pick a finished trade and it breaks down exactly what happened: the entry and exit reasoning, the market context at both moments, what went right or wrong, and the lessons to carry forward.

It's a review tool — you use it after the fact to understand WHY a trade worked or failed, spot repeating mistakes, and tune your approach. Until you analyze a trade it sits in an empty waiting state.`,
  },

  pnllab: {
    title: 'PnL Lab',
    body: `PnL Lab is your performance analytics hub. It fills in automatically once your first trade closes.

The condensed bar shows three headline numbers: Cumulative PnL, Drawdown (DD — your worst peak-to-trough dip), and Expectancy (E — the average profit you can mathematically expect per trade). Expanded, it adds drawdown tracking, full expectancy analysis, and daily statistics across every closed trade in your journal.

Use it to see whether the strategy is genuinely profitable (positive expectancy), how much risk/pain it puts you through (drawdown), and how performance trends day by day.`,
  },

  aria: {
    title: 'ARIA — Pattern Recognition & Alerts',
    body: `ARIA (Advanced Recognition Intelligence Alerts) is a real-time pattern-detection system. It continuously scans price action across timeframes, recognizes chart patterns, and turns them into actionable setups.

The strip shows the current pattern name, its timeframe, confidence, and a mini pattern chart. Expanded, the left column shows the detected pattern (name / TF / confidence) and the right shows the live candle type, volume, and the multi-timeframe (MTF) stack of agreeing signals. A verdict badge — WATCH, BUY, SELL, HOLD — sums up the bias, with context hints, MTF score, volume regime, trap-rate and magnet bias around it. Recent detections are kept in a short history.

"Pattern Vision" draws the actual 40-candle window where a pattern was detected, overlaid with the zigzag structure and ENTRY / TARGET / STOP level pills — and you can switch timeframe (chart, 15m, 30m, 1h, 4h) to inspect each. Below, a Liquidity-Magnet radar maps the support/resistance clusters above and below price with an overall BULLISH / BEARISH / NEUTRAL bias. ARIA is an analysis & alerting tool — it highlights opportunities, it doesn't execute them.`,
  },

  nova: {
    title: 'Nova — Verdicts & Scenarios',
    body: `Nova logs the brain's verdicts and its scenario analysis in one place. The strip shows the current verdict state (idle / watching / alert…), and expanded it keeps a timestamped log of each verdict with its reasoning (with a Copy-Log button to export).

It also embeds two intelligence sections: the Scenario Engine, with an EXIT-RISK bar showing how likely the current setup is to fail (from signal strength + market conditions); and Cycle Intelligence, showing market regime, flow, sentiment, slope, the size/performance multipliers in effect, and how the strategy performs per regime. Together it gives you the brain's high-level read on market health and how much to trust the current decision.`,
  },

  adaptive: {
    title: 'Adaptive Control',
    body: `Adaptive Control lets the system self-tune based on what's actually been working. When OFF, all multipliers are fixed at 1.00 (no adaptation). When ON, it learns per "bucket" (combinations of regime, trading profile and volatility) and scales three things: ENTRY aggressiveness, position SIZE, and EXIT speed.

It needs at least ~30 trades in a bucket before it trusts that bucket enough to adjust. The live row shows the current ENTRY / SIZE / EXIT multipliers; a table lists recent buckets with their trade count, win-rate and computed multiplier, and a "Last Update" timestamp.

This panel also hosts the Multi-Symbol Scanner (live opportunity count) and the Signal Scanner (a grid of live indicator signals across everything Zeus watches).`,
  },

  flow: {
    title: 'Flow — Order Flow',
    body: `Flow watches the market's microstructure in real time — who's actually buying and selling RIGHT NOW, beneath the candles. It streams bid/ask volume imbalances, large trade blocks, and overall flow sentiment.

A FLOW:OK badge means the data feed is healthy. When buying pressure dominates vs selling (or vice-versa), Flow shows it immediately — useful for confirming a trend's strength or catching a reversal before it appears on the chart.`,
  },

  quantmonitor: {
    title: 'Quantitative Monitor',
    body: `The Quantitative Monitor is a retro command-center terminal (monospace, scanlines, glow) that surfaces 30+ market-intelligence engines and on-chain data in one screen.

It streams, live: basis, cross-exchange funding, dominance, on-chain metrics, open-interest trends, funding-rate anomalies, liquidation pressure, BTC→ALT correlation matrices, and macro regime indicators. It reads Zeus's existing market data and enriches it with extra sources, giving you a dense, at-a-glance quant dashboard of everything moving the market.`,
  },

  mtf: {
    title: 'MTF — Multi-Timeframe',
    body: `MTF shows whether the market agrees with itself across timeframes (15m, 1h, 4h) — the foundation of high-probability setups.

For each it shows REGIME, STRUCTURE, ATR%, volatility mode, SQUEEZE, ADX and VOLUME, color-coded bullish/bearish/neutral. It adds SWEEP (price-sweep patterns), TRAP RATE (liquidity-trap risk), MAGNET levels above/below price and the magnet bias. The headline MTF-ALIGN score (0–100%) aggregates how strongly all timeframes point the same way. The RE (Regime Edge) and PF (Phase Flow) sections add adaptive multi-regime scoring. The higher the alignment, the safer the trade direction.`,
  },

  teacher: {
    title: 'Teacher',
    body: `Teacher is Zeus's self-education and backtesting engine — it runs autonomous practice sessions and learns from live trades to get smarter over time.

A capability score (0–100, WEAK → EXPERT) shows how good it's become; a status bar shows IDLE / ACTIVE / EXECUTING; quick stats show capital, sessions run, trades and fails. Five tabs organize it: REPLAY (the live session — timeframe, profile, regime, decisions), TRADES (history), STATS (lifetime), MEMORY (lessons & patterns it has learned), and REVIEW (capability breakdown + cross-validation). You can START a session, EXPORT the results, or RESET to wipe its learning. It builds a performance model of itself as it runs.`,
  },

  sigreg: {
    title: 'Signals',
    body: `The Signal Registry centralizes every trading signal Zeus tracks and lets you backtest them. The strip shows total signal count, average win-rate and the last signal fired.

Expanded, it lists all registered signals, plus: a DAY/HOUR win-rate filter (heatmap — red = avoid this time, green = good time to trade), a Performance Tracker (per-indicator win-rate, signal count and the AI weight each gets), and a Backtest Engine — run tests over 100 / 200 / 500 / 1000 bars, forecast 3 / 5 / 10 / 20 bars forward, and set move thresholds. Results show the best indicator, average and confluence win-rates, total signals, and an equity curve of the simulated strategy.`,
  },

  liquidations: {
    title: 'Liquidations',
    body: `The Liquidations panel tracks forced liquidations across exchanges (Binance, Bybit, OKX) in real time — a powerful read on market stress and reversal zones.

It shows long vs short liquidation counts and volume, the rate per minute, long/short ratio, estimated total losses, and 1m/5m/15m breakdowns. HOT ZONES clusters liquidations by price level. A MARKET-PRESSURE badge reads CALM / WARNING / CRITICAL / PANIC. The 1-hour overview shows a long/short ratio bar and contribution per exchange (with duplicate detection), and a LIVE FEED streams each event (time, symbol, size, venue), filterable by exchange. It keeps accumulating even when closed, so pressure zones build up for you to spot reversals.`,
  },

  'market-metrics': {
    title: 'Market Metrics',
    body: `Market Metrics gathers the key macro numbers in one place. BTC metrics: FUNDING RATE (with next-settlement countdown), OPEN INTEREST (and 5m delta), ATR(14) 1h volatility, and the LONG/SHORT ratio. A live ORDER BOOK shows the bid/ask ladder and spread.

ZEUS S/R LEVELS auto-calculates support/resistance (Zeus High, Z3–Z1, DT/VWAP, PIVOT, DB, L1–L3, Zeus Low) with distance to price. ZEUS TRADER AI METRICS adds 1H / 4H / 12H / 1D / 1W tabs, each showing price, open interest, funding, L/S and RSI with their change and a signal. Everything is live and auto-refreshed — your macro context at a glance.`,
  },

  activity: {
    title: 'Activity',
    body: `The Activity Feed is a live, chronological log of everything Zeus does: positions opening/closing, signals firing, DSL activations, brain decisions, plus errors and warnings. Each entry shows the event type, timestamp and a summary; a counter badge shows the total.

A DEEP DIVE section ties events to the market context around them — regime shifts, liquidation clusters, macro anomalies — so you can see WHY something triggered at a given moment. It's the go-to panel for reviewing what happened and when.`,
  },

  aub: {
    title: 'Alien — System Diagnostics & Optimization',
    body: `Alien (the "Alien Upgrade Bay") is Zeus's self-diagnostics and tuning hub — it watches the app's OWN health and performance, not the market.

It reports: COMPATIBILITY (browser/API support), INPUT GUARD (validates control calls to prevent race conditions), RENDER ORCHESTRATOR (animation FPS + dropped frames), DECISION BLACKBOX (snapshots of trading decisions, exportable), MTF HIERARCHY (how 4h/1h/15m/5m are weighted), CORRELATION FIELD (BTC→ETH, BTC→SOL correlation + penalties), and a MACRO ANOMALY RADAR (economic events and their risk impact). Badges show COMPAT, PERF and data freshness (STALE / FRESH / SYNCED).

Its NIGHTLY SIM LAB runs backtests to suggest optimal Stop-Loss % and Risk:Reward, and every section has export/import/clear for deep tuning. Think of it as the engine bay where you check that Zeus itself is running clean and fast.`,
  },
}

export function PanelInfoButton({ infoKey }: { infoKey?: string | null }) {
  const [open, setOpen] = useState(false)
  const info = infoKey ? PANEL_INFO[infoKey] : null
  if (!info) return null

  return (
    <>
      <button
        type="button"
        aria-label={`About ${info.title}`}
        title="What is this panel?"
        onClick={() => setOpen(true)}
        style={{
          marginLeft: 'auto', marginRight: 4, width: 24, height: 24, borderRadius: '50%',
          border: '1.5px solid #ff2d95', background: 'rgba(255,45,149,0.12)', color: '#ff2d95',
          fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic', fontWeight: 700,
          fontSize: 15, lineHeight: '21px', cursor: 'pointer', flex: '0 0 auto', padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >i</button>

      {open && createPortal((
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 540, width: '100%', maxHeight: '80vh', overflowY: 'auto',
              background: '#000000', border: '1px solid rgba(255,45,149,0.45)', borderRadius: 12,
              boxShadow: '0 12px 48px rgba(0,0,0,0.6), 0 0 24px rgba(255,45,149,0.18)',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.08)', position: 'sticky', top: 0, background: '#000000',
            }}>
              <span style={{
                width: 22, height: 22, borderRadius: '50%', border: '1.5px solid #ff2d95',
                color: '#ff2d95', fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flex: '0 0 auto',
              }}>i</span>
              <span style={{ fontWeight: 700, color: '#e8eef6', fontSize: 15 }}>{info.title}</span>
              <button
                type="button" aria-label="Close" onClick={() => setOpen(false)}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#7a9ab8', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 4 }}
              >✕</button>
            </div>
            <div style={{ padding: '14px 18px', color: '#c5d2e0', fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {info.body}
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  )
}

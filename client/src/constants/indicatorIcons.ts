/**
 * Zeus Terminal — Dedicated per-indicator line-art icons.
 * [2026-06-16] Operator asked for a distinct, hand-drawn line glyph per indicator
 * (the clean `.z-i` SVG style, NOT recycled colored emoji). Each glyph evokes what
 * the indicator does. Rendered via dangerouslySetInnerHTML; styled by `svg.z-i` CSS
 * (currentColor stroke). Keyed by indicator id — falls back to the legacy emoji
 * if an id is missing here.
 */

const S = '<svg class="z-i" viewBox="0 0 16 16">'
const E = '</svg>'
/** one or more inner path/circle fragments → full svg string */
const g = (inner: string): string => S + inner + E
const p = (d: string): string => '<path d="' + d + '"/>'
const dot = (cx: number, cy: number, r = 1): string => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" stroke="none"/>`

export const IND_ICONS: Record<string, string> = {
  // ── Moving averages (each a line, distinguished by character) ──
  ema: g(p('M2 12C5 12 5 5 8 5s4 3 6 1')),                                  // smooth exponential curve
  sma: g(p('M2 12l3-2 3-2 3-2 3-1')),                                       // plain straight polyline
  wma: g(p('M2 13l4-3 4-4 4-4') + dot(14, 2, 1.3)),                          // weighted toward recent (end dot)
  hma: g(p('M2 11l3-5 3 4 3-6 3 3')),                                       // fast low-lag zigzag
  vwma: g(p('M2 6c3 0 4 3 6 2s4-2 6-2') + p('M3 14v-2M6 14v-3M9 14v-2M12 14v-3')), // line over volume bars
  // ── Trend systems ──
  st: g(p('M2 11h4V6h4v4h4')),                                              // supertrend step/flip
  psar: g(p('M2 12c4 0 8-2 12-7') + dot(4, 13) + dot(8, 11) + dot(12, 7)),    // curve + trailing dots
  adx: g(p('M2 13h12') + p('M4 13v-3M8 13v-6M12 13v-9')),                    // rising strength bars
  aroon: g(p('M2 13L14 3') + p('M2 3L14 13')),                              // up/down lines crossing
  ichimoku: g(p('M5 12a3 3 0 01-.5-6A4 4 0 0113 8a2.5 2.5 0 01-.5 4z')),     // cloud
  fib: g(p('M2 4h12M2 7h12M2 10h9M2 13h12')),                               // retracement levels
  pivot: g(p('M2 8h12') + p('M4 4h8M4 12h8')),                              // central pivot + S/R
  // ── Support / pivots end ──
  // ── Volatility / bands ──
  bb: g(p('M2 8c3-3 9 3 12 0') + p('M2 4c3-3 9 3 12 0') + p('M2 12c3-3 9 3 12 0')), // 3 envelope curves
  kc: g(p('M2 9l5-2 7 1') + p('M2 5l5-2 7 1') + p('M2 13l5-2 7 1')),          // tilted channel bands
  dc: g(p('M2 4h12v8H2z') + p('M2 8h12')),                                  // breakout box
  atr: g(p('M4 3v10M8 5v8M12 2v11')),                                       // true-range vertical bars
  // ── Momentum oscillators ──
  rsi14: g(p('M2 5h12M2 11h12') + p('M2 8c2-3 4 3 6 0s4-3 6 0')),            // wave between OB/OS lines
  stoch: g(p('M2 6c2-2 4 2 6 0s4-2 6 0') + p('M2 10c2-2 4 2 6 0s4-2 6 0')),   // %K / %D twin waves
  macd: g(p('M2 4c4 6 8 6 12 1') + p('M2 8c4 4 8 4 12 0') + p('M5 13v-2M8 13v-3M11 13v-1')), // 2 lines + histogram
  cci: g(p('M2 8h12') + p('M2 8l3-4 3 8 3-6 3 3')),                          // deviation from mean
  willr: g(p('M2 3h12') + p('M2 4c2 4 4-2 6 1s4 4 6 0')),                     // bounded near top
  roc: g(p('M2 13l11-8') + p('M9 5h4v4')),                                  // rate-of-change up arrow
  ao: g(p('M2 13h12') + p('M3 13v-3M6 13v-6M9 13v-4M12 13v-8')),             // momentum histogram
  trix: g(p('M2 8c1.4-3 2.8 3 4.2 0s2.8-3 4.2 0 2.8 3 3.4 0')),              // triple-smoothed wave
  uo: g(p('M5 3h6v2a3 3 0 01-6 0zM8 8v3M6 13h4') + p('M4 3h8')),             // trophy (ultimate)
  chop: g(p('M2 11l2-4 2 4 2-4 2 4 2-4 2 4')),                              // choppy saw
  // ── Volume family ──
  vp: g(p('M2 4h7M2 7h11M2 10h5M2 13h9')),                                  // horizontal volume profile
  obv: g(p('M2 12l3-1 3-3 3-1 3-4')),                                       // cumulative balance steps
  vwap: g(p('M2 12c4 0 8-8 12-8') + p('M3 14v-2M6 14v-2M9 14v-2M12 14v-2')),  // weighted avg over volume
  cvd: g(p('M2 8h3V5h3v6h3V7h2')),                                          // cumulative delta steps
  cmf: g(p('M2 10c3 0 4 3 6 2s4-4 6-2') + dot(8, 4, 1.3)),                    // money-flow drop
  mfi: g(p('M8 2v12') + p('M5 4c0-1.3 6-1.3 6 0s-6 .7-6 2 6 1.3 6 0')),       // money ($) flow
  // ── Invented: KERAUNOS (thunderbolt) + AETHER (squeeze: converging arrows) ──
  kera: g('<path d="M9 1L3 9h4l-1 6 7-9H9l1-5z" fill="currentColor" stroke="none"/>'),
  aether: g(p('M2 3l4 5-4 5') + p('M14 3l-4 5 4 5') + p('M8 5v6')),
  ms: g(p('M2 12l3-7 3 5 3-8 3 6')),                                       // market-structure zigzag
  nem: g(p('M4 7V3m0 0L2 5m2-2l2 2') + p('M12 9v4m0 0l2-2m-2 2l-2-2')),      // reversal: up + down arrows
  iris: g(p('M2 13a6 6 0 0112 0') + p('M4 13a4 4 0 018 0') + p('M6 13a2 2 0 014 0')), // rainbow arcs
  pythia: g(p('M8 2a6 6 0 100 12A6 6 0 008 2z') + dot(8, 8, 1.6)),            // oracle eye / crystal ball
  plutus: g(p('M8 2v12M8 4h-2a2 2 0 000 4h4a2 2 0 010 4H6') ),               // money flow ($ effort/result)
  helios: g(p('M8 5a3 3 0 100 6 3 3 0 000-6z') + p('M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M13 3l-1.4 1.4M4.4 11.6L3 13')), // sun / regime
  hermes: g(p('M3 3v3M3 13v-3M13 3v3M13 13v-3') + p('M2 6h3M2 10h3M11 6h3M11 10h3') + p('M6 8h4') + dot(8, 8, 0.8)), // imbalance gap between two candles
  charon: g(p('M2 5h12M2 11h12') + p('M9 5l2-2 2 2M5 11l-2 2-2-2')), // resting-liquidity levels swept up/down
  atlas: g(p('M8 14V5M8 5l-3 3M8 5l3 3') + p('M4 13l1.5-1.5M12 13l-1.5-1.5')), // acceleration / launch
  eos: g(p('M2 4l5 4 7-5') + p('M2 9l5 3 7-2')), // diverging lines (price up / momentum flat)
  pantheon: g(p('M2 5l6-3 6 3') + p('M3 5v7M6 5v7M10 5v7M13 5v7') + p('M2 13h12')), // temple columns (council)
  aegis: g(p('M8 1l5 2v5c0 4-3 6-5 7-2-1-5-3-5-7V3z') + p('M6 8l1.5 1.5L10 6')), // shield + check
  selene: g(p('M10 2a5 5 0 100 12A6 6 0 0110 2z') + p('M2 13c1.5-3 3-3 4.5 0')), // crescent moon over a tide wave
  kratos: g(p('M3 3l4 4M13 3l-4 4M3 13l4-4M13 13l-4-4') + p('M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z') + dot(8, 8, 0.8)), // command reticle / crosshair on target
  prometheus: g(p('M3 8h3') + p('M6 8l8-5M6 8l8 5') + p('M6 8l7-1M6 8l7 1')), // forward-opening forecast cone
  mnemosyne: g(p('M2 9c2 0 2-4 4-4s2 4 4 4') + p('M10 9c1.5 0 2-3 3.5-3') + dot(13.5, 6, 0.9)), // past wave continuing into a projected dot
  themis: g(p('M8 2v12M3 14h10') + p('M3 5h10') + p('M3 5L1.5 8.5h3zM13 5l-1.5 3.5h3z')), // scales of balance (equilibrium)
  erebus: g(p('M2 8h2l1-3 2 6 2-8 2 8 1-3h2')), // erratic/chaotic disordered signal
  anemoi: g(p('M3 13v-3M6 13v-6M9 13V3M12 13v-5') + p('M9 3l-1.5 1.5M9 3l1.5 1.5')), // volume bars with a spike gust
  cerberus: g(p('M3 11a2 2 0 104 0 2 2 0 00-4 0z') + p('M6 11a2 2 0 104 0 2 2 0 00-4 0z') + p('M9 11a2 2 0 104 0 2 2 0 00-4 0z') + p('M5 6l1-2 2 1 2-1 1 2')), // three guardian heads
  proteus: g(p('M2 8h3l1-5 2 10 2-9 1 4h3')), // sharp Fisher spikes
  typhon: g(p('M8 8m-1 0a1 1 0 102 0 1 1 0 10-2 0') + p('M8 8c3-3 5-1 4 2s-5 3-7 1-2-6 2-8 8-2 8 4')), // spiral storm
  styx: g(p('M2 6c2 0 2 2 4 2s2-2 4-2 2 2 4 2') + p('M8 8v5') + p('M6 13h4')), // waterline with price submerged below
  geras: g(p('M4 2h8M4 14h8') + p('M4 2c0 4 8 4 8 0M4 14c0-4 8-4 8 0') + p('M8 7v2')), // hourglass (time/age)
  // ── Support / pivots ──
  // ── Overlay/heatmap modals ──
  ovi: g(p('M8 2L4 9a4 4 0 008 0z')),                                       // liquid drop
  liq: g(p('M8 1l1.4 4 4-1-2.4 3.4 4 1.6-4 1 1 4-4-2.4L4 15l1-4-4-1 4-1.6L2.6 4l4 1z')), // burst
  zs: g(p('M2 12h12L12 5l-2 3-2-4-2 4-2-3z')),                              // crown (supremus)
  sr: g(p('M2 5h12M2 11h12') + p('M2 8h6')),                               // support/resistance levels
  llv: g(p('M8 1c0 3-3 4-3 7a3 3 0 006 0c0-2-1-3-2-4-1 2-2 4-2 6')),         // large-liq fire
}

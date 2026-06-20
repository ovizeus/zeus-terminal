import { devInjectSignal, devInjectLiquidation, devInjectWhale, devFeedDisconnect, devFeedRecover, devTriggerKillSwitch, devResetProtect, devReplayStart, devReplayStop, devClearLog, devExportLog } from '../../utils/dev'
// [UI-COMPACT 2026-06-06] QexitRiskStrip moved to NovaPanel.tsx together with
// its host section (#scenario-sec).
import { NeuralDataStream } from './NeuralDataStream'

export function AnalysisSections() {
  return (
    <>
      {/* ===== RSI MULTI-TIMEFRAME ===== */}
      <div className="sec">
        <div className="slbl">
          <span>&#9889; RSI MULTI-TIMEFRAME</span>
          <span id="rsiupd" style={{ fontSize: '7px', color: 'var(--dim)' }}></span>
        </div>
        <div className="rsig">
          <div className="rsic rsinow">
            <div className="rsitf">NOW (5m)</div>
            <div className="rsiv mid" id="rn">&mdash;</div>
            <div className="rsibw">
              <div className="rsib" id="rb0" style={{ width: '50%', background: 'var(--ylw)' }}></div>
            </div>
          </div>
          <div className="rsic">
            <div className="rsitf">15m</div>
            <div className="rsiv mid" id="r15">&mdash;</div>
            <div className="rsibw">
              <div className="rsib" id="rb1" style={{ width: '50%', background: 'var(--ylw)' }}></div>
            </div>
          </div>
          <div className="rsic">
            <div className="rsitf">1h</div>
            <div className="rsiv mid" id="r1h">&mdash;</div>
            <div className="rsibw">
              <div className="rsib" id="rb2" style={{ width: '50%', background: 'var(--ylw)' }}></div>
            </div>
          </div>
          <div className="rsic">
            <div className="rsitf">3h</div>
            <div className="rsiv mid" id="r3h">&mdash;</div>
            <div className="rsibw">
              <div className="rsib" id="rb3" style={{ width: '50%', background: 'var(--ylw)' }}></div>
            </div>
          </div>
          <div className="rsic">
            <div className="rsitf">4h</div>
            <div className="rsiv mid" id="r4h">&mdash;</div>
            <div className="rsibw">
              <div className="rsib" id="rb4" style={{ width: '50%', background: 'var(--ylw)' }}></div>
            </div>
          </div>
          <div className="rsic">
            <div className="rsitf">1d</div>
            <div className="rsiv mid" id="r1d">&mdash;</div>
            <div className="rsibw">
              <div className="rsib" id="rb5" style={{ width: '50%', background: 'var(--ylw)' }}></div>
            </div>
          </div>
        </div>
      </div>

      {/* ===== FEAR & GREED INDEX ===== */}
      <div className="sec">
        <div className="slbl">&#128561; FEAR &amp; GREED INDEX</div>
        <div className="fgw">
          <div className="fgc">
            <svg viewBox="0 0 70 70" width="70" height="70">
              <circle cx="35" cy="35" r="28" fill="none" stroke="#1e2530" strokeWidth="8" />
              <circle
                cx="35" cy="35" r="28" fill="none" stroke="#f0c040" strokeWidth="8"
                strokeDasharray="175.93" strokeDashoffset="175.93" id="fgarc"
                strokeLinecap="round" transform="rotate(-90 35 35)"
                style={{ transition: 'stroke-dashoffset 1s, stroke 1s' }}
              />
            </svg>
            <div className="fgn" id="fgval">&mdash;</div>
          </div>
          <div className="fgi">
            <div className="fgl" id="fglbl" style={{ color: 'var(--ylw)' }}>Loading...</div>
            <div className="fgsub" id="fgsub">Crypto sentiment</div>
            <div className="fgbar">
              <div className="fgf" id="fgf" style={{ width: '50%', background: 'var(--ylw)' }}></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '7px', marginTop: '2px', color: 'var(--dim)' }}>
              <span>FEAR</span><span>GREED</span>
            </div>
            <div className="fgsub" id="fgch" style={{ marginTop: '3px' }}>Yesterday: &mdash; | Week: &mdash;</div>
          </div>
        </div>
      </div>

      {/* ===== NEURAL DATA STREAM (relocated here, always visible) ===== */}
      <NeuralDataStream />

      {/* [UI-COMPACT 2026-06-13] BTC MARKET METRICS + BTC ORDER BOOK — LIVE moved
          1:1 into MarketMetricsPanel.tsx (Market Metrics dock page, between
          Liquidations and Activity) — operator wants the home scroll shorter.
          bootstrapInit mvSec('#frv')/mvSec('#askc') removed in the same change. */}

      {/* [UI-COMPACT 2026-06-06] LIQUIDITY MAGNET — RADAR (magSec) moved 1:1
          into ARIAPanel.tsx (ARIA dock page) — same pattern; bootstrapInit
          mv() removed in pair. */}

      {/* [UI-COMPACT 2026-06-06] MULTI-SYMBOL SCANNER (mscanSec) + SIGNAL
          SCANNER (sigScanSec) moved 1:1 into AdaptivePanel.tsx (Adaptive dock
          page) — same pattern; bootstrapInit mv()'s removed in pair. */}

      {/* [UI-COMPACT 2026-06-06] DAY / HOUR WIN RATE FILTER moved 1:1 into
          SignalRegistryPanel.tsx (Signals dock page) — operator wants the home
          scroll shorter. bootstrapInit.ts mv('dhfSec') removed in the same
          change so the boot mover can't yank it back out of the panel. */}

      {/* [UI-COMPACT 2026-06-06] PERFORMANCE TRACKER (perfSec) + BACKTEST
          ENGINE (btSec) moved 1:1 into SignalRegistryPanel.tsx (Signals dock
          page, under DAY/HOUR) — same operation as dhfSec; bootstrapInit
          mv('perfSec')/mv('btSec') removed in the same change. */}

      {/* [UI-COMPACT 2026-06-13] ZeuS S/R LEVELS — AUTO (.srgrid) moved 1:1 into
          MarketMetricsPanel.tsx (Market Metrics dock page) — same pattern;
          bootstrapInit mvSec('.srgrid') removed in pair. */}

      {/* [UI-COMPACT 2026-06-07] LIQUIDATIONS MONITOR moved 1:1 into
          LiquidationsPanel.tsx (dedicated Liquidations dock page) — same
          pattern; bootstrapInit mvSec(".lmcs") removed in pair. */}

      {/* [UI-COMPACT 2026-06-13] ZEUS TRADER — AI METRICS (.dttabs + .dttbl) moved
          1:1 into MarketMetricsPanel.tsx (Market Metrics dock page) and the dead
          1H/4H/12H/1D/1W tabs re-wired to setDtTf (per-tf PRICE change). Paired:
          bootstrapInit mvSec('.dttabs') removed so the boot mover can't yank it out. */}

      {/* ===== CONFLUENCE SCORE — ZEUS AI ===== */}
      <div className="sec">
        <div className="slbl">CONFLUENCE SCORE &mdash; ZEUS AI</div>
        <div className="conf-widget">
          <div className="conf-row">
            <div>
              <div className="conf-score" id="confScore" style={{ color: 'var(--dim)' }}>&mdash;</div>
              <div className="conf-label" id="confLabel">WAITING DATA</div>
            </div>
            <div style={{ flex: 1, paddingLeft: '12px' }}>
              <div style={{ fontSize: '7px', color: 'var(--dim)', letterSpacing: '1px', marginBottom: '4px' }}>CONFLUENTA</div>
              <div className="conf-meter">
                <div className="conf-fill" id="confFill" style={{ width: '0%', background: '#555' }}></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '6px', color: 'var(--dim)', marginTop: '2px' }}>
                <span>BEAR</span><span>NEUTRAL</span><span>BULL</span>
              </div>
            </div>
          </div>
          <div className="conf-bars" id="confBars" style={{ marginTop: '8px' }}>
            <div className="conf-bar-item">
              <div className="conf-bar-bg">
                <div className="conf-bar-f" id="cbRSI" style={{ width: '0%', background: '#f5c842' }}></div>
              </div>
              <span style={{ color: 'var(--dim)', minWidth: '28px' }}>RSI</span>
            </div>
            <div className="conf-bar-item">
              <div className="conf-bar-bg">
                <div className="conf-bar-f" id="cbMACD" style={{ width: '0%', background: '#00e5ff' }}></div>
              </div>
              <span style={{ color: 'var(--dim)', minWidth: '36px' }}>MACD</span>
            </div>
            <div className="conf-bar-item">
              <div className="conf-bar-bg">
                <div className="conf-bar-f" id="cbST" style={{ width: '0%', background: '#ff8800' }}></div>
              </div>
              <span style={{ color: 'var(--dim)', minWidth: '28px' }}>ST</span>
            </div>
            <div className="conf-bar-item">
              <div className="conf-bar-bg">
                <div className="conf-bar-f" id="cbLS" style={{ width: '0%', background: '#aa44ff' }}></div>
              </div>
              <span style={{ color: 'var(--dim)', minWidth: '28px' }}>L/S</span>
            </div>
            <div className="conf-bar-item">
              <div className="conf-bar-bg">
                <div className="conf-bar-f" id="cbFR" style={{ width: '0%', background: '#f0c040' }}></div>
              </div>
              <span style={{ color: 'var(--dim)', minWidth: '28px' }}>FR</span>
            </div>
            <div className="conf-bar-item">
              <div className="conf-bar-bg">
                <div className="conf-bar-f" id="cbOI" style={{ width: '0%', background: '#00b8d4' }}></div>
              </div>
              <span style={{ color: 'var(--dim)', minWidth: '28px' }}>OI</span>
            </div>
          </div>
        </div>
      </div>

      {/* [UI-COMPACT 2026-06-07] LIQUIDATION OVERVIEW + LIVE FEED moved 1:1
          into LiquidationsPanel.tsx — bootstrapInit mvSec("#tv")/mvSec(".fdlist")
          removed in pair. */}

      {/* ===== TICKER WIDGET ===== */}
      {/* ===== DEVELOPER MODE — TEST HARNESS ===== */}
      {/* [UI-COMPACT 2026-06-06] DEEP DIVE — MARKET CONTEXT (deepdive-sec)
          moved 1:1 into ActivityFeedPanel.tsx (Activity dock page) — same
          pattern; bootstrapInit mv() removed in pair. */}

      {/* [UI-COMPACT 2026-06-06] SCENARIO ENGINE (scenario-sec + QexitRiskStrip)
          + CYCLE INTELLIGENCE (macro-sec) moved 1:1 into NovaPanel.tsx (Nova
          dock page) — same pattern; bootstrapInit mv()'s removed in pair. */}

      {/* ===== ADAPTIVE CONTROL — hidden here, rendered inside dock AdaptivePanel ===== */}
      <div className="sec" id="adaptive-sec" style={{ display: 'none' }}>
        <div className="slbl" style={{ justifyContent: 'space-between' }}>
          <span>ADAPTIVE CONTROL</span>
          <span id="adaptive-last-upd" style={{ fontSize: '8px', color: 'var(--dim)' }}></span>
        </div>
        <div style={{ padding: '8px 12px' }}>
          <div style={{ marginBottom: '8px' }}>
            <button id="adaptiveToggleBtn" onClick={() => (window as any).toggleAdaptive?.()} style={{ width: '100%', padding: '6px 10px', fontSize: '10px', fontFamily: 'var(--ff)', letterSpacing: '1px', background: '#0a1220', border: '1px solid #2a3a4a', color: '#778899', borderRadius: '3px', cursor: 'pointer', transition: 'all .2s' }}>
              ADAPTIVE OFF
            </button>
            <div style={{ fontSize: '8px', color: 'var(--dim)', marginTop: '4px', lineHeight: 1.6 }}>
              OFF = all multipliers &times;1.00, engine reads nothing.<br />
              Min 30 trades/bucket to activate multipliers.
            </div>
          </div>
          <div id="adaptive-mults-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: '3px', fontSize: '9px', background: '#0a1520', border: '1px solid #1a2a3a', borderRadius: '3px', padding: '6px 10px', marginBottom: '8px' }}>
            <span style={{ color: 'var(--dim)' }}>ENTRY</span><span style={{ color: '#778899', fontWeight: 700 }}>&times;1.00</span>
            <span style={{ color: 'var(--dim)' }}>SIZE</span><span style={{ color: '#778899', fontWeight: 700 }}>&times;1.00</span>
            <span style={{ color: 'var(--dim)' }}>EXIT</span><span style={{ color: '#778899', fontWeight: 700 }}>&times;1.00</span>
          </div>
          <div style={{ fontSize: '8px', letterSpacing: '1.5px', color: 'var(--dim)', marginBottom: '3px' }}>BUCKETS (regime|profile|vol)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 42px 42px 48px', gap: '3px', fontSize: '8px', color: '#445566', marginBottom: '3px', padding: '0 0 2px 0', borderBottom: '1px solid #1a2530' }}>
            <span>BUCKET</span><span>TRADES</span><span>WR</span><span>MULT</span>
          </div>
          <div id="adaptive-bucket-table" style={{ maxHeight: '120px', overflowY: 'auto', fontSize: '8px', color: '#6a8090' }}>
            <div style={{ color: 'var(--dim)', padding: '4px 0' }}>No trade with context yet.</div>
          </div>
        </div>
      </div>

      <div className="sec" id="dev-sec" style={{ display: 'none' }}>
        <div className="slbl" style={{ justifyContent: 'space-between' }}>
          <span>DEVELOPER MODE — TEST HARNESS</span>
          <span id="dev-upd" style={{ fontSize: '7px', color: '#aa88ff' }}></span>
        </div>
        <div className="dev-content" id="dev-content">
          <div className="dev-section">
            <div className="dev-title">INJECT EVENTS</div>
            <div className="dev-buttons">
              <button className="dev-btn" onClick={() => devInjectSignal('LONG')}>LONG SIGNAL</button>
              <button className="dev-btn" onClick={() => devInjectSignal('SHORT')}>SHORT SIGNAL</button>
              <button className="dev-btn" onClick={() => devInjectLiquidation('LONG')}>LIQ LONG</button>
              <button className="dev-btn" onClick={() => devInjectLiquidation('SHORT')}>LIQ SHORT</button>
              <button className="dev-btn" onClick={() => devInjectWhale()}>FAKE WHALE</button>
              <button className="dev-btn" onClick={() => devFeedDisconnect()}>FEED DISCONNECT</button>
              <button className="dev-btn" onClick={() => devFeedRecover()}>FEED RECOVER</button>
              <button className="dev-btn" onClick={() => devTriggerKillSwitch()}>KILL SWITCH</button>
              <button className="dev-btn" onClick={() => devResetProtect()}>RESET PROTECT</button>
            </div>
          </div>
          <div className="dev-section">
            <div className="dev-title">EVENT LOG (last 50)</div>
            <div className="dev-log" id="dev-log">
              <div className="dev-log-empty">No events yet. Use buttons above to simulate.</div>
            </div>
            <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
              <button className="dev-btn small" onClick={() => devClearLog()}>CLEAR LOG</button>
              <button className="dev-btn small" onClick={() => devExportLog()}>EXPORT CSV</button>
            </div>
          </div>
          <div className="dev-section">
            <div className="dev-title">REPLAY MODE (log-only viewer)</div>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <button className="dev-btn small" onClick={() => devReplayStart()}>▶ START</button>
              <button className="dev-btn small" onClick={() => devReplayStop()}>■ STOP</button>
              <span style={{ color: 'var(--dim)', fontSize: '7px' }} id="dev-replay-status">Idle</span>
            </div>
            <div style={{ marginTop: '4px', fontSize: '7px', color: 'var(--dim)' }}>
              <input type="number" id="dev-replay-speed" defaultValue={1} min={0.1} max={10} step={0.1}
                style={{ width: '50px', background: '#0a121a', border: '1px solid #2a3a4a', color: '#aaccff', padding: '2px 4px', borderRadius: '2px', fontFamily: 'var(--ff)' }} />
              × speed
            </div>
          </div>
        </div>
      </div>

      <div className="tickw">
        <div className="tick" id="ticker">
          <span className="ti">ZeuS Terminal loading...</span>
          <span className="ti">ZeuS Terminal loading...</span>
        </div>
      </div>
    </>
  );
}

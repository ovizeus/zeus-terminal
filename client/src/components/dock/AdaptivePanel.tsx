import { useBrainStore } from '../../stores'
import { toggleAdaptive } from '../../trading/risk'

/** Adaptive Control dock page view — 1:1 from #adaptive-sec in index.html lines 4435-4471 */
export function AdaptivePanel() {
  const adaptiveOn = useBrainStore((s) => !!s.brain.adaptive?.enabled)

  return (
    <>
    <div className="sec" id="adaptive-sec">
      <div className="slbl" style={{ justifyContent: 'space-between' }}>
        <span>ADAPTIVE CONTROL</span>
        <span id="adaptive-last-upd" style={{ fontSize: '8px', color: 'var(--dim)' }}></span>
      </div>
      <div style={{ padding: '8px 12px' }}>
        {/* Toggle button */}
        <div style={{ marginBottom: '8px' }}>
          {/* [O17] id removed — duplicate with AnalysisSections.tsx legacy
              mirror caused getElementById to update the hidden node and
              skip this visible one. AdaptivePanel uses Zustand subscription
              + React onClick; no id needed. Legacy mirror keeps its id
              for _adaptLoad's restore path (display:none, not user-facing). */}
          <button onClick={() => {
            toggleAdaptive()
            // brainStore is canonical; engine writes directly via mutators
          }} style={{
            width: '100%', padding: '6px 10px', fontSize: '10px', fontFamily: 'var(--ff)', letterSpacing: '1px',
            background: adaptiveOn ? '#0a2a1a' : '#0a1220',
            border: `1px solid ${adaptiveOn ? '#00ffcc44' : '#2a3a4a'}`,
            color: adaptiveOn ? '#00ffcc' : '#778899', borderRadius: '3px',
            cursor: 'pointer', transition: 'all .2s'
          }}>
            {adaptiveOn ? 'ADAPTIVE ON' : 'ADAPTIVE OFF'}
          </button>
          <div style={{ fontSize: '8px', color: 'var(--dim)', marginTop: '4px', lineHeight: 1.6 }}>
            OFF = all multipliers &times;1.00, engine reads nothing.<br />
            Min 30 trades/bucket to activate multipliers.
          </div>
        </div>
        {/* Active multipliers row */}
        <div id="adaptive-mults-row" style={{
          display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: '3px', fontSize: '9px',
          background: '#0a1520', border: '1px solid #1a2a3a', borderRadius: '3px', padding: '6px 10px', marginBottom: '8px'
        }}>
          <span style={{ color: 'var(--dim)' }}>ENTRY</span><span style={{ color: '#778899', fontWeight: 700 }}>&times;1.00</span>
          <span style={{ color: 'var(--dim)' }}>SIZE</span><span style={{ color: '#778899', fontWeight: 700 }}>&times;1.00</span>
          <span style={{ color: 'var(--dim)' }}>EXIT</span><span style={{ color: '#778899', fontWeight: 700 }}>&times;1.00</span>
        </div>
        {/* Bucket table */}
        <div style={{ fontSize: '8px', letterSpacing: '1.5px', color: 'var(--dim)', marginBottom: '3px' }}>BUCKETS (regime|profile|vol)</div>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 42px 42px 48px', gap: '3px', fontSize: '8px', color: '#445566',
          marginBottom: '3px', padding: '0 0 2px 0', borderBottom: '1px solid #1a2530'
        }}>
          <span>BUCKET</span><span>TRADES</span><span>WR</span><span>MULT</span>
        </div>
        <div id="adaptive-bucket-table" style={{ maxHeight: '120px', overflowY: 'auto', fontSize: '8px', color: '#6a8090' }}>
          <div style={{ color: 'var(--dim)', padding: '4px 0' }}>No trade with context yet.</div>
        </div>
      </div>
    </div>

    {/* ===== MULTI-SYMBOL SCANNER — LIVE =====
        [UI-COMPACT 2026-06-06] Moved 1:1 from AnalysisSections.tsx (home
        scroll zone) — operator wants the home shorter and Adaptive was nearly
        empty. Filled by legacy JS via getElementById (#mscanBody etc.), SCAN
        button calls window.runMultiSymbolScan — position-agnostic. Paired
        change: bootstrapInit.ts no longer mv()'s #mscanSec. */}
    <div className="sec" id="mscanSec">
      <div className="slbl" style={{ justifyContent: 'space-between' }}>
        <span>MULTI-SYMBOL SCANNER &mdash; LIVE</span>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <span id="mscanUpdTime" style={{ fontSize: '7px', color: 'var(--dim)' }}>&mdash;</span>
          <span id="mscanOpps" style={{ fontSize: '7px', color: '#00ff88' }}>0 oportunitati</span>
          <button
            style={{
              fontSize: '7px', padding: '2px 7px', border: '1px solid #00b8d433',
              borderRadius: '2px', background: 'transparent', color: '#00b8d4',
              cursor: 'pointer', fontFamily: 'var(--ff)'
            }}
            onClick={() => (window as any).runMultiSymbolScan?.()}
          >&#8634; SCAN</button>
        </div>
      </div>
      <div className="mscan-wrap">
        <table className="mscan-table">
          <thead>
            <tr>
              <th>SYM</th>
              <th>PRICE</th>
              <th>24H</th>
              <th>RSI(5m)</th>
              <th>MACD</th>
              <th>S.TREND</th>
              <th>ADX</th>
              <th>SCORE</th>
              <th>SIGNAL</th>
              <th>ACTION</th>
            </tr>
          </thead>
          <tbody id="mscanBody">
            <tr>
              <td colSpan={10} style={{ textAlign: 'center', padding: '16px', color: 'var(--dim)', fontSize: '8px' }}>
                Press SCAN or wait for Auto Trade to start...
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    {/* ===== SIGNAL SCANNER =====
        [UI-COMPACT 2026-06-06] Moved 1:1 from AnalysisSections.tsx — filled by
        legacy JS via getElementById (#megaSigBox/#sigGrid), position-agnostic.
        Paired change: bootstrapInit.ts no longer mv()'s #sigScanSec. */}
    <div className="sec sig-scan" id="sigScanSec">
      <div className="sig-hdr">
        <span>SIGNAL SCANNER</span>
        <span id="sigScanTime" style={{ fontSize: '7px', color: 'var(--dim)' }}></span>
      </div>
      <div id="megaSigBox"></div>
      <div className="sig-grid" id="sigGrid">
        <div className="sig-row" style={{ justifyContent: 'center', padding: '14px', color: 'var(--dim)', fontSize: '8px' }}>Calculating signals...</div>
      </div>
    </div>
    </>
  )
}

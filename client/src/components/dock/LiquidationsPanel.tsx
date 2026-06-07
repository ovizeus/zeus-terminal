/** Liquidations dock page view — [UI-COMPACT 2026-06-07]
 *  LIQUIDATIONS MONITOR + LIQUIDATION OVERVIEW + LIVE FEED moved 1:1 from
 *  AnalysisSections.tsx (home scroll zone) into a dedicated dock icon —
 *  operator request, right after the liq feed revival (allLiquidation/OKX
 *  fixes) made these widgets live again.
 *
 *  All three are filled by legacy JS strictly via getElementById
 *  (updLiqStats/renderFeed/updLiqSourceMetrics in marketDataWS.ts +
 *  renderHotZones/updMarketPressure) — position-agnostic; dock panel
 *  wrappers stay in the DOM at all times (only CSS-hidden), so the counters
 *  keep accumulating with the panel closed.
 *  Paired change: bootstrapInit.ts no longer mvSec()'s .lmcs / #tv / .fdlist.
 */

export function LiquidationsPanel() {
  return (
    <>
    {/* ===== LIQUIDATIONS MONITOR ===== */}
    <div className="sec">
      <div className="slbl">
        <span>&#128165; LIQUIDATIONS MONITOR</span>
        <span id="calm" style={{ fontSize: '8px', padding: '1px 6px', borderRadius: '2px', background: '#1a1a1a', color: 'var(--dim)' }}>CALM</span>
      </div>
      <div className="lmcs">
        <div className="lmc lc">
          <div className="lmcl">LONG LIQS</div>
          <div className="lmcv cr" id="llc">0</div>
          <div className="lmcs2" id="llu">$0</div>
          <div className="lmcs2" id="lla">avg: &mdash;</div>
        </div>
        <div className="lmc sc">
          <div className="lmcl">SHORT LIQS</div>
          <div className="lmcv cgr" id="lsc">0</div>
          <div className="lmcs2" id="lsu">$0</div>
          <div className="lmcs2" id="lsa">avg: &mdash;</div>
        </div>
        <div className="lmc rc">
          <div className="lmcl">RATE</div>
          <div className="lmcv cg" id="lrate">0</div>
          <div className="lmcs2">per minute</div>
          <div className="lmcs2" id="lratio">&mdash;</div>
        </div>
        <div className="lmc ec">
          <div className="lmcl">EST. LOSSES</div>
          <div className="lmcv cr" id="lloss">$0</div>
          <div className="lmcs2">Total USD session</div>
        </div>
      </div>
      <div className="lmtf">
        <div>
          <span style={{ color: 'var(--dim)' }}>1m:</span>
          <span className="L" id="t1l"> 0L</span>
          <span className="S" id="t1s"> 0S</span>
          <span className="V" id="t1v"> $0</span>
        </div>
        <div>
          <span style={{ color: 'var(--dim)' }}>5m:</span>
          <span className="L" id="t5l"> 0L</span>
          <span className="S" id="t5s"> 0S</span>
          <span className="V" id="t5v"> $0</span>
        </div>
        <div>
          <span style={{ color: 'var(--dim)' }}>15m:</span>
          <span className="L" id="t15l"> 0L</span>
          <span className="S" id="t15s"> 0S</span>
          <span className="V" id="t15v"> $0</span>
        </div>
      </div>
      <div className="hz">
        <div className="hzt">&#128293; HOT ZONES &mdash; BTC LIQ CLUSTERS</div>
        <div id="hzc">
          <div style={{ fontSize: '9px', color: 'var(--dim)', textAlign: 'center', padding: '10px' }}>Accumulating data...</div>
        </div>
      </div>
      <div className="pr">
        <span style={{ fontSize: '8px', letterSpacing: '1.5px', color: 'var(--txt)', fontWeight: 600 }}>MARKET PRESSURE</span>
        <div className="pvv neut" id="pvv">NEUTRAL</div>
      </div>
    </div>

    {/* ===== LIQUIDATION OVERVIEW ===== */}
    <div className="sec">
      <div className="slbl">&#127777;&#65039; LIQUIDATION OVERVIEW</div>
      <div className="s4">
        <div className="st">
          <div className="stl">TOTAL 1H</div>
          <div className="stv cb" id="tv">$0</div>
        </div>
        <div className="st">
          <div className="stl">LONGS LIQ</div>
          <div className="stv cr" id="lv">$0</div>
        </div>
        <div className="st">
          <div className="stl">SHORTS LIQ</div>
          <div className="stv cgr" id="sv">$0</div>
        </div>
        <div className="st">
          <div className="stl">COUNT</div>
          <div className="stv cw" id="cv">0</div>
        </div>
      </div>
      <div className="hmw">
        <div className="hmg" id="hmg"></div>
        <div className="rbar">
          <div className="rfill" id="rfill" style={{ width: '50%' }}></div>
        </div>
        <div className="rlbl">
          <span id="lplbl">LONG 50%</span>
          <span id="splbl">SHORT 50%</span>
        </div>
      </div>
      {/* LIQ SOURCE METRICS */}
      <div className="liq-src-panel">
        <div className="liq-src-hdr">SOURCE CONTRIBUTION</div>
        <div className="liq-src-grid">
          <div className="liq-src-col">
            <div className="liq-src-lbl" style={{ color: 'var(--grn)' }}>BNB</div>
            <div className="liq-src-val" id="lm-bnb-cnt">0</div>
            <div className="liq-src-sub" id="lm-bnb-usd">$0</div>
            <div className="liq-src-pct" id="lm-bnb-pct">0%</div>
          </div>
          <div className="liq-src-col">
            <div className="liq-src-lbl" style={{ color: 'var(--ylw)' }}>BYB</div>
            <div className="liq-src-val" id="lm-byb-cnt">0</div>
            <div className="liq-src-sub" id="lm-byb-usd">$0</div>
            <div className="liq-src-pct" id="lm-byb-pct">0%</div>
          </div>
          <div className="liq-src-col">
            <div className="liq-src-lbl" style={{ color: 'var(--blu)' }}>OKX</div>
            <div className="liq-src-val" id="lm-okx-cnt">0</div>
            <div className="liq-src-sub" id="lm-okx-usd">$0</div>
            <div className="liq-src-pct" id="lm-okx-pct">0%</div>
          </div>
          <div className="liq-src-col">
            <div className="liq-src-lbl" style={{ color: 'var(--dim)' }}>LAST</div>
            <div className="liq-src-val" id="lm-last-src">&mdash;</div>
            <div className="liq-src-sub">DUP?</div>
            <div className="liq-src-pct" id="lm-dup-cnt">0</div>
          </div>
        </div>
      </div>
    </div>

    {/* ===== LIVE FEED ===== */}
    <div className="sec">
      <div className="fdh">
        <span>&#9889; LIVE FEED</span>
        <span id="fcnt">0 events</span>
      </div>
      <div className="liq-filter-bar">
        <button className="liq-fbtn act" id="lf-all" onClick={() => (window as any).setLiqSrcFilter?.('all')}>ALL</button>
        <button className="liq-fbtn" id="lf-bnb" onClick={() => (window as any).setLiqSrcFilter?.('bnb')}>BNB</button>
        <button className="liq-fbtn" id="lf-byb" onClick={() => (window as any).setLiqSrcFilter?.('byb')}>BYB</button>
        <button className="liq-fbtn" id="lf-okx" onClick={() => (window as any).setLiqSrcFilter?.('okx')}>OKX</button>
      </div>
      <div className="feed">
        <div className="fdlist" id="fdlist"></div>
      </div>
    </div>
    </>
  )
}

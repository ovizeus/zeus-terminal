export function ARIAPanel() {
  return (
    <div className="aria-panel" id="aria-panel">
      <div className="aria-cols">
        <div>{/* left col */}
          <div className="aria-col-hdr">PATTERN</div>
          <div className="aria-svg-wrap">
            <svg id="aria-psvg" className="aria-psvg" viewBox="0 0 80 48" preserveAspectRatio="none"></svg>
          </div>
          <div className="aria-pname" id="aria-pname">&mdash;</div>
          <div className="aria-meta">
            <span className="aria-lbl">TF</span><span id="aria-ptf">&mdash;</span>
            <span className="aria-lbl">CONF</span><span id="aria-pconf">&mdash;</span>
          </div>
        </div>
        <div className="aria-col-r">{/* right col */}
          <div className="aria-col-hdr">CANDLE</div>
          <div className="aria-cline"><span className="aria-lbl">Type:</span><span id="aria-ctype">&mdash;</span></div>
          <div className="aria-cline"><span className="aria-lbl">Vol:</span><span id="aria-cvol">&mdash;</span></div>
          <div className="aria-col-hdr" style={{ marginTop: 7 }}>MTF STACK</div>
          <div id="aria-mtf" className="aria-mtf"></div>
        </div>
      </div>
      <div className="aria-verdict-row">
        <span id="aria-verdict" className="aria-verdict">WATCH</span>
        <span id="aria-verdict-txt" className="aria-verdict-txt">Waiting for data&hellip;</span>
      </div>
      {/* Fix 5 v92: MTF context + vol regime hint -- read-only advisory */}
      <div
        id="aria-ctx-hint"
        style={{ fontSize: 8, color: '#00ffcc33', letterSpacing: 1, padding: '4px 0 2px', minHeight: 10 }}
      ></div>
      {/* Fix 5 v93: MTF score + VOL regime dedicated rows (GPT spec) */}
      <div style={{ display: 'flex', gap: 10, padding: '2px 0 4px', fontSize: 8, color: '#00ffcc44', letterSpacing: 1 }}>
        <span>MTF score: <span id="aria-mtfscore" style={{ color: '#00ffcc88' }}>&mdash;</span></span>
        <span>VOL: <span id="aria-volreg" style={{ color: '#00ffcc88' }}>&mdash;</span></span>
      </div>
      {/* v94: Trap rate + Magnet bias -- permanent display from BM.liqCycle */}
      <div style={{ display: 'flex', gap: 10, padding: '2px 0 4px', fontSize: 8, color: '#00ffcc44', letterSpacing: 1 }}>
        <span>Trap rate: <span id="aria-traprate" style={{ color: '#00ffcc88' }}>&mdash;</span></span>
        <span>Magnet: <span id="aria-magnet" style={{ color: '#00ffcc88' }}>&mdash;</span></span>
      </div>
      {/* Pattern history (last 5 detections) */}
      <div className="aria-col-hdr" style={{ marginTop: 4, fontSize: 7, opacity: 0.5 }}>RECENT PATTERNS</div>
      <div id="aria-history" style={{ fontSize: 8, color: '#00ffcc55', maxHeight: 52, overflow: 'hidden', padding: '1px 0' }}>
      </div>
    </div>
  );
}

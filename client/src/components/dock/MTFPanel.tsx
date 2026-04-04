export function MTFPanel() {
  return (
    <div id="mtf-strip-panel">
      <div className="mtf-row"><span className="mtf-lbl">REGIME</span><span className="mtf-val" id="mtf-regime">—</span></div>
      <div className="mtf-row"><span className="mtf-lbl">STRUCTURE</span><span className="mtf-val" id="mtf-structure">—</span></div>
      <div className="mtf-row"><span className="mtf-lbl">ATR%</span><span className="mtf-val" id="mtf-atr">—</span></div>
      <div className="mtf-row"><span className="mtf-lbl">VOL MODE</span><span className="mtf-val" id="mtf-vol">—</span></div>
      <div className="mtf-row"><span className="mtf-lbl">SQUEEZE</span><span className="mtf-val" id="mtf-squeeze">—</span></div>
      <div className="mtf-row"><span className="mtf-lbl">ADX</span><span className="mtf-val" id="mtf-adx">—</span></div>
      <div className="mtf-row"><span className="mtf-lbl">VOL REGIME</span><span className="mtf-val" id="mtf-vol-regime">—</span></div>
      <div className="mtf-row"><span className="mtf-lbl">VOL PERCENTILĂ</span><span className="mtf-val" id="mtf-vol-pct">—</span></div>
      <div style={{ height: '1px', background: '#00d9ff0a', margin: '4px 0' }}></div>
      <div className="mtf-row"><span className="mtf-lbl">SWEEP</span><span className="mtf-val" id="mtf-sweep">—</span></div>
      <div className="mtf-row"><span className="mtf-lbl">TRAP RATE</span><span className="mtf-val" id="mtf-trap-rate">—</span></div>
      <div className="mtf-row"><span className="mtf-lbl">MAGNET ↑</span><span className="mtf-val" id="mtf-mag-above">—</span></div>
      <div className="mtf-row"><span className="mtf-lbl">MAGNET ↓</span><span className="mtf-val" id="mtf-mag-below">—</span></div>
      <div className="mtf-row"><span className="mtf-lbl">MAG BIAS</span><span className="mtf-val" id="mtf-mag-bias">—</span></div>
      <div style={{ height: '1px', background: '#00d9ff0a', margin: '4px 0' }}></div>
      <div className="mtf-row"><span className="mtf-lbl">MTF ALIGN</span>
        <div className="mtf-tf-row" id="mtf-tf-badges">
          <span className="mtf-tf-badge neut" id="mtf-15m">15m —</span>
          <span className="mtf-tf-badge neut" id="mtf-1h">1h —</span>
          <span className="mtf-tf-badge neut" id="mtf-4h">4h —</span>
        </div>
      </div>
      <div className="mtf-row"><span className="mtf-lbl">ALIGN SCORE</span><span className="mtf-val" id="mtf-score-txt">0 / 100</span></div>
      <div className="mtf-score-bar">
        <div className="mtf-score-fill" id="mtf-score-fill" style={{ width: '0%' }}></div>
      </div>
      <div className="mtf-update-ts" id="mtf-ts">— actualizat la —</div>
      <div style={{ height: '1px', background: '#f0c04022', margin: '4px 0' }}></div>
      <div className="mtf-row"><span className="mtf-lbl" style={{ color: '#f0c040' }}>RE REGIME</span><span className="mtf-val" id="re-regime">—</span></div>
      <div className="mtf-row"><span className="mtf-lbl" style={{ color: '#f0c040' }}>RE TRAP</span><span className="mtf-val" id="re-trap">—</span></div>
      <div className="mtf-row"><span className="mtf-lbl" style={{ color: '#f0c040' }}>RE CONF</span><span className="mtf-val" id="re-conf">—</span></div>
      <div style={{ height: '1px', background: '#88f04022', margin: '4px 0' }}></div>
      <div className="mtf-row"><span className="mtf-lbl" style={{ color: '#88f040' }}>PF PHASE</span><span className="mtf-val" id="pf-phase">—</span></div>
      <div className="mtf-row"><span className="mtf-lbl" style={{ color: '#88f040' }}>PF RISK</span><span className="mtf-val" id="pf-risk">—</span></div>
      <div className="mtf-row"><span className="mtf-lbl" style={{ color: '#88f040' }}>PF SIZE</span><span className="mtf-val" id="pf-size">—</span></div>
    </div>
  );
}

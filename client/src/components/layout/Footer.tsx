/** Bottom Nav (.bot) — 1:1 from index.html lines 2918-2929
 *  Shows WS connection dots + update time. */
export function Footer() {
  return (
    <div className="bot">
      <div className="drow2">
        <div className="dd" id="bnd"></div><span id="bns">BNB:—</span>&nbsp;
        <div className="dd" id="byd"></div><span id="bys">BYB:—</span>
        <span className="byb-health-mini">
          <span id="byb-h-status" style={{ color: 'var(--dim)' }}>—</span>
          <span style={{ color: 'var(--dim)' }}>RC:</span><span id="byb-h-reconn">0</span>
          <span style={{ color: 'var(--dim)' }}>R:</span><span id="byb-h-rate">0/min</span>
          <span style={{ color: 'var(--dim)' }}>AGE:</span><span id="byb-h-age">—</span>
        </span>
      </div>
      <span id="updt">—</span>
    </div>
  )
}

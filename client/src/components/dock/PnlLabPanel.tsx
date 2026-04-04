/** PnL Lab dock page view — 1:1 from #pnlLabWrap in index.html lines 693-695
 *  Body populated by renderPnlLab() in panels.js; shows empty-state banner initially. */
export function PnlLabPanel() {
  return (
    <div id="pnlLabWrap">
      <div id="pnlLabBody">
        {/* Empty-state banner — 1:1 from renderPnlLab() in panels.js */}
        <div className="pnl-lab-section" style={{ textAlign: 'center', padding: '16px 10px' }}>
          <div style={{ fontSize: '28px', marginBottom: '6px' }}>📊</div>
          <div style={{ color: '#00d9ff', fontSize: '13px', fontWeight: 700, marginBottom: '4px' }}>PnL Lab — No Data Yet</div>
          <div style={{ color: '#3a5068', fontSize: '11px', lineHeight: 1.5 }}>
            PnL Lab se va popula automat după ce închizi primul trade.<br />
            Drawdown, Expectancy, Daily stats — totul apare aici.
          </div>
        </div>
      </div>
    </div>
  );
}

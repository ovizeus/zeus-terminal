import { useJournalStore } from '../../stores'

export function JournalPanel() {
  const entries = useJournalStore((s) => s.entries)

  function exportCSV() {
    if (entries.length === 0) return
    const header = 'Time,Symbol,Side,Entry,Exit,PnL,Reason,Mode\n'
    const rows = entries.map((e) =>
      `${new Date(e.closeTs).toISOString()},${e.symbol},${e.side},${e.entryPrice},${e.exitPrice},${e.pnl.toFixed(2)},${e.reason},${e.mode}`
    ).join('\n')
    const blob = new Blob([header + rows], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `zeus-journal-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="zr-journal">
      <div className="zr-journal__header">
        <span className="zr-journal__title">TRADE JOURNAL</span>
        <button className="zr-at-btn" onClick={exportCSV} disabled={entries.length === 0}>
          CSV
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="zr-pos-empty">No closed trades yet</div>
      ) : (
        <div className="zr-journal__list">
          {entries.slice(-50).reverse().map((e) => {
            const isWin = e.pnl >= 0
            return (
              <div key={e.id} className={`zr-journal__row ${isWin ? 'zr-journal__row--win' : 'zr-journal__row--loss'}`}>
                <span className="zr-journal__time">
                  {new Date(e.closeTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className={`zr-pos-side ${e.side === 'LONG' ? 'zr-pos-side--long' : 'zr-pos-side--short'}`}>
                  {e.side === 'LONG' ? 'L' : 'S'}
                </span>
                <span className="zr-journal__sym">{e.symbol.replace('USDT', '')}</span>
                <span className="zr-journal__prices">
                  {e.entryPrice.toFixed(2)} → {e.exitPrice.toFixed(2)}
                </span>
                <span className={`zr-journal__pnl ${isWin ? 'zr-kv__value--grn' : 'zr-kv__value--red'}`}>
                  ${e.pnl.toFixed(2)}
                </span>
                <span className="zr-journal__reason">{e.reason}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Command Palette (Ctrl+K) — 1:1 from #cmdPalette in index.html
 *  Search overlay. Logic = category B. */
interface Props { visible: boolean; onClose: () => void }

export function CommandPalette({ visible, onClose }: Props) {
  return (
    <div id="cmdPalette" className="cmd-overlay" style={{ display: visible ? 'flex' : 'none' }} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cmd-panel">
        <div className="cmd-input-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            id="cmdInput"
            type="text"
            className="cmd-input"
            placeholder="Search symbols, actions, navigation..."
            autoComplete="off"
            spellCheck={false}
          />
          <span className="cmd-hint">ESC</span>
        </div>
        <div id="cmdResults" className="cmd-results"></div>
      </div>
    </div>
  )
}

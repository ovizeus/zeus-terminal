/** Post-Mortem dock page view — 1:1 from initPMPanel() in deepdive.js */
export function PostMortemPanel() {
  return (
    <div id="pm-strip-panel">
      <div id="pm-panel-body" style={{
        background: '#010508',
        borderTop: '1px solid #f0c04015',
        borderRadius: '0 0 10px 10px',
        margin: '2px 8px 0',
      }}>
        <div style={{
          padding: '12px',
          textAlign: 'center',
          fontSize: '12px',
          color: '#445566',
          letterSpacing: '1px',
        }}>
          Nicio tranzacție analizată încă.
        </div>
      </div>
    </div>
  )
}

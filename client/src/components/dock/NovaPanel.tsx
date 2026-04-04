export function NovaPanel() {
  return (
    <div className="nova-panel" id="nova-panel">
      {/* ARIA Mini-Summary */}
      <div
        id="nova-aria-summary"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 8px 2px',
          fontSize: '9px',
          color: '#00ffcc66',
          borderBottom: '1px solid #00ffcc11',
          marginBottom: '2px',
        }}
      >
        <span style={{ opacity: 0.5 }}>ARIA:</span>
        <span id="nova-aria-name" style={{ color: '#00ffccaa' }}>—</span>
        <span id="nova-aria-dir" style={{ fontSize: '8px' }}></span>
        <span id="nova-aria-conf" style={{ fontSize: '8px', opacity: 0.7 }}></span>
        <span id="nova-aria-tf" style={{ fontSize: '7px', opacity: 0.4, marginLeft: 'auto' }}></span>
      </div>
      <div id="nova-log" className="nova-log">
        <div className="nova-empty">No verdicts yet — monitoring market…</div>
      </div>
      {/* ARIA History in NOVA */}
      <div style={{ borderTop: '1px solid #00ffcc11', padding: '3px 6px 2px', marginTop: '2px' }}>
        <div style={{ fontSize: '7px', opacity: 0.35, letterSpacing: '1px', marginBottom: '1px' }}>PATTERN HISTORY</div>
        <div id="nova-aria-hist" style={{ fontSize: '8px', maxHeight: '48px', overflow: 'hidden' }}></div>
      </div>
      <div style={{ textAlign: 'right', padding: '2px 6px 4px' }}>
        <button
          id="nova-copy-btn"
          style={{
            background: 'none',
            border: '1px solid #00ffcc33',
            color: '#00ffcc88',
            fontSize: '9px',
            padding: '1px 6px',
            borderRadius: '3px',
            cursor: 'pointer',
          }}
          title="Copy NOVA log to clipboard"
        >
          Copy Log
        </button>
      </div>
    </div>
  );
}

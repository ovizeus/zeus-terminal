/** Signal Registry dock page view — 1:1 from #sr-strip-panel > #sr-sec */
export function SignalRegistryPanel() {
  return (
    <div id="sr-strip-panel">
      <div id="sr-sec">
        <div id="sr-stats"></div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '3px 8px 0' }}>
          <button
            style={{
              background: 'none',
              border: '1px solid #0a1a2a',
              color: 'var(--dim)',
              fontSize: '7px',
              padding: '1px 6px',
              borderRadius: '2px',
              cursor: 'pointer',
              fontFamily: 'var(--ff)',
            }}
          >
            ↺ refresh
          </button>
        </div>
        <div id="sr-list"></div>
      </div>
    </div>
  )
}

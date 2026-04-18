import { useBrainStore } from '../../stores'
import { toggleAdaptive } from '../../trading/risk'

/** Adaptive Control dock page view — 1:1 from #adaptive-sec in index.html lines 4435-4471 */
export function AdaptivePanel() {
  const adaptiveOn = useBrainStore((s) => !!s.brain.adaptive?.enabled)

  return (
    <div className="sec" id="adaptive-sec">
      <div className="slbl" style={{ justifyContent: 'space-between' }}>
        <span>ADAPTIVE CONTROL</span>
        <span id="adaptive-last-upd" style={{ fontSize: '8px', color: 'var(--dim)' }}></span>
      </div>
      <div style={{ padding: '8px 12px' }}>
        {/* Toggle button */}
        <div style={{ marginBottom: '8px' }}>
          <button id="adaptiveToggleBtn" onClick={() => {
            toggleAdaptive()
            // brainStore is canonical; engine writes directly via mutators
          }} style={{
            width: '100%', padding: '6px 10px', fontSize: '10px', fontFamily: 'var(--ff)', letterSpacing: '1px',
            background: adaptiveOn ? '#0a2a1a' : '#0a1220',
            border: `1px solid ${adaptiveOn ? '#00ffcc44' : '#2a3a4a'}`,
            color: adaptiveOn ? '#00ffcc' : '#778899', borderRadius: '3px',
            cursor: 'pointer', transition: 'all .2s'
          }}>
            {adaptiveOn ? 'ADAPTIVE ON' : 'ADAPTIVE OFF'}
          </button>
          <div style={{ fontSize: '8px', color: 'var(--dim)', marginTop: '4px', lineHeight: 1.6 }}>
            OFF = to&#x21B;i multiplieri &#xD7;1.00, engine nu cite&#x219;te nimic.<br />
            Min 30 trades/bucket pentru a activa multiplicatorii.
          </div>
        </div>
        {/* Active multipliers row */}
        <div id="adaptive-mults-row" style={{
          display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: '3px', fontSize: '9px',
          background: '#0a1520', border: '1px solid #1a2a3a', borderRadius: '3px', padding: '6px 10px', marginBottom: '8px'
        }}>
          <span style={{ color: 'var(--dim)' }}>ENTRY</span><span style={{ color: '#778899', fontWeight: 700 }}>&times;1.00</span>
          <span style={{ color: 'var(--dim)' }}>SIZE</span><span style={{ color: '#778899', fontWeight: 700 }}>&times;1.00</span>
          <span style={{ color: 'var(--dim)' }}>EXIT</span><span style={{ color: '#778899', fontWeight: 700 }}>&times;1.00</span>
        </div>
        {/* Bucket table */}
        <div style={{ fontSize: '8px', letterSpacing: '1.5px', color: 'var(--dim)', marginBottom: '3px' }}>BUCKETS (regime|profile|vol)</div>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 42px 42px 48px', gap: '3px', fontSize: '8px', color: '#445566',
          marginBottom: '3px', padding: '0 0 2px 0', borderBottom: '1px solid #1a2530'
        }}>
          <span>BUCKET</span><span>TRADES</span><span>WR</span><span>MULT</span>
        </div>
        <div id="adaptive-bucket-table" style={{ maxHeight: '120px', overflowY: 'auto', fontSize: '8px', color: '#6a8090' }}>
          <div style={{ color: 'var(--dim)', padding: '4px 0' }}>Niciun trade cu context &#xEE;nc&#x103;.</div>
        </div>
      </div>
    </div>
  )
}

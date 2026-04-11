import { ModalOverlay, ModalHeader } from './ModalOverlay'
import { masterReset } from '../../core/bootstrapMisc'
import { cloudSave, cloudClear, cloudLoad } from '../../data/marketDataWS'

const w = window as any

interface Props { visible: boolean; onClose: () => void }

export function CloudSyncModal({ visible, onClose }: Props) {
  return (
    <ModalOverlay id="mcloud" visible={visible} onClose={onClose}>
      <ModalHeader title="CLOUD SYNC" onClose={onClose} />

      <div style={{ padding: '14px 16px' }}>
        {/* Privacy box */}
        <div style={{
          background: '#0d1018', border: '1px solid #f0c04033', borderRadius: 8,
          padding: 12, marginBottom: 12, fontSize: 9, color: 'var(--txt)', lineHeight: 1.8
        }}>
          <div style={{ color: 'var(--gold)', fontWeight: 700, marginBottom: 6 }}>Privacy &amp; Security</div>
          <div>• Email is <strong>hashed</strong> with SHA-256 (one-way)</div>
          <div>• Email is <strong>NOT stored</strong> on server or locally</div>
          <div>• Only the <strong>hash</strong> is used as a key</div>
          <div>• Settings are saved to your browser localStorage</div>
        </div>

        {/* Cloud status */}
        <div id="cloudStatus" style={{
          background: '#0d1018', border: '1px solid #1e2530', borderRadius: 6,
          padding: 10, marginBottom: 12, fontSize: 9, color: 'var(--dim)', textAlign: 'center'
        }}>Not configured</div>

        {/* Email input */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 8, color: 'var(--dim)', marginBottom: 4, letterSpacing: 1 }}>EMAIL ADDRESS</div>
          <input type="email" id="cloudEmail" placeholder="your@email.com" style={{
            width: '100%', background: '#0d1018', border: '1px solid var(--brd)',
            color: 'var(--whi)', padding: '8px 10px', borderRadius: 4,
            fontSize: 11, fontFamily: 'var(--ff)', outline: 'none', boxSizing: 'border-box'
          }} />
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
          <button className="sbtn2 pri" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            onClick={() => cloudSave?.()}>Save to Cloud</button>
          <button className="sbtn2" style={{
            background: '#1a2530', border: '1px solid var(--brd)', color: 'var(--txt)',
            padding: 10, borderRadius: 4, fontSize: 10, cursor: 'pointer', fontFamily: 'var(--ff)'
          }} onClick={() => cloudLoad?.()}>
            <svg className="z-i" viewBox="0 0 16 16"><path d="M8 2v8m-3-3l3 3 3-3M3 14h10" /></svg>
            {' '}Load from Cloud
          </button>
          <button className="sbtn2" style={{
            background: '#2a1010', border: '1px solid #ff335533', color: 'var(--red)',
            padding: 10, borderRadius: 4, fontSize: 10, cursor: 'pointer', fontFamily: 'var(--ff)'
          }} onClick={() => cloudClear?.()}>
            <svg className="z-i" viewBox="0 0 16 16"><path d="M3 4h10M6 2h4v2M5 4v9h6V4m-4 2v5m2-5v5" /></svg>
            {' '}Clear Email
          </button>
        </div>

        <div id="cloudMsg" style={{ marginTop: 10, fontSize: 9, color: 'var(--grn)', textAlign: 'center', minHeight: 16 }}></div>

        {/* Danger zone */}
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #ff335522' }}>
          <div style={{ fontSize: 7, color: '#ff335566', letterSpacing: 1.5, marginBottom: 6, textAlign: 'center' }}>
            <svg className="z-i" viewBox="0 0 16 16" style={{ color: '#ff3355' }}><path d="M8 2L1 14h14L8 2zM8 6v4m0 2h.01" /></svg> DANGER ZONE
          </div>
          <button style={{
            width: '100%', padding: 10, background: '#2a0000', border: '2px solid #ff335555',
            color: '#ff4466', borderRadius: 4, fontSize: 9, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'var(--ff)', letterSpacing: 1.5
          }} onClick={() => masterReset?.()}>
            <svg className="z-i" viewBox="0 0 16 16" style={{ color: '#ff4466' }}><path d="M5 6h.01M11 6h.01M4 3a5 5 0 018 0c1 2 1 4-1 6H5c-2-2-2-4-1-6M6 12v2m4-2v2" /></svg> MASTER RESET — ȘTERGE TOT
          </button>
          <div style={{ fontSize: 7, color: '#ff335544', textAlign: 'center', marginTop: 4 }}>
            Resetează poziții, AT, DSL, PERF, DHF + localStorage
          </div>
        </div>
      </div>
    </ModalOverlay>
  )
}

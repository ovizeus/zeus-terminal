import { createPortal } from 'react-dom'
import { useProfileStore } from '../../stores/profileStore'
import { useAuthStore } from '../../stores'
import { ModalOverlay, ModalHeader } from '../modals/ModalOverlay'

// [2026-06-24] Profile settings — a dedicated panel (like the other Zeus settings) opened by the
// bare gear in the profile panel. Holds the accent picker (real) plus Leaderboard + Referral as
// UI previews (wired for real in Phase 2 / Phase 3). Keeps the flip profile strip clean.
const ACCENTS = [
  '#f0c040', '#ffd700', '#ff9d3c', '#ff6f00',
  '#00e676', '#00c853', '#26ffd0', '#00d9ff',
  '#2196f3', '#7c4dff', '#b388ff', '#ff4d6d',
  '#ff1744', '#ffffff', '#90a4ae', '#0a0a0a',
]

function Section({ icon, title, soon, children }: { icon: string; title: string; soon?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '9px' }}>
        <span style={{ fontSize: '13px' }}>{icon}</span>
        <span style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '1.5px', color: 'rgba(255,255,255,0.65)', fontWeight: 700 }}>{title}</span>
        {soon ? <span style={{ fontFamily: 'monospace', fontSize: '8px', letterSpacing: '0.5px', color: '#0a0a0a', background: '#f0c040', borderRadius: '3px', padding: '1px 5px', fontWeight: 700 }}>SOON</span> : null}
      </div>
      {children}
    </div>
  )
}

export function ProfileSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const profile = useProfileStore((s) => s.profile)
  const save = useProfileStore((s) => s.save)
  const email = useAuthStore((s) => s.email)
  const role = useAuthStore((s) => s.role)
  const accent = profile.accent_color || '#f0c040'
  const refCode = 'ZEUS-' + ((profile.username || email || 'YOU').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'YOU8') + '-7K2'

  // Portal to <body> so the modal escapes the flip header's transformed/fixed ancestor
  // (a transformed ancestor would otherwise clip the fixed overlay to the header box).
  return createPortal(
    <ModalOverlay id="profile-settings-mover" visible={open} onClose={onClose} maxWidth="440px" zIndex={100001}>
      <ModalHeader title="PROFILE" onClose={onClose} titleStyle={{ color: accent, letterSpacing: '2px' }} />

      {/* 🎨 ACCENT — real */}
      <Section icon="🎨" title="ACCENT COLOR">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '7px', marginBottom: '9px' }}>
          {ACCENTS.map((c) => (
            <button key={c} onClick={() => save({ accent_color: c })} title={c} style={{
              width: '100%', aspectRatio: '1', borderRadius: '50%', background: c, cursor: 'pointer', padding: 0,
              border: c === accent ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)',
              boxShadow: c === accent ? `0 0 8px ${c}` : 'none',
            }} />
          ))}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'monospace', fontSize: '10px', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', letterSpacing: '0.5px' }}>
          <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '#f0c040'} onChange={(e) => save({ accent_color: e.target.value })}
            style={{ width: '26px', height: '26px', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }} />
          PERSONALIZED — pick any colour
        </label>
      </Section>

      {/* 🏆 LEADERBOARD — UI preview (Phase 2) */}
      <Section icon="🏆" title="LEADERBOARD" soon>
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '8px 10px' }}>
          {[['🥇', 'TopTrader', '+$4,210'], ['🥈', 'whale_07', '+$2,980'], ['🥉', 'you?', '+$1,120']].map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', fontFamily: 'monospace', fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}>
              <span>{r[0]} {r[1]}</span><span style={{ color: '#00e676' }}>{r[2]}</span>
            </div>
          ))}
          <div style={{ fontFamily: 'monospace', fontSize: '9px', color: 'rgba(255,255,255,0.35)', marginTop: '5px' }}>Live ranking by real PnL — coming soon.</div>
        </div>
      </Section>

      {/* 🎁 REFERRAL — UI preview (Phase 3) */}
      <Section icon="🎁" title="REFERRAL" soon>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '7px' }}>
          <code style={{ flex: 1, fontFamily: 'monospace', fontSize: '13px', color: accent, background: 'rgba(0,0,0,0.4)', border: `1px dashed ${accent}66`, borderRadius: '4px', padding: '7px 10px', letterSpacing: '1px' }}>{refCode}</code>
          <button disabled style={{ fontFamily: 'monospace', fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', padding: '7px 12px', cursor: 'not-allowed', letterSpacing: '1px' }}>INVITE</button>
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: '9px', color: 'rgba(255,255,255,0.35)' }}>Invite friends with your code — both get a bonus. Coming soon.</div>
      </Section>

      {/* 👤 ACCOUNT — real, read-only */}
      <Section icon="👤" title="ACCOUNT">
        <div style={{ fontFamily: 'monospace', fontSize: '10px', color: 'rgba(255,255,255,0.55)', lineHeight: 1.7 }}>
          <div>EMAIL <span style={{ color: 'rgba(255,255,255,0.85)' }}>{email || '—'}</span></div>
          <div>ROLE <span style={{ color: accent }}>{(role || 'user').toUpperCase()}</span></div>
        </div>
      </Section>

      <div style={{ padding: '12px 16px' }}>
        <button onClick={onClose} style={{
          width: '100%', fontFamily: 'monospace', fontSize: '12px', fontWeight: 700, letterSpacing: '1px',
          color: accent, background: `${accent}1f`, border: `1px solid ${accent}`, borderRadius: '4px', padding: '9px', cursor: 'pointer',
        }}>DONE</button>
      </div>
    </ModalOverlay>,
    document.body
  )
}

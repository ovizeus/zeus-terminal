import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useProfileStore } from '../../stores/profileStore'
import { useAuthStore } from '../../stores'
import { reencodeAvatar, initialsAvatar } from '../../profile/avatar'
import { validateUsername } from '../../profile/validate'
import { appConfirm } from '../common/confirmDialog'
import { ModalOverlay, ModalHeader } from '../modals/ModalOverlay'
import { LeaderboardPanel } from './LeaderboardPanel'

// [2026-06-24] Profile settings — a dedicated panel (like the other Zeus settings) opened by the
// bare gear in the profile strip. ALL editing lives here (photo / name / @username / tagline) so the
// flip strip is display-only and never opens an editor by accident. Plus accent (real), and
// Leaderboard + Referral as UI previews (wired for real in Phase 2 / Phase 3).
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
  const fileRef = useRef<HTMLInputElement | null>(null)

  const accent = profile.accent_color || '#f0c040'
  const name = profile.display_name || ''
  const avatarSrc = profile.avatar || initialsAvatar(name || '?', accent)
  const refCode = 'ZEUS-' + ((profile.username || email || 'YOU').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'YOU8') + '-7K2'

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!f) return
    try { const data = await reencodeAvatar(f); await save({ avatar: data }) } catch (_) { /* bad image — ignored */ }
  }
  const editName = async () => {
    const r = await appConfirm({ title: 'Display name', body: 'Shown across the app.', confirmLabel: 'SAVE', text: { label: 'NAME', initial: name, maxLength: 40, placeholder: 'Your name' } })
    if (r.confirmed && r.text !== undefined) await save({ display_name: r.text.trim() })
  }
  const editTagline = async () => {
    const r = await appConfirm({ title: 'Tagline', body: 'A short line about you.', confirmLabel: 'SAVE', text: { label: 'TAGLINE', initial: profile.tagline || '', maxLength: 80, placeholder: 'Hunting liquidations' } })
    if (r.confirmed && r.text !== undefined) await save({ tagline: r.text.trim() })
  }
  const editUsername = async () => {
    const r = await appConfirm({ title: 'Username', body: '3-20 letters, digits or _. Must be unique.', tone: 'info', confirmLabel: 'SAVE', text: { label: 'USERNAME', initial: profile.username || '', maxLength: 20, placeholder: 'zeus_ovi' } })
    if (!r.confirmed || r.text === undefined) return
    const u = r.text.trim()
    if (u && !validateUsername(u)) { await appConfirm({ title: 'Invalid username', body: 'Use 3-20 letters, digits or _ (no spaces or symbols).', tone: 'danger', confirmLabel: 'OK' }); return }
    const ok = await save({ username: u })
    if (!ok) await appConfirm({ title: 'Username taken', body: 'That @username is already in use. Try another.', tone: 'danger', confirmLabel: 'OK' })
  }

  const editBtn: React.CSSProperties = { fontFamily: 'monospace', fontSize: '9px', fontWeight: 700, letterSpacing: '0.5px', color: accent, background: `${accent}14`, border: `1px solid ${accent}55`, borderRadius: '4px', padding: '5px 9px', cursor: 'pointer' }
  const fieldLbl: React.CSSProperties = { fontFamily: 'monospace', fontSize: '8px', letterSpacing: '1px', color: 'rgba(255,255,255,0.4)' }
  const fieldVal: React.CSSProperties = { fontFamily: 'monospace', fontSize: '12px', color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '6px 0' }

  return createPortal(
    <ModalOverlay id="profile-settings-mover" visible={open} onClose={onClose} maxWidth="440px" zIndex={100001}>
      <ModalHeader title="PROFILE" onClose={onClose} titleStyle={{ color: accent, letterSpacing: '2px' }} />

      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={onFile} />

      {/* ✏️ EDIT PROFILE — all the editing lives here (deliberate, never by accident) */}
      <Section icon="✏️" title="EDIT PROFILE">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
          <img src={avatarSrc} alt="avatar" style={{ width: '52px', height: '52px', borderRadius: '50%', objectFit: 'cover', border: `2px solid ${accent}`, filter: `drop-shadow(0 0 6px ${accent}) drop-shadow(0 0 13px ${accent}cc)`, flex: 'none' }} />
          <button onClick={() => fileRef.current?.click()} style={{ ...editBtn, fontSize: '10px', padding: '7px 12px' }}>📷 CHANGE PHOTO</button>
        </div>
        <div style={row}>
          <div style={{ minWidth: 0 }}><div style={fieldLbl}>DISPLAY NAME</div><div style={fieldVal}>{name || '— not set'}</div></div>
          <button onClick={editName} style={editBtn}>CHANGE</button>
        </div>
        <div style={row}>
          <div style={{ minWidth: 0 }}><div style={fieldLbl}>USERNAME</div><div style={fieldVal}>{profile.username ? '@' + profile.username : '— not set'}</div></div>
          <button onClick={editUsername} style={editBtn}>CHANGE</button>
        </div>
        <div style={row}>
          <div style={{ minWidth: 0 }}><div style={fieldLbl}>TAGLINE</div><div style={fieldVal}>{profile.tagline || '— not set'}</div></div>
          <button onClick={editTagline} style={editBtn}>CHANGE</button>
        </div>
      </Section>

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

      {/* 🏆 LEADERBOARD — real (Phase 2) */}
      <Section icon="🏆" title="LEADERBOARD">
        <LeaderboardPanel />
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

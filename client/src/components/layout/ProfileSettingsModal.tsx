import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useProfileStore } from '../../stores/profileStore'
import { useAuthStore } from '../../stores'
import { reencodeAvatar, initialsAvatar } from '../../profile/avatar'
import { validateUsername } from '../../profile/validate'
import { appConfirm } from '../common/confirmDialog'
import { ModalOverlay, ModalHeader } from '../modals/ModalOverlay'
import { LeaderboardPanel } from './LeaderboardPanel'
import { ReferralPanel } from './ReferralPanel'
import { Icon } from './icons'

// [2026-06-25] Profile settings — a clean MENU of titles. Tapping a title opens its sub-panel OVER
// the menu, with the menu blurred behind (frosted backdrop). All editing lives in the EDIT PROFILE
// sub-panel; edit dialogs open on top (highest z) with the sub-panel frosted behind. No more crammed
// single scroll, and no more edit dialog hiding behind the panel.
const ACCENTS = [
  '#f0c040', '#ffd700', '#ff9d3c', '#ff6f00',
  '#00e676', '#00c853', '#26ffd0', '#00d9ff',
  '#2196f3', '#7c4dff', '#b388ff', '#ff4d6d',
  '#ff1744', '#ffffff', '#90a4ae', '#0a0a0a',
]
type View = 'menu' | 'edit' | 'accent' | 'leaderboard' | 'referral' | 'account'
const MENU: { key: View; icon: string; title: string; sub: string }[] = [
  { key: 'edit', icon: 'edit', title: 'EDIT PROFILE', sub: 'Photo, name, @username, tagline' },
  { key: 'accent', icon: 'palette', title: 'ACCENT COLOUR', sub: 'Your personal colour' },
  { key: 'leaderboard', icon: 'trophy', title: 'LEADERBOARD', sub: 'Live ranking by PnL' },
  { key: 'referral', icon: 'gift', title: 'REFERRAL', sub: 'Invite friends, both get a bonus' },
  { key: 'account', icon: 'user', title: 'ACCOUNT', sub: 'Your account details' },
]

export function ProfileSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const profile = useProfileStore((s) => s.profile)
  const save = useProfileStore((s) => s.save)
  const email = useAuthStore((s) => s.email)
  const role = useAuthStore((s) => s.role)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [view, setView] = useState<View>('menu')

  useEffect(() => { if (!open) setView('menu') }, [open])

  const accent = profile.accent_color || '#f0c040'
  const name = profile.display_name || ''
  const avatarSrc = profile.avatar || initialsAvatar(name || '?', accent)

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files && e.target.files[0]; e.target.value = ''
    if (!f) return
    try { const data = await reencodeAvatar(f); await save({ avatar: data }) } catch (_) { /* bad image */ }
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

  const editBtn: React.CSSProperties = { fontFamily: 'monospace', fontSize: '9px', fontWeight: 700, letterSpacing: '0.5px', color: accent, background: `${accent}14`, border: `1px solid ${accent}55`, borderRadius: '4px', padding: '6px 11px', cursor: 'pointer', flex: 'none' }
  const fieldLbl: React.CSSProperties = { fontFamily: 'monospace', fontSize: '8px', letterSpacing: '1px', color: 'rgba(255,255,255,0.4)' }
  const fieldVal: React.CSSProperties = { fontFamily: 'monospace', fontSize: '12px', color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '8px 0' }

  function renderView() {
    switch (view) {
      case 'edit': return (
        <div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={onFile} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <img src={avatarSrc} alt="avatar" style={{ width: '54px', height: '54px', borderRadius: '50%', objectFit: 'cover', border: `2px solid ${accent}`, filter: `drop-shadow(0 0 6px ${accent}) drop-shadow(0 0 13px ${accent}cc)`, flex: 'none' }} />
            <button onClick={() => fileRef.current?.click()} style={{ ...editBtn, fontSize: '10px', padding: '8px 13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Icon name="camera" size={13} color={accent} /> CHANGE PHOTO</button>
          </div>
          <div style={row}><div style={{ minWidth: 0 }}><div style={fieldLbl}>DISPLAY NAME</div><div style={fieldVal}>{name || '— not set'}</div></div><button onClick={editName} style={editBtn}>CHANGE</button></div>
          <div style={row}><div style={{ minWidth: 0 }}><div style={fieldLbl}>USERNAME</div><div style={fieldVal}>{profile.username ? '@' + profile.username : '— not set'}</div></div><button onClick={editUsername} style={editBtn}>CHANGE</button></div>
          <div style={row}><div style={{ minWidth: 0 }}><div style={fieldLbl}>TAGLINE</div><div style={fieldVal}>{profile.tagline || '— not set'}</div></div><button onClick={editTagline} style={editBtn}>CHANGE</button></div>
        </div>
      )
      case 'accent': return (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '8px', marginBottom: '11px' }}>
            {ACCENTS.map((c) => (
              <button key={c} onClick={() => save({ accent_color: c })} title={c} style={{ width: '100%', aspectRatio: '1', borderRadius: '50%', background: c, cursor: 'pointer', padding: 0, border: c === accent ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)', boxShadow: c === accent ? `0 0 8px ${c}` : 'none' }} />
            ))}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'monospace', fontSize: '10px', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', letterSpacing: '0.5px' }}>
            <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '#f0c040'} onChange={(e) => save({ accent_color: e.target.value })} style={{ width: '28px', height: '28px', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }} />
            PERSONALIZED — pick any colour
          </label>
        </div>
      )
      case 'leaderboard': return <LeaderboardPanel />
      case 'referral': return <ReferralPanel />
      case 'account': return (
        <div style={{ fontFamily: 'monospace', fontSize: '11px', color: 'rgba(255,255,255,0.55)', lineHeight: 1.9 }}>
          <div>EMAIL <span style={{ color: 'rgba(255,255,255,0.85)' }}>{email || '—'}</span></div>
          <div>ROLE <span style={{ color: accent }}>{(role || 'user').toUpperCase()}</span></div>
        </div>
      )
      default: return null
    }
  }

  const activeTitle = MENU.find((m) => m.key === view)?.title || ''

  return createPortal(
    <>
      {/* MENU — list of titles. Frosted backdrop over the app. */}
      <ModalOverlay id="profile-settings-mover" visible={open} onClose={onClose} maxWidth="440px" zIndex={100001}>
        <ModalHeader title="PROFILE" onClose={onClose} titleStyle={{ color: accent, letterSpacing: '2px' }} />
        <div style={{ padding: '6px 10px 12px' }}>
          {MENU.map((m) => (
            <button key={m.key} className="pset-row" onClick={() => setView(m.key)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '12px', background: 'transparent', border: 'none', borderRadius: '7px', padding: '11px 10px', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ flex: 'none', display: 'flex' }}><Icon name={m.icon} size={18} color={accent} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontFamily: 'monospace', fontSize: '12px', letterSpacing: '1px', color: '#fff', fontWeight: 700 }}>{m.title}</span>
                <span style={{ display: 'block', fontFamily: 'monospace', fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>{m.sub}</span>
              </span>
              <span style={{ fontFamily: 'monospace', fontSize: '16px', color: accent, flex: 'none' }}>›</span>
            </button>
          ))}
        </div>
      </ModalOverlay>

      {/* SUB-PANEL — opens OVER the menu, menu frosted behind */}
      {open && view !== 'menu' && (
        <ModalOverlay id="profile-subview-mover" visible={true} onClose={() => setView('menu')} maxWidth="440px" zIndex={100050}>
          <div className="mhdr">
            <div className="mtitle" style={{ color: accent, letterSpacing: '1.5px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span onClick={() => setView('menu')} style={{ cursor: 'pointer', fontSize: '16px' }}>‹</span>
              {activeTitle}
            </div>
            <span className="mclose" onClick={onClose}>✕</span>
          </div>
          <div className="pset-view" style={{ padding: '12px 16px 16px' }}>{renderView()}</div>
        </ModalOverlay>
      )}
    </>,
    document.body
  )
}

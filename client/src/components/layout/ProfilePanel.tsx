import { useRef, useState } from 'react'
import { useProfileStore } from '../../stores/profileStore'
import { reencodeAvatar, initialsAvatar } from '../../profile/avatar'
import { validateUsername } from '../../profile/validate'
import { appConfirm } from '../common/confirmDialog'
import { ProfileSettingsModal } from './ProfileSettingsModal'

// [2026-06-24] Profile panel — the "back" of the flip header. Same dark header style.
// Tap the avatar to flip back; "Upload photo" to change the picture (re-encoded, sterile);
// tap name / @username / tagline to edit via the app dialog; the gear opens profile settings.
export function ProfilePanel({ onAvatarClick }: { onAvatarClick?: () => void }) {
  const profile = useProfileStore((s) => s.profile)
  const error = useProfileStore((s) => s.error)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const save = useProfileStore((s) => s.save)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const name = profile.display_name || ''
  const accent = profile.accent_color || '#f0c040'
  const avatarSrc = profile.avatar || initialsAvatar(name || '?', accent)

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

  const editable: React.CSSProperties = { cursor: 'pointer', borderBottom: '1px dashed rgba(255,255,255,0.18)' }

  return (
    <div className="profile-panel" style={{
      height: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: '11px',
      padding: '6px 14px', overflow: 'hidden', background: '#000', borderBottom: `1px solid ${accent}40`,
    }}>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={onFile} />

      {/* avatar — tap to flip back */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', flex: 'none' }}>
        <img
          src={avatarSrc} alt="profile" onClick={onAvatarClick} title="Tap to go back"
          style={{ width: '42px', height: '42px', borderRadius: '50%', objectFit: 'cover', cursor: 'pointer', border: `2px solid ${accent}`, boxShadow: `0 0 10px ${accent}55` }}
        />
        <button onClick={() => fileRef.current?.click()} style={{
          background: 'transparent', border: 'none', color: accent, fontFamily: 'monospace',
          fontSize: '8px', letterSpacing: '0.5px', cursor: 'pointer', padding: 0,
        }}>📷 UPLOAD</button>
      </div>

      {/* identity */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0, flex: 1 }}>
        <div onClick={editName} style={{ ...editable, fontFamily: 'monospace', fontSize: '15px', fontWeight: 700, color: accent, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {name || 'Set your name'}
        </div>
        <div onClick={editUsername} style={{ ...editable, fontFamily: 'monospace', fontSize: '11px', color: 'rgba(255,255,255,0.7)', width: 'fit-content', maxWidth: '100%' }}>
          {profile.username ? '@' + profile.username : '@set_username'}
        </div>
        <div onClick={editTagline} style={{ ...editable, fontFamily: 'monospace', fontSize: '10px', color: 'rgba(255,255,255,0.5)', fontStyle: 'italic', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {profile.tagline ? '"' + profile.tagline + '"' : 'add a tagline…'}
        </div>
        {error ? <div style={{ fontFamily: 'monospace', fontSize: '8px', color: '#ff5b6e' }}>{error}</div> : null}
      </div>

      {/* bare settings gear (no box) — opens the dedicated profile settings panel */}
      <button className="profile-gear" onClick={() => setSettingsOpen(true)} title="Profile settings" aria-label="Profile settings"
        style={{ flex: 'none', background: 'transparent', border: 'none', padding: '4px', cursor: 'pointer', color: accent, lineHeight: 0 }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      <ProfileSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

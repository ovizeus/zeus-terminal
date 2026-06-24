import { useState } from 'react'
import { useProfileStore } from '../../stores/profileStore'
import { initialsAvatar } from '../../profile/avatar'
import { ProfileSettingsModal } from './ProfileSettingsModal'

// [2026-06-24] Profile panel — the "back" of the flip header. DISPLAY-ONLY: it never opens an editor
// by accident. Tap the avatar to flip back; the gear opens the dedicated settings panel where all
// editing (photo / name / @username / tagline / accent) lives.
export function ProfilePanel({ onAvatarClick }: { onAvatarClick?: () => void }) {
  const profile = useProfileStore((s) => s.profile)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const name = profile.display_name || ''
  const accent = profile.accent_color || '#f0c040'
  const avatarSrc = profile.avatar || initialsAvatar(name || '?', accent)

  return (
    <div className="profile-panel" style={{
      height: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: '11px',
      padding: '6px 14px', overflow: 'hidden', background: '#000', borderBottom: `1px solid ${accent}40`,
    }}>
      {/* avatar — tap to flip back to the trading header */}
      <img
        src={avatarSrc} alt="profile" onClick={onAvatarClick} title="Tap to go back"
        style={{ width: '44px', height: '44px', borderRadius: '50%', objectFit: 'cover', cursor: 'pointer', flex: 'none', border: `2px solid ${accent}`, filter: `drop-shadow(0 0 5px ${accent}) drop-shadow(0 0 11px ${accent}cc)` }}
      />

      {/* identity — display only */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: 'monospace', fontSize: '15px', fontWeight: 700, color: accent, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {name || 'Set your name'}
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: '11px', color: 'rgba(255,255,255,0.7)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {profile.username ? '@' + profile.username : '@set_username'}
        </div>
        {profile.tagline ? (
          <div style={{ fontFamily: 'monospace', fontSize: '10px', color: 'rgba(255,255,255,0.5)', fontStyle: 'italic', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {'"' + profile.tagline + '"'}
          </div>
        ) : null}
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

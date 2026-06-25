import { useEffect, useState } from 'react'

// [2026-06-26] In-app self-update for the sideloaded Android APK. On boot (native app only) it asks the
// native ZeusUpdater for the installed versionCode and fetches /app-version.json; if a newer build is
// published, it shows a banner. "Update" downloads + launches the installer via the native plugin (the
// OS still asks the user to confirm the install — sideload rule). Renders nothing in a normal browser.
interface Latest { versionCode: number; versionName: string; url: string; notes?: string }
interface Updater { getCurrentVersion: () => Promise<{ versionCode: number; versionName: string }>; downloadAndInstall: (o: { url: string }) => Promise<unknown> }

function getUpdater(): Updater | null {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: { ZeusUpdater?: Updater } } }).Capacitor
  if (cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins && cap.Plugins.ZeusUpdater) return cap.Plugins.ZeusUpdater
  return null
}

export function AppUpdateChecker() {
  const [latest, setLatest] = useState<Latest | null>(null)
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const up = getUpdater()
    if (!up) return
    let alive = true
    ;(async () => {
      try {
        const cur = await up.getCurrentVersion()
        const res = await fetch('/app-version.json?nc=' + Date.now(), { cache: 'no-store' })
        const lat = (await res.json()) as Latest
        if (alive && lat && typeof lat.versionCode === 'number' && lat.url && lat.versionCode > (cur.versionCode || 0)) {
          setLatest(lat)
        }
      } catch (_) { /* never block the app */ }
    })()
    return () => { alive = false }
  }, [])

  if (!latest || dismissed) return null

  const update = async () => {
    const up = getUpdater(); if (!up) return
    setBusy(true)
    try { await up.downloadAndInstall({ url: latest.url }) } catch (_) { setBusy(false) }
    // on success the OS download + installer take over; keep the banner in "downloading" state
  }

  return (
    <div style={{ position: 'fixed', left: '12px', right: '12px', bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))', zIndex: 2000002, background: 'rgba(12,14,20,0.97)', border: '1px solid #f0c04066', borderRadius: '12px', padding: '12px 14px', boxShadow: '0 8px 30px rgba(0,0,0,0.6)', fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#f0c040', letterSpacing: '0.5px' }}>Update available — {latest.versionName}</div>
          <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.55)', marginTop: '2px' }}>{busy ? 'Downloading… you will be asked to confirm the install.' : (latest.notes || 'A new version of the app is ready.')}</div>
        </div>
        {!busy && (
          <button onClick={() => setDismissed(true)} style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.6)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '8px 6px' }}>LATER</button>
        )}
        <button onClick={update} disabled={busy} style={{ fontSize: '12px', fontWeight: 700, color: '#0a0a0a', background: '#f0c040', border: 'none', borderRadius: '7px', padding: '9px 16px', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1, flex: 'none' }}>{busy ? '…' : 'UPDATE'}</button>
      </div>
    </div>
  )
}

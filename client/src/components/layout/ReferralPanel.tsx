import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { useProfileStore } from '../../stores/profileStore'
import { useAuthStore } from '../../stores'

// [2026-06-25] Referral (Phase 3). A stable per-user code + two share modes: a link (native share /
// WhatsApp) and a generated promo image (Zeus logo + QR + code) you can share or download.
// Note: signup attribution (tracking who joined via whom) is the backend follow-up; the code +
// share are fully working now.
const APP_ORIGIN = 'https://zeus-terminal.com'

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => resolve(i); i.onerror = reject; i.src = src })
}

async function buildPromoImage(link: string, code: string, accent: string): Promise<string> {
  const qrUrl = await QRCode.toDataURL(link, { margin: 1, width: 360, color: { dark: '#0a0a0a', light: '#ffffff' } })
  const W = 600, H = 800
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const ctx = cv.getContext('2d'); if (!ctx) return qrUrl
  ctx.fillStyle = '#08080c'; ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = accent; ctx.lineWidth = 6; ctx.strokeRect(14, 14, W - 28, H - 28)
  ctx.textAlign = 'center'
  try { const logo = await loadImg(import.meta.env.BASE_URL + 'zeus-logo.png'); ctx.save(); ctx.shadowColor = accent; ctx.shadowBlur = 30; ctx.drawImage(logo, W / 2 - 55, 56, 110, 110); ctx.restore() } catch (_) { /* logo optional */ }
  ctx.fillStyle = accent; ctx.font = 'bold 46px monospace'; ctx.fillText('ZEUS TERMINAL', W / 2, 230)
  ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '22px monospace'; ctx.fillText('AI Trading Terminal', W / 2, 264)
  const qr = await loadImg(qrUrl); ctx.drawImage(qr, W / 2 - 160, 312, 320, 320)
  ctx.fillStyle = accent; ctx.font = 'bold 34px monospace'; ctx.fillText(code, W / 2, 692)
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '19px monospace'; ctx.fillText('Scan to join with my code', W / 2, 728)
  return cv.toDataURL('image/png')
}

function downloadDataUrl(dataUrl: string, name: string) {
  const a = document.createElement('a'); a.href = dataUrl; a.download = name; document.body.appendChild(a); a.click(); a.remove()
}

export function ReferralPanel() {
  const profile = useProfileStore((s) => s.profile)
  const email = useAuthStore((s) => s.email)
  const userId = useAuthStore((s) => s.userId)
  const accent = profile.accent_color || '#f0c040'

  const base = (profile.username || (email ? email.split('@')[0] : '') || ('U' + (userId || ''))).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'TRADER'
  const code = 'ZEUS-' + base
  const link = `${APP_ORIGIN}/?ref=${encodeURIComponent(code)}`
  const shareText = `Join me on ZEUS Terminal — AI trading terminal. Use my code ${code}:`

  const [promo, setPromo] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true; setBusy(true)
    buildPromoImage(link, code, accent).then((d) => { if (alive) { setPromo(d); setBusy(false) } }).catch(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [link, code, accent])

  const shareLink = async () => {
    const nav = navigator as Navigator & { share?: (d: unknown) => Promise<void> }
    if (nav.share) { try { await nav.share({ title: 'ZEUS Terminal', text: shareText, url: link }); return } catch (_) { /* cancelled */ } }
    window.open('https://wa.me/?text=' + encodeURIComponent(shareText + ' ' + link), '_blank')
  }
  const shareImage = async () => {
    if (!promo) return
    try {
      const blob = await (await fetch(promo)).blob()
      const file = new File([blob], 'zeus-invite.png', { type: 'image/png' })
      const nav = navigator as Navigator & { share?: (d: unknown) => Promise<void>; canShare?: (d: unknown) => boolean }
      if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) { await nav.share({ files: [file], text: shareText, title: 'ZEUS Terminal' }); return }
    } catch (_) { /* fall through to download */ }
    downloadDataUrl(promo, 'zeus-invite.png')
  }
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch (_) { /* ignore */ }
  }

  const btn = (bg: string, br: string, col: string): React.CSSProperties => ({ flex: 1, fontFamily: 'monospace', fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', color: col, background: bg, border: `1px solid ${br}`, borderRadius: '5px', padding: '9px', cursor: 'pointer' })

  return (
    <div>
      {/* code */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <code style={{ flex: 1, fontFamily: 'monospace', fontSize: '15px', color: accent, background: 'rgba(0,0,0,0.4)', border: `1px dashed ${accent}66`, borderRadius: '5px', padding: '9px 12px', letterSpacing: '1px', textAlign: 'center' }}>{code}</code>
        <button onClick={copyLink} style={btn('rgba(255,255,255,0.06)', 'rgba(255,255,255,0.18)', 'rgba(255,255,255,0.75)')}>{copied ? 'COPIED ✓' : 'COPY'}</button>
      </div>

      {/* promo image preview */}
      <div style={{ textAlign: 'center', marginBottom: '10px' }}>
        {busy ? <div style={{ fontFamily: 'monospace', fontSize: '10px', color: 'rgba(255,255,255,0.4)', padding: '24px 0' }}>Building your invite image…</div>
          : promo ? <img src={promo} alt="invite" style={{ width: '160px', borderRadius: '8px', border: `1px solid ${accent}44`, boxShadow: `0 0 18px ${accent}33` }} />
            : null}
      </div>

      {/* share actions */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
        <button onClick={shareLink} style={btn(`${accent}1f`, accent, accent)}>📱 SHARE LINK</button>
        <button onClick={shareImage} disabled={!promo} style={btn('rgba(0,230,118,0.14)', '#00e67688', '#00e676')}>🖼️ SHARE IMAGE</button>
      </div>
      <button onClick={() => promo && downloadDataUrl(promo, 'zeus-invite.png')} disabled={!promo} style={{ ...btn('rgba(255,255,255,0.05)', 'rgba(255,255,255,0.15)', 'rgba(255,255,255,0.6)'), width: '100%' }}>⬇️ DOWNLOAD IMAGE</button>

      <div style={{ fontFamily: 'monospace', fontSize: '9px', color: 'rgba(255,255,255,0.35)', marginTop: '8px', lineHeight: 1.5 }}>
        Share your link or the promo image (QR + Zeus logo). Friends who join with your code get a bonus — and so do you.
      </div>
    </div>
  )
}

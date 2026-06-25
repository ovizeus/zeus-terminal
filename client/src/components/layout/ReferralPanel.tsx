import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { useProfileStore } from '../../stores/profileStore'
import { referralApi } from '../../services/api'
import { Icon } from './icons'

// [2026-06-25] Referral (Phase 3). Real server-issued unique code + joined count. Share via many
// targets (WhatsApp / Telegram / X / Facebook / Email / native / copy) and a generated promo image
// (Zeus logo + QR of the invite link + code) you can share or download. The link + QR open the app
// in the browser with ?ref=<code> so the signup is attributed to you.
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
  const accent = profile.accent_color || '#f0c040'

  const [code, setCode] = useState<string>('')
  const [joined, setJoined] = useState<number>(0)
  const [promo, setPromo] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [copied, setCopied] = useState(false)

  const link = code ? `${APP_ORIGIN}/?ref=${encodeURIComponent(code)}` : APP_ORIGIN
  const text = code ? `Join me on ZEUS Terminal — AI trading terminal. Use my code ${code}:` : 'Join me on ZEUS Terminal:'

  useEffect(() => { referralApi.get().then((r) => { if (r.ok) { setCode(r.code || ''); setJoined(r.joined || 0) } }) }, [])
  useEffect(() => {
    if (!code) return
    let alive = true; setBusy(true)
    buildPromoImage(link, code, accent).then((d) => { if (alive) { setPromo(d); setBusy(false) } }).catch(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [link, code, accent])

  const enc = encodeURIComponent
  const open = (u: string) => window.open(u, '_blank', 'noopener')
  const targets = [
    { name: 'whatsapp', label: 'WhatsApp', color: '#25D366', go: () => open(`https://wa.me/?text=${enc(text + ' ' + link)}`) },
    { name: 'telegram', label: 'Telegram', color: '#26A5E4', go: () => open(`https://t.me/share/url?url=${enc(link)}&text=${enc(text)}`) },
    { name: 'x', label: 'X', color: '#ffffff', go: () => open(`https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(link)}`) },
    { name: 'facebook', label: 'Facebook', color: '#1877F2', go: () => open(`https://www.facebook.com/sharer/sharer.php?u=${enc(link)}`) },
    { name: 'mail', label: 'Email', color: '#e0e0e0', go: () => { window.location.href = `mailto:?subject=${enc('Join me on ZEUS Terminal')}&body=${enc(text + ' ' + link)}` } },
    { name: 'share', label: 'More', color: accent, go: async () => { const n = navigator as Navigator & { share?: (d: unknown) => Promise<void> }; if (n.share) { try { await n.share({ title: 'ZEUS Terminal', text, url: link }) } catch (_) { /* cancelled */ } } else { open(`https://wa.me/?text=${enc(text + ' ' + link)}`) } } },
  ]

  const shareImage = async () => {
    if (!promo) return
    try {
      const blob = await (await fetch(promo)).blob()
      const file = new File([blob], 'zeus-invite.png', { type: 'image/png' })
      const n = navigator as Navigator & { share?: (d: unknown) => Promise<void>; canShare?: (d: unknown) => boolean }
      if (n.canShare && n.canShare({ files: [file] }) && n.share) { await n.share({ files: [file], text, title: 'ZEUS Terminal' }); return }
    } catch (_) { /* fall through */ }
    downloadDataUrl(promo, 'zeus-invite.png')
  }
  const copyLink = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch (_) { /* ignore */ } }

  return (
    <div>
      {/* code + joined */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <code style={{ flex: 1, fontFamily: 'monospace', fontSize: '15px', color: accent, background: 'rgba(0,0,0,0.4)', border: `1px dashed ${accent}66`, borderRadius: '5px', padding: '9px 12px', letterSpacing: '1px', textAlign: 'center' }}>{code || '…'}</code>
        <button onClick={copyLink} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontFamily: 'monospace', fontSize: '10px', fontWeight: 700, color: copied ? '#00e676' : 'rgba(255,255,255,0.75)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: '5px', padding: '9px 11px', cursor: 'pointer' }}>
          <Icon name={copied ? 'check' : 'link'} size={13} /> {copied ? 'COPIED' : 'COPY'}
        </button>
      </div>
      <div style={{ fontFamily: 'monospace', fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginBottom: '10px' }}>
        <span style={{ color: accent, fontWeight: 700 }}>{joined}</span> friend{joined === 1 ? '' : 's'} joined with your code
      </div>

      {/* share targets */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '6px', marginBottom: '12px' }}>
        {targets.map((t) => (
          <button key={t.name} onClick={t.go} title={t.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '7px', padding: '8px 2px', cursor: 'pointer' }}>
            <Icon name={t.name} size={18} color={t.color} />
            <span style={{ fontFamily: 'monospace', fontSize: '7px', color: 'rgba(255,255,255,0.55)', letterSpacing: '0.3px' }}>{t.label.toUpperCase()}</span>
          </button>
        ))}
      </div>

      {/* promo image */}
      <div style={{ textAlign: 'center', marginBottom: '10px' }}>
        {busy ? <div style={{ fontFamily: 'monospace', fontSize: '10px', color: 'rgba(255,255,255,0.4)', padding: '20px 0' }}>Building your invite image…</div>
          : promo ? <img src={promo} alt="invite" style={{ width: '150px', borderRadius: '8px', border: `1px solid ${accent}44`, boxShadow: `0 0 18px ${accent}33` }} /> : null}
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={shareImage} disabled={!promo} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontFamily: 'monospace', fontSize: '10px', fontWeight: 700, color: '#00e676', background: 'rgba(0,230,118,0.14)', border: '1px solid #00e67688', borderRadius: '5px', padding: '9px', cursor: 'pointer' }}>
          <Icon name="image" size={14} color="#00e676" /> SHARE IMAGE
        </button>
        <button onClick={() => promo && downloadDataUrl(promo, 'zeus-invite.png')} disabled={!promo} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontFamily: 'monospace', fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.7)', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: '5px', padding: '9px', cursor: 'pointer' }}>
          <Icon name="download" size={14} /> DOWNLOAD
        </button>
      </div>

      <div style={{ fontFamily: 'monospace', fontSize: '9px', color: 'rgba(255,255,255,0.35)', marginTop: '8px', lineHeight: 1.5 }}>
        Share your link or the promo image (QR + Zeus logo). Friends who join with your code get a bonus — and so do you.
      </div>
    </div>
  )
}

// [2026-11-27] Token Cloudflare Turnstile pentru login / inscriere / resetare in aplicatia React.
// Incarca ACELASI script ca pagina de start (/js/zt-turnstile.js) — o singura implementare.
// undefined = Turnstile oprit pe server (cererea pleaca exact ca inainte); string = token nou; null = esec.
let _loading: Promise<void> | null = null

function _load(): Promise<void> {
  const w = window as any
  if (w.ztTurnstileToken) return Promise.resolve()
  if (!_loading) {
    _loading = new Promise<void>((resolve) => {
      const s = document.createElement('script')
      s.src = '/js/zt-turnstile.js'
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => resolve()
      // scriptul nu sosete (retea proasta / mediu fara retea): nu tinem utilizatorul agatat
      setTimeout(resolve, 3000)
      document.head.appendChild(s)
    })
  }
  return _loading
}

export async function getTurnstileToken(): Promise<string | null | undefined> {
  try {
    await _load()
    const fn = (window as any).ztTurnstileToken
    return typeof fn === 'function' ? await fn() : undefined
  } catch {
    return null
  }
}

export function _resetTurnstileForTest(): void { _loading = null }

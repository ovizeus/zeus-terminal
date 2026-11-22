// [2026-11-22] Notificari pe telefon pentru mesajele importante (raspunsuri de la suport;
// la admin si mesajele utilizatorilor + conturile de aprobat). Pe web nu face nimic.
//
// Aplicatia Android (pluginul nativ ZeusNotify, din APK-ul 1.7.17) verifica singura in fundal,
// la 15 minute, cu o CHEIE a telefonului. Aici: o data dupa autentificare, telefonul isi cere
// cheia de la server, i-o da pluginului si cere voie pentru notificari. La revenirea in
// aplicatie se verifica imediat (notificarile citite dispar, cifra de pe iconita se actualizeaza).
//
// Cheia e legata de CONTUL curent: daca pe telefon intra alt cont, se cere una noua.

const UID_KEY = 'zt-notify-uid'

function _plugin(): any {
  const cap = (window as any).Capacitor
  if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return null
  const p = cap.Plugins && cap.Plugins.ZeusNotify
  return p && typeof p.setToken === 'function' ? p : null
}

let _started = false

export async function startPhoneNotify(userId: string | null, fetchImpl: typeof fetch = fetch): Promise<'unavailable' | 'ok' | 'error'> {
  const plugin = _plugin()
  if (!plugin || !userId) return 'unavailable'
  try {
    let bound: string | null = null
    try { bound = localStorage.getItem(UID_KEY) } catch { /* */ }
    const st = await plugin.hasToken()
    if (!st || !st.has || bound !== String(userId)) {
      if (st && st.has) await plugin.clearToken()
      const r = await fetchImpl('/api/notify/register', { method: 'POST', credentials: 'include', headers: { 'X-Zeus-Request': '1' } })
      const j = r && r.ok ? await r.json() : null
      if (!j || !j.token) return 'error'
      await plugin.setToken({ token: j.token })
      try { localStorage.setItem(UID_KEY, String(userId)) } catch { /* */ }
    }
    await plugin.requestPermission()
    if (!_started) {
      _started = true
      document.addEventListener('visibilitychange', () => { if (!document.hidden) { try { plugin.sync() } catch { /* */ } } })
    }
    try { await plugin.sync() } catch { /* */ }
    return 'ok'
  } catch (e: any) {
    try { console.warn('[NOTIFY]', e?.message || e) } catch { /* */ }
    return 'error'
  }
}

/** La deconectare: telefonul nu mai primeste notificari pentru contul acesta. */
export async function stopPhoneNotify(): Promise<void> {
  const plugin = _plugin()
  if (!plugin) return
  try { await plugin.clearToken() } catch { /* */ }
}

/** Dupa ce utilizatorul a citit mesajele in aplicatie: notificarile si cifra se actualizeaza acum. */
export function syncPhoneNotify(): void {
  const plugin = _plugin()
  if (!plugin) return
  try { plugin.sync() } catch { /* */ }
}

export function _resetForTest(): void { _started = false }

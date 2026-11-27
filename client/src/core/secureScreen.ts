// [2026-11-27] Capturile de ecran: in APK sunt blocate de la pornire (FLAG_SECURE in MainActivity);
// dupa login, aplicatia le deblocheaza DOAR pentru Super Admin (operatorul trimite capturi).
// Pe web nu se poate bloca nimic; pe un APK vechi pluginul ZeusSecure lipseste → nu face nimic.
export function applySecureScreen(role: string | null): void {
  try {
    const p = (window as any).Capacitor?.Plugins?.ZeusSecure
    if (!p || typeof p.setSecure !== 'function') return
    void Promise.resolve(p.setSecure({ on: role !== 'admin' })).catch(() => { /* fara plugin = nimic */ })
  } catch { /* nimic */ }
}

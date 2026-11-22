/**
 * [2026-11-22] Notificari pe telefon: cheia se cere o data per cont; alt cont = cheie noua; pe web nimic.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { startPhoneNotify, stopPhoneNotify, _resetForTest } from '../phoneNotify'

function mkPlugin(has = false) {
  const st = { has }
  return {
    hasToken: vi.fn(async () => ({ has: st.has, enabled: true })),
    setToken: vi.fn(async () => { st.has = true }),
    clearToken: vi.fn(async () => { st.has = false }),
    requestPermission: vi.fn(async () => ({ asked: true, enabled: true })),
    sync: vi.fn(async () => {}),
  }
}
const okFetch = () => vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, token: 'T'.repeat(43) }) })) as any

beforeEach(() => { _resetForTest(); localStorage.clear() })
afterEach(() => { delete (window as any).Capacitor })

describe('notificari pe telefon', () => {
  it('pe web (fara Capacitor) nu face nimic', async () => {
    const f = okFetch()
    expect(await startPhoneNotify('1', f)).toBe('unavailable')
    expect(f).not.toHaveBeenCalled()
  })
  it('APK vechi (fara pluginul ZeusNotify) nu face nimic', async () => {
    ;(window as any).Capacitor = { isNativePlatform: () => true, Plugins: {} }
    expect(await startPhoneNotify('1', okFetch())).toBe('unavailable')
  })
  it('prima data: cere cheia (POST cu antetul CSRF), o da pluginului, cere voie, verifica acum', async () => {
    const p = mkPlugin(false)
    ;(window as any).Capacitor = { isNativePlatform: () => true, Plugins: { ZeusNotify: p } }
    const f = okFetch()
    expect(await startPhoneNotify('1', f)).toBe('ok')
    expect(f).toHaveBeenCalledWith('/api/notify/register', expect.objectContaining({ method: 'POST', headers: { 'X-Zeus-Request': '1' } }))
    expect(p.setToken).toHaveBeenCalledWith({ token: 'T'.repeat(43) })
    expect(p.requestPermission).toHaveBeenCalled()
    expect(p.sync).toHaveBeenCalled()
  })
  it('a doua oara, acelasi cont: NU cere alta cheie', async () => {
    const p = mkPlugin(false)
    ;(window as any).Capacitor = { isNativePlatform: () => true, Plugins: { ZeusNotify: p } }
    await startPhoneNotify('1', okFetch())
    const f2 = okFetch()
    await startPhoneNotify('1', f2)
    expect(f2).not.toHaveBeenCalled()
  })
  it('alt cont pe acelasi telefon: sterge cheia veche si cere una noua', async () => {
    const p = mkPlugin(false)
    ;(window as any).Capacitor = { isNativePlatform: () => true, Plugins: { ZeusNotify: p } }
    await startPhoneNotify('1', okFetch())
    const f2 = okFetch()
    await startPhoneNotify('2', f2)
    expect(p.clearToken).toHaveBeenCalled()
    expect(f2).toHaveBeenCalledTimes(1)
  })
  it('la deconectare: pluginul uita cheia', async () => {
    const p = mkPlugin(true)
    ;(window as any).Capacitor = { isNativePlatform: () => true, Plugins: { ZeusNotify: p } }
    await stopPhoneNotify()
    expect(p.clearToken).toHaveBeenCalled()
  })
})

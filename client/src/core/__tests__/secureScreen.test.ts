// [2026-11-27] Capturile de ecran blocate in APK (FLAG_SECURE), deblocate doar pentru Super Admin
// (operatorul isi trimite capturi). Pe web nu exista asa ceva; pe un APK vechi pluginul lipseste → nimic.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { applySecureScreen } from '../secureScreen'

afterEach(() => { delete (window as any).Capacitor })

describe('applySecureScreen', () => {
  it('user obisnuit → capturile raman blocate (on: true)', () => {
    const setSecure = vi.fn(async () => ({}))
    ;(window as any).Capacitor = { Plugins: { ZeusSecure: { setSecure } } }
    applySecureScreen('user')
    expect(setSecure).toHaveBeenCalledWith({ on: true })
  })
  it('Super Admin → deblocate (on: false)', () => {
    const setSecure = vi.fn(async () => ({}))
    ;(window as any).Capacitor = { Plugins: { ZeusSecure: { setSecure } } }
    applySecureScreen('admin')
    expect(setSecure).toHaveBeenCalledWith({ on: false })
  })
  it('rol necunoscut (null) → blocate (cade inchis)', () => {
    const setSecure = vi.fn(async () => ({}))
    ;(window as any).Capacitor = { Plugins: { ZeusSecure: { setSecure } } }
    applySecureScreen(null)
    expect(setSecure).toHaveBeenCalledWith({ on: true })
  })
  it('web / APK vechi fara plugin → nu arunca', () => {
    expect(() => applySecureScreen('user')).not.toThrow()
    ;(window as any).Capacitor = { Plugins: {} }
    expect(() => applySecureScreen('user')).not.toThrow()
  })
})

describe('legatura cu authStore', () => {
  it('cand rolul se schimba (login / logout), blocarea se reaplica', async () => {
    const setSecure = vi.fn(async () => ({}))
    ;(window as any).Capacitor = { Plugins: { ZeusSecure: { setSecure } } }
    const { useAuthStore } = await import('../../stores/authStore')
    useAuthStore.setState({ role: 'admin' } as never)
    expect(setSecure).toHaveBeenLastCalledWith({ on: false })
    useAuthStore.setState({ role: null } as never)
    expect(setSecure).toHaveBeenLastCalledWith({ on: true })
  })
})

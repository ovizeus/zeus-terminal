/**
 * [2026-11-22] Alerts › Phone notifications: casutele vin de pe server si se salveaza imediat.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { PhoneNotifySection } from '../PhoneNotifySection'

afterEach(() => vi.unstubAllGlobals())
const PREFS = { support: true, price: true, atEntry: true, atExit: true, safety: true }

describe('Phone notifications', () => {
  it('arata cele 5 casute cu starea de pe server; o bifa se salveaza imediat (POST cu CSRF)', async () => {
    const calls: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      calls.push({ url, init })
      if (init && init.method === 'POST') return { ok: true, json: async () => ({ ok: true, prefs: { ...PREFS, ...JSON.parse(init.body) } }) }
      return { ok: true, json: async () => ({ ok: true, prefs: PREFS }) }
    }))
    const { container } = render(<PhoneNotifySection />)
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    const boxes = container.querySelectorAll('input[type="checkbox"]')
    expect(boxes).toHaveLength(5)
    expect(screen.getByText(/Auto-trade entries/)).toBeTruthy()
    expect(screen.getByText(/Big price moves/)).toBeTruthy()
    const entry = container.querySelector('input[data-notify-key="atEntry"]') as HTMLInputElement
    expect(entry.checked).toBe(true)
    await act(async () => { fireEvent.click(entry) })
    const post = calls.find((c) => c.init && c.init.method === 'POST')
    expect(post.url).toBe('/api/notify/prefs')
    expect(post.init.headers['X-Zeus-Request']).toBe('1')
    expect(JSON.parse(post.init.body)).toEqual({ atEntry: false })
    expect((container.querySelector('input[data-notify-key="atEntry"]') as HTMLInputElement).checked).toBe(false)
  })
  it('salvare esuata → bifa revine si apare mesaj', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: any) => (init && init.method === 'POST')
      ? { ok: false, json: async () => ({}) }
      : { ok: true, json: async () => ({ ok: true, prefs: PREFS }) }))
    const { container } = render(<PhoneNotifySection />)
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    await act(async () => { fireEvent.click(container.querySelector('input[data-notify-key="price"]') as HTMLInputElement) })
    expect((container.querySelector('input[data-notify-key="price"]') as HTMLInputElement).checked).toBe(true)
    expect(screen.getByRole('alert').textContent).toMatch(/Not saved/)
  })
})

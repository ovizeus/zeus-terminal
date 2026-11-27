/**
 * [2026-11-27] Settings › Security › Anti-phishing code.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { AntiPhishingSection } from '../AntiPhishingSection'

afterEach(() => vi.unstubAllGlobals())
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

describe('Anti-phishing code', () => {
  it('arata codul salvat si salveaza unul nou (POST cu CSRF)', async () => {
    const calls: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      calls.push({ url, init })
      if (init && init.method === 'POST') return { ok: true, json: async () => ({ ok: true, code: JSON.parse(init.body).code }) }
      return { ok: true, json: async () => ({ ok: true, code: 'tiger' }) }
    }))
    const { container } = render(<AntiPhishingSection />)
    await tick()
    const inp = container.querySelector('input[data-antiphish]') as HTMLInputElement
    expect(inp.value).toBe('tiger')
    fireEvent.change(inp, { target: { value: 'Blue Fox' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save code/ })) })
    await tick()
    const post = calls.find((c) => c.init && c.init.method === 'POST')
    expect(post.url).toBe('/auth/security/anti-phishing')
    expect(post.init.headers['X-Zeus-Request']).toBe('1')
    expect(JSON.parse(post.init.body)).toEqual({ code: 'Blue Fox' })
    expect(screen.getByText(/Saved/)).toBeTruthy()
  })
  it('eroarea serverului apare sub camp', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: any) => (init && init.method === 'POST')
      ? { ok: false, json: async () => ({ ok: false, error: 'Use 3 to 20 letters, digits, spaces or dashes.' }) }
      : { ok: true, json: async () => ({ ok: true, code: null }) }))
    const { container } = render(<AntiPhishingSection />)
    await tick()
    fireEvent.change(container.querySelector('input[data-antiphish]')!, { target: { value: '<b>' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save code/ })) })
    await tick()
    expect(screen.getByText(/3 to 20 letters/)).toBeTruthy()
  })
})

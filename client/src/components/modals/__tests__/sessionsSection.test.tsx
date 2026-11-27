/**
 * [2026-11-27] Settings › Security › Sign-ins: ultimele intrari + „Sign out everywhere else".
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { SessionsSection } from '../SessionsSection'

afterEach(() => vi.unstubAllGlobals())
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

describe('Sign-ins', () => {
  it('arata ultimele intrari (ora, IP, dispozitiv)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, signins: [{ ip: '9.9.9.9', at: '2026-11-27 20:00:00', device: 'Chrome on Android' }] }) })))
    render(<SessionsSection />)
    await tick()
    expect(screen.getByText(/9\.9\.9\.9/)).toBeTruthy()
    expect(screen.getByText(/Chrome on Android/)).toBeTruthy()
    expect(screen.getByText(/2026-11-27 20:00/)).toBeTruthy()
  })
  it('„Sign out everywhere else" cere confirmare, trimite POST cu CSRF si spune rezultatul', async () => {
    const calls: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => { calls.push({ url, init }); return { ok: true, json: async () => ({ ok: true, signins: [] }) } }))
    const { useConfirmDialog } = await import('../../common/confirmDialog')
    render(<SessionsSection />)
    await tick()
    fireEvent.click(screen.getByRole('button', { name: /Sign out everywhere else/ }))
    await tick()
    expect(useConfirmDialog.getState().req).toBeTruthy()
    await act(async () => { useConfirmDialog.getState().settle(true) })
    await tick()
    const post = calls.find((c) => c.url === '/auth/security/logout-others')
    expect(post.init.method).toBe('POST')
    expect(post.init.headers['X-Zeus-Request']).toBe('1')
    expect(screen.getByText(/signed out everywhere else/i)).toBeTruthy()
  })
})

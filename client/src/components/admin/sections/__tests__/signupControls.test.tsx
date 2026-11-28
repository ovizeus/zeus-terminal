/**
 * [2026-11-27] Admin › Users: inscrierile on/off + stergerea tuturor conturilor blocate (botii).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { SignupControls } from '../SignupControls'

afterEach(() => vi.unstubAllGlobals())

function stub(open = true, deleted = 39) {
  const calls: any[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    calls.push({ url, init })
    if (url === '/auth/admin/registration' && (!init || init.method !== 'POST')) return { ok: true, json: async () => ({ ok: true, open }) }
    if (url === '/auth/admin/registration') return { ok: true, json: async () => ({ ok: true, open: JSON.parse(init.body).open }) }
    if (url === '/auth/admin/delete-blocked') return { ok: true, json: async () => ({ ok: true, deleted, errors: [] }) }
    return { ok: false, json: async () => ({}) }
  }))
  return calls
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

describe('SignupControls', () => {
  it('arata starea inscrierilor si o comuta (POST cu CSRF)', async () => {
    const calls = stub(true)
    render(<SignupControls blockedCount={39} onChanged={() => {}} />)
    await flush()
    expect(screen.getByText(/Sign-ups: OPEN/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Close sign-ups/ }))
    // [2026-11-28] cere confirmare: pana la confirmare nu pleaca nimic
    expect(calls.find((c) => c.init && c.init.method === 'POST')).toBeUndefined()
    expect(screen.getByText(/Close sign-ups\?/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close' })) })
    await flush()
    const post = calls.find((c) => c.init && c.init.method === 'POST')
    expect(post.init.headers['X-Zeus-Request']).toBe('1')
    expect(JSON.parse(post.init.body)).toEqual({ open: false })
    expect(screen.getByText(/Sign-ups: CLOSED/)).toBeTruthy()
  })
  it('stergerea blocatelor cere textul tastat; dupa confirmare raporteaza cate s-au sters', async () => {
    const calls = stub(true, 39)
    const onChanged = vi.fn()
    render(<SignupControls blockedCount={39} onChanged={onChanged} />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: /Delete all blocked \(39\)/ }))
    const confirmBtn = screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement
    expect(confirmBtn.disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText(/DELETE BLOCKED/), { target: { value: 'DELETE BLOCKED' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete' })) })
    await flush()
    const del = calls.find((c) => c.url === '/auth/admin/delete-blocked')
    expect(JSON.parse(del.init.body)).toEqual({ confirm: 'DELETE BLOCKED' })
    expect(screen.getByText(/39 blocked accounts deleted/)).toBeTruthy()
    expect(onChanged).toHaveBeenCalled()
  })
  it('fara conturi blocate, butonul de stergere e dezactivat', async () => {
    stub(true)
    render(<SignupControls blockedCount={0} onChanged={() => {}} />)
    await flush()
    expect((screen.getByRole('button', { name: /Delete all blocked \(0\)/ }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('[2026-11-28] Cancel la confirmare nu schimba nimic', async () => {
    const calls = stub(true)
    render(<SignupControls blockedCount={0} onChanged={() => {}} />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: /Close sign-ups/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await flush()
    expect(calls.find((c) => c.init && c.init.method === 'POST')).toBeUndefined()
    expect(screen.getByText(/Sign-ups: OPEN/)).toBeTruthy()
  })
  it('[2026-11-28] redeschiderea cere si ea confirmare', async () => {
    const calls = stub(false)
    render(<SignupControls blockedCount={0} onChanged={() => {}} />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: /Open sign-ups/ }))
    expect(screen.getByText(/Open sign-ups\?/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open' })) })
    await flush()
    expect(JSON.parse(calls.find((c) => c.init && c.init.method === 'POST').init.body)).toEqual({ open: true })
    expect(screen.getByText(/Sign-ups: OPEN/)).toBeTruthy()
  })
})

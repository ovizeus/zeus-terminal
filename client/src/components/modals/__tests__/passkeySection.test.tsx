/**
 * [2026-11-28] Settings › Security › Passkeys.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

const pk = vi.hoisted(() => ({ supported: true, add: vi.fn() }))
vi.mock('../../../services/passkey', () => ({
  passkeySupported: () => pk.supported,
  addPasskey: (...a: any[]) => pk.add(...a),
  deviceName: () => 'Chrome on Windows',
}))
import { PasskeySection } from '../PasskeySection'

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
let calls: any[]
function server(state: { enabled: boolean; needsCode?: boolean; list: any[] }) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null })
    const j = (b: any, ok = true) => ({ ok, status: ok ? 200 : 403, json: async () => b, text: async () => JSON.stringify(b) })
    if (url === '/api/passkeys') return j({ ok: true, enabled: state.enabled, needsCode: !!state.needsCode, passkeys: state.list })
    if (url === '/api/passkeys/remove') {
      const b = JSON.parse(init.body)
      if (b.password !== 'pw') return j({ ok: false, error: 'Wrong password.' }, false)
      state.list = state.list.filter((p) => p.id !== b.id); return j({ ok: true })
    }
    return j({ ok: false }, false)
  }))
}
beforeEach(() => { pk.supported = true; pk.add.mockReset() })
afterEach(() => vi.unstubAllGlobals())
const P = (id: number, name: string) => ({ id, name, createdAt: Date.parse('2026-11-28'), lastUsedAt: null, synced: true })

describe('PasskeySection', () => {
  it('serverul cu passkey oprit → sectiunea nu apare', async () => {
    server({ enabled: false, list: [] })
    const { container } = render(<PasskeySection />)
    await tick()
    expect(container.innerHTML).toBe('')
  })
  it('browser fara passkey (sau aplicatia Android) → nu apare si nici nu intreaba serverul', async () => {
    pk.supported = false
    server({ enabled: true, list: [] })
    const { container } = render(<PasskeySection />)
    await tick()
    expect(container.innerHTML).toBe('')
    expect(calls).toHaveLength(0)
  })
  it('lista passkey-urilor, cu data adaugarii', async () => {
    server({ enabled: true, list: [P(1, 'Laptop'), P(2, 'Phone')] })
    render(<PasskeySection />)
    await tick()
    expect(screen.getByText('Laptop')).toBeTruthy()
    expect(screen.getByText('Phone')).toBeTruthy()
    expect(screen.getAllByText(/added 2026-11-28/)).toHaveLength(2)
  })
  it('adaugare: nume implicit + parola → addPasskey; fara 2FA nu cere cod', async () => {
    const st = { enabled: true, list: [] as any[] }
    server(st)
    pk.add.mockImplementation(async () => { st.list = [P(9, 'Chrome on Windows')]; return { ok: true } })
    render(<PasskeySection />)
    await tick()
    fireEvent.click(screen.getByRole('button', { name: 'Add a passkey' }))
    expect((document.querySelector('[data-passkey="name"]') as HTMLInputElement).value).toBe('Chrome on Windows')
    expect(document.querySelector('[data-passkey="code"]')).toBeNull()
    const cont = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement
    expect(cont.disabled).toBe(true)
    fireEvent.change(document.querySelector('[data-passkey="password"]')!, { target: { value: 'pw' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue' })) })
    await tick()
    expect(pk.add).toHaveBeenCalledWith('pw', '', 'Chrome on Windows')
    expect(screen.getByText(/Passkey added/)).toBeTruthy()
    expect(screen.getByText('Chrome on Windows')).toBeTruthy()
  })
  it('cu 2FA pornit cere si codul', async () => {
    server({ enabled: true, needsCode: true, list: [] })
    pk.add.mockResolvedValue({ ok: false, error: 'Wrong two-factor code.' })
    render(<PasskeySection />)
    await tick()
    fireEvent.click(screen.getByRole('button', { name: 'Add a passkey' }))
    fireEvent.change(document.querySelector('[data-passkey="password"]')!, { target: { value: 'pw' } })
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(document.querySelector('[data-passkey="code"]')!, { target: { value: '111111' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue' })) })
    await tick()
    expect(pk.add).toHaveBeenCalledWith('pw', '111111', 'Chrome on Windows')
    expect(screen.getByText('Wrong two-factor code.')).toBeTruthy()
  })
  it('stergere cu parola; parola gresita → mesaj, ramane in lista', async () => {
    server({ enabled: true, list: [P(1, 'Laptop')] })
    render(<PasskeySection />)
    await tick()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.change(document.querySelector('[data-passkey="password"]')!, { target: { value: 'bad' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove passkey' })) })
    await tick()
    expect(screen.getByText('Wrong password.')).toBeTruthy()
    fireEvent.change(document.querySelector('[data-passkey="password"]')!, { target: { value: 'pw' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove passkey' })) })
    await tick()
    expect(calls.find((c) => c.url === '/api/passkeys/remove').body).toEqual({ id: 1, password: 'bad' })
    expect(screen.getByText('Passkey removed.')).toBeTruthy()
    expect(screen.queryByText('Laptop')).toBeNull()
  })
})

/**
 * [2026-11-28] Passkey — ajutoarele din client (biblioteca browserului e simulata).
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'

const lib = vi.hoisted(() => ({ supports: true, auth: vi.fn(), reg: vi.fn() }))
vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: () => lib.supports,
  startAuthentication: (a: any) => lib.auth(a),
  startRegistration: (a: any) => lib.reg(a),
}))
import { deviceName, friendlyError, passkeySupported, signInWithPasskey, addPasskey, passkeyLoginEnabled } from '../passkey'

const j = (b: any, ok = true) => ({ ok, status: ok ? 200 : 401, json: async () => b, text: async () => JSON.stringify(b) })
let calls: any[]
beforeEach(() => { lib.supports = true; lib.auth.mockReset(); lib.reg.mockReset(); calls = [] })
afterEach(() => { vi.unstubAllGlobals(); delete (window as any).Capacitor })

function server(routes: Record<string, any>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null, headers: init && init.headers })
    const r = routes[url]
    return r ? j(r.body, r.ok !== false) : j({ ok: false }, false)
  }))
}

describe('passkeySupported', () => {
  it('pe web cu WebAuthn: da', () => { expect(passkeySupported()).toBe(true) })
  it('fara WebAuthn: nu', () => { lib.supports = false; expect(passkeySupported()).toBe(false) })
  it('in aplicatia Android (Capacitor nativ): nu, chiar daca browserul pare sa stie', () => {
    (window as any).Capacitor = { isNativePlatform: () => true }
    expect(passkeySupported()).toBe(false)
  })
})

describe('texte', () => {
  it('erorile browserului pe intelesul omului', () => {
    expect(friendlyError({ name: 'NotAllowedError' })).toMatch(/Cancelled/)
    expect(friendlyError({ name: 'InvalidStateError' })).toMatch(/already has a passkey/)
    expect(friendlyError(new Error('x'))).toMatch(/could not use a passkey/)
  })
  it('numele implicit al dispozitivului', () => {
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/131.0 Safari/537.36')).toBe('Chrome on Windows')
    expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) AppleWebKit Version/18.0 Mobile Safari/604.1')).toBe('Safari on iPhone')
    expect(deviceName('Mozilla/5.0 (Linux; Android 14) AppleWebKit Chrome/131.0 Mobile Safari/537.36')).toBe('Chrome on Android')
  })
})

describe('intrare', () => {
  it('config: pornit doar daca serverul spune enabled', async () => {
    server({ '/auth/passkey/config': { body: { ok: true, enabled: true } } })
    expect(await passkeyLoginEnabled()).toBe(true)
    server({ '/auth/passkey/config': { body: { ok: true, enabled: false } } })
    expect(await passkeyLoginEnabled()).toBe(false)
  })
  it('options → browserul semneaza → verify (cu CSRF); raspunsul trimis e cel din browser', async () => {
    server({
      '/auth/passkey/options': { body: { ok: true, challengeId: 'cid', options: { challenge: 'ch' } } },
      '/auth/passkey/verify': { body: { ok: true, email: 'a@x.ro' } },
    })
    lib.auth.mockResolvedValue({ id: 'cred1' })
    expect(await signInWithPasskey()).toEqual({ ok: true })
    expect(lib.auth).toHaveBeenCalledWith({ optionsJSON: { challenge: 'ch' } })
    const v = calls.find((c) => c.url === '/auth/passkey/verify')
    expect(v.body).toEqual({ challengeId: 'cid', response: { id: 'cred1' } })
    expect(v.headers['X-Zeus-Request']).toBe('1')
  })
  it('anulat in browser → mesaj, fara verify', async () => {
    server({ '/auth/passkey/options': { body: { ok: true, challengeId: 'cid', options: { challenge: 'ch' } } } })
    lib.auth.mockRejectedValue({ name: 'NotAllowedError' })
    const r = await signInWithPasskey()
    expect(r.ok).toBe(false)
    expect(calls.some((c) => c.url === '/auth/passkey/verify')).toBe(false)
  })
  it('serverul refuza → mesajul serverului', async () => {
    server({
      '/auth/passkey/options': { body: { ok: true, challengeId: 'cid', options: { challenge: 'ch' } } },
      '/auth/passkey/verify': { ok: false, body: { error: 'This passkey is not registered with Zeus.' } },
    })
    lib.auth.mockResolvedValue({ id: 'x' })
    expect(await signInWithPasskey()).toEqual({ ok: false, error: 'This passkey is not registered with Zeus.' })
  })
})

describe('adaugare', () => {
  it('parola (+cod) → options → browserul creeaza → verify cu numele', async () => {
    server({
      '/api/passkeys/register/options': { body: { ok: true, options: { challenge: 'rc' } } },
      '/api/passkeys/register/verify': { body: { ok: true, id: 3 } },
    })
    lib.reg.mockResolvedValue({ id: 'new' })
    expect(await addPasskey('pw', ' 123456 ', 'My phone')).toEqual({ ok: true })
    expect(calls[0].body).toEqual({ password: 'pw', code: '123456' })
    expect(lib.reg).toHaveBeenCalledWith({ optionsJSON: { challenge: 'rc' } })
    expect(calls[1].body).toEqual({ response: { id: 'new' }, name: 'My phone' })
  })
  it('parola gresita → mesajul serverului, browserul nu e deranjat', async () => {
    server({ '/api/passkeys/register/options': { ok: false, body: { ok: false, error: 'Wrong password.' } } })
    expect(await addPasskey('x', '', 'n')).toMatchObject({ ok: false, error: 'Wrong password.' })
    expect(lib.reg).not.toHaveBeenCalled()
  })
})

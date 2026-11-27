/**
 * [2026-11-27] Admin › Users: raportul de securitate pe ultimele 24 h (Sentinel, etapa 3).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { SecurityReport } from '../SecurityReport'

afterEach(() => vi.unstubAllGlobals())
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

describe('Security report', () => {
  it('arata cifrele zilei si IP-urile cele mai active', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true,
      report: { hours: 24, failedSignIns: 12, resetRequests: 38, signUps: 9, blockedSignUps: 7, signIns: 4, topFailIps: [{ ip: '83.141.90.134', n: 35 }] },
      sentinel: { alertsSent: 2 } }) })))
    render(<SecurityReport />)
    await tick()
    expect(screen.getByText(/Last 24 hours/)).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByText('38')).toBeTruthy()
    expect(screen.getByText(/7 blocked as bots/)).toBeTruthy()
    expect(screen.getByText(/83\.141\.90\.134/)).toBeTruthy()
    expect(screen.getByText(/2 alerts sent today/)).toBeTruthy()
  })
  it('raport indisponibil → mesaj, nu se strica panoul', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    render(<SecurityReport />)
    await tick()
    expect(screen.getByText(/Security report unavailable/)).toBeTruthy()
  })
})

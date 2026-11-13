import { describe, it, expect, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { ZeusDock } from '../ZeusDock'
import { useAuthStore } from '../../../stores'
import { currentBetaNotice, hideBetaNotice } from '../../../core/betaGate'

// [BETA-GATE 2026-11-13] Dock-ul pentru un cont 'viewer': pictogramele de
// activitate raman la vedere, cu lacat, si apasate arata mesajul de beta.
const setAuth = (over: Record<string, unknown>) =>
    useAuthStore.setState({ authenticated: true, userId: '21', email: 'v@t.io', role: 'user', accessLevel: 'viewer', accessKnown: true, loading: false, ...over } as any)

describe('ZeusDock sub lacat', () => {
    beforeEach(() => { hideBetaNotice() })

    it('viewer: activitatea are lacat, informatia nu; nimic nu dispare', () => {
        setAuth({})
        const { container } = render(<ZeusDock active={null} onDockClick={() => {}} />)
        const item = (id: string) => container.querySelector(`[data-dock="${id}"]`) as HTMLElement
        for (const id of ['autotrade', 'manual-trade', 'dsl', 'dsl-drive', 'omega', 'ares', 'multi-exchange']) {
            expect([id, !!item(id), item(id).classList.contains('zd-locked'), !!item(id).querySelector('.zd-lock')]).toEqual([id, true, true, true])
        }
        for (const id of ['liqmap', 'liquidations', 'market-metrics', 'flow']) {
            expect([id, !!item(id), item(id).classList.contains('zd-locked')]).toEqual([id, true, false])
        }
        expect(item('admin')).toBeNull()      // adminul ramane doar al adminului
    })

    it('viewer: apasarea pe un lacat NU deschide panoul si arata mesajul cu numele functiei', () => {
        setAuth({})
        const opened: string[] = []
        const { container } = render(<ZeusDock active={null} onDockClick={(id) => opened.push(id)} />)
        fireEvent.click(container.querySelector('[data-dock="autotrade"]') as HTMLElement)
        expect(opened).toEqual([])
        expect(currentBetaNotice()).toBe('AutoTrade')
        hideBetaNotice()
        fireEvent.click(container.querySelector('[data-dock="liqmap"]') as HTMLElement)
        expect(opened).toEqual(['liqmap'])
        expect(currentBetaNotice()).toBeNull()
    })

    it('⛔ full: niciun lacat, totul se deschide ca inainte', () => {
        setAuth({ accessLevel: 'full' })
        const opened: string[] = []
        const { container } = render(<ZeusDock active={null} onDockClick={(id) => opened.push(id)} />)
        expect(container.querySelectorAll('.zd-locked').length).toBe(0)
        fireEvent.click(container.querySelector('[data-dock="autotrade"]') as HTMLElement)
        fireEvent.click(container.querySelector('[data-dock="omega"]') as HTMLElement)
        expect(opened).toEqual(['autotrade', 'omega'])
        expect(currentBetaNotice()).toBeNull()
    })

    it('⛔ nivel inca neconfirmat de server: niciun lacat (un cont full nu vede lacate la pornire)', () => {
        setAuth({ accessLevel: 'viewer', accessKnown: false })
        const { container } = render(<ZeusDock active={null} onDockClick={() => {}} />)
        expect(container.querySelectorAll('.zd-locked').length).toBe(0)
    })
})

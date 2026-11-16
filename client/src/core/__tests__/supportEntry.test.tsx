import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'
import { supportTarget, supportBadge, badgeText } from '../supportEntry'

// [2026-11-15] Suportul a plecat din Settings si are pictograma lui in antet.
// La admin oglindeste casuta din Admin → Support / Ops.

describe('cine ce deschide', () => {
    it('un utilizator ajunge in fereastra lui de suport', () => {
        expect(supportTarget('user')).toEqual({ modal: 'support', section: null })
        expect(supportTarget(null)).toEqual({ modal: 'support', section: null })
        expect(supportTarget(undefined)).toEqual({ modal: 'support', section: null })
    })
    it('adminul ajunge direct in Admin → Support / Ops', () => {
        expect(supportTarget('admin')).toEqual({ modal: 'adminPage', section: 'support' })
    })
    it('⛔ doar rolul exact „admin" deschide panoul de admin', () => {
        for (const r of ['Admin', 'ADMIN', 'administrator', 'user ', '']) expect(supportTarget(r).modal).toBe('support')
    })
})

describe('bulina', () => {
    it('adminul vede mesajele necitite de la utilizatori; un utilizator doar raspunsurile lui', () => {
        expect(supportBadge('admin', 4, 9)).toBe(4)
        expect(supportBadge('user', 4, 9)).toBe(9)
    })
    it('zero, negativ sau gunoi = fara bulina', () => {
        expect(supportBadge('admin', 0, 5)).toBe(0)
        expect(supportBadge('user', 5, 0)).toBe(0)
        expect(supportBadge('user', 5, NaN as any)).toBe(0)
        expect(supportBadge('user', 5, -2)).toBe(0)
    })
    it('peste 99 se scrie 99+', () => {
        expect(badgeText(7)).toBe('7')
        expect(badgeText(99)).toBe('99')
        expect(badgeText(100)).toBe('99+')
    })
})

describe('pictograma din antet', () => {
    let Header: any, useAuthStore: any, useUiStore: any, useSupportStore: any, useAdminStore: any
    beforeEach(async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, totalUnread: 3, unread: 2 }) })))
        ;({ Header } = await import('../../components/layout/Header'))
        ;({ useAuthStore, useUiStore } = await import('../../stores'))
        ;({ useSupportStore } = await import('../../stores/supportStore'))
        ;({ useAdminStore } = await import('../../stores/adminStore'))
        useUiStore.setState({ activeModal: null } as any)
        useAdminStore.setState({ entrySection: null } as any)
        useSupportStore.setState({ adminUnread: 0, userUnread: 0 } as any)
    })
    afterEach(() => { vi.unstubAllGlobals() })
    const login = (role: string) => useAuthStore.setState({ authenticated: true, userId: '1', email: 'a@t.io', role, accessLevel: 'full', accessKnown: true, loading: false } as any)

    it('sta INAINTEA cautarii si a setarilor si are aceeasi marime', () => {
        login('user')
        const { container } = render(<Header />)
        const ids = [...container.querySelectorAll('.hdr-btns .sbtn')].map((b) => b.id || (b.getAttribute('title') || ''))
        const iSupport = ids.indexOf('supportBtn'), iSearch = ids.indexOf('cmdPaletteBtn'), iSettings = ids.findIndex((x) => x.startsWith('Settings'))
        expect(iSupport).toBeGreaterThanOrEqual(0)
        expect(iSupport).toBeLessThan(iSearch)
        expect(iSearch).toBeLessThan(iSettings)
        const size = (sel: string) => { const s = container.querySelector(sel + ' svg') as SVGElement; return [s.getAttribute('width'), s.getAttribute('height')] }
        expect(size('#supportBtn')).toEqual(size('#cmdPaletteBtn'))
    })

    it('utilizator: apasarea deschide fereastra de suport; bulina arata raspunsurile lui', async () => {
        login('user')
        const { container } = render(<Header />)
        await waitFor(() => expect(container.querySelector('#supportBtn .sbtn-badge')?.textContent).toBe('2'))
        fireEvent.click(container.querySelector('#supportBtn') as HTMLElement)
        expect(useUiStore.getState().activeModal).toBe('support')
        expect(useAdminStore.getState().entrySection).toBeNull()
    })

    it('admin: bulina arata mesajele utilizatorilor, iar apasarea deschide Admin → Support / Ops', async () => {
        login('admin')
        const { container } = render(<Header />)
        await waitFor(() => expect(container.querySelector('#supportBtn .sbtn-badge')?.textContent).toBe('3'))
        fireEvent.click(container.querySelector('#supportBtn') as HTMLElement)
        expect(useUiStore.getState().activeModal).toBe('adminPage')
        expect(useAdminStore.getState().entrySection).toBe('support')
    })

    it('admin: un mesaj VIU de la un utilizator urca bulina pe loc', async () => {
        login('admin')
        const { container } = render(<Header />)
        await waitFor(() => expect(container.querySelector('#supportBtn .sbtn-badge')?.textContent).toBe('3'))
        useSupportStore.getState().onIncoming({ id: 99, user_id: 21, sender: 'user', message: 'hello' } as any)
        await waitFor(() => expect(container.querySelector('#supportBtn .sbtn-badge')?.textContent).toBe('4'))
    })

    it('pictograma de setari nu mai poarta bulina suportului', async () => {
        login('user')
        const { container } = render(<Header />)
        await waitFor(() => expect(container.querySelector('#supportBtn .sbtn-badge')).toBeTruthy())
        expect(container.querySelectorAll('.sbtn-badge').length).toBe(1)
    })
})

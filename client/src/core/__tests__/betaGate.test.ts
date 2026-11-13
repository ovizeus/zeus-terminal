import { describe, it, expect, beforeEach } from 'vitest'
import {
    accessLevelFrom, isDockLocked, isModalLocked, lockedLabel, lockedApiFeature,
    installBetaFetchGuard, setAccessLevel, resetAccessLevel, currentBetaNotice, hideBetaNotice, onBetaNotice,
    BETA_MESSAGE,
} from '../betaGate'

// [BETA-GATE 2026-11-13] Lacatele din aplicatie. Poarta adevarata e pe server;
// aici se verifica doar ca aplicatia nu arata viewerului usi care nu se deschid
// fara sa-i spuna de ce.

describe('accessLevelFrom — cade inchis', () => {
    it('adminul e mereu full', () => {
        expect(accessLevelFrom({ role: 'admin' })).toBe('full')
        expect(accessLevelFrom({ role: 'admin', accessLevel: 'viewer' })).toBe('full')
    })
    it('un user e full doar cand serverul spune exact asta', () => {
        expect(accessLevelFrom({ role: 'user', accessLevel: 'full' })).toBe('full')
        for (const v of ['viewer', undefined, null, '', 'FULL', true, 1]) {
            expect(accessLevelFrom({ role: 'user', accessLevel: v })).toBe('viewer')
        }
        expect(accessLevelFrom(null)).toBe('viewer')
        expect(accessLevelFrom({})).toBe('viewer')
    })
})

describe('lacatele', () => {
    it('activitatea e sub lacat pentru viewer', () => {
        for (const id of ['autotrade', 'manual-trade', 'dsl', 'dsl-drive', 'omega', 'ares', 'multi-exchange', 'theia', 'postmortem', 'pnllab', 'activity']) {
            expect([id, isDockLocked(id, 'viewer')]).toEqual([id, true])
        }
    })
    it('chartul, lichidarile si informatia raman deschise', () => {
        for (const id of ['liqmap', 'liquidations', 'market-metrics', 'flow', 'quantmonitor', 'mtf', 'aria', 'nova']) {
            expect([id, isDockLocked(id, 'viewer')]).toEqual([id, false])
        }
    })
    it('pentru un cont full nimic nu e sub lacat', () => {
        for (const id of ['autotrade', 'omega', 'ares', 'theia']) expect(isDockLocked(id, 'full')).toBe(false)
        expect(isModalLocked('byoi', 'full')).toBe(false)
    })
    it('BYOI si ferestrele de jurnal sunt sub lacat; setarile si chartul nu', () => {
        for (const id of ['byoi', 'performance', 'decisionlog', 'missed', 'session']) expect(isModalLocked(id, 'viewer')).toBe(true)
        for (const id of ['settings', 'charts', 'welcome', 'notifications']) expect(isModalLocked(id, 'viewer')).toBe(false)
    })
    it('nume proprietati mostenite nu trec drept lacat', () => {
        expect(isDockLocked('constructor', 'viewer')).toBe(false)
        expect(isModalLocked('toString', 'viewer')).toBe(false)
    })
    it('mesajul poarta numele functiei', () => {
        expect(lockedLabel('autotrade')).toBe('AutoTrade')
        expect(lockedLabel('byoi')).toBe('Build Your Own Indicator')
        expect(lockedLabel('altceva')).toBe('This feature')
    })
})

describe('lockedApiFeature', () => {
    it('recunoaste zonele de activitate', () => {
        expect(lockedApiFeature('/api/at/state')).toBe('AutoTrade')
        expect(lockedApiFeature('/api/order/place')).toBe('Trading')
        expect(lockedApiFeature('/api/omega/chat?x=1')).toBe('OMEGA')
        expect(lockedApiFeature('https://zeus.example/api/ares/state')).toBe('ARES')
        expect(lockedApiFeature('/api/journal')).toBe('Journal')
        expect(lockedApiFeature('/api/positions')).toBe('Trading')
    })
    it('⛔ nu inchide ce serverul lasa deschis', () => {
        for (const u of ['/api/market/klines', '/api/market/liq-panel', '/api/market/bookmap', '/api/user/settings',
            '/api/sync/state', '/api/sync/user-context', '/api/indicators/active', '/api/support/thread',
            '/api/profile', '/api/byoi/config', '/api/version', '/auth/me', '/app/index.html']) {
            expect([u, lockedApiFeature(u)]).toEqual([u, null])
        }
    })
    it('nu confunda prefixe vecine', () => {
        expect(lockedApiFeature('/api/atlas')).toBeNull()
        expect(lockedApiFeature('/api/user/aresx')).toBeNull()
        expect(lockedApiFeature('/api/positionsx')).toBeNull()
    })
})

describe('garda de fetch', () => {
    let calls: Array<[string, string]>
    let target: any
    const mk = (status = 200, body: any = { ok: true }) => {
        calls = []
        target = {
            fetch: async (u: any, init?: any) => {
                calls.push([String(u), String((init && init.method) || 'GET')])
                return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
            },
        }
        installBetaFetchGuard(target)
    }
    beforeEach(() => { hideBetaNotice(); setAccessLevel('viewer') })

    it('viewer: o citire dintr-o zona inchisa nu pleaca in retea si nu arata niciun mesaj', async () => {
        mk()
        const r = await target.fetch('/api/at/state')
        expect(r.status).toBe(403)
        expect((await r.json()).error).toBe('beta_locked')
        expect(calls).toEqual([])
        expect(currentBetaNotice()).toBeNull()
    })
    it('viewer: o SCRIERE intr-o zona inchisa arata mesajul, cu numele functiei', async () => {
        mk()
        const seen: Array<string | null> = []
        const off = onBetaNotice((f) => seen.push(f))
        const r = await target.fetch('/api/at/toggle', { method: 'POST' })
        off()
        expect(r.status).toBe(403)
        expect(calls).toEqual([])
        expect(currentBetaNotice()).toBe('AutoTrade')
        expect(seen).toEqual(['AutoTrade'])
    })
    it('viewer: ce e deschis trece neatins', async () => {
        mk()
        const r = await target.fetch('/api/market/liq-panel?symbol=BTCUSDT')
        expect(r.status).toBe(200)
        expect(calls.length).toBe(1)
    })
    it('⛔ full: nimic nu e oprit', async () => {
        mk()
        setAccessLevel('full')
        await target.fetch('/api/at/toggle', { method: 'POST' })
        await target.fetch('/api/order/place', { method: 'POST' })
        expect(calls.length).toBe(2)
        expect(currentBetaNotice()).toBeNull()
    })
    it('un 403 beta_locked venit de la server pe o scriere neprevazuta tot explica de ce', async () => {
        mk(403, { error: 'beta_locked', feature: 'byoi', message: BETA_MESSAGE })
        const r = await target.fetch('/api/byoi/draft', { method: 'POST' })
        expect(r.status).toBe(403)
        expect((await r.json()).error).toBe('beta_locked')      // raspunsul ramane citibil pentru cel care a cerut
        expect(currentBetaNotice()).toBe('This feature')
    })
    it('un 403 obisnuit (nu al nostru) nu arata mesajul de beta', async () => {
        mk(403, { error: 'Admin only' })
        await target.fetch('/api/admin/halt', { method: 'POST' })
        expect(currentBetaNotice()).toBeNull()
    })
    it('⛔ cat timp nivelul e NECUNOSCUT (pornire, inainte de /auth/me), nimic nu e oprit', async () => {
        // Altfel un cont full ar pierde primele cereri la fiecare reincarcare.
        mk()
        resetAccessLevel()
        const r = await target.fetch('/api/at/state')
        expect(r.status).toBe(200)
        await target.fetch('/api/at/toggle', { method: 'POST' })
        expect(calls.length).toBe(2)
        expect(currentBetaNotice()).toBeNull()
    })
    it('o presupunere de viewer (dupa login, inainte de raspunsul serverului) nu taie cereri', async () => {
        mk()
        setAccessLevel('viewer', false)
        await target.fetch('/api/at/state')
        expect(calls.length).toBe(1)
    })
    it('se instaleaza o singura data', async () => {
        mk()
        const first = target.fetch
        installBetaFetchGuard(target)
        expect(target.fetch).toBe(first)
    })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

// [2026-11-15] setTZ e singura usa prin care fusul orar ales intra in aplicatie.
// Inainte primea „RO" / „US" si scria valoarea ca atare in w.S.tz — de acolo
// „engine error" la prima formatare de ora.
vi.mock('../../engine/brain', () => ({ applyTimezone: vi.fn() }))
import { setTZ } from '../marketDataWS'
import { applyTimezone } from '../../engine/brain'

const w = window as any

describe('setTZ', () => {
    beforeEach(() => { w.S = { tz: 'Europe/Bucharest' }; document.body.innerHTML = '<span id="chartTZLbl">RO</span>'; vi.clearAllMocks() })

    it('⛔ un cod scurt vechi devine fusul real — w.S.tz nu mai poate fi „US"', () => {
        setTZ('US', null)
        expect(w.S.tz).toBe('America/New_York')
        expect(() => new Intl.DateTimeFormat('en-GB', { timeZone: w.S.tz }).format(0)).not.toThrow()
    })
    it('un fus valid ramane; eticheta din antet arata codul tarii', () => {
        setTZ('Asia/Tokyo', null)
        expect(w.S.tz).toBe('Asia/Tokyo')
        expect(document.getElementById('chartTZLbl')!.textContent).toBe('JP')
    })
    it('gunoiul nu ajunge niciodata in stare', () => {
        setTZ('Mars/Olympus', null)
        expect(w.S.tz).toBe('Europe/Bucharest')
    })
    it('chartul primeste fusul nou pe loc si restul aplicatiei e anuntata', () => {
        const seen: string[] = []
        const on = (e: any) => seen.push(e.detail.tz)
        window.addEventListener('zeusTzChanged', on)
        setTZ('America/Sao_Paulo', null)
        window.removeEventListener('zeusTzChanged', on)
        expect(applyTimezone).toHaveBeenCalledWith('America/Sao_Paulo')
        expect(seen).toEqual(['America/Sao_Paulo'])
    })
})

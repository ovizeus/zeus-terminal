import { describe, it, expect } from 'vitest'
import { TZ_LIST, isValidTz, normalizeTz, tzLabel, utcOffsetLabel, searchTz, DEFAULT_TZ } from '../timezones'

// [2026-11-15] „Schimb timezone si da engine error": fereastra trimitea „RO",
// „US", „JP", „UK" ca fus orar, iar `Intl` arunca la orice nume care nu e IANA.

describe('lista de tari', () => {
    it('fiecare fus din lista e unul pe care browserul il stie', () => {
        const bad = TZ_LIST.filter((e) => !isValidTz(e.tz)).map((e) => e.tz)
        expect(bad).toEqual([])
    })
    it('codurile sunt unice si lista e larga', () => {
        expect(new Set(TZ_LIST.map((e) => e.code)).size).toBe(TZ_LIST.length)
        expect(TZ_LIST.length).toBeGreaterThan(100)
        expect(TZ_LIST.find((e) => e.code === 'RO')!.tz).toBe('Europe/Bucharest')
    })
})

describe('isValidTz / normalizeTz', () => {
    it('⛔ codurile scurte vechi NU sunt fusuri — exact eroarea care darama motorul', () => {
        for (const c of ['RO', 'US', 'JP', 'UK']) {
            expect(isValidTz(c)).toBe(false)
            expect(() => new Intl.DateTimeFormat('en-GB', { timeZone: c })).toThrow()
        }
    })
    it('valorile vechi salvate in setari sunt traduse, nu aruncate', () => {
        expect(normalizeTz('RO')).toBe('Europe/Bucharest')
        expect(normalizeTz('US')).toBe('America/New_York')
        expect(normalizeTz('JP')).toBe('Asia/Tokyo')
        expect(normalizeTz('UK')).toBe('Europe/London')
        expect(normalizeTz('UTC')).toBe('UTC')
    })
    it('un fus IANA valid ramane cum e; gunoiul cade pe implicit', () => {
        expect(normalizeTz('Asia/Kolkata')).toBe('Asia/Kolkata')
        for (const x of ['Mars/Olympus', '', null, undefined, 42, {}]) expect(normalizeTz(x)).toBe(DEFAULT_TZ)
    })
})

describe('eticheta din antetul chartului', () => {
    const JAN = Date.UTC(2026, 0, 15, 12, 0), JUL = Date.UTC(2026, 6, 15, 12, 0)
    it('codul tarii pentru un fus din lista', () => {
        expect(tzLabel('Europe/Bucharest')).toBe('RO')
        expect(tzLabel('RO')).toBe('RO')
        expect(tzLabel('America/Sao_Paulo')).toBe('BR')
        expect(tzLabel('UTC')).toBe('UTC')
    })
    it('decalajul fata de UTC, cu ora de vara', () => {
        expect(utcOffsetLabel('Europe/Bucharest', JAN)).toBe('UTC+2')
        expect(utcOffsetLabel('Europe/Bucharest', JUL)).toBe('UTC+3')
        expect(utcOffsetLabel('Asia/Kolkata', JAN)).toBe('UTC+5:30')
        expect(utcOffsetLabel('America/New_York', JAN)).toBe('UTC-5')
        expect(utcOffsetLabel('UTC', JAN)).toBe('UTC')
    })
    it('un fus valid din afara listei arata decalajul', () => {
        expect(tzLabel('Asia/Kathmandu', JAN)).toBe('NP')
        expect(tzLabel('Pacific/Chatham', JAN)).toMatch(/^UTC\+13:45$/)
    })
})

describe('cautarea', () => {
    it('dupa tara, cod sau oras', () => {
        expect(searchTz('roman').map((e) => e.code)).toEqual(['RO'])
        expect(searchTz('jp')[0].code).toBe('JP')
        expect(searchTz('tokyo').map((e) => e.code)).toContain('JP')
        expect(searchTz('brazil').length).toBe(2)
        expect(searchTz('').length).toBe(TZ_LIST.length)
        expect(searchTz('zzzz')).toEqual([])
    })
})

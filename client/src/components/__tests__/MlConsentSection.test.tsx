// [REAL-GATE P0-3 2026-06-09] Consent UI: status from GET, change via POST
// only after explicit confirm. Real-money ML must never be one accidental
// click away.
import { describe, test, expect, vi, beforeEach } from 'vitest'
// NOTE: repo has no @testing-library/user-event dep (live VPS — not adding
// one); fireEvent.click is the sibling-test convention and equivalent here.
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MlConsentSection } from '../settings/MlConsentSection'

const fetchMock = vi.fn()
beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
})

function okJson(body: unknown) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)
}

describe('MlConsentSection', () => {
    test('shows NOT OPTED IN when server says false', async () => {
        fetchMock.mockReturnValueOnce(okJson({ ok: true, optedIn: false }))
        render(<MlConsentSection />)
        await waitFor(() => expect(screen.getByText(/NOT OPTED IN/i)).toBeTruthy())
    })

    test('opt-in requires confirm — first click does NOT POST', async () => {
        fetchMock.mockReturnValueOnce(okJson({ ok: true, optedIn: false }))
        render(<MlConsentSection />)
        await waitFor(() => screen.getByText(/NOT OPTED IN/i))
        fireEvent.click(screen.getByRole('button', { name: /opt in/i }))
        expect(fetchMock.mock.calls.filter(c => c[1]?.method === 'POST')).toHaveLength(0)
        expect(screen.getByText(/are you sure/i)).toBeTruthy()
    })

    test('confirm sends POST {optedIn:true} and flips the badge', async () => {
        fetchMock
            .mockReturnValueOnce(okJson({ ok: true, optedIn: false }))   // initial GET
            .mockReturnValueOnce(okJson({ ok: true, optedIn: true }))    // POST
        render(<MlConsentSection />)
        await waitFor(() => screen.getByText(/NOT OPTED IN/i))
        fireEvent.click(screen.getByRole('button', { name: /opt in/i }))
        fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
        // Anchored regex: unanchored /OPTED IN/i would also match the
        // pre-flip 'NOT OPTED IN' badge (and the hint text), making the
        // assertion pass before the POST round-trip. Intent unchanged.
        await waitFor(() => expect(screen.getByText(/^OPTED IN/i)).toBeTruthy())
        const post = fetchMock.mock.calls.find(c => c[1]?.method === 'POST')
        expect(post?.[0]).toBe('/api/ring5/live-optin')
        expect(JSON.parse(post?.[1]?.body as string)).toEqual({ optedIn: true })
    })

    test('revoke does NOT require confirm (withdrawing consent must be easy)', async () => {
        fetchMock
            .mockReturnValueOnce(okJson({ ok: true, optedIn: true }))    // initial GET
            .mockReturnValueOnce(okJson({ ok: true, optedIn: false }))   // POST
        render(<MlConsentSection />)
        await waitFor(() => screen.getByText(/^OPTED IN/i))
        fireEvent.click(screen.getByRole('button', { name: /revoke/i }))
        await waitFor(() => expect(screen.getByText(/NOT OPTED IN/i)).toBeTruthy())
    })

    test('GET failure → UNKNOWN badge and no action buttons (fail-closed)', async () => {
        fetchMock.mockReturnValueOnce(Promise.reject(new Error('network')))
        render(<MlConsentSection />)
        await waitFor(() => expect(screen.getByText(/UNKNOWN/i)).toBeTruthy())
        expect(screen.queryByRole('button')).toBeNull()
    })

    // [2026-06-10] Compact mode — Omega header rendering. Same state machine:
    // confirm-before-POST and fail-closed UNKNOWN must hold there too.
    test('compact: NOT OPTED IN badge, OPT IN first click does NOT POST — shows confirm', async () => {
        fetchMock.mockReturnValueOnce(okJson({ ok: true, optedIn: false }))
        render(<MlConsentSection compact />)
        await waitFor(() => expect(screen.getByText(/NOT OPTED IN/i)).toBeTruthy())
        fireEvent.click(screen.getByRole('button', { name: /opt in/i }))
        expect(fetchMock.mock.calls.filter(c => c[1]?.method === 'POST')).toHaveLength(0)
        expect(screen.getByText(/are you sure/i)).toBeTruthy()
        expect(screen.getByRole('button', { name: /confirm/i })).toBeTruthy()
        expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy()
    })

    test('compact: GET failure → UNKNOWN and no buttons (fail-closed)', async () => {
        fetchMock.mockReturnValueOnce(Promise.reject(new Error('network')))
        render(<MlConsentSection compact />)
        await waitFor(() => expect(screen.getByText(/UNKNOWN/i)).toBeTruthy())
        expect(screen.queryByRole('button')).toBeNull()
    })
})

// [REAL-GATE P0-3 2026-06-09 / v2 2026-06-10] Consent chip: status from GET,
// change via POST only after explicit confirm — for BOTH opt-in and revoke,
// each with an explanation of what ON / OFF means. Real-money ML influence
// must never be one accidental click away, in either direction.
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

const postCalls = () => fetchMock.mock.calls.filter(c => c[1]?.method === 'POST')

describe('MlConsentSection', () => {
    test('shows NOT OPTED IN when server says false', async () => {
        fetchMock.mockReturnValueOnce(okJson({ ok: true, optedIn: false }))
        render(<MlConsentSection />)
        await waitFor(() => expect(screen.getByText(/NOT OPTED IN/i)).toBeTruthy())
    })

    test('OPT IN first click does NOT POST — shows the Turn ON explanation', async () => {
        fetchMock.mockReturnValueOnce(okJson({ ok: true, optedIn: false }))
        render(<MlConsentSection />)
        await waitFor(() => screen.getByText(/NOT OPTED IN/i))
        fireEvent.click(screen.getByRole('button', { name: /opt in/i }))
        expect(postCalls()).toHaveLength(0)
        expect(screen.getByText(/may adjust the confidence/i)).toBeTruthy()
    })

    test('CONFIRM after OPT IN sends POST {optedIn:true} and flips the badge', async () => {
        fetchMock
            .mockReturnValueOnce(okJson({ ok: true, optedIn: false }))   // initial GET
            .mockReturnValueOnce(okJson({ ok: true, optedIn: true }))    // POST
        render(<MlConsentSection />)
        await waitFor(() => screen.getByText(/NOT OPTED IN/i))
        fireEvent.click(screen.getByRole('button', { name: /opt in/i }))
        fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
        // Anchored regex: unanchored /OPTED IN/i would also match the
        // pre-flip 'NOT OPTED IN' badge, passing before the POST round-trip.
        await waitFor(() => expect(screen.getByText(/^OPTED IN/i)).toBeTruthy())
        const post = postCalls()[0]
        expect(post?.[0]).toBe('/api/ring5/live-optin')
        expect(JSON.parse(post?.[1]?.body as string)).toEqual({ optedIn: true })
    })

    test('REVOKE first click does NOT POST — shows the Turn OFF explanation', async () => {
        fetchMock.mockReturnValueOnce(okJson({ ok: true, optedIn: true }))
        render(<MlConsentSection />)
        await waitFor(() => screen.getByText(/^OPTED IN/i))
        fireEvent.click(screen.getByRole('button', { name: /revoke/i }))
        expect(postCalls()).toHaveLength(0)
        expect(screen.getByText(/immediately stops influencing/i)).toBeTruthy()
    })

    test('CONFIRM after REVOKE sends POST {optedIn:false} and flips the badge', async () => {
        fetchMock
            .mockReturnValueOnce(okJson({ ok: true, optedIn: true }))    // initial GET
            .mockReturnValueOnce(okJson({ ok: true, optedIn: false }))   // POST
        render(<MlConsentSection />)
        await waitFor(() => screen.getByText(/^OPTED IN/i))
        fireEvent.click(screen.getByRole('button', { name: /revoke/i }))
        fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
        await waitFor(() => expect(screen.getByText(/NOT OPTED IN/i)).toBeTruthy())
        const post = postCalls()[0]
        expect(post?.[0]).toBe('/api/ring5/live-optin')
        expect(JSON.parse(post?.[1]?.body as string)).toEqual({ optedIn: false })
    })

    test('CANCEL from either confirm → no POST, state unchanged', async () => {
        // opt-in side
        fetchMock.mockReturnValueOnce(okJson({ ok: true, optedIn: false }))
        const first = render(<MlConsentSection />)
        await waitFor(() => screen.getByText(/NOT OPTED IN/i))
        fireEvent.click(screen.getByRole('button', { name: /opt in/i }))
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
        expect(postCalls()).toHaveLength(0)
        expect(screen.getByText(/NOT OPTED IN/i)).toBeTruthy()
        expect(screen.getByRole('button', { name: /opt in/i })).toBeTruthy()
        first.unmount()

        // revoke side
        fetchMock.mockReturnValueOnce(okJson({ ok: true, optedIn: true }))
        render(<MlConsentSection />)
        await waitFor(() => screen.getByText(/^OPTED IN/i))
        fireEvent.click(screen.getByRole('button', { name: /revoke/i }))
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
        expect(postCalls()).toHaveLength(0)
        expect(screen.getByText(/^OPTED IN/i)).toBeTruthy()
        expect(screen.getByRole('button', { name: /revoke/i })).toBeTruthy()
    })

    test('GET failure → UNKNOWN badge and no action buttons (fail-closed)', async () => {
        fetchMock.mockReturnValueOnce(Promise.reject(new Error('network')))
        render(<MlConsentSection />)
        await waitFor(() => expect(screen.getByText(/UNKNOWN/i)).toBeTruthy())
        expect(screen.queryByRole('button')).toBeNull()
    })
})

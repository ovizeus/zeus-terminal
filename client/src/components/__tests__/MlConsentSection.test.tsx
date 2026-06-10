// [REAL-GATE P0-3 2026-06-09 / v3 2026-06-10] Consent chip: status from GET,
// change via POST only after explicit confirm — for BOTH opt-in and revoke,
// each in a dedicated zr-modal dialog explaining what ON / OFF means.
// Real-money ML influence must never be one accidental click away, in
// either direction. CANCEL and overlay click both close without POSTing.
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

    test('OPT IN ML click does NOT POST — opens the Enable ML on REAL modal', async () => {
        fetchMock.mockReturnValueOnce(okJson({ ok: true, optedIn: false }))
        render(<MlConsentSection />)
        await waitFor(() => screen.getByText(/NOT OPTED IN/i))
        fireEvent.click(screen.getByRole('button', { name: /opt in ml/i }))
        expect(postCalls()).toHaveLength(0)
        expect(screen.getByText(/Enable ML on REAL/i)).toBeTruthy()
        expect(screen.getByText(/may adjust the confidence/i)).toBeTruthy()
    })

    test('CONFIRM after OPT IN ML sends POST {optedIn:true} and flips the badge', async () => {
        fetchMock
            .mockReturnValueOnce(okJson({ ok: true, optedIn: false }))   // initial GET
            .mockReturnValueOnce(okJson({ ok: true, optedIn: true }))    // POST
        render(<MlConsentSection />)
        await waitFor(() => screen.getByText(/NOT OPTED IN/i))
        fireEvent.click(screen.getByRole('button', { name: /opt in ml/i }))
        fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
        // Anchored regex: unanchored /OPTED IN/i would also match the
        // pre-flip 'NOT OPTED IN' badge, passing before the POST round-trip.
        await waitFor(() => expect(screen.getByText(/^OPTED IN/i)).toBeTruthy())
        const post = postCalls()[0]
        expect(post?.[0]).toBe('/api/ring5/live-optin')
        expect(JSON.parse(post?.[1]?.body as string)).toEqual({ optedIn: true })
        // Modal closes after the POST resolves.
        expect(screen.queryByText(/Enable ML on REAL/i)).toBeNull()
    })

    test('REVOKE ML click does NOT POST — opens the Disable ML on REAL modal', async () => {
        fetchMock.mockReturnValueOnce(okJson({ ok: true, optedIn: true }))
        render(<MlConsentSection />)
        await waitFor(() => screen.getByText(/^OPTED IN/i))
        fireEvent.click(screen.getByRole('button', { name: /revoke ml/i }))
        expect(postCalls()).toHaveLength(0)
        expect(screen.getByText(/Disable ML on REAL/i)).toBeTruthy()
        expect(screen.getByText(/immediately stops influencing/i)).toBeTruthy()
    })

    test('CONFIRM after REVOKE ML sends POST {optedIn:false} and flips the badge', async () => {
        fetchMock
            .mockReturnValueOnce(okJson({ ok: true, optedIn: true }))    // initial GET
            .mockReturnValueOnce(okJson({ ok: true, optedIn: false }))   // POST
        render(<MlConsentSection />)
        await waitFor(() => screen.getByText(/^OPTED IN/i))
        fireEvent.click(screen.getByRole('button', { name: /revoke ml/i }))
        fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
        await waitFor(() => expect(screen.getByText(/NOT OPTED IN/i)).toBeTruthy())
        const post = postCalls()[0]
        expect(post?.[0]).toBe('/api/ring5/live-optin')
        expect(JSON.parse(post?.[1]?.body as string)).toEqual({ optedIn: false })
        expect(screen.queryByText(/Disable ML on REAL/i)).toBeNull()
    })

    test('CANCEL from either modal → no POST, modal closed, state unchanged', async () => {
        // opt-in side
        fetchMock.mockReturnValueOnce(okJson({ ok: true, optedIn: false }))
        const first = render(<MlConsentSection />)
        await waitFor(() => screen.getByText(/NOT OPTED IN/i))
        fireEvent.click(screen.getByRole('button', { name: /opt in ml/i }))
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
        expect(postCalls()).toHaveLength(0)
        expect(screen.queryByText(/Enable ML on REAL/i)).toBeNull()
        expect(screen.getByText(/NOT OPTED IN/i)).toBeTruthy()
        expect(screen.getByRole('button', { name: /opt in ml/i })).toBeTruthy()
        first.unmount()

        // revoke side
        fetchMock.mockReturnValueOnce(okJson({ ok: true, optedIn: true }))
        render(<MlConsentSection />)
        await waitFor(() => screen.getByText(/^OPTED IN/i))
        fireEvent.click(screen.getByRole('button', { name: /revoke ml/i }))
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
        expect(postCalls()).toHaveLength(0)
        expect(screen.queryByText(/Disable ML on REAL/i)).toBeNull()
        expect(screen.getByText(/^OPTED IN/i)).toBeTruthy()
        expect(screen.getByRole('button', { name: /revoke ml/i })).toBeTruthy()
    })

    test('overlay click closes the modal without POSTing', async () => {
        fetchMock.mockReturnValueOnce(okJson({ ok: true, optedIn: false }))
        render(<MlConsentSection />)
        await waitFor(() => screen.getByText(/NOT OPTED IN/i))
        fireEvent.click(screen.getByRole('button', { name: /opt in ml/i }))
        expect(screen.getByText(/Enable ML on REAL/i)).toBeTruthy()
        // Click the dark backdrop itself (not the dialog box) — must close.
        fireEvent.click(screen.getByTestId('ml-consent-overlay'))
        expect(postCalls()).toHaveLength(0)
        expect(screen.queryByText(/Enable ML on REAL/i)).toBeNull()
        expect(screen.getByText(/NOT OPTED IN/i)).toBeTruthy()
    })

    test('GET failure → UNKNOWN badge and no action buttons (fail-closed)', async () => {
        fetchMock.mockReturnValueOnce(Promise.reject(new Error('network')))
        render(<MlConsentSection />)
        await waitFor(() => expect(screen.getByText(/UNKNOWN/i)).toBeTruthy())
        expect(screen.queryByRole('button')).toBeNull()
    })
})

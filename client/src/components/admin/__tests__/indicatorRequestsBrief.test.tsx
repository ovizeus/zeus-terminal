/**
 * [2026-11-07] The copy-paste build brief.
 *
 * The operator asked for this shape on purpose: an order is never built
 * automatically. He copies one block of text and hands it over.
 *
 * The test that earns its place is the clipboard FAILING. It fails in real
 * places — an insecure context, a WebView that denies it, a browser that wants
 * a fresh gesture — and a copy button that silently does nothing is worse than
 * no copy button at all.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { IndicatorRequestsSection } from '../sections/IndicatorRequestsSection'

const ROW = {
  id: 42, userId: 5, email: 'buyer@example.com', tier: 'custom', title: 'Ovi Wave',
  spec: { title: 'Ovi Wave', notes: 'draws a wave' }, notes: 'draws a wave',
  status: 'paid', priceCents: 14900, currency: 'USD', isBypass: false,
  paymentRef: 'pay_secret', billingMode: 'live', declineReason: null, adminNote: null,
  submittedAt: 1762500000000, deliveredAt: null,
}
const BRIEF = 'BUILD AN INDICATOR — order #42\n\nName on the chart: Ovi Wave\nWhen a signal counts: Only when the bar closes — never repaints'

function mockApi() {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const u = String(url)
    const json = (b: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(b) } as Response)
    if (u.includes('/brief')) return json({ ok: true, brief: BRIEF })
    if (u.includes('/attachment')) return json({ ok: true, attachments: [] })
    return json({ ok: true, requests: [ROW] })
  }))
}

beforeEach(() => {
  // NOT vi.restoreAllMocks() here: it strips the implementation off the fetch
  // stub this file depends on, and the component then renders nothing at all.
  // Re-stubbing per test is enough, and the empty render it caused was a far
  // more confusing failure than the one it was meant to prevent.
  mockApi()
})

/**
 * The brief lives inside the expanded order, so open it first.
 *
 * Called OUTSIDE act(): rendering and querying inside act() leaves findByText
 * waiting on effects act() has not flushed yet, and the failure reads as an
 * empty page rather than as a mistake in the test. Three of these tests failed
 * that way before the render was lifted out.
 */
async function openOrder() {
  render(<IndicatorRequestsSection />)
  const title = await screen.findByText('Ovi Wave')
  await act(async () => { fireEvent.click(title) })
  return screen.findByText('Build brief')
}


describe('the build brief reaches the operator', () => {
  it('fetches it and puts it on the clipboard', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const btn = await openOrder()
    await act(async () => { fireEvent.click(btn) })
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(BRIEF))
    expect(await screen.findByText(/Copied to the clipboard/)).toBeTruthy()
  })

  it('still SHOWS the text when the clipboard refuses', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true,
    })
    const btn = await openOrder()
    await act(async () => { fireEvent.click(btn) })
    // the whole point: he can still get the text out
    expect(await screen.findByText(/Select the text below/)).toBeTruthy()
    const box = document.querySelector('textarea[readonly]') as HTMLTextAreaElement
    expect(box).toBeTruthy()
    expect(box.value).toContain('never repaints')
  })

  it('survives a clipboard that does not exist at all', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const btn = await openOrder()
    await act(async () => { fireEvent.click(btn) })
    const box = document.querySelector('textarea[readonly]') as HTMLTextAreaElement
    expect(box.value).toContain('Ovi Wave')
  })

  it('hides it again on a second press, instead of stacking copies', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.resolve() }, configurable: true })
    const btn = await openOrder()
    await act(async () => { fireEvent.click(btn) })
    await act(async () => { fireEvent.click(await screen.findByText('Hide build brief')) })
    expect(document.querySelector('textarea[readonly]')).toBeNull()
  })
})

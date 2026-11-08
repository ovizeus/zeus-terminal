/**
 * [2026-11-06] Build Your Own Indicator — the buyer's side.
 *
 * The two that matter: the form is rendered from the SERVER's schema, so it
 * cannot drift from the rules that validate it; and Send never fires without
 * the confirmation step, because an order leaving on a stray tap is a charge
 * the buyer did not agree to.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { BuildIndicatorModal } from '../BuildIndicatorModal'

const CONFIG = {
  ok: true,
  fields: [
    { key: 'title', type: 'text', label: 'Indicator name', required: true, max: 40 },
    { key: 'placement', type: 'select', label: 'Where it draws', required: true, options: [{ v: 'pane', l: 'In its own pane below' }] },
    { key: 'visuals', type: 'multi', label: 'What it draws', required: true, min: 1, options: [{ v: 'line', l: 'Line' }, { v: 'bands', l: 'Bands / channel' }] },
    { key: 'exclusive', type: 'bool', label: 'Exclusive to me' },
    { key: 'notes', type: 'textarea', label: 'Describe it in your own words', required: true, max: 4000 },
  ],
  tiers: [
    { id: 'signature', label: 'Signature', price_cents: 2900, price: '$29', quote_only: false, blurb: 'Your name and your colours.',
      includes: ['An existing engine, renamed and recoloured as yours', 'Yours alone, private to your account'] },
    { id: 'custom', label: 'Custom', price_cents: 14900, price: '$149', quote_only: false, blurb: 'A new indicator.',
      includes: ['A new indicator built from your own rules, not a reskin', 'Keeps working with the app closed', 'Alerts to Telegram, worded by you', 'Its own drawn icon in the indicator list'] },
    { id: 'bespoke', label: 'Bespoke', price_cents: 0, price: '$0', quote_only: true, blurb: 'Anything larger.' },
  ],
  billingMode: 'disabled', canSubmit: false,
  maxAttachments: 6, maxAttachmentBytes: 2097152, allowedMime: ['image/png'],
}

let submitCalls = 0

function mockApi({ canSubmit = false } = {}) {
  submitCalls = 0
  const json = (b: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(b) } as unknown as Response)
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const u = String(url)
    if (u.endsWith('/api/byoi/config')) return json({ ...CONFIG, canSubmit })
    if (u.endsWith('/api/byoi/requests')) return json({ ok: true, requests: [] })
    if (u.includes('/api/byoi/submit')) { submitCalls++; return json({ ok: true, request: { id: 1, status: 'paid', attachments: [] } }) }
    if (u.includes('/api/byoi/draft')) {
      return json({ ok: true, request: { id: 1, tier: 'signature', title: 'Ovi Wave', spec: {}, notes: '', status: 'draft', priceCents: 2900, isBypass: false, declineReason: null, updatedAt: 1, attachments: [] } })
    }
    return json({ ok: true })
  }))
}

async function openEditor(canSubmit = false) {
  mockApi({ canSubmit })
  render(<BuildIndicatorModal visible={true} onClose={() => {}} />)
  await waitFor(() => expect(screen.getByText('+ New indicator')).toBeTruthy())
  fireEvent.click(screen.getByText('+ New indicator'))
}

beforeEach(() => { vi.restoreAllMocks() })

describe('BYOI — prices come from the server', () => {
  it('shows the three tiers with the operator\'s prices', async () => {
    mockApi()
    render(<BuildIndicatorModal visible={true} onClose={() => {}} />)
    await waitFor(() => expect(screen.getAllByText('$29').length).toBeGreaterThan(0))
    expect(screen.getAllByText('$149').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Quote').length).toBeGreaterThan(0)
  })

  it('hardcodes no price of its own', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/components/modals/BuildIndicatorModal.tsx'), 'utf8')
    expect(src).not.toContain('2900')
    expect(src).not.toContain('14900')
  })
})

describe('BYOI — the form is the server\'s', () => {
  it('renders each field the server described, by its type', async () => {
    await openEditor()
    expect(screen.getByText('Indicator name')).toBeTruthy()
    expect(screen.getByText('Where it draws')).toBeTruthy()
    expect(screen.getByText('Line')).toBeTruthy()
    expect(screen.getByText('Bands / channel')).toBeTruthy()
    expect(screen.getByText('Exclusive to me')).toBeTruthy()
  })

  it('renders nothing the server did not send', async () => {
    await openEditor()
    expect(screen.queryByText('Timeframes it must work on')).toBeNull()
  })
})

describe('BYOI — Send asks first', () => {
  it('does not submit on the first press', async () => {
    await openEditor(true)
    fireEvent.click(screen.getByText(/^Send/))
    expect(submitCalls).toBe(0)
    expect(screen.getByText('Send this indicator?')).toBeTruthy()
  })

  it('states the refund promise in the confirmation', async () => {
    await openEditor(true)
    fireEvent.click(screen.getByText(/^Send/))
    expect(screen.getByText(/refunded in full/)).toBeTruthy()
  })

  it('cancelling sends nothing', async () => {
    await openEditor(true)
    fireEvent.click(screen.getByText(/^Send/))
    fireEvent.click(screen.getByText('Cancel'))
    expect(submitCalls).toBe(0)
    expect(screen.queryByText('Send this indicator?')).toBeNull()
  })

  it('only confirming actually sends', async () => {
    await openEditor(true)
    fireEvent.click(screen.getByText(/^Send/))
    fireEvent.click(screen.getByText('Yes, send it'))
    await waitFor(() => expect(submitCalls).toBe(1))
  })
})

describe('BYOI — pre-launch', () => {
  it('says orders are not open yet, and that drafts survive', async () => {
    await openEditor(false)
    expect(screen.getByText(/Orders open when Zeus launches/)).toBeTruthy()
  })

  it('fetches nothing until it is opened', () => {
    mockApi()
    render(<BuildIndicatorModal visible={false} onClose={() => {}} />)
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0)
  })
})

describe('the buyer can see what the money buys', () => {
  // [2026-11-08] The card showed a price and nothing else, so the work a
  // higher tier actually buys was invisible. Nobody wants what he cannot see.
  it('lists what the selected tier includes', async () => {
    await openEditor()
    expect(await screen.findByText('What Signature includes')).toBeTruthy()
    expect(screen.getByText('Yours alone, private to your account')).toBeTruthy()
  })

  it('offers the next tier up, and says how much more it is', async () => {
    await openEditor()
    expect(await screen.findByText(/Custom adds 4 more/)).toBeTruthy()
    expect(screen.getByText('See Custom — $149')).toBeTruthy()
  })

  it('switching to it shows ITS list instead', async () => {
    await openEditor()
    fireEvent.click(await screen.findByText('See Custom — $149'))
    expect(await screen.findByText('What Custom includes')).toBeTruthy()
    expect(screen.getByText('Alerts to Telegram, worded by you')).toBeTruthy()
  })

  it('does not nag once the top priced tier is chosen', async () => {
    await openEditor()
    fireEvent.click(await screen.findByText('See Custom — $149'))
    await screen.findByText('What Custom includes')
    expect(screen.queryByText(/adds \d+ more/)).toBeNull()
  })
})

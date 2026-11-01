// [2026-11-01] Contractul de cablare: componenta chiar MASOARA si chiar taie.
// jsdom nu aseaza nimic (toate inaltimile sunt 0), deci inaltimile se pun aici
// explicit — altfel testul ar trece si cu masurarea scoasa, fiindca 0 inseamna
// "nu am masurat" si nu se taie nimic.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { TheVoice } from '../TheVoice'

const ROW_H = 100
const FEED_H = 229   // cazul lui: doua ganduri intregi + o felie din al treilea

const orig: Record<string, PropertyDescriptor | undefined> = {}
beforeAll(() => {
    for (const k of ['offsetTop', 'offsetHeight', 'clientHeight']) {
        orig[k] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, k)
    }
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
        configurable: true,
        get(this: HTMLElement) { return this.classList.contains('omega-utter') ? ROW_H : 0 },
    })
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
        configurable: true,
        get(this: HTMLElement) {
            if (!this.classList.contains('omega-utter')) return 0
            const sibs = Array.from(this.parentElement?.children || [])
            return sibs.indexOf(this) * ROW_H
        },
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
        configurable: true,
        get(this: HTMLElement) { return this.classList.contains('omega-voice-feed') ? FEED_H : 0 },
    })
})
afterAll(() => {
    for (const [k, d] of Object.entries(orig)) {
        if (d) Object.defineProperty(HTMLElement.prototype, k, d)
        else delete (HTMLElement.prototype as any)[k]
    }
})

const u = (id: number) => ({
    id, user_id: 1, utterance_type: 'THOUGHT', mood: 'CALM', text: 'gand ' + id,
    template_id: null, context_json: null, created_at: Date.now() - id * 1000,
}) as any

function clipped(c: HTMLElement) {
    return Array.from(c.querySelectorAll('.omega-utter')).map(e => e.classList.contains('omega-utter-clipped'))
}

describe('TheVoice — taie gandul care nu incape intreg', () => {
    it('REGRESIE: al treilea gand nu incape → e scos de tot, nu lasat o felie', async () => {
        const { container } = render(<TheVoice utterances={[u(1), u(2), u(3)]} loading={false} />)
        await waitFor(() => expect(clipped(container)).toEqual([false, false, true]))
    })

    it('cand toate incap, nu se taie nimic', async () => {
        const { container } = render(<TheVoice utterances={[u(1), u(2)]} loading={false} />)
        await waitFor(() => expect(clipped(container)).toEqual([false, false]))
    })

    it('cand deruleaza, reapar toate — nu i se ia posibilitatea sa citeasca vechile', async () => {
        const { container } = render(<TheVoice utterances={[u(1), u(2), u(3)]} loading={false} />)
        await waitFor(() => expect(clipped(container)).toEqual([false, false, true]))
        const feed = container.querySelector('.omega-voice-feed') as HTMLElement
        Object.defineProperty(feed, 'scrollTop', { configurable: true, value: 120 })
        fireEvent.scroll(feed)
        await waitFor(() => expect(clipped(container)).toEqual([false, false, false]))
    })

    it('textul gandurilor ramase se vede in continuare', () => {
        render(<TheVoice utterances={[u(1), u(2), u(3)]} loading={false} />)
        expect(screen.getByText('gand 1')).toBeTruthy()
    })
})

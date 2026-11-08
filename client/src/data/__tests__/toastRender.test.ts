/**
 * [2026-11-08] The on-screen messages, as they actually render.
 *
 * The old one was a single reused element: a second message silently replaced
 * the first, which with the new alert rules firing more often meant a
 * liquidation could erase a whale alert a moment after it appeared.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { toast } from '../marketDataHelpers'
import { toastTheme } from '../../ui/toastTheme'

const host = () => document.getElementById('zeus-toasts')
const boxes = () => Array.from(document.querySelectorAll('.zeus-toast')) as HTMLElement[]

/** jsdom reports colours as rgb(), so compare in its own terms. */
const rgb = (hex: string) => {
  const h = hex.replace('#', '')
  return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`
}
const accentOf = (b: HTMLElement) => b.style.borderLeftColor

beforeEach(() => {
  document.body.innerHTML = ''
  vi.useFakeTimers()
  // jsdom has no rAF timing; run the entrance immediately.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0 })
})

describe('it shows the message', () => {
  it('puts the text on screen, intact', () => {
    toast('ZeuS Terminal: Test alert working!')
    expect(host()).toBeTruthy()
    expect(boxes()).toHaveLength(1)
    expect(boxes()[0].textContent).toContain('ZeuS Terminal: Test alert working!')
  })

  it('escapes whatever it is given instead of rendering it as markup', () => {
    toast('<img src=x onerror=alert(1)>')
    expect(document.querySelector('.zeus-toast img')).toBeNull()
    expect(boxes()[0].textContent).toContain('<img')
  })

  it('still accepts the icon argument the 189 existing callers pass', () => {
    toast('Saved', 3000, '<svg id="probe"></svg>')
    expect(document.querySelector('#probe')).toBeTruthy()
  })
})

describe('several messages, not one overwriting the next', () => {
  it('keeps more than one on screen', () => {
    toast('first'); toast('second')
    expect(boxes()).toHaveLength(2)
    expect(boxes()[1].textContent).toContain('second')
  })

  it('caps the stack and drops the OLDEST', () => {
    toast('a'); toast('b'); toast('c'); toast('d')
    const texts = boxes().map((b) => b.textContent || '')
    expect(boxes().length).toBeLessThanOrEqual(3)
    expect(texts.join(' ')).not.toContain('a')
    expect(texts.join(' ')).toContain('d')
  })

  it('clears itself after its time is up', () => {
    toast('bye', 1000)
    expect(boxes()).toHaveLength(1)
    vi.advanceTimersByTime(1300)
    expect(boxes()).toHaveLength(0)
  })

  it('a duration of 0 stays — several callers rely on that for blocking states', () => {
    toast('Kill switch active', 0)
    vi.advanceTimersByTime(60_000)
    expect(boxes()).toHaveLength(1)
  })
})

describe('the look carries the meaning, not the sentence', () => {
  it('a failure gets the error accent', () => {
    toast('Modify failed: timeout')
    expect(accentOf(boxes()[0])).toBe(rgb(toastTheme('error').accent))
  })

  it('a quota warning gets amber', () => {
    toast('Binance quota rising: fapi 62%')
    expect(accentOf(boxes()[0])).toBe(rgb(toastTheme('warn').accent))
  })

  it('an ordinary alert stays neutral — not everything is a warning', () => {
    toast('BID WALL BTCUSDT 400 @ 67000')
    expect(accentOf(boxes()[0])).toBe(rgb(toastTheme('info').accent))
  })

  it('an explicit level wins over the guess', () => {
    toast('Saved', 3000, undefined, 'error')
    expect(accentOf(boxes()[0])).toBe(rgb(toastTheme('error').accent))
  })

  it('labels only what deserves a label', () => {
    toast('Modify failed: timeout')
    expect(boxes()[0].textContent).toMatch(/Error/)
    document.body.innerHTML = ''
    toast('BID WALL')
    expect(boxes()[0].textContent).not.toMatch(/Info/i)
  })

  it('stamps the time, so a message read a minute ago is not mistaken for a new one', () => {
    toast('anything')
    expect(boxes()[0].textContent).toMatch(/\d{2}:\d{2}:\d{2}/)
  })
})

describe('a message never breaks the screen it appears on', () => {
  it('survives junk input', () => {
    expect(() => toast(null as never)).not.toThrow()
    expect(() => toast(undefined as never)).not.toThrow()
    expect(() => toast({} as never)).not.toThrow()
  })
})

describe('a heading and a detail, not one glued sentence', () => {
  it('shows the alert title in the accent and the detail underneath', () => {
    toast('BTCUSDT 4h · 3,511 · 4.2× the usual', { title: 'VOLUME SPIKE' })
    const b = boxes()[0]
    expect(b.textContent).toContain('VOLUME SPIKE')
    expect(b.textContent).toContain('4.2× the usual')
    const head = b.querySelector('span') as HTMLElement
    expect(head.textContent).toBe('VOLUME SPIKE')
    expect(head.style.color).toBe(rgb(toastTheme('info').accent))
  })

  it('stamps the time on the heading row', () => {
    toast('detail here', { title: 'BID WALL' })
    expect(boxes()[0].textContent).toMatch(/\d{2}:\d{2}:\d{2}/)
  })

  it('a plain message still gets its time, on its single line', () => {
    toast('Alert settings saved')
    expect(boxes()[0].textContent).toContain('Alert settings saved')
    expect(boxes()[0].textContent).toMatch(/\d{2}:\d{2}:\d{2}/)
  })

  it('an error with no title of its own still says it is an error', () => {
    toast('Modify failed: timeout')
    expect(boxes()[0].textContent).toMatch(/Error/)
  })

  it('sits under the header, using the app\'s own height variable', () => {
    toast('anything')
    expect(host()!.style.top).toContain('--zt-content-top')
    expect(host()!.style.bottom).toBe('')
  })
})

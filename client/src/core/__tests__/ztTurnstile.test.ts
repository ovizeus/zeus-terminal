/**
 * [2026-11-27] public/js/zt-turnstile.js — un singur script pentru login.html si aplicatia React.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'public', 'js', 'zt-turnstile.js'), 'utf8')
const w = window as any

function boot(siteKey: string | null, fake?: (opts: any) => void) {
  delete w.ztTurnstileToken; delete w.turnstile; delete w.__ztTurnstileOnload
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ siteKey }) })))
  const orig = document.head.appendChild.bind(document.head)
  vi.spyOn(document.head, 'appendChild').mockImplementation((node: any) => {
    if (node && node.tagName === 'SCRIPT' && String(node.src).includes('challenges.cloudflare.com')) {
      let opts: any = null; let n = 0
      w.turnstile = {
        render: (_sel: string, o: any) => { opts = o; return 'w1' },
        reset: () => {},
        execute: () => { n++; (fake || ((o: any) => o.callback('tok-' + n)))(opts) },
      }
      setTimeout(() => w.__ztTurnstileOnload(), 0)
      return node
    }
    return orig(node)
  })
  // eslint-disable-next-line no-new-func
  new Function(SRC)()
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('zt-turnstile', () => {
  beforeEach(() => { document.getElementById('zt-turnstile')?.remove() })
  it('fara cheie pe server → undefined (cererea pleaca exact ca inainte), fara script Cloudflare', async () => {
    boot(null)
    expect(await w.ztTurnstileToken()).toBeUndefined()
    expect(document.getElementById('zt-turnstile')).toBeNull()
  })
  it('cu cheie → un token NOU la fiecare cerere', async () => {
    boot('site-key')
    expect(await w.ztTurnstileToken()).toBe('tok-1')
    expect(await w.ztTurnstileToken()).toBe('tok-2')
  })
  it('verificarea Cloudflare esueaza → null (serverul va refuza)', async () => {
    boot('site-key', (o) => o['error-callback']())
    expect(await w.ztTurnstileToken()).toBeNull()
  })
})

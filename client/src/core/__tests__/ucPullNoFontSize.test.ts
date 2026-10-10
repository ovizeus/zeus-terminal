import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// [R9 2026-10-10] The user-context pull used to set the document root font size
// from the `uiScale` section:
//
//     document.documentElement.style.fontSize = sec.uiScale.data + 'px'
//
// uiScale is a feature that was REMOVED on 2026-06-13, because no stylesheet
// ever consumed the var(--ui-scale) the control set. Nothing writes the value
// any more and nothing reads it. But the pull still applied it, and the stored
// shape is a number of PERCENT, not pixels — so a section carrying 100 would
// have given the whole document a 100px root font and the interface would have
// been unusable.
//
// It was never armed: verified on the live system, uiScale.data is null for
// uid=1, there are no rows in user_ctx_data, and the `data != null` guard blocks
// the path. A stale pre-June localStorage value on any device was all it needed.
// Found while tracing who really owns uiScale for the b266 clobber fix, and
// deliberately left for its own change rather than chained onto it.
//
// This test is the hazard itself: hand the pull a uiScale section with a real
// value and the font size must not move.

import { _userCtxPull } from '../config'

const ORIGINAL_FETCH = globalThis.fetch

function respondWith(sections: Record<string, unknown>) {
  globalThis.fetch = vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ ok: true, data: { sections } }),
  })) as unknown as typeof fetch
}

describe('the user-context pull never resizes the document', () => {
  beforeEach(() => {
    document.documentElement.style.fontSize = ''
  })
  afterEach(() => { globalThis.fetch = ORIGINAL_FETCH })

  it('ignores a uiScale section instead of turning 100 percent into a 100px root font', async () => {
    respondWith({ uiScale: { ts: Date.now(), data: 100 } })
    _userCtxPull()
    await new Promise((r) => setTimeout(r, 0))
    expect(document.documentElement.style.fontSize).toBe('')
  })

  it('still merges a section it genuinely owns', async () => {
    // Guard: removing the dead branch must not break the live ones.
    respondWith({ indSettings: { ts: Date.now(), data: { ema: { p1: 42 } } } })
    _userCtxPull()
    await new Promise((r) => setTimeout(r, 0))
    const raw = localStorage.getItem('zeus_ind_settings')
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw as string)).toEqual({ ema: { p1: 42 } })
  })
})

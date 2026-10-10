import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// [2026-10-10] app.css carries a complete [data-theme="light"] palette (Ivory)
// and index.html restores the saved theme before first paint. The institutional
// theme hardcoded a dark palette unconditionally, so a user on Ivory would have
// got three near-black panels in an otherwise light application.
//
// The operator does not use the light theme, and said to add this if I thought
// it worthwhile. It is: the fix is one block, it does not multiply across the
// remaining tasks, and leaving a known broken state behind for a setting that
// exists and is one click away is not a trade worth making.

const CSS = path.join(__dirname, '..', '..', '..', 'styles', 'institutional.css')

describe('the institutional theme follows the app theme', () => {
  const css = fs.readFileSync(CSS, 'utf8')

  it('redefines its tokens for the light theme', () => {
    expect(css).toMatch(/\[data-theme="light"\]\s*\.zi\s*\{/)
  })

  it('still never touches :root, which would restyle the whole app', () => {
    // The gate rule from Task 1 must survive this addition.
    const selectors = css.match(/^[^\s/*][^{]*\{/gm) ?? []
    for (const sel of selectors) {
      expect(sel).not.toMatch(/(^|[\s,])(:root|html|body)\s*[,{]/)
    }
  })

  it('overrides every surface and text token, not just the background', () => {
    const block = css.slice(css.indexOf('[data-theme="light"] .zi'))
    for (const token of ['--zi-bg', '--zi-card', '--zi-line', '--zi-hair', '--zi-field',
                         '--zi-raise', '--zi-edge', '--zi-val', '--zi-lbl', '--zi-mut', '--zi-faint']) {
      expect(block).toContain(token + ':')
    }
  })

  it('keeps the semantic colours readable on a light ground', () => {
    const block = css.slice(css.indexOf('[data-theme="light"] .zi'))
    for (const token of ['--zi-pos', '--zi-neg', '--zi-warn']) {
      expect(block).toContain(token + ':')
    }
  })
})

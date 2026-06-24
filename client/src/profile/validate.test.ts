import { describe, it, expect } from 'vitest'
import { validateUsername } from './validate'
describe('validateUsername', () => {
  it('accepts zeus_ovi', () => expect(validateUsername('zeus_ovi')).toBe(true))
  it('rejects spaces/symbols', () => expect(validateUsername('ov i!')).toBe(false))
  it('rejects too short', () => expect(validateUsername('ab')).toBe(false))
  it('rejects too long', () => expect(validateUsername('a'.repeat(21))).toBe(false))
})

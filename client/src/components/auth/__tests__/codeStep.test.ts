// [2026-11-27] Pasul de cod la login: email (6 cifre) sau aplicatie de autentificare (6 cifre SAU cod de rezerva).
import { describe, it, expect } from 'vitest'
import { sanitizeCode, codeComplete, codePrompt } from '../codeStep'

describe('pasul de cod la login', () => {
  it('email: doar cifre, max 6 (ca pana acum)', () => {
    expect(sanitizeCode('email', '12a3 4567')).toBe('123456')
    expect(codeComplete('email', '123456')).toBe(true)
    expect(codeComplete('email', '12345')).toBe(false)
  })
  it('aplicatie: 6 cifre trec', () => {
    expect(sanitizeCode('totp', '123456')).toBe('123456')
    expect(codeComplete('totp', '123456')).toBe(true)
  })
  it('aplicatie: codul de rezerva NU e taiat la 6 si se face cu majuscule', () => {
    expect(sanitizeCode('totp', 'abcde-fghjk')).toBe('ABCDE-FGHJK')
    expect(codeComplete('totp', 'ABCDE-FGHJK')).toBe(true)
    expect(codeComplete('totp', 'ABCDEFGHJK')).toBe(true)
    expect(codeComplete('totp', 'ABCDE-FGH')).toBe(false)
  })
  it('aplicatie: max 11 caractere, fara semne straine', () => {
    expect(sanitizeCode('totp', 'ABCDE-FGHJK-XYZ!')).toBe('ABCDE-FGHJK')
  })
  it('mesajul spune de unde vine codul', () => {
    expect(codePrompt('email')).toMatch(/email/)
    expect(codePrompt('totp')).toMatch(/authenticator app/)
    expect(codePrompt('totp')).toMatch(/backup code/)
  })
})

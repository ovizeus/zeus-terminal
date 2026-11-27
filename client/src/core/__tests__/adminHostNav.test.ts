// [2026-11-27] Admin pe subdomeniu separat: iconita de admin duce acolo cand ADMIN_HOST e pornit.
import { describe, it, expect } from 'vitest'
import { adminTarget } from '../adminHostNav'

describe('adminTarget', () => {
  it('fara adminHost → panoul se deschide pe loc', () => {
    expect(adminTarget(null, 'zeus-terminal.com')).toBeNull()
  })
  it('pe domeniul principal → adresa subdomeniului de admin', () => {
    expect(adminTarget('admin.zeus-terminal.com', 'zeus-terminal.com')).toBe('https://admin.zeus-terminal.com/')
  })
  it('deja pe subdomeniu → pe loc', () => {
    expect(adminTarget('admin.zeus-terminal.com', 'ADMIN.zeus-terminal.com')).toBeNull()
  })
  it('un adminHost ciudat de la server nu devine redirect oriunde', () => {
    expect(adminTarget('evil.com/x?y', 'zeus-terminal.com')).toBeNull()
    expect(adminTarget('javascript:alert(1)', 'zeus-terminal.com')).toBeNull()
  })
})

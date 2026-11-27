// [2026-11-27] Roluri reale: staff-ul vede doar secțiunile pentru care are permisiune.
import { describe, it, expect } from 'vitest'
import { visibleNav } from '../adminNav'
import { ROLE_PERMS } from '../adminRoles'

describe('visibleNav', () => {
  it('Super Admin vede tot', () => {
    expect(visibleNav('admin', []).length).toBeGreaterThan(10)
  })
  it('support: Users, Audit, Security, Monitoring — nimic de sistem', () => {
    const ids = visibleNav('user', ROLE_PERMS.support).map((n) => n.id).sort()
    expect(ids).toEqual(['audit', 'monitoring', 'security', 'users'])
  })
  it('analyst: fara Security (n-are security.sessions)', () => {
    const ids = visibleNav('user', ROLE_PERMS.analyst).map((n) => n.id).sort()
    expect(ids).toEqual(['audit', 'monitoring', 'users'])
  })
  it('fara permisiuni → nimic', () => {
    expect(visibleNav('user', [])).toEqual([])
  })
})

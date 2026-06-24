import { describe, it, expect } from 'vitest'
import { initialsAvatar } from './avatar'

describe('initialsAvatar', () => {
  it('builds an SVG data-uri with the initials', () => {
    const d = initialsAvatar('Ovi Zeus', '#f0c040')
    expect(d).toMatch(/^data:image\/svg\+xml/)
    expect(decodeURIComponent(d)).toContain('OZ')
    expect(decodeURIComponent(d)).toContain('#f0c040')
  })
  it('falls back to ? for empty name and #888 for bad color', () => {
    const d = decodeURIComponent(initialsAvatar('', 'not-a-color'))
    expect(d).toContain('>?<')
    expect(d).toContain('#888')
  })
})

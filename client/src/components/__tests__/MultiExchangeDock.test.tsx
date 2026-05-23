import { describe, it, expect } from 'vitest'
import { DOCK_ITEMS, DOCK_ENABLED } from '../../ui/dock'

describe('Dock — MultiExchange entry', () => {
  it('registers multi-exchange id with label "MultiExchange" and trading group', () => {
    const entry = DOCK_ITEMS.find((i: any) => i.id === 'multi-exchange')
    expect(entry).toBeDefined()
    expect(entry.label).toBe('MultiExchange')
    expect(entry.group).toBe('trading')
  })

  it('multi-exchange entry includes inline SVG with content', () => {
    const entry = DOCK_ITEMS.find((i: any) => i.id === 'multi-exchange')
    expect(entry.svg).toMatch(/<path|<circle|<text/)
    expect(entry.svg.length).toBeGreaterThan(50)
  })

  it('multi-exchange is in DOCK_ENABLED so it is clickable', () => {
    expect(DOCK_ENABLED).toContain('multi-exchange')
  })

  it('multi-exchange is positioned after omega in DOCK_ITEMS', () => {
    const omegaIdx = DOCK_ITEMS.findIndex((i: any) => i.id === 'omega')
    const meIdx = DOCK_ITEMS.findIndex((i: any) => i.id === 'multi-exchange')
    expect(omegaIdx).toBeGreaterThanOrEqual(0)
    expect(meIdx).toBe(omegaIdx + 1)
  })
})

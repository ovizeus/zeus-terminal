import { describe, it, expect } from 'vitest'
import { DOCK_ITEMS, DOCK_ENABLED } from '../../ui/dock'
import { PAGE_VIEW_MODULES } from '../../ui/pageview'

// [2026-06-13] Market Metrics dock page — BTC MARKET METRICS + BTC ORDER BOOK +
// ZeuS S/R LEVELS moved 1:1 from AnalysisSections.tsx (home scroll zone) into a
// dedicated dock icon, placed between Liquidations and Activity. Operator request
// to shorten the home scroll, same pattern as the Liquidations page.

describe('Market Metrics dock registration', () => {
  it('DOCK_ITEMS has market-metrics labelled "Metrics" between liquidations and activity', () => {
    const ids = DOCK_ITEMS.map((d: any) => d.id)
    const iLiq = ids.indexOf('liquidations')
    const iAct = ids.indexOf('activity')
    const iMM = ids.indexOf('market-metrics')
    expect(iLiq).toBeGreaterThanOrEqual(0)
    expect(iAct).toBeGreaterThanOrEqual(0)
    expect(iMM).toBe(iLiq + 1)
    expect(iMM).toBeLessThan(iAct)
    const item = DOCK_ITEMS.find((d: any) => d.id === 'market-metrics')
    expect(item.label).toBe('Metrics')
    expect(typeof item.svg).toBe('string')
    expect(item.svg.length).toBeGreaterThan(0)
  })

  it('DOCK_ENABLED includes market-metrics between liquidations and activity', () => {
    const iLiq = DOCK_ENABLED.indexOf('liquidations')
    const iAct = DOCK_ENABLED.indexOf('activity')
    const iMM = DOCK_ENABLED.indexOf('market-metrics')
    expect(iMM).toBe(iLiq + 1)
    expect(iMM).toBeLessThan(iAct)
  })

  it('PAGE_VIEW_MODULES has the market-metrics page titled "Market Metrics"', () => {
    expect(PAGE_VIEW_MODULES['market-metrics']).toBeDefined()
    expect(PAGE_VIEW_MODULES['market-metrics'].title).toBe('Market Metrics')
  })
})

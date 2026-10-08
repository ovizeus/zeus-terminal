import { describe, it, expect } from 'vitest'
import { _mergePanelList } from '../chart/ChartControls'

// [DUAL-LIST 2026-10-08] Operator: "de ce să le pui acolo pe care le facem" —
// why does a new indicator have to be added in two places at all? It should not.
// The panel list carries metadata the registry has no concept of (emoji icon,
// which settings modal to open, whether the toggle routes through togOvr), so
// the two cannot simply be merged. Instead the panel now FALLS BACK to the
// registry: anything registered but not described here still shows up, with a
// placeholder icon, so a new indicator is usable the moment it is registered.

type Meta = { id: string; ico: string; name: string; desc: string; hasGenericSettings?: boolean; isOverlay?: boolean }
const list: Meta[] = [
  { id: 'ema', ico: '📈', name: 'EMA 50/200', desc: 'Exponential Moving Average', hasGenericSettings: true },
  { id: 'liq', ico: '💥', name: 'LIQ Heatmap', desc: 'Liquidation levels', isOverlay: true },
]
const registry = [
  { id: 'ema', name: 'EMA 50/200', desc: 'from registry' },
  { id: 'terminator', name: 'TERMINATOR', desc: 'ATR trailing-stop staircase' },
]

describe('_mergePanelList', () => {
  it('keeps every hand-written entry exactly as written', () => {
    const out = _mergePanelList(list, registry)
    const ema = out.find((x) => x.id === 'ema')!
    expect(ema.ico).toBe('📈')
    expect(ema.desc).toBe('Exponential Moving Average')
  })

  it('adds a registered indicator the panel does not describe', () => {
    const out = _mergePanelList(list, registry)
    const t = out.find((x) => x.id === 'terminator')
    expect(t).toBeTruthy()
    expect(t!.name).toBe('TERMINATOR')
    expect(t!.desc).toBe('ATR trailing-stop staircase')
  })

  it('never duplicates an id', () => {
    const out = _mergePanelList(list, registry)
    expect(out.length).toBe(new Set(out.map((x) => x.id)).size)
  })

  it('keeps panel-only entries such as the overlays', () => {
    const out = _mergePanelList(list, registry)
    expect(out.find((x) => x.id === 'liq')?.isOverlay).toBe(true)
  })

  it('auto-added entries get a toggle and a settings gear', () => {
    const t = _mergePanelList(list, registry).find((x) => x.id === 'terminator')!
    expect(t.hasGenericSettings).toBe(true)
    expect(t.isOverlay).toBeFalsy()
    expect(typeof t.ico).toBe('string')
    expect(t.ico.length).toBeGreaterThan(0)
  })

  it('survives a missing or malformed registry', () => {
    expect(_mergePanelList(list, [])).toHaveLength(2)
    expect(_mergePanelList(list, null as never)).toHaveLength(2)
    expect(_mergePanelList(list, [{ name: 'no id' } as never])).toHaveLength(2)
  })

  it('hand-written order comes first, newcomers after', () => {
    const out = _mergePanelList(list, registry)
    expect(out.slice(0, 2).map((x) => x.id)).toEqual(['ema', 'liq'])
    expect(out[out.length - 1].id).toBe('terminator')
  })
})

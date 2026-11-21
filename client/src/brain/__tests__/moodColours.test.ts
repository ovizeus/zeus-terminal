import { describe, test, expect } from 'vitest'
import { MC } from '../brainStrings'

// [2026-11-21] Cerut de operator: „fiecare stare cu culoarea ei la radar". Radarul ia culoarea DOAR din
// MC (brainDerived: c = hexRgb(MC[mood]) → dcol in brainRender). Testul fixeaza ca cele 5 stari dinainte
// de intrare exista si se deosebesc la ochi (ΔE CIELAB ≥ 20; masurat azi: minim 25,4 NERVOUS/HESITANT).
function lab(h: string): [number, number, number] {
  const ch = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92))
  const [r, g, b] = ch
  const X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, Y = r * 0.2126 + g * 0.7152 + b * 0.0722, Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
  const t = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116)
  return [116 * t(Y) - 16, 500 * (t(X) - t(Y)), 200 * (t(Y) - t(Z))]
}
const FIVE = ['CALM', 'ALERT', 'HESITANT', 'NERVOUS', 'CONFUSED'] as const

describe('culorile starilor pe radar', () => {
  test('toate cele 5 stari au culoare', () => {
    for (const m of FIVE) expect((MC as any)[m]).toMatch(/^#[0-9a-f]{6}$/i)
  })
  test('oricare doua se deosebesc la ochi (ΔE ≥ 20)', () => {
    for (let i = 0; i < FIVE.length; i++) for (let j = i + 1; j < FIVE.length; j++) {
      const a = lab((MC as any)[FIVE[i]]), b = lab((MC as any)[FIVE[j]])
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), `${FIVE[i]} / ${FIVE[j]}`).toBeGreaterThanOrEqual(20)
    }
  })
})

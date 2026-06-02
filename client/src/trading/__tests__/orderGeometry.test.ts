import { describe, it, expect } from 'vitest'
import golden from '../../../../tests/fixtures/order-geometry-golden.json'
import { computeOrderGeometry } from '../orderGeometry'
describe('orderGeometry (client) matches golden vectors (parity with server)', () => {
  golden.forEach((v: any, i: number) => {
    it(`vector ${i} ${v.in.side} @${v.in.price}`, () => {
      const out = computeOrderGeometry(v.in)
      expect(out.qty).toBeCloseTo(v.out.qty, 10)
      expect(out.sl).toBeCloseTo(v.out.sl, 6)
      expect(out.tp).toBeCloseTo(v.out.tp, 6)
      expect(out.slPnl).toBeCloseTo(v.out.slPnl, 6)
      expect(out.tpPnl).toBeCloseTo(v.out.tpPnl, 6)
    })
  })
})

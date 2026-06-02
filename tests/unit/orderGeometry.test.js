'use strict';
const path = require('path');
const golden = require(path.resolve(__dirname, '../fixtures/order-geometry-golden.json'));
const { computeOrderGeometry } = require('../../server/services/orderGeometry');
describe('orderGeometry (server) matches golden vectors', () => {
  golden.forEach((v, i) => {
    test(`vector ${i} ${v.in.side} @${v.in.price}`, () => {
      const out = computeOrderGeometry(v.in);
      expect(out.qty).toBeCloseTo(v.out.qty, 10);
      expect(out.sl).toBeCloseTo(v.out.sl, 6);
      expect(out.tp).toBeCloseTo(v.out.tp, 6);
      expect(out.slPnl).toBeCloseTo(v.out.slPnl, 6);
      expect(out.tpPnl).toBeCloseTo(v.out.tpPnl, 6);
    });
  });
});

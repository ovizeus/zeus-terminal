'use strict';
const C = require('../../server/services/sp2Cutover');
beforeEach(() => C._setForTest([]));
describe('sp2Cutover user list', () => {
  test('empty by default → nobody cutover', () => { expect(C.isCutoverUser(1)).toBe(false); });
  test('uid in list → cutover', () => { C._setForTest([1]); expect(C.isCutoverUser(1)).toBe(true); expect(C.isCutoverUser(2)).toBe(false); });
  test('"all" sentinel → every user cutover', () => { C._setForTest('all'); expect(C.isCutoverUser(99)).toBe(true); });
});

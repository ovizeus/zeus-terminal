'use strict';
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '../../data/sp2_cutover_users.json');
let _list = [];
let _floor = null;
_load();
function _load() {
  try {
    const v = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    _list = v === 'all' ? 'all' : (v && Array.isArray(v.users) ? v.users : []);
    _floor = (v && typeof v.soakConfFloor === 'number') ? v.soakConfFloor : null;
  } catch (_) {
    _list = [];
    _floor = null;
  }
}
function isCutoverUser(userId) {
  if (_list === 'all') return true;
  return Array.isArray(_list) && _list.includes(Number(userId));
}
// [SP2-a soak] Tunable SMALL-tier confidence floor for the testnet soak. Read
// from data/sp2_cutover_users.json {"soakConfFloor": N}; default 45, clamped to
// [30,62) so it can never raise the standard 62 bar.
function soakConfFloor() {
  const v = _floor;
  return (typeof v === 'number' && v >= 30 && v < 62) ? v : 45;
}
function _setForTest(v, floor) {
  _list = v;
  if (arguments.length > 1) _floor = floor;
}
module.exports = { isCutoverUser, soakConfFloor, _setForTest };

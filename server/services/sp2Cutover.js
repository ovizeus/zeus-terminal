'use strict';
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '../../data/sp2_cutover_users.json');
let _list = _load();
function _load() {
  try { const v = JSON.parse(fs.readFileSync(FILE, 'utf8')); return v === 'all' ? 'all' : (v && Array.isArray(v.users) ? v.users : []); }
  catch (_) { return []; }
}
function isCutoverUser(userId) {
  if (_list === 'all') return true;
  return Array.isArray(_list) && _list.includes(Number(userId));
}
function _setForTest(v) { _list = v; }
module.exports = { isCutoverUser, _setForTest };

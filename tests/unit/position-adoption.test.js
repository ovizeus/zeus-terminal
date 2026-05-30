'use strict';
// [P-A] Position adoption — bring untracked exchange positions into _positions so
// getLivePositions returns them (persist + display + manageable). See
// docs/superpowers/specs/2026-05-30-P-A-position-adoption-design.md (v2).

const Database = require('better-sqlite3');
const fs = require('fs');
const TEST_DB = '/tmp/zeus-adopt-' + Date.now() + '.db';
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
const mockDb = new Database(TEST_DB);
mockDb.exec(`
  CREATE TABLE at_positions (seq INTEGER PRIMARY KEY, data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), user_id INTEGER, exchange TEXT DEFAULT 'binance');
  CREATE UNIQUE INDEX idx_at_pos_user_sym_side_mode_open ON at_positions(user_id, json_extract(data,'$.symbol'), json_extract(data,'$.side'), json_extract(data,'$.mode')) WHERE status='OPEN';
  CREATE TABLE at_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, user_id INTEGER);
  CREATE TABLE at_closed (seq INTEGER PRIMARY KEY, data TEXT NOT NULL, closed_at TEXT DEFAULT (datetime('now')), user_id INTEGER, exchange TEXT DEFAULT 'binance');
  CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, details TEXT, created_at TEXT DEFAULT (datetime('now')));
`);
const _atState = {};
// serverAT does `const db = require('./database')` and calls db.atSavePosition /
// db.atSetState directly — database.js exports those at top level + a `db` raw instance.
const dbMock = {
  db: mockDb,
  atSavePosition: (pos) => mockDb.prepare("INSERT INTO at_positions (seq, data, status, user_id, exchange) VALUES (?,?,?,?,?) ON CONFLICT(seq) DO UPDATE SET data=excluded.data, status=excluded.status, user_id=excluded.user_id").run(pos.seq, JSON.stringify(pos), pos.status || 'OPEN', pos.userId || null, pos.exchange || 'binance'),
  atLoadOpenPositions: () => [],
  atSetState: (k, v) => { _atState[k] = v; },
  atGetState: (k) => _atState[k],
  prepare: (...a) => mockDb.prepare(...a),
  atGetOpenUserIds: () => [],
  atArchiveClosed: () => {},
};
const tgMock = { sendToUser: jest.fn(() => Promise.resolve()), alertCritical: jest.fn(() => Promise.resolve()), alertOrderFilled: jest.fn(), sendToAll: jest.fn(), alertServerStart: jest.fn(), alertServerStop: jest.fn() };
jest.mock('../../server/services/database', () => dbMock);
jest.mock('../../server/services/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../server/services/audit', () => ({ record: jest.fn() }));
jest.mock('../../server/services/telegram', () => tgMock);
jest.mock('../../server/services/credentialStore', () => ({
  getExchangeCreds: () => ({ exchange: 'bybit', mode: 'testnet' }),
  getExchangeCredsFor: () => ({ exchange: 'bybit', mode: 'testnet' }),
}));

const serverAT = require('../../server/services/serverAT');

describe('[P-A] _adoptExternalPosition', () => {
  it('creates a tracked OPEN row that getLivePositions returns', () => {
    const pos = { symbol: 'BTCUSDT', side: 'SHORT', qty: '0.054', entryPrice: '73559.4', markPrice: '73500', slOrderId: 'sl-x' };
    const r = serverAT._adoptExternalPosition(1, 'bybit', 'TESTNET', pos);
    expect(r.ok).toBe(true);
    const live = serverAT.getLivePositions(1);
    const found = live.find(p => p.symbol === 'BTCUSDT' && p.side === 'SHORT');
    expect(found).toBeTruthy();
    expect(found.source).toBe('external');
    expect(tgMock.sendToUser).toHaveBeenCalled();
  });

  it('is idempotent — adopting the same position twice yields one tracked row', () => {
    const pos = { symbol: 'ETHUSDT', side: 'LONG', qty: '1', entryPrice: '3000', markPrice: '3000', slOrderId: 'sl-y' };
    serverAT._adoptExternalPosition(1, 'bybit', 'TESTNET', pos);
    serverAT._adoptExternalPosition(1, 'bybit', 'TESTNET', pos);
    const live = serverAT.getLivePositions(1).filter(p => p.symbol === 'ETHUSDT' && p.side === 'LONG');
    expect(live.length).toBe(1);
  });
});

describe('[P-A] _adoptWithProtection (SL-then-insert)', () => {
  it('SL-fail → halt armed + no tracked row', async () => {
    const pos = { symbol: 'SOLUSDT', side: 'LONG', qty: '2', entryPrice: '150', markPrice: '150' };
    const r = await serverAT._adoptWithProtection(1, 'bybit', 'TESTNET', pos, async () => ({ ok: false, error: 'sl down' }));
    expect(r.ok).toBe(false);
    expect(serverAT.getLivePositions(1).some(p => p.symbol === 'SOLUSDT')).toBe(false);
    expect(_atState['global:halt'] && _atState['global:halt'].active).toBe(true);
  });
  it('SL-ok → row adopted with slOrderId', async () => {
    const pos = { symbol: 'XRPUSDT', side: 'SHORT', qty: '10', entryPrice: '0.5', markPrice: '0.5' };
    const r = await serverAT._adoptWithProtection(1, 'bybit', 'TESTNET', pos, async () => ({ ok: true, slOrderId: 's1' }));
    expect(r.ok).toBe(true);
    const f = serverAT.getLivePositions(1).find(p => p.symbol === 'XRPUSDT');
    expect(f.live.slOrderId).toBe('s1');
  });
  it('position already has an exchange SL → adopts without calling slPlacer', async () => {
    const placer = jest.fn(async () => ({ ok: true, slOrderId: 'should-not-be-used' }));
    const pos = { symbol: 'DOGEUSDT', side: 'LONG', qty: '100', entryPrice: '0.1', markPrice: '0.1', slOrderId: 'existing-sl' };
    const r = await serverAT._adoptWithProtection(1, 'bybit', 'TESTNET', pos, placer);
    expect(r.ok).toBe(true);
    expect(placer).not.toHaveBeenCalled();
    expect(serverAT.getLivePositions(1).find(p => p.symbol === 'DOGEUSDT').live.slOrderId).toBe('existing-sl');
  });
});

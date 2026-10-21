'use strict';
// [PROVENANCE FIX 2026-10-21] Rândul PENDING scris la execuţie trebuie să
// poarte `userId` şi `env` ÎN OBIECT, nu doar în coloana `user_id`. Vezi
// positionProvenance.js pentru cele două mecanisme care cădeau fără ele.
// Testul acoperă AMBELE burse: `mode` fusese reparat în amândouă în iunie,
// `userId` în niciuna — deci contractul se verifică simetric, altfel una
// dintre ele o ia iar înainte.
const { _buildPendingPositionData } = require('../../server/services/binanceOps');
const { _buildPendingPositionDataBybit } = require('../../server/services/bybitOps');

const CASES = [
  ['binance', _buildPendingPositionData],
  ['bybit', _buildPendingPositionDataBybit],
];

const params = {
  symbol: 'BTCUSDT', side: 'LONG', qty: 0.062, entryType: 'MARKET',
  sl: { price: '62000' }, tp: { price: '67000' }, leverage: 5,
  decisionKey: 'SAT_1_abc', source: 'serverAT', mode: 'live',
};

describe.each(CASES)('%s — rândul PENDING poartă provenienţa', (name, build) => {
  test('constructorul e exportat (altfel contractul nu e verificabil)', () => {
    expect(typeof build).toBe('function');
  });

  test('scrie userId în OBIECT — câmpul pe care garda direcţională îl testează primul', () => {
    expect(build(params, { mode: 'testnet' }, 7).userId).toBe(7);
  });

  test("scrie env='TESTNET' — poarta care armează SMART_CUT", () => {
    expect(build(params, { mode: 'testnet' }, 1).env).toBe('TESTNET');
  });

  test("env='REAL' pe creds live", () => {
    expect(build(params, { mode: 'live' }, 1).env).toBe('REAL');
  });

  test('FAIL-CLOSED: fără creds → env null, niciodată REAL', () => {
    expect(build(params, null, 1).env).toBeNull();
  });

  test('uid lipsă → userId null, nu un utilizator inventat', () => {
    expect(build(params, { mode: 'testnet' }, undefined).userId).toBeNull();
  });

  test('nu regresează câmpurile de ordin deja scrise', () => {
    const d = build(params, { mode: 'testnet' }, 1);
    expect(d.symbol).toBe('BTCUSDT');
    expect(d.side).toBe('LONG');
    expect(d.qty).toBe(0.062);
    expect(d.sl).toBe('62000');
    expect(d.tp).toBe('67000');
    expect(d.leverage).toBe(5);
    expect(d.decisionKey).toBe('SAT_1_abc');
    expect(d.source).toBe('serverAT');
  });

  test("nu regresează tag-ul de mod: engine mode='live' bate creds.mode='testnet'", () => {
    expect(build(params, { mode: 'testnet' }, 1).mode).toBe('live');
  });
});

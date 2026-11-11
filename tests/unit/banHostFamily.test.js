'use strict';
/**
 * De ce exista acest test.
 *
 * 11 nov 2026: opt "banuri" intr-o zi. 41 din 41 de raspunsuri 418/429 veneau
 * de la testnet.binancefuture.com, cu usedWeight=0 si cu un IP care nu e al
 * nostru. Zero de la fapi.binance.com. Dar starea de ban era una singura,
 * "globala", asa ca un ban de TESTNET stingea datele publice de pe MAINNET:
 * klines, cartea de ordine, randul de preturi.
 *
 * Regula: banul se aplica familiei de host care l-a dat. Familie necunoscuta
 * = se aplica tuturor (comportamentul vechi, fail-closed).
 */
const Database = require('better-sqlite3');
const path = require('path');
const S = (m) => path.join(__dirname, '../../server/services', m);

const SCHEMA_SQL = `
  CREATE TABLE binance_rate_state (
    scope TEXT PRIMARY KEY DEFAULT 'global',
    banned_until INTEGER NOT NULL DEFAULT 0, ban_reason TEXT,
    warm_until INTEGER NOT NULL DEFAULT 0,
    used_weight_1m INTEGER NOT NULL DEFAULT 0, used_weight_ts INTEGER,
    burst_calls_10s INTEGER NOT NULL DEFAULT 0, burst_window_start INTEGER,
    last_heavy_endpoint_ts INTEGER,
    resume_generation INTEGER NOT NULL DEFAULT 1,
    consecutive_ban_count INTEGER NOT NULL DEFAULT 0,
    last_ban_at INTEGER, updated_at INTEGER NOT NULL
  );
  CREATE TABLE binance_rate_state_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, event_json TEXT NOT NULL
  );
`;

const MAIN = 'fapi.binance.com';
const TEST = 'testnet.binancefuture.com';
const KLINES = { pressure: 0.1, src: 'marketFeed:klines', path: '/fapi/v1/klines' };

let db, rs, scheduler;
beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  jest.resetModules();
  jest.doMock(S('database'), () => ({ db, get: () => db }));
  rs = require(S('binanceRateState'));
  scheduler = require(S('binanceScheduler'));
});
afterEach(() => { try { db.close(); } catch (_) {} });

describe('hostFamily', () => {
  test('desparte testnet de mainnet', () => {
    expect(rs.hostFamily(TEST)).toBe('testnet');
    expect(rs.hostFamily('https://testnet.binancefuture.com')).toBe('testnet');
    expect(rs.hostFamily(MAIN)).toBe('mainnet');
    expect(rs.hostFamily('https://fapi.binance.com/fapi/v1/klines')).toBe('mainnet');
    expect(rs.hostFamily('api.binance.com')).toBe('mainnet');
  });
  test('ce nu cunoaste ramane necunoscut, nu ghicit', () => {
    expect(rs.hostFamily('')).toBeNull();
    expect(rs.hostFamily(null)).toBeNull();
    expect(rs.hostFamily('unknown')).toBeNull();
    expect(rs.hostFamily('api.bybit.com')).toBeNull();
  });
});

describe('banAppliesTo — fail-closed pe tot ce e neclar', () => {
  const st = (reason) => ({ banned_until: Date.now() + 60000, warm_until: 0, ban_reason: reason });
  test('ban de testnet NU atinge mainnet', () => {
    const s = st(rs.tagReason('testnet', 'HTTP 418: x'));
    expect(rs.banAppliesTo(s, MAIN)).toBe(false);
    expect(rs.banAppliesTo(s, TEST)).toBe(true);
  });
  test('ban de mainnet NU atinge testnet', () => {
    const s = st(rs.tagReason('mainnet', 'HTTP 418: x'));
    expect(rs.banAppliesTo(s, MAIN)).toBe(true);
    expect(rs.banAppliesTo(s, TEST)).toBe(false);
  });
  test('ban fara familie (vechi) se aplica TUTUROR', () => {
    const s = st('HTTP 418: Way too many requests');
    expect(rs.banAppliesTo(s, MAIN)).toBe(true);
    expect(rs.banAppliesTo(s, TEST)).toBe(true);
  });
  test('cerere cu host necunoscut ramane oprita', () => {
    const s = st(rs.tagReason('testnet', 'x'));
    expect(rs.banAppliesTo(s, undefined)).toBe(true);
    expect(rs.banAppliesTo(s, 'unknown')).toBe(true);
  });
  test('stare stricata = se aplica', () => {
    expect(rs.banAppliesTo(null, MAIN)).toBe(true);
    expect(rs.banAppliesTo({ ban_reason: 42 }, MAIN)).toBe(true);
  });
});

describe('recordBan tine minte familia', () => {
  test('familia ajunge in stare si SUPRAVIETUIESTE ferestrei WARM', () => {
    const now = Date.now();
    rs.recordBan({ bannedUntil: now + 1000, reason: 'HTTP 418: x', now, family: 'testnet' });
    expect(rs.banFamilyOf(rs.load())).toBe('testnet');
    rs.advanceState({ now: now + 2000 }); // ban expirat -> WARM
    const s = rs.load();
    expect(rs.computeCurrentMode(s, now + 2001)).toBe('WARM');
    expect(rs.banFamilyOf(s)).toBe('testnet');
  });
  test('doua familii active in acelasi timp = ban pentru TOTI', () => {
    const now = Date.now();
    rs.recordBan({ bannedUntil: now + 60000, reason: 'a', now, family: 'testnet' });
    rs.recordBan({ bannedUntil: now + 90000, reason: 'b', now: now + 10, family: 'mainnet' });
    expect(rs.banFamilyOf(rs.load())).toBeNull();
  });
  test('un ban vechi fara familie NU se ingusteaza cand vine unul cu familie', () => {
    const now = Date.now();
    rs.recordBan({ bannedUntil: now + 60000, reason: 'vechi', now });
    rs.recordBan({ bannedUntil: now + 90000, reason: 'nou', now: now + 10, family: 'testnet' });
    expect(rs.banFamilyOf(rs.load())).toBeNull();
  });
  test('dupa ce totul a expirat, un ban nou isi ia familia proprie', () => {
    const now = Date.now();
    rs.recordBan({ bannedUntil: now - 5000, reason: 'a', now: now - 9000, family: 'mainnet' });
    rs.save({ banned_until: 0, warm_until: 0 });
    rs.recordBan({ bannedUntil: now + 60000, reason: 'b', now, family: 'testnet' });
    expect(rs.banFamilyOf(rs.load())).toBe('testnet');
  });
  test('fara familie data, scrie motivul neatins (compatibil cu vechiul apel)', () => {
    const now = Date.now();
    rs.recordBan({ bannedUntil: now + 60000, reason: 'HTTP 418: x', now });
    expect(rs.load().ban_reason).toBe('HTTP 418: x');
  });
});

describe('poarta: banul de testnet nu mai stinge mainnet', () => {
  test('SUPPRESSED de testnet: klines de mainnet TREC, testnet e oprit', () => {
    const now = Date.now();
    rs.recordBan({ bannedUntil: now + 60000, reason: 'HTTP 418', now, family: 'testnet' });
    const main = scheduler.canProceed({ ...KLINES, host: MAIN });
    expect(main.reason).not.toBe('suppressed_banned');
    expect(main.accept).toBe(true);
    const t = scheduler.canProceed({ pressure: 0.1, src: 'signer:GET /fapi/v2/positionRisk', path: '/fapi/v2/positionRisk', host: TEST });
    expect(t.accept).toBe(false);
    expect(t.reason).toBe('suppressed_banned');
  });
  test('WARM de testnet: clasa B de mainnet TRECE', () => {
    const now = Date.now();
    rs.save({ banned_until: 0, warm_until: now + 60000, ban_reason: rs.tagReason('testnet', 'x'), last_ban_at: now });
    const r = scheduler.canProceed({ ...KLINES, host: MAIN });
    expect(r.reason).not.toBe('warm_class_b');
    expect(r.accept).toBe(true);
  });
  test('REGRESIE: banul de mainnet opreste in continuare mainnet', () => {
    const now = Date.now();
    rs.recordBan({ bannedUntil: now + 60000, reason: 'HTTP 418', now, family: 'mainnet' });
    const r = scheduler.canProceed({ ...KLINES, host: MAIN });
    expect(r.accept).toBe(false);
    expect(r.reason).toBe('suppressed_banned');
  });
  test('REGRESIE: banul fara familie opreste tot, ca inainte', () => {
    const now = Date.now();
    rs.recordBan({ bannedUntil: now + 60000, reason: 'HTTP 418', now });
    expect(scheduler.canProceed({ ...KLINES, host: MAIN }).accept).toBe(false);
    expect(scheduler.canProceed({ ...KLINES, host: TEST }).accept).toBe(false);
    expect(scheduler.canProceed({ ...KLINES }).accept).toBe(false);
  });
});

describe('semnatarul: cererile semnate se opresc doar pe familia banata', () => {
  test('ban venit de pe testnet lasa libere cererile semnate de mainnet', () => {
    const signer = require(S('binanceSigner'));
    signer._setIpBan(Date.now() + 60000, 'HTTP 418: x', 'https://testnet.binancefuture.com');
    expect(signer._isIpBannedFor('https://testnet.binancefuture.com')).toBe(true);
    expect(signer._isIpBannedFor('https://fapi.binance.com')).toBe(false);
    expect(rs.banFamilyOf(rs.load())).toBe('testnet');
  });
  test('ban fara host cunoscut opreste tot', () => {
    const signer = require(S('binanceSigner'));
    signer._setIpBan(Date.now() + 60000, 'HTTP 418: x');
    expect(signer._isIpBannedFor('https://fapi.binance.com')).toBe(true);
    expect(signer._isIpBannedFor('https://testnet.binancefuture.com')).toBe(true);
  });
  test('ban persistat de testnet, incarcat dupa reload, nu opreste mainnet', () => {
    const now = Date.now();
    rs.recordBan({ bannedUntil: now + 60000, reason: 'HTTP 418', now, family: 'testnet' });
    const signer = require(S('binanceSigner'));
    expect(signer._isIpBannedFor('https://fapi.binance.com')).toBe(false);
    expect(signer._isIpBannedFor('https://testnet.binancefuture.com')).toBe(true);
  });
});

describe('pornirea: banul de testnet nu mai lasa feedul de mainnet orb', () => {
  const { shouldSeedAtBoot } = require(S('klineSelfHeal'));
  test('ban de testnet -> istoricul de mainnet SE incarca', () => {
    const now = Date.now();
    const st = { banned_until: now + 60000, warm_until: 0, ban_reason: '[family:testnet] HTTP 418' };
    expect(shouldSeedAtBoot(st, now).seed).toBe(true);
  });
  test('REGRESIE: ban de mainnet sau fara familie -> NU se incarca', () => {
    const now = Date.now();
    expect(shouldSeedAtBoot({ banned_until: now + 60000, ban_reason: '[family:mainnet] x' }, now)).toEqual({ seed: false, reason: 'banned' });
    expect(shouldSeedAtBoot({ banned_until: now + 60000, ban_reason: 'HTTP 418' }, now)).toEqual({ seed: false, reason: 'banned' });
    expect(shouldSeedAtBoot({ banned_until: 0, warm_until: now + 60000, ban_reason: null }, now)).toEqual({ seed: false, reason: 'warming' });
  });
});

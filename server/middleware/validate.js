// Zeus Terminal — Input Validation Middleware
// Sanitizes and validates order parameters
'use strict';

const VALID_SIDES = new Set(['BUY', 'SELL']);
const VALID_TYPES = new Set(['MARKET', 'LIMIT', 'STOP_MARKET', 'TAKE_PROFIT_MARKET']);
const SYMBOL_RE = /^[A-Z0-9]{2,20}$/;

function validateOrderBody(req, res, next) {
  const { symbol, side, type, quantity, leverage, stopPrice, newClientOrderId } = req.body;

  if (!symbol || !SYMBOL_RE.test(String(symbol).toUpperCase())) {
    return res.status(400).json({ error: 'Invalid symbol' });
  }
  if (!VALID_SIDES.has(String(side).toUpperCase())) {
    return res.status(400).json({ error: 'Invalid side (BUY or SELL)' });
  }
  if (type != null && !VALID_TYPES.has(String(type).toUpperCase())) {
    return res.status(400).json({ error: 'Invalid order type' });
  }
  const qty = parseFloat(quantity);
  if (!quantity || isNaN(qty) || qty <= 0) {
    return res.status(400).json({ error: 'Invalid quantity' });
  }
  if (leverage !== undefined) {
    const lev = parseInt(leverage, 10);
    if (isNaN(lev) || lev < 1 || lev > 125) {
      return res.status(400).json({ error: 'Invalid leverage (1-125)' });
    }
  }
  // stopPrice required for STOP_MARKET / TAKE_PROFIT_MARKET
  const normType = type ? String(type).toUpperCase() : 'MARKET';
  // [FIX QA-H12] Validate price for LIMIT orders
  if (normType === 'LIMIT') {
    const { price } = req.body;
    const p = parseFloat(price);
    if (price === undefined || price === null || isNaN(p) || p <= 0) {
      return res.status(400).json({ error: 'Invalid or missing price for LIMIT order' });
    }
    req.body.price = p;
  }
  if (normType === 'STOP_MARKET' || normType === 'TAKE_PROFIT_MARKET') {
    if (stopPrice === undefined || stopPrice === null) {
      return res.status(400).json({ error: 'stopPrice required for ' + normType });
    }
    const sp = parseFloat(stopPrice);
    if (isNaN(sp) || sp <= 0) {
      return res.status(400).json({ error: 'Invalid stopPrice' });
    }
    req.body.stopPrice = sp;
  }
  // newClientOrderId — alphanumeric + underscore, max 36 chars (Binance limit)
  if (newClientOrderId !== undefined) {
    const cid = String(newClientOrderId);
    if (!/^[A-Za-z0-9_]{1,36}$/.test(cid)) {
      return res.status(400).json({ error: 'Invalid newClientOrderId' });
    }
    req.body.newClientOrderId = cid;
  }

  // Normalize values
  req.body.symbol = String(symbol).toUpperCase();
  req.body.side = String(side).toUpperCase();
  req.body.type = normType;
  req.body.quantity = qty;
  if (leverage !== undefined) req.body.leverage = parseInt(leverage, 10);

  // [BUG-T5 2026-05-13] Defense-in-depth: enforce SL pentru mode=live.
  // Coordonat cu BUG-T2c (Path A/B no-SL în registerManualPosition) +
  // BUG-T4 (orphan position în catch block). Middleware blochează cererea
  // ÎNAINTE să ajungă la route handler, prevenind tracking-deficient
  // live positions fără SL pe exchange.
  //
  // Edge cases acoperite: 0, "0", null, undefined, "", negative, NaN,
  // Infinity, malformed decimals ("1.2.3"), booleans, objects/arrays.
  // Number() folosit (NU parseFloat) — strict, refuză "1.2.3" → NaN.
  //
  // Demo mode exempt (per Mirela manual playground pattern documentat
  // BUG-T10 audit §3.5; demo positions au sl=null prin design).
  if (req.body.mode === 'live') {
    const sl = req.body.sl;
    if (sl === undefined || sl === null || sl === '' ||
        typeof sl === 'object' || typeof sl === 'boolean') {
      return res.status(400).json({ error: 'SL required for live mode (defense-in-depth)' });
    }
    const slNum = Number(String(sl).trim());
    if (!Number.isFinite(slNum) || slNum <= 0) {
      return res.status(400).json({ error: 'SL required for live mode (defense-in-depth)' });
    }
    req.body.sl = slNum;  // normalize la number
  }

  next();
}

function validateCancelBody(req, res, next) {
  const { symbol, orderId } = req.body;
  if (!symbol || !SYMBOL_RE.test(String(symbol).toUpperCase())) {
    return res.status(400).json({ error: 'Invalid symbol' });
  }
  if (!orderId) {
    return res.status(400).json({ error: 'Missing orderId' });
  }
  const oid = String(orderId);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(oid) && isNaN(Number(orderId))) {
    return res.status(400).json({ error: 'Invalid orderId format' });
  }
  req.body.orderId = oid;
  req.body.symbol = String(symbol).toUpperCase();
  next();
}

function validateLeverageBody(req, res, next) {
  const { symbol, leverage } = req.body;
  if (!symbol || !SYMBOL_RE.test(String(symbol).toUpperCase())) {
    return res.status(400).json({ error: 'Invalid symbol' });
  }
  const lev = parseInt(leverage, 10);
  if (isNaN(lev) || lev < 1 || lev > 125) {
    return res.status(400).json({ error: 'Invalid leverage (1-125)' });
  }
  req.body.symbol = String(symbol).toUpperCase();
  req.body.leverage = lev;
  next();
}

// [SEC-27 — flipped to STRICT 2026-05-08] Settings body validator. Was
// LOG-ONLY soft mode pre-flip; soft-mode logs in PM2 over weeks of
// production traffic showed ZERO `[validate][settings] log-only` entries
// (grep confirmed clean). Contract stable → flip to strict reject. Now:
// (1) unknown keys → 400 + JSON error listing offenders; (2) bad types →
// 400 + JSON error listing mismatches; (3) all whitelisted shape mismatches
// reject. Compatibility guard: `null` value for any whitelisted key still
// accepted (downstream null-safety is already established).
//
// Mirrors the client-side SettingsPayload contract (see
// client/src/types/settings-contracts.ts) and the whitelist in
// routes/trading.js.
const SETTINGS_SHAPE = {
  // numbers
  confMin: 'number', sigMin: 'number', size: 'number', riskPct: 'number',
  maxDay: 'number', maxPos: 'number', sl: 'number', rr: 'number',
  killPct: 'number', lossStreak: 'number', maxAddon: 'number', lev: 'number',
  uiScale: 'number', timezoneOffset: 'number',
  ptLevDemo: 'number', ptLevLive: 'number',
  // booleans
  adaptEnabled: 'boolean', adaptLive: 'boolean', smartExitEnabled: 'boolean',
  mscanEnabled: 'boolean', soundEnabled: 'boolean', assistArmed: 'boolean',
  // strings
  theme: 'string', chartTf: 'string', chartTz: 'string', chartType: 'string',
  profile: 'string', bmMode: 'string', ptMarginMode: 'string',
  // arrays
  mscanSyms: 'array',
  // objects (nested blobs — null also acceptable)
  candleColors: 'object', heatmapSettings: 'object',
  indSettings: 'object', indicators: 'object', liqSettings: 'object', llvSettings: 'object',
  zsSettings: 'object', srSettings: 'object', alertSettings: 'object',
  manualLive: 'object', manualTestnet: 'object', dslSettings: 'object',
  // [BRAIN-MODE-SPLIT b74] per-AT-mode brain namespace — nested { live, demo }
  brain: 'object',
};

function validateSettingsBody(req, res, next) {
  try {
    const raw = req.body && req.body.settings;
    if (raw === undefined || raw === null) {
      // Allow missing settings (some endpoints may legitimately POST without
      // settings — handler decides). Don't reject empty body here.
      return next();
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid settings shape',
        detail: 'expected plain object, got ' + (Array.isArray(raw) ? 'array' : typeof raw),
      });
    }
    const unknownKeys = [];
    const badTypes = [];
    for (const key of Object.keys(raw)) {
      const expected = SETTINGS_SHAPE[key];
      if (!expected) { unknownKeys.push(key); continue; }
      const value = raw[key];
      if (value === null) continue; // null accepted for any whitelisted key
      const actual = Array.isArray(value) ? 'array' : typeof value;
      if (actual !== expected) badTypes.push({ key, expected, actual });
    }
    if (unknownKeys.length > 0 || badTypes.length > 0) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid settings payload',
        unknownKeys: unknownKeys.length > 0 ? unknownKeys : undefined,
        badTypes: badTypes.length > 0 ? badTypes : undefined,
      });
    }
  } catch (err) {
    // Middleware-level error: log + soft-pass to avoid breaking handler on
    // unexpected internal failure (defense in depth — strict on data
    // contract, lenient on validator-internal exceptions).
    console.warn('[validate][settings] middleware error, soft-passing:', err && err.message);
  }
  return next();
}

// ─── Profile fields validator (flip-header profile) ───
const PROFILE_USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const PROFILE_HEX_RE = /^#[0-9a-fA-F]{6}$/;
const PROFILE_AVATAR_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const PROFILE_AVATAR_MAX_LEN = 300000; // ~220KB decoded — generous for a 128px image

function validateProfileFields(p) {
  if (!p || typeof p !== 'object') return { ok: false, error: 'body' };
  if (p.display_name != null && (typeof p.display_name !== 'string' || p.display_name.length > 40)) return { ok: false, error: 'display_name' };
  if (p.username != null && p.username !== '' && !PROFILE_USERNAME_RE.test(p.username)) return { ok: false, error: 'username' };
  if (p.accent_color != null && p.accent_color !== '' && !PROFILE_HEX_RE.test(p.accent_color)) return { ok: false, error: 'accent_color' };
  if (p.tagline != null && (typeof p.tagline !== 'string' || p.tagline.length > 80)) return { ok: false, error: 'tagline' };
  if (p.avatar != null && p.avatar !== '') {
    if (typeof p.avatar !== 'string' || p.avatar.length > PROFILE_AVATAR_MAX_LEN || !PROFILE_AVATAR_RE.test(p.avatar)) return { ok: false, error: 'avatar' };
  }
  return { ok: true };
}

module.exports = { validateOrderBody, validateCancelBody, validateLeverageBody, validateSettingsBody, validateProfileFields };

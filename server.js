// Zeus Terminal v122 — Server with Trading API + Multi-User
// [SENTRY] Must be first import — instruments all subsequent requires
const Sentry = require('./server/instrument');
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const config = require('./server/config');
const tradingRoutes = require('./server/routes/trading');
const authRoutes = require('./server/routes/auth');
const exchangeRoutes = require('./server/routes/exchange');
const { createSessionAuth } = require('./server/middleware/sessionAuth');
const { startAutoRefresh: refreshExchangeInfo } = require('./server/services/exchangeInfo');
const telegram = require('./server/services/telegram');
const telegramBot = require('./server/services/telegramBot');
const logger = require('./server/services/logger');
// reconciliation.js removed — serverAT has built-in _runReconciliation (60s + startup)
const db = require('./server/services/database');
const MF = require('./server/migrationFlags');
const WebSocket = require('ws');
// [P2] Server-side market data feed
const marketFeed = require('./server/services/marketFeed');
const serverState = require('./server/services/serverState');
// [P3] Server-side brain cycle
const serverBrain = require('./server/services/serverBrain');
// [P5] Server-side AT shadow engine
const serverAT = require('./server/services/serverAT');
const metrics = require('./server/services/metrics');
const { atCriticalLimit, globalApiLimit } = require('./server/middleware/rateLimit');

const app = express();
const PORT = config.port;

// Trust proxy (Cloudflare/nginx) for correct req.ip in rate limiting
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Gzip compression for all responses
const compression = require('compression');
app.use(compression());

// Request correlation ID + slow request detection
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (ms > 3000) logger.warn('SLOW', `${req.method} ${req.originalUrl} ${ms}ms`, { requestId: req.id });
  });
  next();
});

// Parse JSON bodies and cookies
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// [BATCH2] Security headers via Helmet
const helmet = require('helmet');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://browser.sentry-cdn.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "wss://fstream.binance.com", "wss://stream.bybit.com", "https://fapi.binance.com", "https://api.binance.com", "https://testnet.binancefuture.com", "https://api.alternative.me", "https://*.ingest.de.sentry.io"],
      imgSrc: ["'self'", "data:", "blob:"],
      manifestSrc: ["'self'", "blob:"],
      frameAncestors: ["'none'"],
      scriptSrcAttr: ["'unsafe-inline'"],  // needed for onclick/onchange handlers
      baseUri: ["'self'"],
      formAction: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,   // breaks CDN loads if true
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
}));
// No-store for API responses
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

// ─── Block backup/old files from being served ───
app.use((req, res, next) => {
  if (/\.pre_.*backup/.test(req.path)) {
    return res.status(404).end();
  }
  next();
});

// ─── CSRF Protection (custom header check) ───
// Blocks cross-origin POST/PUT/DELETE/PATCH that lack the header
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    // sendBeacon endpoints can't set custom headers — validate Origin instead [S3B1-T2]
    if (req.path === '/api/client-error' || req.path === '/api/sync/state' || req.path === '/api/sync/user-context') {
      var origin = req.headers['origin'] || '';
      var allowed = config.allowedOrigins || ['https://' + (req.headers['host'] || '')];
      // Accept same-origin (Origin matches host) or absent Origin (same-site navigation)
      if (origin && !allowed.some(function (a) { return origin === a; }) && origin !== 'https://' + req.headers['host'] && origin !== 'http://' + req.headers['host']) {
        return res.status(403).json({ error: 'Forbidden — origin mismatch' });
      }
      return next();
    }
    if (req.headers['x-zeus-request'] !== '1') {
      return res.status(403).json({ error: 'Forbidden — missing CSRF header' });
    }
  }
  next();
});

// ─── Health check (unauthenticated — for monitoring) ───
// ─── Global API rate limit (200 req/min per IP — catches abuse on all routes) ───
app.use('/api', globalApiLimit);

app.get('/health', (_req, res) => {
  const mem = process.memoryUsage();
  let dbOk = false;
  try { db.db.prepare('SELECT 1').get(); dbOk = true; } catch (_) { }
  let disk = null;
  try {
    const st = fs.statfsSync(path.join(__dirname, 'data'));
    disk = { totalGB: +(st.bsize * st.blocks / 1073741824).toFixed(1), freeGB: +(st.bsize * st.bfree / 1073741824).toFixed(1), usedPct: +((1 - st.bfree / st.blocks) * 100).toFixed(1) };
  } catch (_) { }
  res.json({
    status: dbOk ? 'ok' : 'degraded',
    uptime: Math.floor(process.uptime()),
    memory: { rss: Math.round(mem.rss / 1048576), heap: Math.round(mem.heapUsed / 1048576) },
    version: require('./server/version').version,
    db: dbOk ? 'ok' : 'error',
    disk,
  });
});

// ─── Auth Routes (public — before session check) ───
app.use('/auth', authRoutes);

// ─── Session Auth (protects everything below) ───
app.use(createSessionAuth(config.jwtSecret || authRoutes.JWT_SECRET)); // [S16] prefer config source

// ─── App Version endpoint ───
const appVersion = require('./server/version');
app.get('/api/version', (_req, res) => {
  res.json(Object.assign({}, appVersion, { migration: MF.getAll() }));
});

// ─── Migration Flags (admin-only control for gradual migration) ───
app.get('/api/migration/flags', (_req, res) => {
  res.json(MF.getAll());
});
app.post('/api/migration/flags', (_req, res) => {
  const ip = _req.ip || _req.connection?.remoteAddress || '';
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  const isAdmin = _req.user && _req.user.role === 'admin';
  if (!isLocal && !isAdmin) return res.status(403).json({ error: 'Admin only' });
  const { key, value } = _req.body;
  try {
    const updated = MF.set(key, value);
    logger.log('INFO', 'MIGRATION', `Flag ${key} = ${value}`, { flags: updated });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Fear & Greed proxy (avoid CORS) ───
// [P2] Server Data health endpoint (admin only)
app.get('/api/sd/health', (_req, res) => {
  if (!_req.user || _req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  res.json({
    enabled: MF.SERVER_MARKET_DATA,
    ready: serverState.isDataReady(),
    snapshot: serverState.getSnapshot(),
  });
});

// [MULTI-SYM] Available symbols endpoint (authenticated)
app.get('/api/sd/symbols', (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  res.json({
    configured: app._sdSymbols || [],
    ready: serverState.getReadySymbols(),
  });
});

// [P3] Server Brain status endpoint (admin only)
app.get('/api/brain/status', (_req, res) => {
  if (!_req.user || _req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  res.json({
    enabled: MF.SERVER_BRAIN,
    dataEnabled: MF.SERVER_MARKET_DATA,
    status: serverBrain.getStatus(),
  });
});
app.get('/api/brain/log', (_req, res) => {
  if (!_req.user || _req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const limit = Math.min(parseInt(_req.query.limit) || 50, 200);
  res.json({
    enabled: MF.SERVER_BRAIN,
    log: serverBrain.getDecisionLog(limit),
  });
});

// [P4] TC Sync — client pushes trading config to server brain
app.post('/api/tc/sync', (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  const body = _req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Invalid body' });
  }
  // Whitelist + clamp each field
  const SCHEMA = {
    confMin: { min: 10, max: 100 },
    sigMin: { min: 1, max: 10 },
    adxMin: { min: 0, max: 80 },
    maxPos: { min: 1, max: 20 },
    cooldownMs: { min: 0, max: 3600000 },
    lev: { min: 1, max: 125 },
    size: { min: 1, max: 100000 },
    slPct: { min: 0.1, max: 20 },
    rr: { min: 0.1, max: 20 },
  };
  const clean = {};
  let count = 0;
  for (const [k, range] of Object.entries(SCHEMA)) {
    if (k in body && typeof body[k] === 'number' && isFinite(body[k])) {
      clean[k] = Math.max(range.min, Math.min(range.max, body[k]));
      count++;
    }
  }
  // DSL mode is a string field — validate separately
  if (body.dslMode && typeof body.dslMode === 'string') {
    const validModes = ['fast', 'tp', 'def', 'atr', 'swing'];
    const m = body.dslMode.toLowerCase();
    if (validModes.includes(m)) { clean.dslMode = m; count++; }
  }
  // [MULTI-SYM] Symbol selection per user
  if (Array.isArray(body.symbols)) {
    clean.symbols = body.symbols;  // validated in serverBrain.updateConfig
    count++;
  } else if (body.symbols === null) {
    clean.symbols = null;  // explicit "all symbols"
    count++;
  }
  if (count === 0) {
    return res.status(400).json({ error: 'No valid TC fields' });
  }
  serverBrain.updateConfig(_req.user.id, clean);
  logger.info('TC', 'Config sync from user', { userId: _req.user.id, fields: Object.keys(clean) });
  db.auditLog(_req.user.id, 'TC_CONFIG_SYNC', { applied: clean }, _req.ip);
  res.json({ ok: true, applied: count, stc: serverBrain.getSTC(_req.user.id) });
});

// [P4] TC read — get current server STC
app.get('/api/tc/current', (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  res.json({ stc: serverBrain.getSTC(_req.user.id) });
});

// [AT] Unified AT endpoints — single source of truth (per-user)
app.get('/api/at/state', (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  res.json(serverAT.getFullState(_req.user.id));
});
app.get('/api/at/positions', (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  res.json({ positions: serverAT.getOpenPositions(_req.user.id) });
});
app.get('/api/at/log', (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  const limit = Math.min(parseInt(_req.query.limit) || 50, 200);
  res.json({ log: serverAT.getLog(_req.user.id, limit), stats: serverAT.getStats(_req.user.id) });
});
app.get('/api/at/balance', (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  res.json(serverAT.getDemoBalance(_req.user.id));
});
app.post('/api/at/mode', async (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  const mode = _req.body.mode;
  // Pre-live checklist — validate before switching to live
  if (mode === 'live') {
    try {
      const checklist = await serverAT.preLiveChecklist(_req.user.id);
      if (!checklist.ok) {
        return res.json({ ok: false, error: 'Pre-live checklist failed', checks: checklist.checks, failedChecks: checklist.failedChecks });
      }
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Pre-live checklist error: ' + err.message });
    }
  }
  const result = serverAT.setMode(_req.user.id, mode);
  if (result.ok && mode === 'live') result.preLiveChecklist = 'PASSED';
  res.json(result);
});
// [AT-TOGGLE-FIX] Dedicated AT ON/OFF endpoint — server-authoritative
app.post('/api/at/toggle', (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  const active = _req.body.active;
  if (typeof active !== 'boolean') return res.status(400).json({ ok: false, error: 'active must be boolean' });
  const result = serverAT.toggleActive(_req.user.id, active);
  if (!result.ok) return res.json(result);
  res.json({ ok: true, atActive: result.atActive, state: serverAT.getFullState(_req.user.id) });
});
app.post('/api/at/reset', (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  serverAT.reset(_req.user.id);
  res.json({ ok: true, state: serverAT.getFullState(_req.user.id) });
});
app.post('/api/at/kill', (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  res.json(serverAT.activateKillSwitch(_req.user.id));
});
// Kill switch reset (per-user, any authenticated user)
app.post('/api/at/kill/reset', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Auth required' });
  const balRef = parseFloat(req.body?.balanceRef);
  if (Number.isFinite(balRef) && balRef > 0) serverAT.setLiveBalanceRef(req.user.id, balRef);
  res.json(serverAT.resetKill(req.user.id));
});
// Kill switch threshold update (per-user)
app.post('/api/at/kill/pct', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Auth required' });
  const pct = parseFloat(req.body?.pct);
  if (!Number.isFinite(pct) || pct < 1 || pct > 50) return res.status(400).json({ error: 'Invalid pct (1-50)' });
  const balRef = parseFloat(req.body?.balanceRef);
  if (Number.isFinite(balRef) && balRef > 0) serverAT.setLiveBalanceRef(req.user.id, balRef);
  res.json(serverAT.setKillPct(req.user.id, pct));
});
// [BUG1 FIX] Client-initiated position close — tells server to remove position
app.post('/api/at/close', atCriticalLimit, (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Auth required' });
  const seq = parseInt(req.body.seq, 10);
  if (!Number.isFinite(seq)) return res.status(400).json({ error: 'Invalid seq' });
  res.json(serverAT.closeBySeq(req.user.id, seq));
});
// [BUG3 FIX] Client-initiated controlMode update (Take Control / Release)
app.post('/api/at/control', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Auth required' });
  const seq = parseInt(req.body.seq, 10);
  const controlMode = String(req.body.controlMode || '').toLowerCase();
  if (!Number.isFinite(seq)) return res.status(400).json({ error: 'Invalid seq' });
  const dslParams = (req.body.dslParams && typeof req.body.dslParams === 'object') ? req.body.dslParams : null;
  res.json(serverAT.updateControlMode(req.user.id, seq, controlMode, dslParams));
});
// Client-initiated DSL param update (during Take Control)
// Register manual position (demo or live) on server for DSL param persistence
app.post('/api/at/register-manual', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Auth required' });
  const d = req.body;
  if (!d || !d.symbol || !d.side || !d.entryPrice) return res.status(400).json({ error: 'Missing fields' });
  const result = serverAT.registerManualPosition(req.user.id, {
    symbol: d.symbol,
    side: d.side,
    entryPrice: parseFloat(d.entryPrice) || 0,
    qty: parseFloat(d.qty) || 0,
    leverage: parseInt(d.leverage, 10) || 1,
    sl: d.sl ? parseFloat(d.sl) : null,
    tp: d.tp ? parseFloat(d.tp) : null,
    mode: d.mode || 'demo',
    dslParams: d.dslParams || null,
  });
  res.json(result);
});
app.post('/api/at/dslparams', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Auth required' });
  const seq = parseInt(req.body.seq, 10);
  if (!Number.isFinite(seq)) return res.status(400).json({ error: 'Invalid seq' });
  const dslParams = req.body.dslParams;
  if (!dslParams || typeof dslParams !== 'object') return res.status(400).json({ error: 'Invalid dslParams' });
  res.json(serverAT.updateDslParams(req.user.id, seq, dslParams));
});
app.post('/api/at/demo/add-funds', (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  const result = serverAT.addDemoFunds(_req.user.id, _req.body.amount);
  res.json(result);
});
app.post('/api/at/demo/reset-balance', (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  const result = serverAT.resetDemoBalance(_req.user.id);
  res.json(result);
});

// Legacy endpoints /api/at/shadow, /api/at/live, /api/at/live/positions removed — use /api/at/state

// [P7] Shadow Validation Dashboard — comprehensive overview for VPS monitoring
app.get('/api/dashboard', (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  const mem = process.memoryUsage();
  const brainStatus = serverBrain.getStatus ? serverBrain.getStatus() : null;
  res.json({
    uptime: Math.floor(process.uptime()),
    memory: { rss: Math.round(mem.rss / 1048576), heap: Math.round(mem.heapUsed / 1048576) },
    flags: MF.getAll(),
    feed: {
      enabled: MF.SERVER_MARKET_DATA,
      ready: serverState.isDataReady(),
    },
    brain: brainStatus,
    at: serverAT.getFullState(_req.user.id),
    recentLog: serverAT.getLog(_req.user.id, 10),
  });
});

// ─── Unified Health — all modules in one call ───
app.get('/api/health/full', (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  const modules = {};

  // DB
  try { db.db.prepare('SELECT 1').get(); modules.database = { status: 'OK' }; }
  catch (e) { modules.database = { status: 'ERROR', detail: e.message }; }

  // Market Feed
  try {
    const feed = marketFeed.getHealth();
    const allConnected = Object.values(feed.streams || {}).every(s => s.connected);
    const anyAlive = Object.values(feed.streams || {}).some(s => s.alive);
    modules.marketFeed = {
      status: allConnected && anyAlive ? 'OK' : (anyAlive ? 'WARNING' : 'ERROR'),
      symbols: feed.symbols,
      streamCount: feed.streamCount,
      streams: feed.streams,
    };
  } catch (_) { modules.marketFeed = { status: 'ERROR', detail: 'unavailable' }; }

  // Brain
  try {
    const brain = serverBrain.getStatus();
    modules.brain = {
      status: brain.running ? 'OK' : 'WARNING',
      running: brain.running,
      cycleCount: brain.cycleCount,
      lastDecision: brain.lastDecision ? brain.lastDecision.ts : null,
    };
  } catch (_) { modules.brain = { status: 'ERROR', detail: 'unavailable' }; }

  // AT Engine (per-user)
  try {
    const atState = serverAT.getFullState(_req.user.id);
    modules.atEngine = {
      status: 'OK',
      mode: atState.mode,
      atActive: atState.atActive,
      killActive: atState.killActive,
      openPositions: atState.openPositions ? atState.openPositions.length : 0,
    };
  } catch (_) { modules.atEngine = { status: 'ERROR', detail: 'unavailable' }; }

  // Data freshness
  try {
    const ready = serverState.isDataReady();
    const snap = serverState.getSnapshot();
    const dataAge = snap && snap.priceTs ? Date.now() - snap.priceTs : null;
    modules.dataFreshness = {
      status: !ready ? 'ERROR' : (dataAge && dataAge > 60000 ? 'WARNING' : 'OK'),
      ready,
      dataAgeMs: dataAge,
      stale: snap ? snap.stale : true,
    };
  } catch (_) { modules.dataFreshness = { status: 'ERROR', detail: 'unavailable' }; }

  // Metrics
  try {
    const m = metrics.getMetrics();
    modules.metrics = {
      status: 'OK',
      uptime: m.uptime,
      memory: m.memory,
      latency: m.latency,
      errors: m.errors,
    };
  } catch (_) { modules.metrics = { status: 'ERROR', detail: 'unavailable' }; }

  // Overall
  const statuses = Object.values(modules).map(m => m.status);
  const overall = statuses.includes('ERROR') ? 'ERROR' : (statuses.includes('WARNING') ? 'WARNING' : 'OK');

  res.json({ status: overall, ts: new Date().toISOString(), modules });
});

// ─── Strategy Comparison ───
app.get('/api/compare', (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  try {
    const userId = _req.user.id;
    const rows = db.journalGetClosed(userId, 500, 0);
    const allTrades = rows.map(r => { try { return JSON.parse(r.data); } catch (_) { return null; } }).filter(Boolean);

    function _calcSet(trades) {
      if (trades.length === 0) return { trades: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0, avgPnl: 0, avgHoldMin: 0, maxDD: 0, bestTrade: 0, worstTrade: 0, avgCaptured: null };
      const wins = trades.filter(t => (t.closePnl||0) > 0).length;
      const losses = trades.filter(t => (t.closePnl||0) < 0).length;
      const totalPnl = trades.reduce((s, t) => s + (t.closePnl||0), 0);
      const avgHoldMs = trades.reduce((s, t) => s + ((t.closeTs||0) - (t.ts||0)), 0) / trades.length;
      let cum = 0, peak = 0, maxDD = 0;
      trades.sort((a,b) => (a.closeTs||0) - (b.closeTs||0));
      trades.forEach(t => { cum += (t.closePnl||0); if(cum>peak)peak=cum; if(peak-cum>maxDD)maxDD=peak-cum; });
      const qT = trades.filter(t => t.quality);
      const avgCap = qT.length > 0 ? +(qT.reduce((s,t) => s + (t.quality.capturedPct||0), 0) / qT.length).toFixed(1) : null;
      return {
        trades: trades.length, wins, losses,
        winRate: +(wins / trades.length * 100).toFixed(1),
        totalPnl: +totalPnl.toFixed(2),
        avgPnl: +(totalPnl / trades.length).toFixed(2),
        avgHoldMin: Math.round(avgHoldMs / 60000),
        maxDD: +maxDD.toFixed(2),
        bestTrade: +Math.max(...trades.map(t => t.closePnl||0)).toFixed(2),
        worstTrade: +Math.min(...trades.map(t => t.closePnl||0)).toFixed(2),
        avgCaptured: avgCap,
      };
    }

    // Demo vs Live
    const demo = _calcSet(allTrades.filter(t => t.mode !== 'live'));
    const live = _calcSet(allTrades.filter(t => t.mode === 'live'));

    // Per regime
    const regimes = {};
    allTrades.forEach(t => {
      const r = t.regime || t.closeRegime || 'UNKNOWN';
      if (!regimes[r]) regimes[r] = [];
      regimes[r].push(t);
    });
    const byRegime = {};
    for (const r in regimes) byRegime[r] = _calcSet(regimes[r]);

    // Per symbol
    const syms = {};
    allTrades.forEach(t => {
      const s = t.symbol || '?';
      if (!syms[s]) syms[s] = [];
      syms[s].push(t);
    });
    const bySymbol = {};
    for (const s in syms) bySymbol[s] = _calcSet(syms[s]);

    // This month vs last month
    const now = new Date();
    const thisMonth = now.toISOString().slice(0, 7);
    const lastDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonth = lastDate.toISOString().slice(0, 7);
    const thisMonthTrades = allTrades.filter(t => t.closeTs && new Date(t.closeTs).toISOString().slice(0, 7) === thisMonth);
    const lastMonthTrades = allTrades.filter(t => t.closeTs && new Date(t.closeTs).toISOString().slice(0, 7) === lastMonth);

    res.json({
      ok: true,
      demoVsLive: { demo, live },
      thisVsLast: { thisMonth: _calcSet(thisMonthTrades), lastMonth: _calcSet(lastMonthTrades), thisLabel: thisMonth, lastLabel: lastMonth },
      byRegime, bySymbol,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Performance Dashboard Pro ───
app.get('/api/performance', (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  try {
    const userId = _req.user.id;
    const mode = _req.query.mode; // optional: demo|live
    const rows = db.journalGetClosed(userId, 500, 0);
    let trades = rows.map(r => { try { return JSON.parse(r.data); } catch (_) { return null; } }).filter(Boolean);
    if (mode) trades = trades.filter(t => t.mode === mode);

    if (trades.length === 0) return res.json({ ok: true, empty: true });

    // Sort by close time asc for equity curve
    trades.sort((a, b) => (a.closeTs || 0) - (b.closeTs || 0));

    // Equity curve (cumulative PnL)
    let cumPnl = 0; let peak = 0; let maxDrawdown = 0;
    const equity = trades.map(t => {
      cumPnl = +(cumPnl + (t.closePnl || 0)).toFixed(2);
      if (cumPnl > peak) peak = cumPnl;
      const dd = peak - cumPnl;
      if (dd > maxDrawdown) maxDrawdown = dd;
      return { ts: t.closeTs, pnl: cumPnl, dd };
    });

    // Win rate per symbol
    const bySymbol = {};
    trades.forEach(t => {
      const s = t.symbol || '?';
      if (!bySymbol[s]) bySymbol[s] = { wins: 0, losses: 0, pnl: 0, count: 0 };
      bySymbol[s].count++;
      bySymbol[s].pnl = +(bySymbol[s].pnl + (t.closePnl || 0)).toFixed(2);
      if ((t.closePnl || 0) > 0) bySymbol[s].wins++; else bySymbol[s].losses++;
    });
    for (const s in bySymbol) bySymbol[s].winRate = bySymbol[s].count > 0 ? +(bySymbol[s].wins / bySymbol[s].count * 100).toFixed(1) : 0;

    // Win rate per regime
    const byRegime = {};
    trades.forEach(t => {
      const r = t.regime || t.closeRegime || 'UNKNOWN';
      if (!byRegime[r]) byRegime[r] = { wins: 0, losses: 0, pnl: 0, count: 0 };
      byRegime[r].count++;
      byRegime[r].pnl = +(byRegime[r].pnl + (t.closePnl || 0)).toFixed(2);
      if ((t.closePnl || 0) > 0) byRegime[r].wins++; else byRegime[r].losses++;
    });
    for (const r in byRegime) byRegime[r].winRate = byRegime[r].count > 0 ? +(byRegime[r].wins / byRegime[r].count * 100).toFixed(1) : 0;

    // P&L calendar (per day)
    const calendar = {};
    trades.forEach(t => {
      if (!t.closeTs) return;
      const day = new Date(t.closeTs).toISOString().slice(0, 10);
      if (!calendar[day]) calendar[day] = { pnl: 0, count: 0 };
      calendar[day].pnl = +(calendar[day].pnl + (t.closePnl || 0)).toFixed(2);
      calendar[day].count++;
    });

    // PnL distribution (buckets)
    const buckets = { '<-50': 0, '-50/-20': 0, '-20/-5': 0, '-5/0': 0, '0/5': 0, '5/20': 0, '20/50': 0, '>50': 0 };
    trades.forEach(t => {
      const p = t.closePnl || 0;
      if (p < -50) buckets['<-50']++; else if (p < -20) buckets['-50/-20']++; else if (p < -5) buckets['-20/-5']++;
      else if (p < 0) buckets['-5/0']++; else if (p < 5) buckets['0/5']++; else if (p < 20) buckets['5/20']++;
      else if (p < 50) buckets['20/50']++; else buckets['>50']++;
    });

    // Streaks
    let curWin = 0, curLoss = 0, bestWin = 0, worstLoss = 0;
    trades.forEach(t => {
      if ((t.closePnl || 0) > 0) { curWin++; curLoss = 0; if (curWin > bestWin) bestWin = curWin; }
      else { curLoss++; curWin = 0; if (curLoss > worstLoss) worstLoss = curLoss; }
    });

    // Quality averages
    const qTrades = trades.filter(t => t.quality);
    const avgCaptured = qTrades.length > 0 ? +(qTrades.reduce((s, t) => s + (t.quality.capturedPct || 0), 0) / qTrades.length).toFixed(1) : null;
    const avgMAE = qTrades.length > 0 ? +(qTrades.reduce((s, t) => s + Math.abs(t.quality.mae || 0), 0) / qTrades.length).toFixed(2) : null;

    res.json({
      ok: true,
      totalTrades: trades.length,
      totalPnl: +cumPnl.toFixed(2),
      maxDrawdown: +maxDrawdown.toFixed(2),
      bestWinStreak: bestWin,
      worstLossStreak: worstLoss,
      avgCapturedPct: avgCaptured,
      avgMAE: avgMAE,
      equity: equity.map(e => ({ ts: e.ts, pnl: e.pnl })),
      bySymbol, byRegime, calendar, buckets,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Session Review ───
app.get('/api/session-review', (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  try {
    const userId = _req.user.id;
    // Get today's closed trades
    const rows = db.journalGetClosed(userId, 500, 0);
    const today = new Date().toISOString().slice(0, 10);
    const allTrades = rows.map(r => { try { return JSON.parse(r.data); } catch (_) { return null; } }).filter(Boolean);
    const todayTrades = allTrades.filter(t => {
      if (!t.closeTs) return false;
      return new Date(t.closeTs).toISOString().slice(0, 10) === today;
    });

    const wins = todayTrades.filter(t => (t.closePnl || 0) > 0);
    const losses = todayTrades.filter(t => (t.closePnl || 0) < 0);
    const totalPnl = todayTrades.reduce((s, t) => s + (t.closePnl || 0), 0);
    const avgHoldMs = todayTrades.length > 0 ? todayTrades.reduce((s, t) => s + ((t.closeTs || 0) - (t.ts || 0)), 0) / todayTrades.length : 0;

    // Best & worst trade
    let bestTrade = null, worstTrade = null;
    for (const t of todayTrades) {
      if (!bestTrade || (t.closePnl || 0) > (bestTrade.closePnl || 0)) bestTrade = t;
      if (!worstTrade || (t.closePnl || 0) < (worstTrade.closePnl || 0)) worstTrade = t;
    }

    // Regime distribution
    const regimes = {};
    todayTrades.forEach(t => {
      const r = t.regime || t.closeRegime || 'UNKNOWN';
      if (!regimes[r]) regimes[r] = { count: 0, pnl: 0 };
      regimes[r].count++;
      regimes[r].pnl = +(regimes[r].pnl + (t.closePnl || 0)).toFixed(2);
    });

    // Symbol distribution
    const symbols = {};
    todayTrades.forEach(t => {
      const s = t.symbol || '?';
      if (!symbols[s]) symbols[s] = { count: 0, pnl: 0 };
      symbols[s].count++;
      symbols[s].pnl = +(symbols[s].pnl + (t.closePnl || 0)).toFixed(2);
    });

    // Exit reasons
    const exitReasons = {};
    todayTrades.forEach(t => {
      const r = t.closeReason || '?';
      exitReasons[r] = (exitReasons[r] || 0) + 1;
    });

    // Quality averages (if available)
    const qualityTrades = todayTrades.filter(t => t.quality);
    const avgCaptured = qualityTrades.length > 0 ? +(qualityTrades.reduce((s, t) => s + (t.quality.capturedPct || 0), 0) / qualityTrades.length).toFixed(1) : null;
    const avgMAE = qualityTrades.length > 0 ? +(qualityTrades.reduce((s, t) => s + (t.quality.mae || 0), 0) / qualityTrades.length).toFixed(2) : null;

    // Missed trades today
    const missed = db.getMissedTrades(userId, 200);
    const missedToday = missed.filter(m => m.created_at && m.created_at.slice(0, 10) === today);

    // AT state
    const state = serverAT.getFullState(userId);

    res.json({
      ok: true, date: today,
      summary: {
        totalTrades: todayTrades.length,
        wins: wins.length, losses: losses.length,
        winRate: todayTrades.length > 0 ? +(wins.length / todayTrades.length * 100).toFixed(1) : 0,
        totalPnl: +totalPnl.toFixed(2),
        avgPnl: todayTrades.length > 0 ? +(totalPnl / todayTrades.length).toFixed(2) : 0,
        avgHoldMin: Math.round(avgHoldMs / 60000),
        bestTrade: bestTrade ? { symbol: bestTrade.symbol, side: bestTrade.side, pnl: bestTrade.closePnl } : null,
        worstTrade: worstTrade ? { symbol: worstTrade.symbol, side: worstTrade.side, pnl: worstTrade.closePnl } : null,
        avgCapturedPct: avgCaptured,
        avgMAE: avgMAE,
      },
      regimes, symbols, exitReasons,
      missedCount: missedToday.length,
      mode: state.mode,
      killActive: !!state.killActive,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Regime History ───
app.get('/api/regime-history', (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  try {
    const symbol = _req.query.symbol;
    const limit = Math.min(parseInt(_req.query.limit, 10) || 100, 500);
    const history = symbol ? db.getRegimeHistory(symbol, limit) : db.getRegimeHistoryAll(limit);
    res.json({ ok: true, history });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Missed Trades ───
app.get('/api/missed-trades', (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  try {
    const limit = Math.min(parseInt(_req.query.limit, 10) || 50, 200);
    const trades = db.getMissedTrades(_req.user.id, limit);
    res.json({ ok: true, trades });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Exposure Dashboard — risk overview ───
app.get('/api/exposure', (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  try {
    const userId = _req.user.id;
    const state = serverAT.getFullState(userId);
    const allPos = state.openPositions || [];
    const demoPos = allPos.filter(p => p.mode !== 'live');
    const livePos = allPos.filter(p => p.mode === 'live');

    const bySymbol = {};
    for (const p of allPos) {
      if (!bySymbol[p.symbol]) bySymbol[p.symbol] = { symbol: p.symbol, totalMargin: 0, totalSize: 0, count: 0, sides: [] };
      bySymbol[p.symbol].totalMargin += (p.margin || 0);
      bySymbol[p.symbol].totalSize += (p.size || 0);
      bySymbol[p.symbol].count++;
      bySymbol[p.symbol].sides.push(p.side);
    }

    const totalMargin = allPos.reduce((s, p) => s + (p.margin || 0), 0);
    const symbolMargins = Object.values(bySymbol).map(s => s.totalMargin);
    const maxConcentration = totalMargin > 0 ? Math.max(...symbolMargins) / totalMargin * 100 : 0;
    const balance = state.mode === 'live' ? (state.liveBalance || 0) : (state.demoBalance ? state.demoBalance.balance : 0);
    const marginUsagePct = balance > 0 ? totalMargin / balance * 100 : 0;

    let unrealizedPnl = 0;
    for (const p of allPos) {
      if (p._lastPrice && p.price) {
        const dir = p.side === 'LONG' ? 1 : -1;
        unrealizedPnl += dir * (p._lastPrice - p.price) / p.price * (p.size || 0) * (p.lev || 1);
      }
    }

    res.json({
      ok: true, mode: state.mode,
      balance: +balance.toFixed(2), totalMargin: +totalMargin.toFixed(2),
      marginUsagePct: +marginUsagePct.toFixed(1), unrealizedPnl: +unrealizedPnl.toFixed(2),
      positionCount: { total: allPos.length, demo: demoPos.length, live: livePos.length },
      bySymbol: Object.values(bySymbol).map(s => ({
        symbol: s.symbol, margin: +s.totalMargin.toFixed(2), count: s.count,
        concentrationPct: totalMargin > 0 ? +(s.totalMargin / totalMargin * 100).toFixed(1) : 0,
        sides: [...new Set(s.sides)],
      })),
      maxConcentrationPct: +maxConcentration.toFixed(1),
      killActive: !!state.killActive,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/fng', async (_req, res) => {
  try {
    const r = await fetch('https://api.alternative.me/fng/?limit=2');
    if (!r.ok) throw new Error(r.statusText);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'FNG upstream error' });
  }
});

// ─── Sync Routes (BEFORE trading — trading's resolveExchange would block these) ───
const syncRoutes = require('./server/routes/sync');
app.use('/api/sync', syncRoutes);

// ─── Per-User Context Sync (cross-device preferences) ───
const userContextRoutes = require('./server/routes/userContext');
app.use('/api/sync', userContextRoutes);

// ─── Journal Route ───
const journalRoutes = require('./server/routes/journal');
app.use('/api/journal', journalRoutes);

// ─── API Routes (trading + exchange) ───
app.use('/api', tradingRoutes);
app.use('/api/exchange', exchangeRoutes);

// ─── [C7] Client Error Forwarding (+ Sentry) ───
app.post('/api/client-error', (req, res) => {
  try {
    const { msg, src, line, col, stack, ua } = req.body || {};
    const userId = req.user ? req.user.id : 'anon';
    logger.error('[CLIENT]', { userId, msg: String(msg || '').slice(0, 500), src: String(src || '').slice(0, 200), line, col, stack: String(stack || '').slice(0, 1000), ua: String(ua || '').slice(0, 200) });
    // Forward to Sentry with user context
    Sentry.withScope(scope => {
      scope.setUser({ id: String(userId) });
      scope.setTag('source', 'client');
      scope.setExtra('file', String(src || '').slice(0, 200));
      scope.setExtra('line', line);
      scope.setExtra('col', col);
      scope.setExtra('ua', String(ua || '').slice(0, 200));
      Sentry.captureException(new Error(`[CLIENT] ${String(msg || 'Unknown error').slice(0, 500)}`));
    });
  } catch (_) { }
  res.json({ ok: true });
});

// ─── Serve sw.js dynamically with version-stamped cache ───
app.get('/sw.js', (_req, res) => {
  const ver = require('./server/version');
  const swPath = path.join(__dirname, 'public', 'sw.js');
  let content = fs.readFileSync(swPath, 'utf8');
  content = content.replace(
    /const CACHE_VERSION = '[^']*'/,
    `const CACHE_VERSION = 'zt-v${ver.version}-b${ver.build}'`
  );
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.send(content);
});

// ─── Static Files ───
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.css') || filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// ─── Legacy old app at /legacy/ (backup — can be removed later) ───
app.get('/legacy', (req, res) => res.redirect('/legacy/'));
app.get('/legacy/{*rest}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'legacy', 'index.html'), (err) => {
    if (err) res.status(500).send('Server error');
  });
});

// ─── React app at /app/ (kept for backwards compat) ───
app.get('/app', (req, res) => res.redirect('/app/'));
app.get('/app/{*rest}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app', 'index.html'), (err) => {
    if (err) res.status(500).send('Server error');
  });
});

// ─── Fallback: React app is now the main app ───
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app', 'index.html'), (err) => {
    if (err) res.status(500).send('Server error');
  });
});

// ─── [SENTRY] Error handler — must be before our custom error handler ───
Sentry.setupExpressErrorHandler(app);

// ─── Global error handler ───
app.use((err, req, res, _next) => {
  logger.error('SERVER', 'Unhandled route error: ' + err.message, { path: req.originalUrl, method: req.method });
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Bind to 0.0.0.0 for LAN access (phone over Wi-Fi) ───
const server = app.listen(PORT, '0.0.0.0', () => {
  // Request timeout — prevent hung connections
  server.setTimeout(30000);
  // Migrate users from JSON to SQLite (if needed)
  try {
    const result = db.migrateFromJson();
    if (result.migrated > 0) console.log(`[DB] Migrated ${result.migrated} users from users.json → SQLite`);
  } catch (err) {
    console.error('[DB] Migration error:', err.message);
  }

  // Load exchange filters at startup (non-blocking)
  refreshExchangeInfo();
  const os = require('os');
  const nets = os.networkInterfaces();
  let lanIp = 'localhost';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        lanIp = net.address;
        break;
      }
    }
  }
  console.log(`⚡ Zeus Terminal running on:`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Network: http://${lanIp}:${PORT}`);
  console.log(`   Trading: ${config.tradingEnabled ? '✅ ENABLED' : '🔒 DISABLED'}`);
  if (config.tradingEnabled) {
    console.log(`   Endpoint: ${config.binance.baseUrl}`);
  }
  logger.info('SERVER', 'Zeus Terminal started on port ' + PORT);
  logger.info('MIGRATION', 'Feature flags: ' + JSON.stringify(MF.getAll()));
  telegram.alertServerStart();
  telegramBot.start();
  // Position reconciliation handled internally by serverAT._runReconciliation (60s + startup)
  // [C5] DB backup: already self-starting in database.js (30s delay + hourly, keep 7)

  // [P2] Start server-side market data feed if flag enabled
  if (MF.SERVER_MARKET_DATA) {
    const SD_SYMBOLS = (process.env.SD_SYMBOLS || process.env.SD_SYMBOL || 'BTCUSDT')
        .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const SD_TFS = (process.env.SD_TIMEFRAMES || '5m,1h,4h').split(',');
    serverState.init(SD_SYMBOLS, SD_TFS);
    marketFeed.subscribeMulti(SD_SYMBOLS, SD_TFS).then(() => {
      logger.info('SERVER', `[P2] Market feed active for [${SD_SYMBOLS.join(',')}] [${SD_TFS}]`);
    }).catch(err => {
      logger.error('SERVER', '[P2] Market feed failed:', err.message);
    });
    // [MULTI-SYM] Expose configured symbols for API
    app._sdSymbols = SD_SYMBOLS;
  } else {
    logger.info('SERVER', '[P2] Market feed DISABLED (MF.SERVER_MARKET_DATA=false)');
    app._sdSymbols = [];
  }

  // [P3] Start server brain cycle if flag enabled (requires market data)
  if (MF.SERVER_BRAIN) {
    if (!MF.SERVER_MARKET_DATA) {
      logger.error('SERVER', '[P3] SERVER_BRAIN requires SERVER_MARKET_DATA — brain NOT started');
    } else {
      // Wait for data to populate before starting brain
      setTimeout(() => {
        serverBrain.start();
        logger.info('SERVER', '[P3] Server brain active (observation mode)');
      }, 15000);  // 15s delay for initial candle load
    }
  } else {
    logger.info('SERVER', '[P3] Server brain DISABLED (MF.SERVER_BRAIN=false)');
  }

  // [P6] Log live AT status
  if (MF.SERVER_AT) {
    if (!MF.SERVER_BRAIN) {
      logger.error('SERVER', '[P6] SERVER_AT requires SERVER_BRAIN — live AT NOT active');
    } else {
      logger.info('SERVER', '[P6] Server AT LIVE EXECUTION enabled — orders will be placed!');
      telegram.sendToAll('🔴 `SERVER_AT` LIVE MODE ACTIVATED — server will place real orders');
    }
  } else {
    logger.info('SERVER', '[P6] Server AT live execution DISABLED (shadow-only)');
  }
});

// ─── WebSocket Sync (real-time cross-device push) ───
const wss = new WebSocket.Server({ noServer: true, maxPayload: 64 * 1024 });
const _wsClients = new Map(); // userId -> Set<ws>

// Handle upgrade manually — prevents "Invalid Upgrade header" crash from Cloudflare/proxies
server.on('upgrade', (req, socket, head) => {
  // Only accept /ws/sync path
  if (req.url !== '/ws/sync') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws, req) => {
  // Early error handler to prevent zombie sockets
  ws.on('error', () => { try { ws.terminate(); } catch (_) { } });

  // Auth: parse zeus_token cookie from upgrade request
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) cookies[k] = v.join('=');
  });
  const token = cookies.zeus_token;
  if (!token) { ws.close(4001, 'unauthorized'); return; }
  let user;
  try {
    const jwt = require('jsonwebtoken');
    user = jwt.verify(token, config.jwtSecret || authRoutes.JWT_SECRET, { algorithms: ['HS256'] });
    if (!user || !user.id) { ws.close(4001, 'unauthorized'); return; }
    // Verify token_version (session invalidation on password change)
    if (user.tokenVersion != null) {
      const fresh = db.findUserById(user.id);
      if (!fresh || fresh.status !== 'active' || (fresh.token_version != null && user.tokenVersion !== fresh.token_version)) {
        ws.close(4001, 'session expired'); return;
      }
    }
  } catch (_) { ws.close(4001, 'unauthorized'); return; }

  const uid = user.id;
  if (!_wsClients.has(uid)) _wsClients.set(uid, new Set());
  const userSet = _wsClients.get(uid);
  const MAX_WS_PER_USER = 5;
  if (userSet.size >= MAX_WS_PER_USER) {
    ws.close(4002, 'too many connections');
    logger.warn('WS', 'Connection limit reached uid=' + uid + ' max=' + MAX_WS_PER_USER);
    return;
  }
  userSet.add(ws);
  logger.info('WS', 'Client connected uid=' + uid + ' total=' + userSet.size);

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('close', () => {
    const set = _wsClients.get(uid);
    if (set) { set.delete(ws); if (set.size === 0) _wsClients.delete(uid); }
  });
  ws.on('error', () => { try { ws.close(); } catch (_) { } });
});

// Heartbeat — drop dead connections every 30s
const _wsPing = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// ── AT change → push to affected user's connected clients ──
serverAT.onChange((userId, state) => {
  const msg = JSON.stringify({ type: 'at_update', data: state });
  const set = _wsClients.get(userId);
  if (set) {
    set.forEach(ws => {
      try { if (ws.readyState === WebSocket.OPEN) ws.send(msg); } catch (_) {}
    });
  }
});

// Broadcast to all other devices of same user
app.locals.wsBroadcast = function (userId, senderWs) {
  const set = _wsClients.get(userId);
  if (!set || set.size === 0) return;
  const msg = JSON.stringify({ type: 'sync' });
  set.forEach(ws => {
    if (ws !== senderWs && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  });
};

// ─── Graceful Shutdown ───
function _gracefulShutdown(signal) {
  logger.warn('SERVER', 'Shutdown signal received: ' + signal);
  console.log('\n🛑 Shutting down gracefully (' + signal + ')...');
  telegramBot.stop();
  clearInterval(_wsPing);
  wss.clients.forEach(ws => ws.terminate());
  telegram.alertServerStop(signal).finally(() => {
    server.close(() => {
      logger.info('SERVER', 'HTTP server closed');
      db.closeDb();
      process.exit(0);
    });
    // Force kill after 5s if server won't close
    setTimeout(() => { process.exit(1); }, 5000);
  });
}

process.on('SIGTERM', () => _gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => _gracefulShutdown('SIGINT'));

// ─── Crash Safety Net ───
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err.message, err.stack);
  logger.error('FATAL', 'uncaughtException: ' + err.message);
  telegram.sendToAll('🔴 *ZEUS CRASH* — uncaughtException: ' + err.message).finally(() => {
    process.exit(1);
  });
  setTimeout(() => process.exit(1), 3000); // force exit if telegram hangs
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error('[WARN] Unhandled promise rejection:', msg);
  logger.warn('PROMISE', 'unhandledRejection: ' + msg);
});

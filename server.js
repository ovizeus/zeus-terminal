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
// [Bybit Phase 1A Task 43] Boot-time position reconciliation (scan exchange → reconcile DB → verify SL → lift halt)
const recoveryBoot = require('./server/services/recoveryBoot');
const timeSyncAssert = require('./server/services/timeSyncAssert');
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
      connectSrc: ["'self'", "wss://fstream.binance.com", "wss://stream.bybit.com", "wss://ws.okx.com:8443", "https://fapi.binance.com", "https://api.binance.com", "https://testnet.binancefuture.com", "https://api.alternative.me", "https://*.ingest.de.sentry.io", "https://api.bybit.com", "https://www.okx.com", "https://api.coingecko.com"],
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
    // [batch2-M2] Reject absent Origin too. Modern browsers always set Origin on POST
    // (fetch/sendBeacon/form); absent-Origin POSTs only come from non-browser or
    // pre-2017 clients with no cookies, so they can't carry a valid session anyway.
    if (req.path === '/api/client-error' || req.path === '/api/sync/state' || req.path === '/api/sync/user-context') {
      var origin = req.headers['origin'] || '';
      var host = req.headers['host'] || '';
      var allowed = config.allowedOrigins || ['https://' + host];
      if (!origin) {
        return res.status(403).json({ error: 'Forbidden — origin required' });
      }
      if (!allowed.some(function (a) { return origin === a; }) && origin !== 'https://' + host && origin !== 'http://' + host) {
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

// [GATEWAY] Market data proxy — public, no auth required. Must be before auth middleware.
app.use('/api/market', require('./server/routes/marketProxy'));

// [FA-P0-1 2026-05-28] These two health endpoints are mounted BEFORE
// sessionAuth and previously had NO guard — fully public, leaking internal
// WS topology (tracked symbols, connection state, reconnect counts). Restrict
// to localhost: operator/monitoring runs on the same VPS; remote callers get
// 403. The general /health (below) stays public for external uptime monitors.
function _isLocalReq(req) {
  const ip = req.ip || (req.connection && req.connection.remoteAddress) || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

app.get('/api/ws/health', (req, res) => {
  if (!_isLocalReq(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const wsProxy = require('./server/services/wsMarketProxy');
    res.json(wsProxy.getHealthSnapshot());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/userdatastream/health', (req, res) => {
  if (!_isLocalReq(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const uds = require('./server/services/userDataStream');
    res.json({ ok: true, ...uds.getHealthStatus() });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

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

// [SRV-POS] Shadow report — pre-auth (diagnostic endpoint, localhost-safe)
app.use('/api/srv-pos', require('./server/routes/srvPos'));

// ─── Session Auth (protects everything below) ───
app.use(createSessionAuth(config.jwtSecret || authRoutes.JWT_SECRET)); // [S16] prefer config source

// ─── App Version endpoint ───
// ─── [OPS-6] Prometheus /metrics endpoint ───────────────────────────
// Text exposition format (Prometheus 0.0.4). No npm dep — formats the
// existing metrics service output into Prom-compatible labels. Localhost-
// only (req.ip === '127.0.0.1' OR loopback) — Prometheus scraper runs
// on same VPS în current setup; remote scraping requires explicit IP
// allowlist via PROMETHEUS_ALLOW_IPS env (comma-separated). Existing
// JSON metrics at /api/health/full remain unchanged for human dashboards.
const _PROM_ALLOW_IPS = (process.env.PROMETHEUS_ALLOW_IPS || '127.0.0.1,::1,::ffff:127.0.0.1')
    .split(',').map(s => s.trim()).filter(Boolean);
function _promEscape(s) {
    return String(s).replace(/[\\\n"]/g, c => c === '\n' ? '\\n' : '\\' + c);
}
app.get('/metrics', (req, res) => {
    const ip = (req.ip || req.connection?.remoteAddress || '').replace(/^::ffff:/, '');
    if (!_PROM_ALLOW_IPS.includes(req.ip) && !_PROM_ALLOW_IPS.includes(ip)) {
        return res.status(403).type('text/plain').send('# Forbidden — IP not în PROMETHEUS_ALLOW_IPS\n');
    }
    try {
        const m = metrics.getMetrics();
        const memMB = parseInt(String(m.memory.rss).replace(/[^\d]/g, ''), 10) || 0;
        const heapMB = parseInt(String(m.memory.heapUsed).replace(/[^\d]/g, ''), 10) || 0;
        const latencyLast = parseInt(String(m.latency.binanceLast).replace(/[^\d]/g, ''), 10) || 0;
        const latencyAvg = parseInt(String(m.latency.binanceAvg).replace(/[^\d]/g, ''), 10) || 0;
        const lines = [
            '# HELP zeus_uptime_seconds Process uptime in seconds',
            '# TYPE zeus_uptime_seconds gauge',
            'zeus_uptime_seconds ' + (m.uptime || 0),
            '# HELP zeus_memory_rss_mb Process RSS memory in MB',
            '# TYPE zeus_memory_rss_mb gauge',
            'zeus_memory_rss_mb ' + memMB,
            '# HELP zeus_memory_heap_used_mb Process heap used in MB',
            '# TYPE zeus_memory_heap_used_mb gauge',
            'zeus_memory_heap_used_mb ' + heapMB,
            '# HELP zeus_orders_total Total orders by status',
            '# TYPE zeus_orders_total counter',
            'zeus_orders_total{status="placed"} ' + (m.orders.placed || 0),
            'zeus_orders_total{status="filled"} ' + (m.orders.filled || 0),
            'zeus_orders_total{status="failed"} ' + (m.orders.failed || 0),
            'zeus_orders_total{status="blocked"} ' + (m.orders.blocked || 0),
            '# HELP zeus_binance_latency_ms Binance API latency în ms',
            '# TYPE zeus_binance_latency_ms gauge',
            'zeus_binance_latency_ms{kind="last"} ' + latencyLast,
            'zeus_binance_latency_ms{kind="avg"} ' + latencyAvg,
            '# HELP zeus_errors_total Total recorded server errors',
            '# TYPE zeus_errors_total counter',
            'zeus_errors_total ' + (m.errors.total || 0),
            '# HELP zeus_reconciliation_runs_total Position reconciliation runs',
            '# TYPE zeus_reconciliation_runs_total counter',
            'zeus_reconciliation_runs_total ' + (m.reconciliation.runs || 0),
            '# HELP zeus_reconciliation_mismatches_total Position reconciliation mismatches detected',
            '# TYPE zeus_reconciliation_mismatches_total counter',
            'zeus_reconciliation_mismatches_total ' + (m.reconciliation.mismatches || 0),
            '# HELP zeus_ws_clients Connected WebSocket clients (current)',
            '# TYPE zeus_ws_clients gauge',
            'zeus_ws_clients ' + (typeof wss !== 'undefined' && wss && wss.clients ? wss.clients.size : 0),
        ];
        res.type('text/plain; version=0.0.4').send(lines.join('\n') + '\n');
    } catch (err) {
        res.status(500).type('text/plain').send('# error: ' + _promEscape(err.message) + '\n');
    }
});

const appVersion = require('./server/version');
app.get('/api/version', (_req, res) => {
  // [SEC-13] Strip verbose `changelog` from response — recon hardening.
  // Authenticated users get version + build + date + migration flag state
  // only. Internal file paths / architecture / deferred-work labels in
  // `version.changelog` stay in the file for git/operator reference,
  // never leave the box (was 30+ KB JSON exposing implementation detail
  // to any authed user).
  const { changelog: _changelog, ...publicVersion } = appVersion;
  res.json(Object.assign({}, publicVersion, { migration: MF.getAll() }));
});

// [ZT-AUD-#15 / C13] Client-side error report sink. Body: {kind, reason, ...}.
// Logs via structured logger so degraded-mode incidents are observable in logs
// even though there is no client Sentry. Throttled to avoid log flood from a
// stuck loop (single user spamming).
const _clientErrorLastTs = new Map();
const _CLIENT_ERR_TTL_MS = 60 * 60 * 1000; // 1h — any user idle this long won't be throttled
app.post('/api/client-error', express.json({ limit: '8kb' }), (req, res) => {
  try {
    const uid = (req.user && req.user.id) || 'anon';
    const now = Date.now();
    const last = _clientErrorLastTs.get(uid) || 0;
    if (now - last < 5000) return res.json({ ok: true, throttled: true });
    _clientErrorLastTs.set(uid, now);
    // [batch2-L2] Opportunistic eviction — drop entries older than TTL when map grows
    if (_clientErrorLastTs.size > 200) {
      for (const [k, ts] of _clientErrorLastTs) if (now - ts >= _CLIENT_ERR_TTL_MS) _clientErrorLastTs.delete(k);
    }
    const body = req.body || {};
    logger.log('WARN', 'CLIENT_ERR', String(body.reason || 'unknown').slice(0, 300), {
      uid,
      kind: body.kind || 'unknown',
      filename: body.filename,
      lineno: body.lineno,
      ts: body.ts,
      ua: req.get('user-agent'),
    });
  } catch (_) { /* swallow — client report must not 500 */ }
  res.json({ ok: true });
});

// [LIQ-FEED DIAG 2026-05-14] Temporary diagnostic endpoint — exposes live
// state of both liq feed modules (filtered Market Radar + unfiltered
// aggregator pentru Quant Monitor). Public read-only; no auth needed for
// diagnostic. Remove post-confirmation.
app.get('/api/diag/liq-feed', (_req, res) => {
  try {
    const mr = require('./server/services/liquidationFeed').getState();
    const ag = require('./server/services/liqFeedAggregator').getState();
    res.json({ marketRadarFeed: mr, aggregator: ag, ts: Date.now() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// [BIN-TELEM 2026-05-19] Binance rate-limit diagnostic. Read-only snapshot
// of per-source call counts, per-host used-weight (X-MBX-USED-WEIGHT-1M),
// top endpoints, active pollers. Local-IP allowlist via sessionAuth.
// Scop: investiga incident 429 din 2026-05-19 07:47 + dovedi/infirma leak
// pe auto-subscribe în marketFeed. Remove după Phase A patch.
app.get('/api/diag/binance-rates', (_req, res) => {
  try {
    const telem = require('./server/services/binanceTelemetry');
    res.json(Object.assign({}, telem.getSnapshot(), { ts: Date.now() }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Migration Flags (admin-only control for gradual migration) ───
app.get('/api/migration/flags', (_req, res) => {
  res.json(MF.getAll());
});
app.post('/api/migration/flags', (_req, res) => {
  // [SEC-12] Removed `isLocal` bypass — anyone with shell access on
  // VPS could POST via localhost (sessionAuth localSafePaths bypass —
  // see SEC-12-β patch in middleware/sessionAuth.js) without admin
  // role, flipping arbitrary migration flags including SERVER_AT /
  // SERVER_BRAIN. Privilege escalation latent pre-S10 LIVE flip.
  // Now strict admin role check + audit_log entry on every change for
  // forensic trail.
  if (!_req.user || _req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { key, value } = _req.body;
  try {
    const updated = MF.set(key, value);
    const userId = _req.user.id || null;
    logger.log('INFO', 'MIGRATION', `Flag ${key} = ${value}`, { flags: updated, byUserId: userId });
    try { db.auditLog(userId, 'MIGRATION_FLAG_CHANGE', { key, value, byUserId: userId, ip: _req.ip }, _req.ip); } catch (_) {}
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
  const _st = serverAT.getFullState(_req.user.id);
  res.json(_st);
});
// [Phase 2 S1.B] Canonical resume endpoint.
// Purpose: a single REST call a client uses after reconnect / refresh / offline
// / server-restart to rebuild per-user state from authoritative server truth.
// Never guesses from localStorage.
//
// Shape (stable contract):
//   {
//     protocol: 1,                       // bump on breaking changes
//     serverTime: <ms>,                  // wall-clock from server; client uses for drift
//     version: { version, build, date }, // so client can detect stale builds
//     userId: <int>,                     // echo — detects session mismatch
//     at: ServerATState                  // identical to /api/at/state / at_update payload
//   }
//
// Source: serverAT.getFullState() ONLY. Same path as /api/at/state and the
// WS at_update broadcast — no new truth source, no schema change. Per-user
// scoped strictly via req.user.id from JWT (sessionAuth middleware);
// userId is never read from body or query, so it cannot be spoofed.
//
// Empty-state behavior: serverAT.getFullState() returns a fully-initialized
// per-user state (empty positions[], default demo balance, no kill, etc.)
// for a first-time-connecting user — no special-case branch needed here.
//
// Post-restart behavior: serverAT rehydrates from SQLite on module load
// (at_positions, at_state), so a reconnect after `pm2 reload` returns the
// same shape as a reconnect against a warm process.
app.get('/api/at/resume', (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  try {
    const at = serverAT.getFullState(_req.user.id);
    res.json({
      protocol: 1,
      serverTime: Date.now(),
      version: { version: appVersion.version, build: appVersion.build, date: appVersion.date },
      userId: _req.user.id,
      at: at,
    });
  } catch (err) {
    logger.error('AT_RESUME', 'Failed for uid=' + _req.user.id + ': ' + err.message);
    res.status(500).json({ error: 'resume_failed' });
  }
});
// [Phase 2 S2.B] Global PANIC halt — admin-only entry kill switch.
// Persisted in at_state(key='global:halt'); read on every brain-driven +
// server-AT live entry path (serverAT.processBrainDecision, _executeLiveEntry).
// Survives restarts because the DB row is durable and serverAT reads on
// every attempt (no stale in-memory cache).
//
// Contract:
//   GET  /api/panic           → { active, by, ts, reason }   (any authed user)
//   POST /api/panic           → body { active:boolean, reason?:string }
//                               admin-only; userId from JWT (never body).
//                               Response: { ok, halted, by, ts, reason }
//
// Safety:
//   • userId source = req.user.id (JWT); never body/query — no spoofing.
//   • Role check = admin; other users get 403.
//   • No scope creep — no per-user opt-in, no global flag flip, no UI toggle.
app.get('/api/panic', (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  try {
    res.json(serverAT.getGlobalHaltState());
  } catch (err) {
    logger.error('PANIC_GET', 'Failed: ' + err.message);
    res.status(500).json({ error: 'halt_read_failed' });
  }
});
app.post('/api/panic', (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  if (_req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const body = _req.body || {};
  if (typeof body.active !== 'boolean') {
    return res.status(400).json({ error: 'active must be boolean' });
  }
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 200) : null;
  try {
    const state = serverAT.setGlobalHalt(body.active, _req.user.id, reason);
    res.json({ ok: true, halted: state.active, by: state.by, ts: state.ts, reason: state.reason });
  } catch (err) {
    logger.error('PANIC_SET', 'Failed uid=' + _req.user.id + ': ' + err.message);
    res.status(500).json({ error: 'halt_write_failed', detail: err.message });
  }
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
  // [BUG-SAFE-1] Server-side consent enforcement for live mode switch.
  // Client confirm dialog is advisory only; server enforces explicit
  // {confirm:true, env:'TESTNET'|'REAL'} in request body. Demo mode unchanged.
  if (mode === 'live') {
    if (_req.body.confirm !== true) {
      logger.warn('AT_MODE', `Live mode switch rejected uid=${_req.user.id}: missing confirm:true`);
      return res.status(400).json({ ok: false, error: 'CONFIRM_REQUIRED', message: 'Live mode requires explicit server-side confirmation.' });
    }
    if (_req.body.env !== 'TESTNET' && _req.body.env !== 'REAL') {
      logger.warn('AT_MODE', `Live mode switch rejected uid=${_req.user.id}: invalid env='${_req.body.env}'`);
      return res.status(400).json({ ok: false, error: 'ENV_CONFIRM_REQUIRED', message: 'Live mode requires explicit env declaration: TESTNET or REAL.' });
    }
    // Pre-live checklist — validate before switching to live
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
  if (result.ok && mode === 'live') {
    result.preLiveChecklist = 'PASSED';
    // [BUG-SAFE-1] Audit explicit consent + declared env for forensic trail
    try { db.auditLog(_req.user.id, 'AT_MODE_CHANGE', { newMode: 'live', consentMethod: 'EXPLICIT_CONFIRM', declaredEnv: _req.body.env, serverEnforced: true, safe1: true }, _req.ip); } catch (_) {}
  }
  res.json(result);
});
// [AT-TOGGLE-FIX] Dedicated AT ON/OFF endpoint — server-authoritative
// [BUG-T7 2026-05-13] Accept optional `mode` param ('demo'|'live'). If omitted,
// server uses current us.engineMode (backward-compat pentru clients existenți
// care trimit doar { active }).
app.post('/api/at/toggle', (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  const active = _req.body.active;
  if (typeof active !== 'boolean') return res.status(400).json({ ok: false, error: 'active must be boolean' });
  const modeParam = (_req.body.mode === 'live' || _req.body.mode === 'demo') ? _req.body.mode : undefined;
  const result = serverAT.toggleActive(_req.user.id, active, modeParam);
  if (!result.ok) return res.json(result);
  res.json({
    ok: true,
    atActive: result.atActive,
    atActiveDemo: result.atActiveDemo,
    atActiveLive: result.atActiveLive,
    mode: result.mode,
    state: serverAT.getFullState(_req.user.id)
  });
});
app.post('/api/at/reset', (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  serverAT.reset(_req.user.id);
  res.json({ ok: true, state: serverAT.getFullState(_req.user.id) });
});
// [DSL-OFF] Per-user DSL engine on/off — new AT + manual positions respect this flag
app.post('/api/dsl/toggle', (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  const enabled = _req.body.enabled;
  if (typeof enabled !== 'boolean') return res.status(400).json({ ok: false, error: 'enabled must be boolean' });
  res.json(serverAT.setDslEnabled(_req.user.id, enabled));
});
app.get('/api/dsl/toggle', (_req, res) => {
  if (!_req.user) return res.status(401).json({ error: 'Auth required' });
  res.json({ ok: true, dslEnabled: serverAT.getDslEnabled(_req.user.id) });
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
  const result = serverAT.closeBySeq(req.user.id, seq);
  res.json(result);
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
  // [R2] Forward `source` and `clientReqId` — serverAT.registerManualPosition
  // already consumes both (Phase 10 classification + Phase 9D1 idempotency),
  // but this handler previously dropped them, so callers that passed
  // source:'auto' had their position stamped as manual (autoTrade=false) and
  // retries with the same clientReqId double-registered. Strict whitelist:
  // `source` must be 'auto' or 'manual' (default 'manual' when absent),
  // `clientReqId` coerced to string (or null).
  const _src = (d.source === 'auto' || d.source === 'manual') ? d.source : 'manual';
  const _cid = d.clientReqId ? String(d.clientReqId) : null;
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
    source: _src,
    clientReqId: _cid,
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
    const userId = _req.user.id;
    const limit = Math.min(parseInt(_req.query.limit, 10) || 100, 500);
    const history = symbol
      ? db.getRegimeHistory(symbol, userId, limit)
      : db.getRegimeHistoryByUser(userId, limit);
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

// ─── [Phase 2 S3] Brain Parity Harness Route ───
// Mounts POST /api/brain/parity/client + GET /api/brain/parity/report.
// Shadow-only. Gated by MF.PARITY_SHADOW_ENABLED inside the handlers so the
// mount itself is inert when the flag is off (current default).
const brainParityRoutes = require('./server/routes/brainParity');
app.use('/api/brain/parity', brainParityRoutes);

// ─── [OMEGA Wave 1 UI 2026-05-15] Read-only OMEGA UI feed ───
// Mounts GET /api/omega/{voice,mood,health} + POST /api/omega/chat. Read
// model only — no mutation paths. ML write-side is dormant (Wave 2+ wires
// the actual learning). Frontend OmegaPage consumes these endpoints.
const omegaRoutes = require('./server/routes/omega');
app.use('/api/omega', omegaRoutes);

// D-4 Doctor API routes (admin-only). State + events + modules + verdict + quota.
const doctorRoutes = require('./server/routes/doctor');
app.use('/api/omega/doctor', doctorRoutes);

// ML Plan v3 Phase B Day 5 — Ring5 influence pipeline admin observability API.
const ring5Routes = require('./server/routes/ring5');
app.use('/api/ring5', ring5Routes);

// [Task B 2026-05-28] Admin operations — global halt toggle endpoint
app.use('/api/admin', require('./server/routes/admin'));

// ─── Health Routes (Tasks 54-56: feed / locks / recovery) ───
const healthRoutes = require('./server/routes/health');
app.use('/api/health', healthRoutes);

// ─── API Routes (trading + exchange) ───
app.use('/api', tradingRoutes);
app.use('/api/exchange', exchangeRoutes);
app.use('/api/market', require('./server/routes/market'));

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

// ─── /favicon.ico → reuse SVG favicon (browsers auto-request this at root) ───
app.get('/favicon.ico', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(__dirname, 'public', 'app', 'favicon.svg'));
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
    if (filePath.endsWith('.apk')) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', 'attachment; filename="zeus-terminal.apk"');
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
// Asset-looking requests must 404, not fall back to index.html — otherwise the
// browser sees text/html for a missing .js/.css and rejects it under strict
// MIME checks (cached old bundle hashes after a redeploy).
const _ASSET_RE = /\.(?:js|mjs|css|map|json|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|otf|wasm)$/i;
function _sendAppIndex(req, res) {
  if (_ASSET_RE.test(req.path)) return res.status(404).type('text/plain').send('Not Found');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'app', 'index.html'), (err) => {
    if (err) res.status(500).send('Server error');
  });
}
app.get('/app/{*rest}', _sendAppIndex);

// ─── Fallback: React app is now the main app ───
app.get('/{*splat}', _sendAppIndex);

// ─── [SENTRY] Error handler — must be before our custom error handler ───
Sentry.setupExpressErrorHandler(app);

// ─── Global error handler ───
app.use((err, req, res, _next) => {
  logger.error('SERVER', 'Unhandled route error: ' + err.message, { path: req.originalUrl, method: req.method });
  res.status(500).json({ error: 'Internal server error' });
});

// ─── OMEGA Doctor D-1: boot-time module registry validation ───
// Per docs/omega/FAILURE_ONTOLOGY.md — hot_path_critical dep cycles =
// DEAD state → exit 42. Non-critical cycles + forbidden-dep violations
// emit warnings only.
try {
  const moduleRegistry = require('./server/services/ml/_doctor/moduleRegistry');
  const seedRegistry = require('./server/services/ml/_doctor/seedRegistry');
  seedRegistry.runSeed();
  const dagResult = moduleRegistry.validateDAG();
  if (dagResult.hardFail) {
    console.error('[OMEGA-DOCTOR] HARD FAIL: hot_path_critical dependency cycle detected at boot');
    console.error('[OMEGA-DOCTOR] Cycles:', JSON.stringify(dagResult.cycles, null, 2));
    console.error('[OMEGA-DOCTOR] Cognitive state per FAILURE_ONTOLOGY: DEAD → exit 42');
    process.exit(42);
  }
  if (dagResult.cycles.length > 0) {
    console.warn('[OMEGA-DOCTOR] WARNING: non-critical dependency cycles:');
    console.warn(JSON.stringify(dagResult.cycles, null, 2));
  }
  if (dagResult.forbiddenViolations.length > 0) {
    console.warn('[OMEGA-DOCTOR] WARNING: transitive forbidden-dep violations:');
    console.warn(JSON.stringify(dagResult.forbiddenViolations, null, 2));
  }
  const total = moduleRegistry.listAll().length;
  console.log(`[OMEGA-DOCTOR] D-1 registry: ${total} modules registered, DAG valid`);

  // D-2: start telemetry collector + persistent log writer
  const telemetryCollector = require('./server/services/ml/_doctor/telemetryCollector');
  const persistentLogWriter = require('./server/services/ml/_doctor/persistentLogWriter');
  telemetryCollector.start();
  persistentLogWriter.start();
  console.log('[OMEGA-DOCTOR] D-2 telemetry + log writer started');

  // D-3: start analyzer (5s loop computes cognitive state per FAILURE_ONTOLOGY)
  const analyzer = require('./server/services/ml/_doctor/analyzer');
  analyzer.start();
  console.log('[OMEGA-DOCTOR] D-3 analyzer started (5s tick)');
} catch (err) {
  console.error('[OMEGA-DOCTOR] Boot validation error:', err.message);
  console.error('[OMEGA-DOCTOR] Server continues but registry may be incomplete');
}

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

  // [Bybit Phase 1A Task 43] Boot-time position reconciliation.
  // Runs BEFORE other boot services: scan exchange → reconcile DB → verify SL → lift halt per user.
  // Non-fatal — server continues even if recovery fails; failed users stay halted.
  recoveryBoot.run().catch(err => {
    console.error('[BOOT] recoveryBoot failed:', err.message);
  });

  // [Bybit Phase 1B Task 45] Start periodic NTP drift checks (5min interval).
  timeSyncAssert.start();

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
  // [OPS-5] Persist boot event for restart-count monitoring. Daily cron
  // în database.js counts SERVER_BOOT events în last 24h and alerts on
  // anomaly. Best-effort — try/catch so DB write failure never blocks
  // the boot completion logging.
  try {
    db.auditLog(null, 'SERVER_BOOT', {
      pid: process.pid,
      port: PORT,
      nodeEnv: process.env.NODE_ENV,
      flags: MF.getAll(),
    }, '127.0.0.1');
  } catch (err) {
    console.error('[OPS-5] Failed to persist SERVER_BOOT audit:', err && err.message);
  }
  try {
    const rateState = require('./server/services/binanceRateState');
    const bootResult = rateState.resetOnCleanBoot({ now: Date.now() });
    if (bootResult.reset) {
      console.log(`[RATE-STATE] Clean boot reset: ${bootResult.reason}`);
    }
  } catch (err) {
    console.error('[RATE-STATE] Boot reset failed (non-fatal):', err && err.message);
  }
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
    marketFeed.subscribeMultiWithBootRef(SD_SYMBOLS, SD_TFS).then(() => {
      logger.info('SERVER', `[P2] Market feed active for [${SD_SYMBOLS.join(',')}] [${SD_TFS}]`);
      try {
        const dbRef = require('./server/services/database').db;
        marketFeed.startOrphanSweep(dbRef);
      } catch (e) {
        logger.warn('SERVER', `[Phase B] orphan sweeper boot failed: ${e.message}`);
      }
    }).catch(err => {
      logger.error('SERVER', '[P2] Market feed failed:', err.message);
    });
    // [WS-PROXY] Start quant data poller (funding + OI via REST → cache)
    try { require('./server/services/wsMarketProxy').startQuantPoller(); } catch (_) {}
    try { require('./server/services/wsMarketProxy').startWatchlist(); } catch (_) {}
    try { require('./server/services/wsMarketProxy').startWatchlistREST(); } catch (_) {}
    // [MULTI-SYM] Expose configured symbols for API
    app._sdSymbols = SD_SYMBOLS;
  } else {
    logger.info('SERVER', '[P2] Market feed DISABLED (MF.SERVER_MARKET_DATA=false)');
    app._sdSymbols = [];
  }

  // [P3] Start server brain cycle if flag enabled (requires market data)
  // [Phase 2 S3] Also start if PARITY_SHADOW_ENABLED so serverBrain can run
  // its _runShadowCycle writer for the parity harness. Shadow-only when
  // SERVER_BRAIN is off — no AT execution, no Telegram, no DB decision log.
  if (MF.SERVER_BRAIN || MF.PARITY_SHADOW_ENABLED) {
    if (!MF.SERVER_MARKET_DATA) {
      logger.error('SERVER', '[P3] SERVER_BRAIN/PARITY_SHADOW requires SERVER_MARKET_DATA — brain NOT started');
    } else {
      // Wait for data to populate before starting brain
      setTimeout(() => {
        serverBrain.start();
        if (MF.SERVER_BRAIN) {
          logger.info('SERVER', '[P3] Server brain active (observation mode)');
        } else {
          logger.info('SERVER', '[S3] Server brain started in shadow-only mode (parity harness)');
        }
        // [Task H 2026-05-28] Dead Man's Switch watchdog — polls
        // ml_module_heartbeats every 10s; halts globally if brain stale >60s.
        try {
          require('./server/services/brainWatchdog').start();
        } catch (e) {
          logger.warn('SERVER', 'brainWatchdog start failed: ' + e.message);
        }

        // [Task N 2026-05-28] Periodic drift checker — every 15min compare
        // serverAT positions vs exchange positions; halt on 2 consecutive
        // drift detections (transient WS drops don't escalate).
        try {
          require('./server/services/driftChecker').start();
        } catch (e) {
          logger.warn('SERVER', 'driftChecker start failed: ' + e.message);
        }
      }, 15000);  // 15s delay for initial candle load
    }
  } else {
    logger.info('SERVER', '[P3] Server brain DISABLED (MF.SERVER_BRAIN=false, PARITY_SHADOW_ENABLED=false)');
  }

  // [Wave 1 R0 fix 2026-05-19] R0 substrate ring orchestrator was never
  // initialized at boot — `_state` stuck at 'OFFLINE' permanently. UI
  // `/api/omega/health` returned R0: OFFLINE forever. Call init() so the
  // ring transitions to 'OK' state + heartbeat ticks.
  try {
    const R0 = require('./server/services/ml/R0_substrate');
    R0.init();
    logger.info('SERVER', '[R0] substrate ring initialized → OK');
  } catch (err) {
    logger.error('SERVER', `[R0] init failed: ${err.message}`);
  }

  // [USERDATA] Per-user WebSocket stream for real-time position/order/balance updates.
  // Replaces 60s REST poll with <100ms WS events when enabled.
  try {
    const uds = require('./server/services/userDataStream');
    const serverAT = require('./server/services/serverAT');
    const credStore = require('./server/services/credentialStore');
    const MF = require('./server/migrationFlags');
    if (MF.USERDATA_STREAM_ENABLED) {
        const users = db.listUsers ? db.listUsers() : [];
        for (const u of users) {
            try {
                const creds = credStore.getExchangeCreds(u.id);
                if (creds && creds.apiKey) {
                    const mode = serverAT.getMode(u.id) || 'demo';
                    if (uds.resolveStreamFlag(mode)) {
                        uds.connect(u.id, creds, (event) => serverAT.onUserDataEvent(u.id, event));
                        logger.info('SERVER', `[USERDATA] stream started uid=${u.id} mode=${mode}`);
                    }
                }
            } catch (_) {}
        }
    }
  } catch (err) {
    logger.error('SERVER', `[USERDATA] boot failed: ${err.message}`);
  }

  // [RADAR] Market Radar scanner — polls Binance top-300 USDT perps once/min
  // and broadcasts spike / volume / rank / top-300 events via wsBroadcastAll.
  // Always on — no migration flag. Read-only, no trading side effects.
  try {
    const marketRadar = require('./server/services/marketRadar');
    marketRadar.start();
    logger.info('SERVER', '[RADAR] market radar scanner started');
  } catch (err) {
    logger.error('SERVER', `[RADAR] boot failed: ${err.message}`);
  }

  // [FUND Wave 9 / Canonical PDF #8] CoinGecko fundamentals refresher — warms
  // ml_fundamentals_cache every 5min so serverBrain hot-path sync read has
  // market_cap_rank / dominance / vol_24h / 24h_chg available without HTTP.
  try {
    const fundamentals = require('./server/services/fundamentals');
    fundamentals.startBackgroundRefresh();
    logger.info('SERVER', '[FUND] fundamentals refresher started (5min TTL)');
  } catch (err) {
    logger.error('SERVER', `[FUND] boot failed: ${err.message}`);
  }

  // [BIN-TELEM 2026-05-19] Register active pollers provider so diag snapshot
  // includes marketFeed _activeSymbols + _altKlinePollers count. Catches the
  // suspected leak (auto-subscribe adăugă pollers fără cleanup).
  try {
    const telem = require('./server/services/binanceTelemetry');
    telem.registerActivePollersProvider(() => {
      const out = { marketFeed: marketFeed.getPollerStats() };
      try {
        const liq = require('./server/services/serverLiquidity');
        if (liq && typeof liq.getDepthSymbols === 'function') out.serverLiquidity = liq.getDepthSymbols();
      } catch (_) { /* optional */ }
      return out;
    });
    logger.info('SERVER', '[BIN-TELEM] telemetry pollers provider registered');
  } catch (err) {
    logger.error('SERVER', `[BIN-TELEM] register failed: ${err.message}`);
  }

  // [Wave 8 G] Omega greeting — written to ml_voice_log on boot for each
  // active user so TheVoice feed shows life on startup. Best-effort.
  try {
    const voiceLogger = require('./server/services/ml/_voice/voiceLogger');
    const usersList = db.listUsers ? db.listUsers() : [];
    for (const u of usersList) {
      try {
        voiceLogger.logUtterance({
          userId: u.id,
          utteranceType: 'GREETING',
          mood: 'CALM',
          text: 'Ω online. let me look around.',
          templateId: 'omega_boot_greeting',
          contextJson: JSON.stringify({ ts: Date.now() }),
        });
      } catch (_) { /* per-user best-effort */ }
    }
  } catch (err) {
    logger.warn('SERVER', `[OMEGA-GREETING] boot emit failed: ${err.message}`);
  }

  // [LIQ] Binance public liquidation feed — one persistent WS to
  // !forceOrder@arr, filtered to notional ≥ $100k. Read-only public data,
  // no trading side effects. Gated by MARKET_RADAR_LIQ_ENABLED.
  try {
    const liquidationFeed = require('./server/services/liquidationFeed');
    liquidationFeed.start();
    logger.info('SERVER', '[LIQ] liquidation feed started');
  } catch (err) {
    logger.error('SERVER', `[LIQ] boot failed: ${err.message}`);
  }

  // [LIQ-FEED PROXY 2026-05-14] Server-side unfiltered liq aggregator for
  // Quant Monitor heatmap (separate from Market Radar feed above which
  // applies $100k filter + 30s dedup). Broadcasts `liq.feed` frames; clients
  // listen via liqFeedClient.ts when MF.LIQ_FEED_VIA_SERVER is true.
  // Spec: LIQ_FEED_PROXY_PLAN_20260514.md
  try {
    const liqFeedAggregator = require('./server/services/liqFeedAggregator');
    liqFeedAggregator.start();
    logger.info('SERVER', '[LIQ-FEED] aggregator started (BNB + BYB + OKX, unfiltered passthrough)');
  } catch (err) {
    logger.error('SERVER', `[LIQ-FEED] boot failed: ${err.message}`);
  }

  // [b65] Reflection engine: start + backfill from history regardless of SERVER_BRAIN.
  // Dashboard reads thoughts/rules/self-score directly from in-memory Maps —
  // without this seed, every pm2 reload leaves the dashboard empty until a fresh
  // AT close triggers reflectOnTrade. Restores rules from DB and replays the
  // last 50 closed trades per user into the thoughts ring buffer.
  try {
    const serverReflection = require('./server/services/serverReflection');
    serverReflection.start();
    serverReflection.seedFromHistory(null, 50);
    logger.info('SERVER', '[REFLECTION] engine started + history seeded (dashboard ready)');
  } catch (err) {
    logger.error('SERVER', `[REFLECTION] boot failed: ${err.message}`);
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

// ─── Omega Memory Cleanup Cron (Sub-C.1 Task 9) ─────────────────────────────
// Daily 02:00 UTC — hard-delete tombstones, retry failed_transient,
// recover stuck pending, auto-decay expired, compact watermarks per user.
require('./server/cron/omegaMemoryCleanup').schedule();

// [Wave 1] R0 substrate cron — DR heartbeat every 60s
try { require('./server/cron/r0SubstrateCron').schedule(); } catch (_) {}

// [Wave 3] Cold path reflection cron — 5min retrospective analysis
try { require('./server/cron/coldPathCron').schedule(); } catch (_) {}

// [SRV-POS] Position classifications audit table retention — weekly 30d prune
try { require('./server/cron/posClassRetention').schedule(); } catch (_) {}

// [DD3] ML bandit feature scan — 4h auto-quarantine check
try { require('./server/cron/mlScanCron').schedule(); } catch (_) {}

// [Wave 2] R1 Constitution — seed canonical principles (idempotent)
try {
    const charter = require('./server/services/ml/R1_constitution/constitutionalCharterLayer');
    const CANONICAL = [
        { principleId: 'canon_safety', kind: 'safety', description: 'Position sizing, SL, max leverage — never compromise' },
        { principleId: 'canon_truth', kind: 'truth', description: 'No false signals, no self-deception in metrics' },
        { principleId: 'canon_compliance', kind: 'compliance', description: 'Exchange rules, API limits, legal constraints' },
        { principleId: 'canon_integrity', kind: 'integrity', description: 'Consistent behavior across environments' },
        { principleId: 'canon_survivability', kind: 'long_term_survivability', description: 'Capital preservation over profit maximization' },
        { principleId: 'canon_profit', kind: 'profit', description: 'Generate returns within safety constraints' },
    ];
    for (const p of CANONICAL) {
        try {
            charter.registerPrinciple({ userId: 0, resolvedEnv: 'SYSTEM', ...p });
        } catch (_) { /* idempotent — ignore duplicate */ }
    }
} catch (_) {}

// ─── WebSocket Sync (real-time cross-device push) ───
const wss = new WebSocket.Server({
  noServer: true,
  maxPayload: 64 * 1024,
  perMessageDeflate: { zlibDeflateOptions: { level: 1 }, threshold: 256 },
});
global.__zeusWss = wss;
const _wsClients = new Map(); // userId -> Set<ws>

// Handle upgrade manually — prevents "Invalid Upgrade header" crash from Cloudflare/proxies
// [B.17] Per-IP pre-auth WS connection limits + handshake timeout
const _wsIpPending = new Map(); // ip → count
const WS_MAX_PENDING_PER_IP = 10;
const WS_HANDSHAKE_TIMEOUT_MS = 5000;

server.on('upgrade', (req, socket, head) => {
  // Only accept /ws/sync path
  if (req.url !== '/ws/sync') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }
  // [B.17] Per-IP rate guard — slowloris / connection flood protection
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  const pending = _wsIpPending.get(ip) || 0;
  if (pending >= WS_MAX_PENDING_PER_IP) {
    socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
    socket.destroy();
    return;
  }
  _wsIpPending.set(ip, pending + 1);
  const _ipCleanup = () => { const c = _wsIpPending.get(ip) || 0; if (c <= 1) _wsIpPending.delete(ip); else _wsIpPending.set(ip, c - 1); };
  // Handshake timeout — 5s to complete auth or get dropped
  const _hsTimeout = setTimeout(() => { _ipCleanup(); socket.destroy(); }, WS_HANDSHAKE_TIMEOUT_MS);
  socket.on('close', () => { clearTimeout(_hsTimeout); _ipCleanup(); });
  // [SEC-20] Origin allowlist on WS upgrade — defense-in-depth vs cross-site
  // WebSocket hijacking. SameSite=lax cookie already prevents browser cross-
  // origin cookie attach (primary defense), but absent Origin or unknown
  // Origin in upgrade request indicates non-browser or rogue context — reject.
  // Mirrors HTTP Origin guard at line ~107 (sendBeacon paths). Tolerate
  // missing Origin only for non-browser clients în dev sau test (no cookies
  // anyway). Production: strict allowlist match.
  try {
    const origin = req.headers['origin'] || '';
    const host = req.headers['host'] || '';
    const allowed = config.allowedOrigins || ['https://' + host];
    const okOrigin = origin && (
      allowed.some(a => origin === a) ||
      origin === 'https://' + host ||
      origin === 'http://' + host
    );
    if (!okOrigin) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
  } catch (_) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
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
    // Verify user status + token_version (session invalidation on password change).
    // Use ?? 0 on both sides so legacy tokens without tokenVersion claim fail against
    // DB default (1), forcing re-login instead of silently bypassing the check.
    {
      const fresh = db.findUserById(user.id);
      if (!fresh || fresh.status !== 'active' || (user.tokenVersion ?? 0) !== (fresh.token_version ?? 0)) {
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

  // [SEC-19] Pin token_version + uid on socket for heartbeat re-verify.
  // Force-logout (DB token_version bump pe password change/banned/disabled)
  // doesn't kick active WS connections until next reconnect — heartbeat now
  // re-checks every 30s. If DB version > pinned version, kick socket.
  ws._uid = uid;
  ws._tokenVersion = user.tokenVersion ?? 0;

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('close', () => {
    const set = _wsClients.get(uid);
    if (set) { set.delete(ws); if (set.size === 0) _wsClients.delete(uid); }
    try { require('./server/services/wsMarketProxy').handleClientDisconnect(ws); } catch (_) {}
    try { require('./server/services/heartbeatTracker').markAbsent(uid); } catch (_) {}
  });
  ws.on('error', () => { try { ws.close(); } catch (_) { } });

  // WS Market Proxy — route market.* subscribe/unsubscribe from clients
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg && msg.type && msg.type.startsWith('market.')) {
        require('./server/services/wsMarketProxy').handleClientMessage(ws, msg);
      }
    } catch (_) {}
  });

  // [Phase 11.7] Market Radar warm-start — replay cached events so a new or
  // reconnecting session sees the same radar state as everyone else. Safe
  // when cache is empty (we just skip the send). Sent synchronously here so
  // it lands before any future market.radar broadcast.
  try {
    const radarCache = require('./server/services/radarCache');
    const snap = radarCache.snapshot();
    if (snap && (snap.green.length || snap.red.length)) {
      ws.send(JSON.stringify({ type: 'market.radar.snapshot', data: snap }));
    }
  } catch (_) { /* cache optional; never block WS accept */ }

  // [WS-PROXY B.6] Watchlist warm-start — send cached prices on connect
  try {
    const wsProxy = require('./server/services/wsMarketProxy');
    const wlSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'ZECUSDT'];
    for (const sym of wlSymbols) {
      const cached = wsProxy.getLastValue(sym, 'market.wl');
      if (cached && ws.readyState === 1) {
        try { ws.send(JSON.stringify(cached)); } catch (_) {}
      }
    }
  } catch (_) {}

  // [Phase 12.A — Batch A] Exchange/env warm-start — mirrors radar snapshot.
  // Sends one typed exchange.changed frame so a new or reconnecting tab
  // learns the active exchange + env immediately, without waiting for the
  // next at_update emit or for a REST roundtrip on /api/exchange/status.
  // Sent only to THIS socket (not broadcast) — other tabs already have the
  // current state; this is purely a per-connection warm-start.
  try {
    const snap = _buildExchangeSnapshot(uid);
    if (snap) ws.send(JSON.stringify({ type: 'exchange.changed', data: snap }));
  } catch (_) { /* never block WS accept */ }

  // [Phase 2 S1.A] AT warm-start — per-socket canonical AT state snapshot.
  // Eliminates the previous gap where a fresh tab had to wait for either the
  // next serverAT.onChange() broadcast OR the 30s REST polling fallback
  // before the AT panel rendered anything real. Read path is the same
  // getFullState(uid) used by /api/at/state and the onChange broadcast, so
  // the payload shape is identical to what applyATUpdate() already handles
  // — no client wiring change needed. Per-socket only (not broadcast); other
  // tabs already hold their own state.
  try {
    const atSnap = serverAT.getFullState(uid);
    if (atSnap) ws.send(JSON.stringify({ type: 'at_update', data: atSnap }));
  } catch (_) { /* never block WS accept */ }
});

// Heartbeat — drop dead connections every 30s + [SEC-19] re-verify token_version
const _wsPing = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    // [SEC-19] Re-verify token_version against DB. Kick on mismatch (force-
    // logout via password change / banned / disabled) sau on user gone.
    // Cheap: 1 indexed DB read per active WS per 30s. Failure-safe: if DB
    // read throws, leave socket alone (don't kick on transient DB error).
    try {
      if (ws._uid != null) {
        const fresh = db.findUserById(ws._uid);
        if (!fresh || fresh.status !== 'active' ||
            (ws._tokenVersion ?? 0) !== (fresh.token_version ?? 0)) {
          try { ws.close(4001, 'session expired'); } catch (_) { }
          return;
        }
      }
    } catch (_) { /* never kick on DB hiccup */ }
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

// [MIGRATION-F0] Generic per-user push over the existing WSS. Used by
// routes (settings / future stores) to broadcast a typed payload to every
// live session of `userId`. Returns the count of sockets that received
// the message. Safe to call when no sessions are connected.
app.locals.wsBroadcastToUser = function (userId, payload) {
  const set = _wsClients.get(userId);
  if (!set || set.size === 0) return 0;
  let msg;
  try { msg = JSON.stringify(payload); } catch (_) { return 0; }
  let sent = 0;
  set.forEach(ws => {
    try {
      if (ws.readyState === WebSocket.OPEN) { ws.send(msg); sent++; }
    } catch (_) { /* dead socket — cleaned on close */ }
  });
  return sent;
};
// Also expose on global for modules that don't have access to `app`.
global.__zeusWsBroadcastToUser = app.locals.wsBroadcastToUser;

// [Phase 12.A — Batch A] Build a typed exchange/env snapshot for the user.
// Reads the canonical serverAT.getFullState() and plucks only the 5 fields
// the UI needs to render exchange + env labels — no engine state, no
// positions. Returns null if the read throws (defensive; never blocks).
function _buildExchangeSnapshot(userId) {
  if (!userId) return null;
  try {
    const s = serverAT.getFullState(userId);
    return {
      exchange: s.activeExchange,                 // 'binance' | 'bybit' | null
      mode: s.exchangeMode,                       // 'live' | 'testnet' | null
      apiConfigured: !!s.apiConfigured,
      executionEnv: s.executionEnv,               // 'DEMO' | 'TESTNET' | 'REAL' | null
      executionBlockedReason: s.executionBlockedReason,
      ts: Date.now(),
    };
  } catch (_) { return null; }
}

// [Phase 12.A — Batch A] Push exchange.changed to every live session of
// `userId`. Used by /api/exchange/{save,disconnect,verify} so other tabs /
// devices learn the new active exchange + env immediately, without waiting
// for a polling REST cycle. Best-effort: silently no-ops if the user has no
// connected sockets or the snapshot build fails.
app.locals.broadcastExchangeChanged = function (userId) {
  const data = _buildExchangeSnapshot(userId);
  if (!data) return 0;
  return app.locals.wsBroadcastToUser(userId, { type: 'exchange.changed', data });
};

// [RADAR] Broadcast a payload to EVERY connected session across all users.
// Used by market-wide feeds (e.g. market.radar) that are not user-scoped.
app.locals.wsBroadcastAll = function (payload) {
  let msg;
  try { msg = JSON.stringify(payload); } catch (_) { return 0; }
  let sent = 0;
  _wsClients.forEach(set => {
    set.forEach(ws => {
      try {
        if (ws.readyState === WebSocket.OPEN) { ws.send(msg); sent++; }
      } catch (_) { /* dead socket — cleaned on close */ }
    });
  });
  return sent;
};
global.__zeusWsBroadcastAll = app.locals.wsBroadcastAll;

// ─── Graceful Shutdown ───
let _shuttingDown = false;
async function _gracefulShutdown(signal) {
  // [Phase B / Task B1.3] Idempotent — message + signal (or signal + kill-timeout)
  // could both fire; run the graceful sequence exactly once.
  if (_shuttingDown) return;
  _shuttingDown = true;
  logger.warn('SERVER', 'Shutdown signal received: ' + signal);
  console.log('\n🛑 Shutting down gracefully (' + signal + ')...');

  // [Task G 2026-05-28] Stop brain first — prevents new _executeLiveEntry calls
  // from being dispatched while we drain. Idempotent if already stopped.
  try {
    const serverBrain = require('./server/services/serverBrain');
    if (typeof serverBrain.stop === 'function') serverBrain.stop();
    logger.info('SERVER', 'serverBrain stopped (no new cycles)');
  } catch (err) {
    logger.warn('SERVER', 'serverBrain.stop failed: ' + err.message);
  }

  // [Task H 2026-05-28] Stop brain watchdog so it doesn't false-positive
  // during the drain (brain stopped → heartbeats stop → watchdog would alert).
  try { require('./server/services/brainWatchdog').stop(); } catch (_) {}

  // [Task N 2026-05-28] Stop drift checker (no point checking during shutdown)
  try { require('./server/services/driftChecker').stop(); } catch (_) {}

  // [Phase B / Task B1.2 2026-05-29] Stop all market feeds so the dying process
  // closes its WS connections cleanly. Without this, bybitFeed's WS flaps during
  // teardown (close fires with _closing=false → reconnect storm), producing the
  // restart-boundary connection burst seen in logs (32-48 connects/min aggregate).
  try { require('./server/services/feedManager').stopAll(); logger.info('SERVER', 'feeds stopped (feedManager.stopAll)'); } catch (err) { logger.warn('SERVER', 'feedManager.stopAll failed: ' + (err && err.message)); }

  // [Task G 2026-05-28] Drain in-flight _executeLiveEntry calls up to 5s.
  // Without this, PM2 reload mid-entry can create orphan orders on the exchange.
  try {
    const serverAT = require('./server/services/serverAT');
    if (typeof serverAT.drainPending === 'function') {
      const drainResult = await serverAT.drainPending(5000);
      logger.info('SERVER', 'serverAT drain: settled=' + drainResult.settled
        + ' timedOut=' + drainResult.timedOut + ' pending=' + drainResult.pending);
    }
  } catch (err) {
    logger.warn('SERVER', 'serverAT.drainPending failed: ' + err.message);
  }

  // [Wave 8 G] Omega farewell — best-effort, before sockets close
  try {
    const voiceLogger = require('./server/services/ml/_voice/voiceLogger');
    const usersList = db.listUsers ? db.listUsers() : [];
    for (const u of usersList) {
      try {
        voiceLogger.logUtterance({
          userId: u.id,
          utteranceType: 'FAREWELL',
          mood: 'CALM',
          text: 'Ω resting. catch you later boss.',
          templateId: 'omega_shutdown_farewell',
          contextJson: JSON.stringify({ signal, ts: Date.now() }),
        });
      } catch (_) {}
    }
  } catch (_) { /* best-effort during shutdown */ }

  telegramBot.stop();
  try { require('./server/services/wsMarketProxy').initiateShutdown(wss); } catch (_) {}
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

process.on('SIGTERM', () => { _gracefulShutdown('SIGTERM').catch(err => { console.error('[FATAL] shutdown error:', err.message); process.exit(1); }); });
process.on('SIGINT', () => { _gracefulShutdown('SIGINT').catch(err => { console.error('[FATAL] shutdown error:', err.message); process.exit(1); }); });
// [Phase B / Task B1.3] ecosystem.config.js sets shutdown_with_message:true → pm2
// sends an IPC 'shutdown' MESSAGE, NOT a signal. Without this handler the message was
// ignored and pm2 hard-killed after kill_timeout → _gracefulShutdown (drain, clean
// feed/brain stop) NEVER ran on reload. Handle the message so graceful shutdown fires.
process.on('message', (msg) => {
  if (msg === 'shutdown') {
    _gracefulShutdown('pm2-message').catch(err => { console.error('[FATAL] shutdown error:', err.message); process.exit(1); });
  }
});

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

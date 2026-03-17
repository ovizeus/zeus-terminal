// Zeus Terminal v122 — Server with Trading API + Multi-User
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const config = require('./server/config');
const tradingRoutes = require('./server/routes/trading');
const authRoutes = require('./server/routes/auth');
const exchangeRoutes = require('./server/routes/exchange');
const { createSessionAuth } = require('./server/middleware/sessionAuth');
const { startAutoRefresh: refreshExchangeInfo } = require('./server/services/exchangeInfo');
const telegram = require('./server/services/telegram');
const logger = require('./server/services/logger');
const { startReconciliation } = require('./server/services/reconciliation');
const db = require('./server/services/database');

const app = express();
const PORT = config.port;

// Parse JSON bodies and cookies
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// [PATCH5 S2] Security headers
app.use((req, res, next) => {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' wss://fstream.binance.com wss://stream.bybit.com https://fapi.binance.com https://api.binance.com https://testnet.binancefuture.com https://api.alternative.me",
    "img-src 'self' data: blob:",
    "manifest-src 'self' blob:",
    "frame-ancestors 'none'"
  ].join('; ');
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// ─── Auth Routes (public — before session check) ───
app.use('/auth', authRoutes);

// ─── Session Auth (protects everything below) ───
app.use(createSessionAuth(authRoutes.JWT_SECRET));

// ─── API Routes (before static files) ───
app.use('/api', tradingRoutes);
app.use('/api/exchange', exchangeRoutes);

// ─── Sync Routes (PC <-> Phone state sync) ───
const syncRoutes = require('./server/routes/sync');
app.use('/api/sync', syncRoutes);

// ─── Static Files ───
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.css') || filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// ─── Fallback to index.html (SPA) ───
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
    if (err) res.status(500).send('Server error');
  });
});

// ─── Global error handler ───
app.use((err, req, res, _next) => {
  console.error('[SERVER] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Bind to 0.0.0.0 for LAN access (phone over Wi-Fi) ───
const server = app.listen(PORT, '0.0.0.0', () => {
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
  telegram.alertServerStart();
  // Start position reconciliation loop
  startReconciliation();
});

// ─── Graceful Shutdown ───
function _gracefulShutdown(signal) {
  logger.warn('SERVER', 'Shutdown signal received: ' + signal);
  console.log('\n🛑 Shutting down gracefully (' + signal + ')...');
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
  telegram.send('🔴 *ZEUS CRASH* — uncaughtException: ' + err.message).finally(() => {
    process.exit(1);
  });
  setTimeout(() => process.exit(1), 3000); // force exit if telegram hangs
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error('[WARN] Unhandled promise rejection:', msg);
  logger.warn('PROMISE', 'unhandledRejection: ' + msg);
});

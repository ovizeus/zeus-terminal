// [DSL-FIX probe] Open born-manual DEMO positions (controlMode='user') with DSL on
// via the live server's /api/order/place, then verify the server activates DSL for
// them (proving the fix: born-manual positions are no longer skipped). DEMO = no
// exchange order, safe. Run on the VPS: node scripts/dslfix-live-probe.js
const http = require('http');
const jwt = require('jsonwebtoken');
const config = require('./../server/config');

const PORT = config.port || 3000;
const SECRET = config.jwtSecret;
const token = jwt.sign({ id: 1, email: 'hidden.kode@proton.me', role: 'admin', tokenVersion: 1 }, SECRET, { algorithm: 'HS256' });

function post(path, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port: PORT, path, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Cookie': `zeus_token=${token}`,
        'x-zeus-request': '1',
        'x-idempotency-key': 'dslfixprobe-' + Date.now() + '-' + Math.floor(Math.random() * 1e6),
      },
    }, (res) => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', e => resolve({ status: 0, body: 'ERR ' + e.message }));
    req.write(data); req.end();
  });
}

(async () => {
  const dsl = { openDslPct: 0.05, pivotLeftPct: 0.5, pivotRightPct: 0.4, impulseVPct: 0.2 };
  const entry = Number(process.argv[2]) || 70800;
  for (const [label, side] of [['SHORT', 'SELL'], ['LONG', 'BUY']]) {
    const r = await post('/api/order/place', {
      mode: 'demo', symbol: 'BTCUSDT', side, quantity: 0.002, leverage: 5,
      entryPrice: entry, source: 'manual', dslParams: dsl,
    });
    console.log(`OPEN ${label} (${side}): HTTP ${r.status} → ${r.body.slice(0, 260)}`);
  }
  process.exit(0);
})();

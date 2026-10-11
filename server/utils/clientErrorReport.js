'use strict';
// Normalisation for /api/client-error.
//
// [2026-10-11] Why this exists. Two different client reporters post to this
// one endpoint with two different field names, and the server understood only
// one of them:
//
//   utils/guards.ts   w.onerror           → { msg, src, line, col, stack, ua }
//   ErrorBoundary.tsx componentDidCatch   → { reason, stack, componentStack, url }
//
// server.js read body.reason / body.filename / body.lineno. So every uncaught
// window error — the whole global reporter — logged as the bare string
// "unknown" with no message, no file and no line. A second handler further
// down server.js DID read msg/src/line, but Express answers with the first
// matching route, so it never ran. The operator's crash was reported nine
// times on 2026-10-11 and the four window-level reports all landed as
// "unknown".
//
// The field names must be accepted in both shapes, in one place a test can
// hold on to.
function _pick(a, b) {
  return (a !== undefined && a !== null && a !== '') ? a : b;
}

function normalizeClientError(body) {
  const b = body || {};
  const str = (v, n) => (v === undefined || v === null || v === '') ? undefined : String(v).slice(0, n);
  const num = (v) => {
    // A line number of 0 is real; '' and null are not. Number(null) is 0, so
    // emptiness has to be rejected before the coercion. (R-C-9)
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    reason: str(_pick(b.reason, b.msg), 300) || 'unknown',
    kind: str(b.kind, 40) || 'unknown',
    filename: str(_pick(b.filename, b.src), 200),
    lineno: num(_pick(b.lineno, b.line)),
    colno: num(_pick(b.colno, b.col)),
    url: str(b.url, 300),
    stack: str(b.stack, 1500),
    componentStack: str(b.componentStack, 1500),
    ts: num(b.ts),
  };
}

// The throttle key.
//
// [2026-10-11] /api/client-error is in sessionAuth's publicPaths — deliberately,
// so a crash on the login page can still be reported — which means req.user is
// never populated and the old key, (req.user && req.user.id) || 'anon', was the
// literal string 'anon' for every client. The 5s throttle was therefore
// GLOBAL: one phone in a render loop silently suppressed crash reports from
// everyone else, answering them {ok:true, throttled:true}. Keying on the
// client address restores per-client throttling without asking this public
// endpoint to authenticate anything.
function clientErrorThrottleKey(req) {
  const r = req || {};
  const uid = r.user && r.user.id;
  if (uid !== undefined && uid !== null && uid !== '') return 'u:' + uid;
  const ip = r.ip || (r.connection && r.connection.remoteAddress) || 'unknown';
  return 'ip:' + String(ip).slice(0, 60);
}

module.exports = { normalizeClientError, clientErrorThrottleKey };

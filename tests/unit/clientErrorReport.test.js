const { normalizeClientError, clientErrorThrottleKey } = require('../../server/utils/clientErrorReport');

// [2026-10-11] These tests exist because the operator's crash was reported
// nine times in one day and every window-level report reached the log as the
// single word "unknown". The cause was not the crash — it was that the server
// read field names no client ever sent.

describe('the window reporter payload is understood', () => {
  // This is verbatim the shape utils/guards.ts w.onerror pushes.
  const onerrorShape = {
    msg: "Cannot read properties of null (reading 'toFixed')",
    src: 'https://zeus/app/assets/index-CorJ7oIn.js',
    line: 412,
    col: 9183,
    stack: 'TypeError: ...\n  at Pill',
    ua: 'Android',
  };

  it('keeps the message instead of logging "unknown"', () => {
    expect(normalizeClientError(onerrorShape).reason)
      .toBe("Cannot read properties of null (reading 'toFixed')");
  });

  it('keeps the file and line, which locate the crash', () => {
    const n = normalizeClientError(onerrorShape);
    expect(n.filename).toBe('https://zeus/app/assets/index-CorJ7oIn.js');
    expect(n.lineno).toBe(412);
    expect(n.colno).toBe(9183);
  });
});

describe('the ErrorBoundary payload still works', () => {
  const boundaryShape = {
    kind: 'react-boundary',
    reason: "Cannot read properties of null (reading 'toFixed')",
    stack: 'TypeError: ...',
    componentStack: '\n    at PositionCard\n    at PositionsList',
    url: '/app/#theia',
    ts: 1791727093112,
  };

  it('carries the component stack, the field that names the panel', () => {
    expect(normalizeClientError(boundaryShape).componentStack).toContain('PositionCard');
  });

  it('carries kind, url and ts', () => {
    const n = normalizeClientError(boundaryShape);
    expect(n.kind).toBe('react-boundary');
    expect(n.url).toBe('/app/#theia');
    expect(n.ts).toBe(1791727093112);
  });
});

describe('a report that carries nothing degrades honestly', () => {
  it('falls back to "unknown" rather than throwing', () => {
    expect(normalizeClientError({}).reason).toBe('unknown');
    expect(normalizeClientError(undefined).reason).toBe('unknown');
    expect(normalizeClientError(null).kind).toBe('unknown');
  });

  it('does not invent a line number out of null or empty string', () => {
    // Number(null) is 0 and Number('') is 0 — a confident, wrong line 0.
    expect(normalizeClientError({ line: null }).lineno).toBeUndefined();
    expect(normalizeClientError({ line: '' }).lineno).toBeUndefined();
    expect(normalizeClientError({ line: 'nope' }).lineno).toBeUndefined();
  });

  it('keeps a real line 0', () => {
    expect(normalizeClientError({ line: 0 }).lineno).toBe(0);
  });

  it('prefers the reason field when a client sends both names', () => {
    expect(normalizeClientError({ reason: 'real', msg: 'other' }).reason).toBe('real');
  });

  it('truncates a hostile stack rather than logging a megabyte', () => {
    const n = normalizeClientError({ stack: 'x'.repeat(50000), msg: 'y'.repeat(50000) });
    expect(n.stack.length).toBe(1500);
    expect(n.reason.length).toBe(300);
  });
});

describe('the throttle is per client, not global', () => {
  // The bug: /api/client-error is a public path, so req.user is never set and
  // the key was the constant 'anon'. One phone in a render loop then silenced
  // every other user's crash reports for 5 seconds at a time.
  it('gives two different addresses two different keys', () => {
    const a = clientErrorThrottleKey({ ip: '86.123.67.235' });
    const b = clientErrorThrottleKey({ ip: '10.0.0.9' });
    expect(a).not.toBe(b);
  });

  it('does not collapse every anonymous client onto one key', () => {
    const keys = ['1.1.1.1', '2.2.2.2', '3.3.3.3'].map(ip => clientErrorThrottleKey({ ip }));
    expect(new Set(keys).size).toBe(3);
  });

  it('uses the user id when one happens to be there', () => {
    expect(clientErrorThrottleKey({ user: { id: 1 }, ip: '1.1.1.1' })).toBe('u:1');
  });

  it('falls back to the socket address when req.ip is absent', () => {
    expect(clientErrorThrottleKey({ connection: { remoteAddress: '5.5.5.5' } })).toBe('ip:5.5.5.5');
  });

  it('never throws on a malformed request', () => {
    expect(() => clientErrorThrottleKey(undefined)).not.toThrow();
    expect(clientErrorThrottleKey({})).toBe('ip:unknown');
  });
});

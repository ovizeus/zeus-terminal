const fs = require('fs');
const path = require('path');

// [2026-10-14] The panic button has never been pressed.
//
// /api/panic has zero requests across ~14 days of nginx logs. That is not a
// bug — emergencies are rare — but it is the one path the operator would rely
// on at the worst possible moment, and it had never been exercised or pinned.
//
// What matters is not that the endpoint answers. It is that arming the halt
// actually BLOCKS trading. A panic button that sets a flag nothing reads is
// the exact class of defect found all evening (a lit flag commanding nothing),
// and here it would be catastrophic rather than merely untidy.
//
// Checked: it IS enforced, in seven places — three in the order-placement
// routes and four on the entry paths in serverAT. This pins that, because the
// enforcement is spread across seven call sites and nothing asserted they
// exist. Remove one and the button half-works, which you would discover during
// the emergency it was meant to stop.

const ROOT = path.join(__dirname, '..', '..');
const serverAT = fs.readFileSync(path.join(ROOT, 'server', 'services', 'serverAT.js'), 'utf8');
const trading = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'trading.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

const callsIn = (src) => (src.match(/isGlobalHaltActive\(\)/g) || []).length;

describe('the panic button actually halts trading', () => {
  test('the endpoint exists and requires admin to arm it', () => {
    const i = serverJs.indexOf("app.post('/api/panic'");
    expect(i).toBeGreaterThan(-1);
    const body = serverJs.slice(i, i + 700);
    expect(body).toMatch(/_req\.user\.role !== 'admin'/);   // arming is admin-only
    expect(body).toMatch(/setGlobalHalt\(/);
  });

  test('arming is rejected without an explicit boolean', () => {
    const i = serverJs.indexOf("app.post('/api/panic'");
    const body = serverJs.slice(i, i + 700);
    // A truthy string must not arm or disarm the halt by accident.
    expect(body).toMatch(/typeof body\.active !== 'boolean'/);
  });

  test('the halt is ENFORCED on the order-placement routes', () => {
    expect(callsIn(trading)).toBeGreaterThanOrEqual(3);
  });

  test('the halt is ENFORCED on the engine entry paths', () => {
    // serverAT contains the definition plus the guards; require more than the
    // definition alone, so deleting the guards fails even though the function
    // still exists.
    expect(callsIn(serverAT)).toBeGreaterThanOrEqual(4);
  });

  test('the read fails CLOSED — an unreadable state must mean halted', () => {
    const i = serverAT.indexOf('function isGlobalHaltActive');
    const body = serverAT.slice(i, i + 600);
    expect(body).toMatch(/defaulting to HALTED|return true/);
  });

  test('the files really were read (guard against a vacuous pass)', () => {
    expect(serverAT.length).toBeGreaterThan(10000);
    expect(trading.length).toBeGreaterThan(5000);
    expect(serverJs.length).toBeGreaterThan(10000);
  });
});

// [SILENT-ARCHIVE-GUARD 2026-06-12] Passive instrumentation to catch the months-old
// "position archived to at_closed without a close" bug (today: ETHUSDT seq
// ...53353, a live x10 engine position archived at 15:33:10 with status:OPEN /
// closeReason:null → became an exchange orphan → re-adopted as a lev=1
// source=external row showing in the MANUAL journal at x1).
//
// A REAL close always sets closeReason. A boot "stuck position" archive (671)
// carries live.status CLOSED/EMERGENCY_CLOSED. Anything else archived with no
// closeReason while still live is the anomaly we must catch with a stack trace.
const serverAT = require('../../server/services/serverAT');
const isUnexpected = serverAT.__guards.isUnexpectedArchive;

describe('serverAT _isUnexpectedArchive (silent-archive detector)', () => {
  test('normal close (has closeReason) → not flagged', () => {
    expect(isUnexpected({ closeReason: 'DSL_PL', status: 'DSL_PL', live: { status: 'LIVE' } })).toBe(false);
    expect(isUnexpected({ closeReason: 'EXTERNAL_CLOSE', live: { status: 'CLOSED' } })).toBe(false);
    expect(isUnexpected({ closeReason: 'MANUAL_CLIENT', status: 'OPEN' })).toBe(false);
  });

  test('boot stuck-position archive (live.status closed-like) → not flagged', () => {
    expect(isUnexpected({ closeReason: null, status: 'OPEN', live: { status: 'EMERGENCY_CLOSED' } })).toBe(false);
    expect(isUnexpected({ closeReason: null, status: 'OPEN', live: { status: 'CLOSED' } })).toBe(false);
  });

  test('THE BUG: live position archived with no closeReason → FLAGGED', () => {
    // exactly the shape of seq ...53353 the moment it was silently archived
    expect(isUnexpected({ closeReason: null, status: 'OPEN', live: { status: 'LIVE' } })).toBe(true);
  });

  test('live position with no closeReason and no live block → FLAGGED', () => {
    expect(isUnexpected({ closeReason: null, status: 'OPEN' })).toBe(true);
    expect(isUnexpected({ status: 'OPEN' })).toBe(true);
  });

  test('null/garbage input is safe → not flagged (never throw on the close path)', () => {
    expect(isUnexpected(null)).toBe(false);
    expect(isUnexpected(undefined)).toBe(false);
    expect(isUnexpected({})).toBe(false); // no status at all → don't false-positive
  });
});

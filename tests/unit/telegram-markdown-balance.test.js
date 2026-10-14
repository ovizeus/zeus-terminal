const telegram = require('../../server/services/telegram');

// [2026-10-14] ~500 Telegram sends failed over three days:
//
//   "Bad Request: can't parse entities: Can't find end of the entity
//    starting at byte offset 209"      209 on 10-12, 86 on 10-13, 212 on 10-14
//
// parse_mode='Markdown' treats _ * and ` as entity delimiters. Machine strings
// interpolated into alert templates are full of them — DEAD_MAN_SWITCH,
// LIVE_NO_SL, exitType values like SMART_CUT, and anything inside err.message.
// An ODD number of a delimiter opens an entity that never closes, and Telegram
// rejects the whole message.
//
// This exact bug was found and fixed ONCE before, at serverAT.js:380 on
// 2026-10-07, where the comment records "149x in a single day, each costing the
// 2s plain-text retry". The fix was applied at that one call site. Twenty-five
// other templates still interpolate unescaped dynamic values, so the class came
// straight back.
//
// Rather than edit 25 call sites in the money-path file, the delimiter balance
// is repaired at the boundary: if a delimiter appears an odd number of times it
// is escaped THROUGHOUT, and balanced formatting is left exactly as written. So
// intentional *bold* survives, and a stray underscore no longer costs a failed
// send plus a 2s serialized-queue delay.
//
// No alert was ever lost — _sendWithRetry falls back to plain text — but the
// queue is serialized, so ~212 failures a day is ~7 minutes a day of added
// delay in front of whatever alert comes next.

const balance = telegram._balanceMarkdown;

describe('markdown delimiters are balanced before sending', () => {
  // NOTE, learned by getting this test wrong first: DEAD_MAN_SWITCH has TWO
  // underscores. That is an even count, so Telegram parses it happily and
  // renders MAN in italics. Ugly, but it SENDS. Only an ODD count leaves an
  // entity open and triggers the 400. So the send-failure fix lives here, and
  // the cosmetic fix (machine strings rendering as italics) belongs at the call
  // site via escapeMarkdown, which is what serverAT.js:380 already does.
  test('an ODD number of underscores — the shape that actually fails — is neutralised', () => {
    const out = balance('Reason: DEAD_MAN_SWITCH:brain_stale');
    expect(out).not.toMatch(/(?<!\\)_/);
    expect(out).toContain('DEAD\\_MAN\\_SWITCH');
  });

  test('an EVEN count is left alone because Telegram accepts it', () => {
    const t = 'Reason: DEAD_MAN_SWITCH';
    expect(balance(t)).toBe(t);
  });

  test('intentional bold is left alone when it is balanced', () => {
    const t = '🚨 *GLOBAL HALT ARMED*\nAll new entries blocked.';
    expect(balance(t)).toBe(t);
  });

  test('balanced backticks are left alone', () => {
    const t = 'Entry `BTCUSDT` at `$84000`';
    expect(balance(t)).toBe(t);
  });

  test('an odd backtick is escaped so the message still sends', () => {
    expect(balance('price is `84000')).toBe('price is \\`84000');
  });

  test('the real failing shape: bold template plus an ODD-underscore identifier', () => {
    // LIVE_NO_SL alone is even; add the err.message that the template also
    // interpolates and the count goes odd — which is exactly how these alerts
    // reach Telegram in production.
    const out = balance('🚨 *Watchdog: SL Repair Failed*\nLIVE_NO_SL\nError: order_rejected');
    expect(out).toContain('*Watchdog: SL Repair Failed*');   // bold preserved
    expect(out).toContain('LIVE\\_NO\\_SL');                   // identifier neutralised
    expect(out).not.toMatch(/(?<!\\)_/);
  });

  test('an even number of underscores is left alone — it is valid italics', () => {
    const t = 'this is _emphasised_ text';
    expect(balance(t)).toBe(t);
  });

  test('already-escaped delimiters are not counted or double-escaped', () => {
    const t = 'already \\_escaped\\_ here';
    expect(balance(t)).toBe(t);
  });

  test('handles null and undefined without throwing', () => {
    expect(balance(null)).toBe('');
    expect(balance(undefined)).toBe('');
  });

  test('a realistic error message with several underscores', () => {
    const out = balance('Error: UNIQUE constraint failed: emergency_close_queue.decision_key');
    // three underscores is odd -> all escaped
    expect(out).not.toMatch(/(?<!\\)_/);
  });

  test('mixed: odd underscore, balanced bold, odd backtick', () => {
    const out = balance('*OK* a_b `c');
    expect(out).toContain('*OK*');
    expect(out).toContain('a\\_b');
    expect(out).toContain('\\`c');
  });
});

// A balancer nothing calls is the same bug as the escaper nothing called. These
// assert the WIRING: that the first Markdown attempt carries the repaired text,
// and that the plain-text fallback carries the original.
describe('the balancer is actually applied on the send path', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', '..', 'server', 'services', 'telegram.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function _sendWithRetry'));
  const body = fn.slice(0, fn.indexOf('\n}'));

  test('the Markdown attempt sends the balanced text', () => {
    expect(body).toMatch(/_balanceMarkdown\(text\)/);
    expect(body).toMatch(/_enqueueSend\(token, chatId, body, pm\)/);
  });

  test('the plain-text fallback sends the ORIGINAL text, not the escaped one', () => {
    // With no parse_mode the backslashes would be shown literally.
    expect(body).toMatch(/_enqueueSend\(token, chatId, text, null\)/);
  });

  test('a non-Markdown parse mode is passed through untouched', () => {
    expect(body).toMatch(/pm === 'Markdown'\s*\)\s*\?\s*_balanceMarkdown\(text\)\s*:\s*text/);
  });
});

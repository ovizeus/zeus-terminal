'use strict';

/**
 * redactPipeline.test.js — 54 TDD tests for Sub-C.1 Task 2
 *
 * Breakdown:
 *  - 15 base regex tests (Group A)
 *  - 20 parametrized mode divergence tests (Group B: 10 cases × 2 modes)
 *  - 10 helper tests (Group C: blacklist, allowlist, validation, edge cases)
 *  - 5 _internals direct tests (Luhn + BIP39 helpers)
 *  - 4 ±50 char proximity window enforcement tests
 *
 * Final count after two fix passes (032b350 → 32e0305 → aa385ae) + RE_JWT lastIndex fix.
 */

const { redactPipeline, _internals } = require('../../server/services/ml/_voice/redactPipeline');

// ─────────────────────────────────────────────────────────
// Group A: Base regex tests (15)
// ─────────────────────────────────────────────────────────

describe('Group A — Base regex patterns', () => {
    // A-1: Hex64 in proximity to "private"
    test('A-1: redacts 64-char hex when proximity keyword "private" is nearby', () => {
        const text = 'private key: aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';
        const { redactedText, redactionCount, redactionTypes } = redactPipeline.redact(text, { mode: 'input' });
        expect(redactionCount).toBeGreaterThan(0);
        expect(redactedText).not.toContain('aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899');
        expect(redactionTypes.length).toBeGreaterThan(0);
    });

    // A-2: ETH 0x address in proximity to "wallet"
    test('A-2: redacts 0x ETH address (40-char hex) when proximity keyword "wallet" is nearby', () => {
        const text = 'wallet: 0xAbCdEf1234567890AbCdEf1234567890AbCdEf12';
        const { redactedText, redactionCount } = redactPipeline.redact(text, { mode: 'input' });
        expect(redactionCount).toBeGreaterThan(0);
        expect(redactedText).not.toContain('0xAbCdEf1234567890AbCdEf1234567890AbCdEf12');
    });

    // A-3: Standalone 64-char hex (TX hash) — NO redact
    test('A-3: does NOT redact 64-char hex without proximity keyword (TX hash standalone)', () => {
        const text = 'Transaction hash: aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';
        const { redactionCount } = redactPipeline.redact(text, { mode: 'input' });
        expect(redactionCount).toBe(0);
    });

    // A-4: Standalone 0x address — NO redact (public donation addr)
    test('A-4: does NOT redact 0x ETH address without proximity keyword (public donation addr)', () => {
        const text = 'Donate to: 0xAbCdEf1234567890AbCdEf1234567890AbCdEf12';
        const { redactionCount } = redactPipeline.redact(text, { mode: 'input' });
        expect(redactionCount).toBe(0);
    });

    // A-5: JWT 3-part token — REDACT
    test('A-5: redacts JWT 3-part token', () => {
        const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
        const text = `Authorization: Bearer ${jwt}`;
        const { redactedText, redactionCount } = redactPipeline.redact(text, { mode: 'input' });
        expect(redactionCount).toBeGreaterThan(0);
        expect(redactedText).not.toContain(jwt);
    });

    // A-6: Normal text with dots — NO redact (example.com.au)
    test('A-6: does NOT redact normal text with dots (example.com.au)', () => {
        const text = 'Visit our website at example.com.au for more info';
        const { redactionCount } = redactPipeline.redact(text, { mode: 'input' });
        expect(redactionCount).toBe(0);
    });

    // A-7: Luhn-valid credit card — REDACT
    test('A-7: redacts Luhn-valid credit card number 4532015112830366', () => {
        const text = 'Card number 4532015112830366 for payment';
        const { redactedText, redactionCount } = redactPipeline.redact(text, { mode: 'input' });
        expect(redactionCount).toBeGreaterThan(0);
        expect(redactedText).not.toContain('4532015112830366');
    });

    // A-8: Luhn-invalid 16-digit number — NO redact
    test('A-8: does NOT redact Luhn-invalid 16-digit number (1234567890123456)', () => {
        const text = 'Number 1234567890123456 is not a credit card';
        const { redactionCount } = redactPipeline.redact(text, { mode: 'input' });
        expect(redactionCount).toBe(0);
    });

    // A-9: password=value pattern — REDACT
    test('A-9: redacts password=value pattern', () => {
        const text = 'config: password=hunter2 for login';
        const { redactedText, redactionCount } = redactPipeline.redact(text, { mode: 'input' });
        expect(redactionCount).toBeGreaterThan(0);
        expect(redactedText).not.toContain('hunter2');
    });

    // A-10: Stripe key pattern — REDACT
    test('A-10: redacts Stripe key pattern sk_live_... with 20+ chars', () => {
        const text = 'Stripe key: sk_live_abc123def456ghi789jkl012mno345pqr678';
        const { redactedText, redactionCount } = redactPipeline.redact(text, { mode: 'input' });
        expect(redactionCount).toBeGreaterThan(0);
        expect(redactedText).not.toContain('sk_live_abc123def456ghi789jkl012mno345pqr678');
    });

    // A-11: BIP39 12-word sequence — REDACT
    test('A-11: redacts BIP39 12-word sequence (abandon ability able about above absent absorb abstract absurd abuse access accident)', () => {
        const seed = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
        const text = `My seed phrase is: ${seed}`;
        const { redactedText, redactionCount } = redactPipeline.redact(text, { mode: 'input' });
        expect(redactionCount).toBeGreaterThan(0);
        // At minimum should not contain the full seed
        expect(redactedText).not.toContain(seed);
    });

    // A-12: BIP39 words with non-BIP39 word intercalated — NO redact
    test('A-12: does NOT redact BIP39 words with non-BIP39 word intercalated (cucumber)', () => {
        const text = 'abandon ability cucumber able about above absent absorb abstract absurd abuse access accident';
        const { redactionCount } = redactPipeline.redact(text, { mode: 'input' });
        expect(redactionCount).toBe(0);
    });

    // A-13: Preserves surrounding context after multi-substring redact
    test('A-13: preserves surrounding context text after redaction', () => {
        const text = 'Before: password=secret123 and after this there is more text to keep intact.';
        const { redactedText } = redactPipeline.redact(text, { mode: 'input' });
        expect(redactedText).toContain('Before:');
        expect(redactedText).toContain('and after this there is more text to keep intact.');
    });

    // A-14: Empty string returns 0 redactions
    test('A-14: returns 0 redactions on empty string', () => {
        const { redactionCount, redactionTypes } = redactPipeline.redact('', { mode: 'input' });
        expect(redactionCount).toBe(0);
        expect(redactionTypes).toEqual([]);
    });

    // A-15: Short safe text returns 0 redactions
    test('A-15: returns 0 redactions on short safe text ("salut, ce mai faci?")', () => {
        const { redactionCount } = redactPipeline.redact('salut, ce mai faci?', { mode: 'input' });
        expect(redactionCount).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────
// Group B: Mode divergence parametrized tests (10)
// FP cases: input=REDACT, reply=ALLOW
// LEAK cases: input=REDACT, reply=REDACT
// ─────────────────────────────────────────────────────────

describe('Group B — Mode divergence: FP cases (input=REDACT, reply=ALLOW)', () => {
    // FP-1: "cheia" proximity keyword only (Romanian)
    test('B-FP-1 input: redacts "folosesc cheia bună pentru orice" in mode=input', () => {
        const text = 'folosesc cheia bună pentru orice';
        const { redactionCount } = redactPipeline.redact(text, { mode: 'input' });
        expect(redactionCount).toBeGreaterThan(0);
    });

    test('B-FP-1 reply: ALLOWS "folosesc cheia bună pentru orice" in mode=reply', () => {
        const text = 'folosesc cheia bună pentru orice';
        const { redactionCount } = redactPipeline.redact(text, { mode: 'reply' });
        expect(redactionCount).toBe(0);
    });

    // FP-2: "secret" keyword in innocent context
    test('B-FP-2 input: redacts "my secret recipe is delicious" in mode=input', () => {
        const text = 'my secret recipe is delicious';
        const { redactionCount } = redactPipeline.redact(text, { mode: 'input' });
        expect(redactionCount).toBeGreaterThan(0);
    });

    test('B-FP-2 reply: ALLOWS "my secret recipe is delicious" in mode=reply', () => {
        const text = 'my secret recipe is delicious';
        const { redactionCount } = redactPipeline.redact(text, { mode: 'reply' });
        expect(redactionCount).toBe(0);
    });

    // FP-3: "parola" keyword but no value
    test('B-FP-3 input: redacts "parola contului meu Steam s-a schimbat" in mode=input', () => {
        const text = 'parola contului meu Steam s-a schimbat';
        const { redactionCount } = redactPipeline.redact(text, { mode: 'input' });
        expect(redactionCount).toBeGreaterThan(0);
    });

    test('B-FP-3 reply: ALLOWS "parola contului meu Steam s-a schimbat" in mode=reply', () => {
        const text = 'parola contului meu Steam s-a schimbat';
        const { redactionCount } = redactPipeline.redact(text, { mode: 'reply' });
        expect(redactionCount).toBe(0);
    });

    // FP-4: "password" word in sentence without value
    test('B-FP-4 input: redacts "the password word in this sentence is just a word" in mode=input', () => {
        const text = 'the password word in this sentence is just a word';
        const { redactionCount } = redactPipeline.redact(text, { mode: 'input' });
        expect(redactionCount).toBeGreaterThan(0);
    });

    test('B-FP-4 reply: ALLOWS "the password word in this sentence is just a word" in mode=reply', () => {
        const text = 'the password word in this sentence is just a word';
        const { redactionCount } = redactPipeline.redact(text, { mode: 'reply' });
        expect(redactionCount).toBe(0);
    });

    // FP-5: "jwt" mentioned without actual token
    test('B-FP-5 input: redacts "jwt is good for stateless authentication" in mode=input', () => {
        const text = 'jwt is good for stateless authentication';
        const { redactionCount } = redactPipeline.redact(text, { mode: 'input' });
        expect(redactionCount).toBeGreaterThan(0);
    });

    test('B-FP-5 reply: ALLOWS "jwt is good for stateless authentication" in mode=reply', () => {
        const text = 'jwt is good for stateless authentication';
        const { redactionCount } = redactPipeline.redact(text, { mode: 'reply' });
        expect(redactionCount).toBe(0);
    });
});

describe('Group B — Mode divergence: LEAK cases (input=REDACT, reply=REDACT)', () => {
    // LEAK-1: 64-char hex with "private key:" prefix
    test('B-LEAK-1 input: redacts 64-char hex with "private key:" in mode=input', () => {
        const text = 'private key: aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';
        const { redactionCount } = redactPipeline.redact(text, { mode: 'input' });
        expect(redactionCount).toBeGreaterThan(0);
    });

    test('B-LEAK-1 reply: ALSO redacts 64-char hex with "private key:" in mode=reply', () => {
        const text = 'private key: aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';
        const { redactionCount } = redactPipeline.redact(text, { mode: 'reply' });
        expect(redactionCount).toBeGreaterThan(0);
    });

    // LEAK-2: 12-word BIP39 seed phrase
    test('B-LEAK-2 input: redacts 12-word BIP39 seed in mode=input', () => {
        const seed = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
        const { redactionCount } = redactPipeline.redact(seed, { mode: 'input' });
        expect(redactionCount).toBeGreaterThan(0);
    });

    test('B-LEAK-2 reply: ALSO redacts 12-word BIP39 seed in mode=reply', () => {
        const seed = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
        const { redactionCount } = redactPipeline.redact(seed, { mode: 'reply' });
        expect(redactionCount).toBeGreaterThan(0);
    });

    // LEAK-3: password=hunter2 in config context
    test('B-LEAK-3 input: redacts password=hunter2 in mode=input', () => {
        const text = 'password=hunter2 used in config';
        const { redactionCount } = redactPipeline.redact(text, { mode: 'input' });
        expect(redactionCount).toBeGreaterThan(0);
    });

    test('B-LEAK-3 reply: ALSO redacts password=hunter2 in mode=reply', () => {
        const text = 'password=hunter2 used in config';
        const { redactionCount } = redactPipeline.redact(text, { mode: 'reply' });
        expect(redactionCount).toBeGreaterThan(0);
    });

    // LEAK-4: Stripe key
    test('B-LEAK-4 input: redacts Stripe key sk_live_abc123def456ghi789jkl012mno345pqr678 in mode=input', () => {
        const text = 'sk_live_abc123def456ghi789jkl012mno345pqr678';
        const { redactionCount } = redactPipeline.redact(text, { mode: 'input' });
        expect(redactionCount).toBeGreaterThan(0);
    });

    test('B-LEAK-4 reply: ALSO redacts Stripe key in mode=reply', () => {
        const text = 'sk_live_abc123def456ghi789jkl012mno345pqr678';
        const { redactionCount } = redactPipeline.redact(text, { mode: 'reply' });
        expect(redactionCount).toBeGreaterThan(0);
    });

    // LEAK-5: Full JWT 3-part with dots
    test('B-LEAK-5 input: redacts full JWT 3-part token in mode=input', () => {
        const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
        const { redactionCount } = redactPipeline.redact(jwt, { mode: 'input' });
        expect(redactionCount).toBeGreaterThan(0);
    });

    test('B-LEAK-5 reply: ALSO redacts full JWT 3-part token in mode=reply', () => {
        const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
        const { redactionCount } = redactPipeline.redact(jwt, { mode: 'reply' });
        expect(redactionCount).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────
// Group C: Helper tests + edge cases (10 test() calls for ~5 helper topics)
// ─────────────────────────────────────────────────────────

describe('Group C — Helper functions and edge cases', () => {
    // C-1: isFactKeyBlacklisted rejects "password"
    test('C-1: isFactKeyBlacklisted rejects "password"', () => {
        expect(redactPipeline.isFactKeyBlacklisted('password')).toBe(true);
    });

    // C-2: isFactKeyBlacklisted rejects "api_key_binance" (contains "key")
    test('C-2: isFactKeyBlacklisted rejects "api_key_binance"', () => {
        expect(redactPipeline.isFactKeyBlacklisted('api_key_binance')).toBe(true);
    });

    // C-3: isFactKeyBlacklisted ALLOWS "trading_token_preference" (allowlist exception)
    test('C-3: isFactKeyBlacklisted ALLOWS "trading_token_preference" (allowlist exception)', () => {
        expect(redactPipeline.isFactKeyBlacklisted('trading_token_preference')).toBe(false);
    });

    // C-4: isFactKeyBlacklisted ALLOWS "location"
    test('C-4: isFactKeyBlacklisted ALLOWS "location"', () => {
        expect(redactPipeline.isFactKeyBlacklisted('location')).toBe(false);
    });

    // C-5: isClassKeyAllowed('identity', 'favorite_color') returns false
    test('C-5: isClassKeyAllowed("identity", "favorite_color") returns false', () => {
        expect(redactPipeline.isClassKeyAllowed('identity', 'favorite_color')).toBe(false);
    });

    // C-6: isClassKeyAllowed('identity', 'name') returns true
    test('C-6: isClassKeyAllowed("identity", "name") returns true', () => {
        expect(redactPipeline.isClassKeyAllowed('identity', 'name')).toBe(true);
    });

    // C-7: isClassKeyAllowed('trading_strategy', open vocab key) returns true
    test('C-7: isClassKeyAllowed("trading_strategy", "preferred_rsi_threshold") returns true (open vocab)', () => {
        expect(redactPipeline.isClassKeyAllowed('trading_strategy', 'preferred_rsi_threshold')).toBe(true);
    });

    // C-8: validateFactValue rejects BIP39 seed phrase
    test('C-8: validateFactValue rejects BIP39 seed value', () => {
        const seed = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
        const { ok } = redactPipeline.validateFactValue(seed, 'personal_context');
        expect(ok).toBe(false);
    });

    // C-9: validateFactValue rejects Luhn-valid credit card
    test('C-9: validateFactValue rejects Luhn-valid credit card number', () => {
        const { ok } = redactPipeline.validateFactValue('4532015112830366', 'trading_strategy');
        expect(ok).toBe(false);
    });

    // C-10: validateFactValue allows clean value
    test('C-10: validateFactValue allows clean value ("Romania")', () => {
        const { ok } = redactPipeline.validateFactValue('Romania', 'personal_context');
        expect(ok).toBe(true);
    });

    // C-11: RE_JWT lastIndex reset — repeated calls must all detect JWT (regression)
    test('C-11: validateFactValue: JWT detection works on repeated calls (RE_JWT lastIndex reset)', () => {
        const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpM';
        expect(redactPipeline.validateFactValue(jwt, 'temporary').ok).toBe(false);
        expect(redactPipeline.validateFactValue(jwt, 'temporary').ok).toBe(false); // would fail without lastIndex reset
        expect(redactPipeline.validateFactValue(jwt, 'temporary').ok).toBe(false); // third call
    });
});

// ─────────────────────────────────────────────────────────
// _internals: direct tests for Luhn and BIP39 helpers
// ─────────────────────────────────────────────────────────

describe('_internals — Luhn and BIP39 direct tests', () => {
    test('_luhnCheck returns true for known Luhn-valid card 4532015112830366', () => {
        expect(_internals._luhnCheck('4532015112830366')).toBe(true);
    });

    test('_luhnCheck returns false for 1234567890123456 (invalid)', () => {
        expect(_internals._luhnCheck('1234567890123456')).toBe(false);
    });

    test('_bip39Sequence detects 12-word seed phrase', () => {
        const seed = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
        expect(_internals._bip39Sequence(seed)).toBe(true);
    });

    test('_bip39Sequence returns false when non-BIP39 word intercalated', () => {
        const text = 'abandon ability cucumber able about above absent absorb abstract absurd abuse access accident';
        expect(_internals._bip39Sequence(text)).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────
// ±50 char proximity window enforcement (regression tests)
// Locks in the per-match window check introduced in T2 review fix.
// ─────────────────────────────────────────────────────────

describe('±50 char proximity window enforcement', () => {
    test('hex64 is NOT redacted when keyword is >50 chars away (hex preserved in text)', () => {
        // Keyword at position 0, hex at position 100+ (separation > 50 chars)
        // The hex value itself should NOT be replaced, but bare keyword fallback may fire
        const padding = 'x'.repeat(80); // 80 char buffer
        const text = `the private things ${padding} a3b1c2d4e5f607890abcdef1234567890123456789abcdef0123456789abcdef`;
        const result = redactPipeline.redact(text, { mode: 'input' });
        // Hex value is preserved (not replaced with [REDACTED:hex64_private])
        expect(result.redactedText).toContain('a3b1c2d4e5f607890abcdef1234567890123456789abcdef0123456789abcdef');
        expect(result.redactionTypes).not.toContain('hex64_private');
    });

    test('bare keyword fallback fires (input mode high-recall) even when hex exists out of range', () => {
        // Spec §8.2: bare keyword is a high-recall signal in input mode — must fire
        // even when an unrelated hex exists elsewhere in text beyond proximity range
        const padding = 'x'.repeat(80); // 80 char buffer
        const text = `the private things ${padding} a3b1c2d4e5f607890abcdef1234567890123456789abcdef0123456789abcdef`;
        const result = redactPipeline.redact(text, { mode: 'input' });
        expect(result.redactionCount).toBeGreaterThan(0);
    });

    test('reply mode does NOT fire bare keyword fallback even when hex exists out of range', () => {
        // Reply mode = high-precision — no bare keyword catch-all, only exact hex matches.
        // In reply mode, a naked 64-char hex IS redacted (no proximity requirement),
        // but the bare keyword 'private' must NOT be redacted as 'proximity_keyword'.
        const padding = 'x'.repeat(80); // 80 char buffer
        const text = `the private things ${padding} a3b1c2d4e5f607890abcdef1234567890123456789abcdef0123456789abcdef`;
        const result = redactPipeline.redact(text, { mode: 'reply' });
        // Bare keyword fallback must NOT fire in reply mode
        expect(result.redactionTypes).not.toContain('proximity_keyword');
        // The bare word 'private' should be preserved (not replaced)
        expect(result.redactedText).toContain('private');
    });

    test('redacts hex64 when keyword is within 50 chars of hex', () => {
        // Keyword and hex within 30 chars of each other
        const text = 'private key here: a3b1c2d4e5f607890abcdef1234567890123456789abcdef0123456789abcdef';
        const result = redactPipeline.redact(text, { mode: 'input' });
        expect(result.redactionCount).toBeGreaterThan(0);
    });
});

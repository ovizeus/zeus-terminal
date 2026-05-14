/**
 * R0 Substrate — opsec.js tests
 *
 * Spec 244* — operational security primitives: secret redaction,
 * HMAC signing, signature validation. Used by audit trail + operator
 * approval queue + any path that handles sensitive payloads.
 */

const {
    redactSecret,
    signPayload,
    validateSignature,
    REDACTION_PLACEHOLDER
} = require('../../../server/services/ml/R0_substrate/opsec');

describe('R0 Substrate — opsec', () => {
    describe('redactSecret', () => {
        test('replaces API key patterns', () => {
            const text = 'apiKey=ABCD1234EFGH5678IJKL9012MNOP3456';
            const out = redactSecret(text);
            expect(out).not.toContain('ABCD1234EFGH');
            expect(out).toContain(REDACTION_PLACEHOLDER);
        });

        test('redacts Bearer tokens', () => {
            const text = 'Authorization: Bearer abc.def.ghi_someTokenStringExample';
            const out = redactSecret(text);
            expect(out).not.toContain('abc.def.ghi');
            expect(out).toContain(REDACTION_PLACEHOLDER);
        });

        test('redacts long hex strings (signatures)', () => {
            const text = 'signature=a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8';
            const out = redactSecret(text);
            expect(out).not.toContain('a1b2c3d4e5f6a7b8');
        });

        test('preserves non-secret text', () => {
            const text = 'symbol=BTCUSDT side=BUY qty=0.01';
            expect(redactSecret(text)).toBe(text);
        });

        test('throws on non-string input', () => {
            expect(() => redactSecret(42)).toThrow(/string/i);
        });
    });

    describe('signPayload', () => {
        test('returns a string signature', () => {
            const sig = signPayload({ symbol: 'BTC' }, 'secret_key_omega_test');
            expect(typeof sig).toBe('string');
            expect(sig.length).toBeGreaterThan(10);
        });

        test('same input + key produces same signature', () => {
            const sig1 = signPayload({ a: 1 }, 'k');
            const sig2 = signPayload({ a: 1 }, 'k');
            expect(sig1).toBe(sig2);
        });

        test('different keys produce different signatures', () => {
            const sig1 = signPayload({ a: 1 }, 'k1');
            const sig2 = signPayload({ a: 1 }, 'k2');
            expect(sig1).not.toBe(sig2);
        });

        test('different payloads produce different signatures', () => {
            const sig1 = signPayload({ a: 1 }, 'k');
            const sig2 = signPayload({ a: 2 }, 'k');
            expect(sig1).not.toBe(sig2);
        });

        test('throws on empty secret', () => {
            expect(() => signPayload({}, '')).toThrow(/secret/i);
        });
    });

    describe('validateSignature', () => {
        test('returns true for valid signature', () => {
            const payload = { msg: 'omega' };
            const sig = signPayload(payload, 'secret');
            expect(validateSignature(payload, sig, 'secret')).toBe(true);
        });

        test('returns false for tampered payload', () => {
            const sig = signPayload({ msg: 'omega' }, 'secret');
            expect(validateSignature({ msg: 'tampered' }, sig, 'secret')).toBe(false);
        });

        test('returns false for wrong secret', () => {
            const sig = signPayload({ msg: 'omega' }, 'secret1');
            expect(validateSignature({ msg: 'omega' }, sig, 'secret2')).toBe(false);
        });

        test('returns false for malformed signature', () => {
            expect(validateSignature({}, 'not_a_real_sig', 'secret')).toBe(false);
        });
    });
});

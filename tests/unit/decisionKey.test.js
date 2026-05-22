'use strict';

const dk = require('../../server/services/decisionKey');

describe('decisionKey', () => {
    describe('REGEX', () => {
        it('accepts alphanumeric + _ + - up to 36 chars', () => {
            expect(dk.REGEX.test('abc_123-XYZ')).toBe(true);
            expect(dk.REGEX.test('a')).toBe(true);
            expect(dk.REGEX.test('a'.repeat(36))).toBe(true);
        });

        it('rejects forbidden chars (. : / spaces)', () => {
            expect(dk.REGEX.test('abc.def')).toBe(false);
            expect(dk.REGEX.test('abc:def')).toBe(false);
            expect(dk.REGEX.test('abc/def')).toBe(false);
            expect(dk.REGEX.test('abc def')).toBe(false);
            expect(dk.REGEX.test('abc!def')).toBe(false);
        });

        it('rejects >36 chars', () => {
            expect(dk.REGEX.test('a'.repeat(37))).toBe(false);
            expect(dk.REGEX.test('a'.repeat(100))).toBe(false);
        });

        it('rejects empty string', () => {
            expect(dk.REGEX.test('')).toBe(false);
        });
    });

    describe('validate()', () => {
        it('returns true for valid key', () => {
            expect(dk.validate('valid_key')).toBe(true);
            expect(dk.validate('a-b-c-1-2-3')).toBe(true);
        });

        it('returns false for invalid key', () => {
            expect(dk.validate('invalid.key')).toBe(false);
            expect(dk.validate('')).toBe(false);
            expect(dk.validate('a'.repeat(37))).toBe(false);
        });

        it('returns false for non-string input', () => {
            expect(dk.validate(null)).toBe(false);
            expect(dk.validate(undefined)).toBe(false);
            expect(dk.validate(123)).toBe(false);
            expect(dk.validate({})).toBe(false);
        });
    });

    describe('assert()', () => {
        it('throws on invalid key', () => {
            expect(() => dk.assert('invalid.key')).toThrow(/decisionKey/i);
            expect(() => dk.assert('')).toThrow(/decisionKey/i);
            expect(() => dk.assert(null)).toThrow(/decisionKey/i);
        });

        it('does not throw on valid key', () => {
            expect(() => dk.assert('valid_key')).not.toThrow();
            expect(() => dk.assert('abc-123')).not.toThrow();
        });
    });

    describe('generate()', () => {
        it('returns valid key passing REGEX', () => {
            const key = dk.generate();
            expect(dk.REGEX.test(key)).toBe(true);
            expect(key.length).toBeLessThanOrEqual(36);
            expect(key.length).toBeGreaterThan(0);
        });

        it('returns string', () => {
            expect(typeof dk.generate()).toBe('string');
        });

        it('produces unique keys (100 iterations)', () => {
            const keys = new Set();
            for (let i = 0; i < 100; i++) keys.add(dk.generate());
            expect(keys.size).toBe(100);
        });

        it('generated keys pass validate()', () => {
            for (let i = 0; i < 20; i++) {
                expect(dk.validate(dk.generate())).toBe(true);
            }
        });
    });
});

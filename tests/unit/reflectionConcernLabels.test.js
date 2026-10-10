'use strict';
// [2026-10-10] The doctor's reflection alerts all read
//   concerns: ["anti_pattern","anti_pattern"]
// which looks like the same concern listed twice. It is not: those are two
// DIFFERENT anti-patterns that both matched. The payload keeps only `type` and
// throws away `pattern`, so the one piece of information that would tell the
// operator WHICH patterns blocked his trade is the piece that gets dropped.
// 51 such alerts were logged yesterday, every one of them unreadable.

const { _concernLabels } = require('../../server/services/serverReflection');

describe('a reflection alert says which concerns fired', () => {
    test('two different anti-patterns are distinguishable', () => {
        const out = _concernLabels([
            { type: 'anti_pattern', pattern: 'late_longs_in_range' },
            { type: 'anti_pattern', pattern: 'short_into_support' },
        ]);
        expect(out).toEqual(['anti_pattern:late_longs_in_range', 'anti_pattern:short_into_support']);
        expect(new Set(out).size).toBe(2);
    });

    test('a concern with no pattern still reports its type', () => {
        expect(_concernLabels([{ type: 'rule_block' }])).toEqual(['rule_block']);
    });

    test('rubbish in the list does not break the alert', () => {
        expect(_concernLabels([null, undefined, { pattern: 'x' }])).toEqual([]);
    });

    test('an empty list is empty, not a crash', () => {
        expect(_concernLabels(null)).toEqual([]);
    });
});

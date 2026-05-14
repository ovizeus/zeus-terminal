/**
 * Cross-cutting Voice Layer — stub tests
 *
 * Verifies voiceLogger facade over ml_voice_log. Powers OMEGA "voice"
 * (every utterance loggable + retrievable). Real personality generation
 * (mood resolution, template engine) lands in Wave 8 polish.
 */

const { db } = require('../../../server/services/database');
const {
    logUtterance,
    getRecent,
    UTTERANCE_TYPES,
    MOODS
} = require('../../../server/services/ml/_voice/voiceLogger');

describe('Cross-cutting Voice Layer', () => {
    const TEST_USER_ID = 99002;

    afterAll(() => {
        db.prepare(`DELETE FROM ml_voice_log WHERE user_id = ?`).run(TEST_USER_ID);
    });

    test('UTTERANCE_TYPES exposes 6 expected enum values', () => {
        expect(UTTERANCE_TYPES).toEqual(
            expect.arrayContaining(['THOUGHT', 'CHAT_REPLY', 'GREETING', 'FAREWELL', 'CRITICAL_ALERT', 'REACTION'])
        );
    });

    test('MOODS exposes 7 expected enum values', () => {
        expect(MOODS).toEqual(
            expect.arrayContaining(['CALM', 'FOCUSED', 'EXCITED', 'NERVOUS', 'ANGRY', 'SAD', 'BORED'])
        );
    });

    describe('logUtterance', () => {
        test('inserts row and returns id', () => {
            const result = logUtterance({
                userId: TEST_USER_ID,
                utteranceType: 'THOUGHT',
                mood: 'CALM',
                text: 'market boring as fuck',
                templateId: 'boring_market_v1',
                contextJson: JSON.stringify({ vol: 0.01 })
            });
            expect(typeof result.id).toBe('number');
            expect(result.id).toBeGreaterThan(0);
        });

        test('rejects invalid mood via CHECK constraint', () => {
            expect(() => logUtterance({
                userId: TEST_USER_ID,
                utteranceType: 'THOUGHT',
                mood: 'CONFUSED',
                text: 'unknown mood'
            })).toThrow(/CHECK constraint/);
        });

        test('rejects invalid utteranceType', () => {
            expect(() => logUtterance({
                userId: TEST_USER_ID,
                utteranceType: 'SHOUTING',
                mood: 'CALM',
                text: 'wrong type'
            })).toThrow(/CHECK constraint/);
        });

        test('accepts optional decision_digest linkage', () => {
            const result = logUtterance({
                userId: TEST_USER_ID,
                utteranceType: 'REACTION',
                mood: 'EXCITED',
                text: 'oh yes baby BTC going up',
                decisionDigest: 'omega_voice_digest_abc'
            });
            expect(typeof result.id).toBe('number');
        });
    });

    describe('getRecent', () => {
        test('returns recent utterances for user', () => {
            logUtterance({
                userId: TEST_USER_ID,
                utteranceType: 'GREETING',
                mood: 'FOCUSED',
                text: 'omega online boss'
            });
            const recent = getRecent({ userId: TEST_USER_ID, limit: 10 });
            expect(Array.isArray(recent)).toBe(true);
            expect(recent.length).toBeGreaterThan(0);
            expect(recent[0].user_id).toBe(TEST_USER_ID);
        });

        test('respects limit parameter', () => {
            for (let i = 0; i < 5; i++) {
                logUtterance({
                    userId: TEST_USER_ID,
                    utteranceType: 'THOUGHT',
                    mood: 'BORED',
                    text: `nothing ${i}`
                });
            }
            const recent = getRecent({ userId: TEST_USER_ID, limit: 3 });
            expect(recent.length).toBeLessThanOrEqual(3);
        });

        test('returns empty array when no rows match', () => {
            const empty = getRecent({ userId: 999_999_998, limit: 10 });
            expect(empty).toEqual([]);
        });
    });
});

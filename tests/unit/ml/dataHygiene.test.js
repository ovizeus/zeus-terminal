/**
 * R5A Learning Core — dataHygiene tests (canonical §22)
 *
 * Data integrity utilities: schema vocabulary, chronological order checks,
 * lookahead detection, chronological train/test split, timestamp alignment,
 * leakage detection in features/labels pairs.
 *
 * Pure functions, no DB. Used by Wave 3+ when feature pipeline ships, but
 * vocabulary + validators land now to prevent the most common ML bug:
 * silent lookahead leakage between labels and features.
 */

const {
    DATA_SCHEMAS,
    FORWARD_HORIZONS,
    checkChronologicalOrder,
    detectLookahead,
    chronologicalSplit,
    validateAlignedTimestamps,
    checkLeakage
} = require('../../../server/services/ml/R5A_learning/dataHygiene')

describe('R5A — dataHygiene (canonical §22)', () => {
    // ── Exported enums ─────────────────────────────────────────────
    describe('DATA_SCHEMAS', () => {
        test('has 6 spec data types', () => {
            expect(DATA_SCHEMAS).toEqual([
                'tick',
                'l2_snapshot',
                'candle',
                'funding_snapshot',
                'oi_snapshot',
                'options_context'
            ])
        })
    })

    describe('FORWARD_HORIZONS', () => {
        test('aligns with §11 horizons', () => {
            expect(FORWARD_HORIZONS).toEqual([
                'ultra-short', 'short', 'intraday', 'swing-short'
            ])
        })
    })

    // ── checkChronologicalOrder ────────────────────────────────────
    describe('checkChronologicalOrder(events)', () => {
        test('returns true for monotonic-increasing ts', () => {
            expect(checkChronologicalOrder([
                { ts: 1000 }, { ts: 2000 }, { ts: 3000 }
            ])).toBe(true)
        })

        test('returns true for empty or single-element', () => {
            expect(checkChronologicalOrder([])).toBe(true)
            expect(checkChronologicalOrder([{ ts: 1000 }])).toBe(true)
        })

        test('returns false for out-of-order events', () => {
            expect(checkChronologicalOrder([
                { ts: 1000 }, { ts: 3000 }, { ts: 2000 }
            ])).toBe(false)
        })

        test('returns true for equal ts (non-strict monotonic)', () => {
            expect(checkChronologicalOrder([
                { ts: 1000 }, { ts: 1000 }, { ts: 2000 }
            ])).toBe(true)
        })

        test('throws on non-array input', () => {
            expect(() => checkChronologicalOrder(null)).toThrow()
            expect(() => checkChronologicalOrder('bad')).toThrow()
        })

        test('throws on events missing ts field', () => {
            expect(() => checkChronologicalOrder([{ ts: 1 }, { no_ts: 2 }])).toThrow()
        })
    })

    // ── detectLookahead ────────────────────────────────────────────
    describe('detectLookahead(label_ts, feature_ts, horizon_ms)', () => {
        test('returns false when label_ts >= feature_ts + horizon_ms (safe)', () => {
            // label at t+horizon comes AFTER features at t — safe
            expect(detectLookahead(2000, 1000, 1000)).toBe(false)
            expect(detectLookahead(5000, 1000, 1000)).toBe(false)
        })

        test('returns true when label_ts < feature_ts + horizon_ms (leakage)', () => {
            // label inside the future window observed by features = leakage
            expect(detectLookahead(1500, 1000, 1000)).toBe(true)
            expect(detectLookahead(500, 1000, 1000)).toBe(true)
        })

        test('returns true when label_ts == feature_ts (zero horizon)', () => {
            expect(detectLookahead(1000, 1000, 1000)).toBe(true)
        })

        test('throws on invalid inputs', () => {
            expect(() => detectLookahead('bad', 1000, 100)).toThrow()
            expect(() => detectLookahead(1000, 'bad', 100)).toThrow()
            expect(() => detectLookahead(1000, 500, -100)).toThrow()
        })
    })

    // ── chronologicalSplit ─────────────────────────────────────────
    describe('chronologicalSplit(events, cutoff_ts)', () => {
        test('splits events into train (before cutoff) and test (at/after cutoff)', () => {
            const events = [
                { ts: 1000, v: 'a' }, { ts: 2000, v: 'b' },
                { ts: 3000, v: 'c' }, { ts: 4000, v: 'd' }
            ]
            const split = chronologicalSplit(events, 3000)
            expect(split.train).toEqual([
                { ts: 1000, v: 'a' }, { ts: 2000, v: 'b' }
            ])
            expect(split.test).toEqual([
                { ts: 3000, v: 'c' }, { ts: 4000, v: 'd' }
            ])
        })

        test('preserves order, no shuffle', () => {
            const events = [{ ts: 1 }, { ts: 2 }, { ts: 3 }, { ts: 4 }]
            const split = chronologicalSplit(events, 3)
            expect(split.train).toEqual([{ ts: 1 }, { ts: 2 }])
            expect(split.test).toEqual([{ ts: 3 }, { ts: 4 }])
        })

        test('handles empty input', () => {
            expect(chronologicalSplit([], 1000)).toEqual({ train: [], test: [] })
        })

        test('throws on unsorted input (requires pre-sorted)', () => {
            expect(() => chronologicalSplit(
                [{ ts: 3 }, { ts: 1 }, { ts: 2 }], 2
            )).toThrow(/chronological|order/i)
        })
    })

    // ── validateAlignedTimestamps ──────────────────────────────────
    describe('validateAlignedTimestamps(records, tickMs)', () => {
        test('returns true when all timestamps align to tickMs grid', () => {
            const recs = [{ ts: 1000 }, { ts: 2000 }, { ts: 3000 }]
            expect(validateAlignedTimestamps(recs, 1000)).toBe(true)
        })

        test('returns false when any timestamp is off-grid', () => {
            const recs = [{ ts: 1000 }, { ts: 1500 }, { ts: 2000 }]
            expect(validateAlignedTimestamps(recs, 1000)).toBe(false)
        })

        test('returns true on empty array', () => {
            expect(validateAlignedTimestamps([], 1000)).toBe(true)
        })
    })

    // ── checkLeakage ───────────────────────────────────────────────
    describe('checkLeakage({features, labels})', () => {
        test('returns empty array when no leakage detected', () => {
            const features = [
                { ts: 1000, id: 'f1' }, { ts: 2000, id: 'f2' }
            ]
            const labels = [
                { ts: 3000, feature_ts: 1000, horizon_ms: 1000 },
                { ts: 4000, feature_ts: 2000, horizon_ms: 1000 }
            ]
            const leaks = checkLeakage({ features, labels })
            expect(leaks).toEqual([])
        })

        test('detects lookahead leak per label', () => {
            const features = [{ ts: 1000, id: 'f1' }]
            const labels = [
                { ts: 500, feature_ts: 1000, horizon_ms: 1000 }  // leak: label before feature
            ]
            const leaks = checkLeakage({ features, labels })
            expect(leaks.length).toBe(1)
            expect(leaks[0]).toHaveProperty('label_idx')
            expect(leaks[0]).toHaveProperty('type')
        })

        test('returns multiple leaks when multiple labels are bad', () => {
            const features = [{ ts: 1000 }, { ts: 2000 }]
            const labels = [
                { ts: 800, feature_ts: 1000, horizon_ms: 500 },   // leak
                { ts: 1800, feature_ts: 2000, horizon_ms: 500 },  // leak
                { ts: 3000, feature_ts: 2000, horizon_ms: 500 }   // ok
            ]
            const leaks = checkLeakage({ features, labels })
            expect(leaks.length).toBe(2)
        })

        test('throws on invalid input shape', () => {
            expect(() => checkLeakage(null)).toThrow()
            expect(() => checkLeakage({})).toThrow()
            expect(() => checkLeakage({ features: 'bad', labels: [] })).toThrow()
        })
    })
})

/**
 * R7 Communication — eventBus stub tests
 *
 * In-memory pub/sub for inter-ring communication. Foundation: every ring
 * publishes lifecycle events (init/shutdown/heartbeat/error) on the bus.
 * Real implementation may grow to support persistence + replay; stub here
 * is in-memory only.
 */

const {
    publish,
    subscribe,
    unsubscribe,
    topics,
    _reset
} = require('../../../server/services/ml/R7_communication/eventBus');

describe('R7 Communication — eventBus', () => {
    beforeEach(() => { _reset(); });

    describe('publish + subscribe', () => {
        test('subscriber receives published events on its topic', () => {
            const received = [];
            subscribe('ring.heartbeat', (payload) => received.push(payload));
            publish('ring.heartbeat', { ring_id: 'R0', ts: 1 });
            expect(received).toEqual([{ ring_id: 'R0', ts: 1 }]);
        });

        test('subscriber does NOT receive events on other topics', () => {
            const received = [];
            subscribe('topic.A', (p) => received.push(p));
            publish('topic.B', { v: 1 });
            expect(received).toEqual([]);
        });

        test('multiple subscribers receive the same event', () => {
            let a = 0, b = 0;
            subscribe('multi', () => a++);
            subscribe('multi', () => b++);
            publish('multi', {});
            expect(a).toBe(1);
            expect(b).toBe(1);
        });

        test('handler exceptions do not break the bus', () => {
            let goodCalled = false;
            subscribe('safe', () => { throw new Error('boom'); });
            subscribe('safe', () => { goodCalled = true; });
            expect(() => publish('safe', {})).not.toThrow();
            expect(goodCalled).toBe(true);
        });
    });

    describe('unsubscribe', () => {
        test('subscribe returns a token usable to unsubscribe', () => {
            let count = 0;
            const token = subscribe('cleanup', () => count++);
            publish('cleanup', {});
            expect(count).toBe(1);
            unsubscribe(token);
            publish('cleanup', {});
            expect(count).toBe(1);
        });

        test('unsubscribe with unknown token is a no-op (no throw)', () => {
            expect(() => unsubscribe(999999)).not.toThrow();
        });
    });

    describe('topics', () => {
        test('returns array of active topic names', () => {
            subscribe('topic1', () => {});
            subscribe('topic2', () => {});
            const t = topics();
            expect(t).toEqual(expect.arrayContaining(['topic1', 'topic2']));
        });

        test('returns empty array on fresh bus', () => {
            expect(topics()).toEqual([]);
        });
    });

    describe('validation', () => {
        test('publish throws on non-string topic', () => {
            expect(() => publish(42, {})).toThrow(/topic/i);
        });

        test('subscribe throws on non-function handler', () => {
            expect(() => subscribe('x', 'not-a-function')).toThrow(/function/i);
        });
    });
});

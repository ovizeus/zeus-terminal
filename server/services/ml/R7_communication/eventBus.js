'use strict';

/**
 * OMEGA R7 Communication — eventBus
 *
 * In-memory publish/subscribe for inter-ring communication. Decouples rings
 * so changing one ring's internals doesn't ripple through `require()` chains
 * across all consumers.
 *
 * - `subscribe(topic, handler)` — register handler, returns numeric token
 * - `unsubscribe(token)` — remove handler (idempotent)
 * - `publish(topic, payload)` — synchronously dispatch to all subscribers
 *   (handler exceptions caught + swallowed; bus must never crash on bad handlers)
 * - `topics()` — list of topics with at least one subscriber
 * - `_reset()` — test-only hook to clear all subscriptions
 *
 * Wave 1D scope: in-memory only. Persistence + replay for the event bus
 * (useful for cold-start audit reconstruction) is deferred to Wave 7 R6.
 */

let _nextToken = 1;
const _subscribers = new Map();
const _tokenIndex = new Map();

function subscribe(topic, handler) {
    if (typeof topic !== 'string' || topic.length === 0) {
        throw new Error('eventBus: topic must be a non-empty string');
    }
    if (typeof handler !== 'function') {
        throw new Error('eventBus: handler must be a function');
    }
    const token = _nextToken++;
    if (!_subscribers.has(topic)) {
        _subscribers.set(topic, new Map());
    }
    _subscribers.get(topic).set(token, handler);
    _tokenIndex.set(token, topic);
    return token;
}

function unsubscribe(token) {
    const topic = _tokenIndex.get(token);
    if (!topic) return;
    const handlers = _subscribers.get(topic);
    if (handlers) {
        handlers.delete(token);
        if (handlers.size === 0) _subscribers.delete(topic);
    }
    _tokenIndex.delete(token);
}

function publish(topic, payload) {
    if (typeof topic !== 'string' || topic.length === 0) {
        throw new Error('eventBus: topic must be a non-empty string');
    }
    const handlers = _subscribers.get(topic);
    if (!handlers) return;
    for (const handler of handlers.values()) {
        try {
            handler(payload);
        } catch (err) {
            // Defensive: a misbehaving subscriber must NOT break the bus.
            // Real implementation in Wave 7 will log to ml_audit_trail.
            // For now silently swallow — tests verify good handlers still fire.
        }
    }
}

function topics() {
    return Array.from(_subscribers.keys());
}

function _reset() {
    _subscribers.clear();
    _tokenIndex.clear();
    _nextToken = 1;
}

module.exports = {
    publish,
    subscribe,
    unsubscribe,
    topics,
    _reset
};

'use strict';

/**
 * OMEGA R-1 Test Harness — mockExchanges
 *
 * Deterministic stand-ins for Binance / Bybit / OKX, suitable for integration
 * tests of R4 execution without touching real exchanges. Each instance is
 * seeded so output is reproducible. Optional latency + errorRate hooks let
 * resilience tests verify R3A safety guards.
 *
 * Spec: project_ml_v3_expert_acceptance_and_ux_scope_20260514.md Wave 1B.
 */

const VALID_TYPES = ['binance', 'bybit', 'okx'];

function _makeSeededRandom(seed) {
    let state = (seed >>> 0) || 1;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function createMockExchange(opts = {}) {
    const { type, seed = 1, errorRate = 0, latencyMs = 0 } = opts;
    if (!VALID_TYPES.includes(type)) {
        throw new Error(`invalid exchange type: ${type} (expected binance|bybit|okx)`);
    }
    if (!Number.isFinite(errorRate) || errorRate < 0 || errorRate > 1) {
        throw new Error('errorRate must be a number in [0, 1]');
    }

    const rng = _makeSeededRandom(seed);
    let orderCounter = 0;

    async function _maybeError() {
        if (errorRate > 0 && rng() < errorRate) {
            throw new Error(`mock exchange error injected (type=${type}, rate=${errorRate})`);
        }
        if (latencyMs > 0) {
            await new Promise(r => setTimeout(r, latencyMs));
        }
    }

    return {
        type,
        async placeOrder(req) {
            await _maybeError();
            orderCounter++;
            const priceJitter = rng() * 1000;
            return {
                orderId: `mock_${type}_s${seed}_n${orderCounter}`,
                symbol: req.symbol,
                side: req.side,
                qty: req.qty,
                type: req.type || 'MARKET',
                status: 'FILLED',
                executedQty: req.qty,
                avgPrice: 50000 + priceJitter
            };
        },
        async cancelOrder(orderId) {
            await _maybeError();
            return { orderId, status: 'CANCELED' };
        },
        async getOrderBook(symbol) {
            await _maybeError();
            const mid = 50000 + rng() * 1000;
            const bids = [];
            const asks = [];
            for (let i = 0; i < 10; i++) {
                bids.push([mid - (i + 1) * 0.5, 0.1 + rng()]);
                asks.push([mid + (i + 1) * 0.5, 0.1 + rng()]);
            }
            return { bids, asks, timestamp: Date.now(), symbol };
        },
        async getPosition(symbol) {
            await _maybeError();
            return { symbol, qty: 0, avgPrice: 0, unrealizedPnl: 0 };
        }
    };
}

module.exports = { createMockExchange };

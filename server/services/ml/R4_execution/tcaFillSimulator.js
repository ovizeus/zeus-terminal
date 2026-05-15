'use strict';

/**
 * OMEGA R4 Execution — tcaFillSimulator (canonical §51)
 *
 * §51 TCA/FILL SIMULATOR.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt line 1585.
 *
 * "Colecteaza L2 depth historic, calibreaza model de slippage per
 *  exchange; integreaza in backtest si shadow."
 *
 * R4 execution. Multi-exchange calibration + L2-depth walk-the-book
 * simulation + backtest/shadow integration hooks.
 *
 * Distinct from §23 transactionCostAnalyzer (generic single-venue TCA).
 * §51 = per-exchange × per-symbol slippage calibration. Global average
 * misleads: thin altcoin on small venue ≠ BTC on Binance.
 */

const { db } = require('../../database');

const SIM_MODES = Object.freeze(['backtest', 'shadow']);
const ORDER_SIDES = Object.freeze(['LONG', 'SHORT']);
const MIN_SAMPLES_FOR_CALIBRATION = 10;
const DEFAULT_LOOKBACK_DAYS = 30;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`tcaFillSimulator: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertSnapshot: db.prepare(`
        INSERT INTO ml_l2_depth_snapshots
        (user_id, resolved_env, exchange, symbol,
         bids_json, asks_json, mid_price, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    upsertCalibration: db.prepare(`
        INSERT INTO ml_slippage_calibration
        (user_id, resolved_env, exchange, symbol,
         sample_count, alpha, beta, r_squared, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, resolved_env, exchange, symbol) DO UPDATE SET
            sample_count = excluded.sample_count,
            alpha = excluded.alpha,
            beta = excluded.beta,
            r_squared = excluded.r_squared,
            last_updated = excluded.last_updated
    `),
    getCalibration: db.prepare(`
        SELECT * FROM ml_slippage_calibration
        WHERE user_id = ? AND resolved_env = ?
          AND exchange = ? AND symbol = ?
    `),
    insertSimulation: db.prepare(`
        INSERT INTO ml_fill_simulations
        (user_id, resolved_env, exchange, symbol, mode,
         order_side, order_size, simulated_avg_price,
         simulated_slippage_bps, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    fillsForCalibration: db.prepare(`
        SELECT order_size, simulated_slippage_bps
        FROM ml_fill_simulations
        WHERE user_id = ? AND resolved_env = ?
          AND exchange = ? AND symbol = ?
          AND ts >= ?
    `),
    historyForUser: db.prepare(`
        SELECT * FROM ml_fill_simulations
        WHERE user_id = ? AND resolved_env = ?
          AND (? = '' OR exchange = ?)
          AND (? = '' OR mode = ?)
          AND (? = 0 OR ts >= ?)
        ORDER BY ts DESC, id DESC
        LIMIT ?
    `)
};

// ── recordL2Snapshot ───────────────────────────────────────────────
function recordL2Snapshot(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const exchange = _required(params, 'exchange');
    const symbol = _required(params, 'symbol');
    const bids = _required(params, 'bids');
    const asks = _required(params, 'asks');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!Array.isArray(bids) || !Array.isArray(asks)) {
        throw new Error('tcaFillSimulator: bids/asks must be arrays');
    }

    const bestBid = bids.length > 0 ? bids[0][0] : 0;
    const bestAsk = asks.length > 0 ? asks[0][0] : 0;
    const midPrice = (bestBid > 0 && bestAsk > 0) ? (bestBid + bestAsk) / 2 : 0;

    _stmts.insertSnapshot.run(
        userId, env, exchange, symbol,
        JSON.stringify(bids), JSON.stringify(asks),
        midPrice, ts
    );
    return { recorded: true, midPrice };
}

// ── simulateFill — walk-the-book ──────────────────────────────────
function simulateFill(params) {
    const side = _required(params, 'side');
    const size = _required(params, 'size');
    const depthBook = _required(params, 'depthBook');

    if (!ORDER_SIDES.includes(side)) {
        throw new Error(`tcaFillSimulator: invalid side "${side}"`);
    }

    const book = side === 'LONG' ? depthBook.asks : depthBook.bids;
    if (!Array.isArray(book) || book.length === 0) {
        throw new Error('tcaFillSimulator: depthBook side empty');
    }

    const midRef = side === 'LONG'
        ? (depthBook.bids && depthBook.bids[0] ? (book[0][0] + depthBook.bids[0][0]) / 2 : book[0][0])
        : (depthBook.asks && depthBook.asks[0] ? (book[0][0] + depthBook.asks[0][0]) / 2 : book[0][0]);

    let remainingSize = size;
    let totalNotional = 0;
    let levelsConsumed = 0;

    for (const [price, levelSize] of book) {
        if (remainingSize <= 0) break;
        const consumed = Math.min(remainingSize, levelSize);
        totalNotional += consumed * price;
        remainingSize -= consumed;
        levelsConsumed++;
    }

    if (remainingSize > 0) {
        return {
            avgPrice: 0,
            slippageBps: Infinity,
            levelsConsumed,
            fullyFilled: false,
            remainingSize
        };
    }

    const avgPrice = totalNotional / size;
    const slippageDirSign = side === 'LONG' ? 1 : -1;
    const slippageBps = slippageDirSign * ((avgPrice - midRef) / midRef) * 10000;

    return {
        avgPrice,
        slippageBps,
        levelsConsumed,
        fullyFilled: true
    };
}

// ── calibrateSlippageModel — linear regression ─────────────────────
function calibrateSlippageModel(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const exchange = _required(params, 'exchange');
    const symbol = _required(params, 'symbol');
    const lookbackDays = (params && params.lookbackDays) ? params.lookbackDays : DEFAULT_LOOKBACK_DAYS;

    const since = Date.now() - lookbackDays * 86400000;
    const rows = _stmts.fillsForCalibration.all(userId, env, exchange, symbol, since);

    if (rows.length < MIN_SAMPLES_FOR_CALIBRATION) {
        return {
            calibrated: false,
            reason: 'insufficient_samples',
            samples: rows.length
        };
    }

    // Linear regression: slippage_bps = alpha + beta × size
    const n = rows.length;
    const sumX = rows.reduce((s, r) => s + r.order_size, 0);
    const sumY = rows.reduce((s, r) => s + r.simulated_slippage_bps, 0);
    const sumXY = rows.reduce((s, r) => s + r.order_size * r.simulated_slippage_bps, 0);
    const sumXX = rows.reduce((s, r) => s + r.order_size * r.order_size, 0);
    const meanX = sumX / n;
    const meanY = sumY / n;

    const denom = sumXX - n * meanX * meanX;
    const beta = denom !== 0 ? (sumXY - n * meanX * meanY) / denom : 0;
    const alpha = meanY - beta * meanX;

    // R² (coefficient of determination)
    let ssRes = 0, ssTot = 0;
    for (const r of rows) {
        const pred = alpha + beta * r.order_size;
        ssRes += (r.simulated_slippage_bps - pred) ** 2;
        ssTot += (r.simulated_slippage_bps - meanY) ** 2;
    }
    const rSquared = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;

    _stmts.upsertCalibration.run(
        userId, env, exchange, symbol,
        n, alpha, beta, rSquared, Date.now()
    );

    return { calibrated: true, samples: n, alpha, beta, rSquared };
}

// ── predictSlippage ────────────────────────────────────────────────
function predictSlippage(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const exchange = _required(params, 'exchange');
    const symbol = _required(params, 'symbol');
    const size = _required(params, 'size');

    const cal = _stmts.getCalibration.get(userId, env, exchange, symbol);
    if (!cal) {
        return { sufficient: false, reason: 'no_calibration' };
    }

    const predictedBps = cal.alpha + cal.beta * size;
    return {
        sufficient: true,
        predictedBps,
        calibrationAlpha: cal.alpha,
        calibrationBeta: cal.beta,
        calibrationRSquared: cal.r_squared,
        calibrationSamples: cal.sample_count
    };
}

// ── recordFillSimulation ───────────────────────────────────────────
function recordFillSimulation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const exchange = _required(params, 'exchange');
    const symbol = _required(params, 'symbol');
    const mode = _required(params, 'mode');
    const side = _required(params, 'side');
    const size = _required(params, 'size');
    const simulatedAvgPrice = _required(params, 'simulatedAvgPrice');
    const simulatedSlippageBps = _required(params, 'simulatedSlippageBps');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!SIM_MODES.includes(mode)) {
        throw new Error(`tcaFillSimulator: invalid mode "${mode}"`);
    }
    if (!ORDER_SIDES.includes(side)) {
        throw new Error(`tcaFillSimulator: invalid side "${side}"`);
    }

    _stmts.insertSimulation.run(
        userId, env, exchange, symbol, mode,
        side, size, simulatedAvgPrice, simulatedSlippageBps, ts
    );
    return { recorded: true };
}

// ── getCalibrationStats ────────────────────────────────────────────
function getCalibrationStats(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const exchange = _required(params, 'exchange');
    const symbol = _required(params, 'symbol');
    const row = _stmts.getCalibration.get(userId, env, exchange, symbol);
    if (!row) return { exists: false };
    return {
        exists: true,
        exchange: row.exchange,
        symbol: row.symbol,
        sampleCount: row.sample_count,
        alpha: row.alpha,
        beta: row.beta,
        rSquared: row.r_squared,
        lastUpdated: row.last_updated
    };
}

// ── getFillSimulationHistory ───────────────────────────────────────
function getFillSimulationHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const exchange = (params && params.exchange) ? params.exchange : '';
    const mode = (params && params.mode) ? params.mode : '';
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;
    return _stmts.historyForUser.all(
        userId, env,
        exchange, exchange,
        mode, mode,
        since > 0 ? 1 : 0, since,
        limit
    );
}

module.exports = {
    SIM_MODES,
    ORDER_SIDES,
    MIN_SAMPLES_FOR_CALIBRATION,
    DEFAULT_LOOKBACK_DAYS,
    recordL2Snapshot,
    simulateFill,
    calibrateSlippageModel,
    predictSlippage,
    recordFillSimulation,
    getCalibrationStats,
    getFillSimulationHistory
};

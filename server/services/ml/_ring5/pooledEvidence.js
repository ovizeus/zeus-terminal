'use strict';

/**
 * ML Plan v3 Phase 3 — Pooled Evidence (SPEC-7 lazy-with-TTL refresh).
 *
 * Per-cell aggregated stats refreshed lazily on:
 *   - TTL: last_refresh_ts > 30 min stale
 *   - OBS threshold: >= 50 new obs since last refresh
 *   - Forced: explicit refresh() call
 *
 * Window: rolling 30 days. Source of truth: ml_bandit_evidence atomic rows.
 */

const { db } = require('../../database');
const banditEvidence = require('./banditEvidence');

const TTL_MS = 30 * 60 * 1000;
const OBS_THRESHOLD = 50;
const WINDOW_DAYS = 30;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

function _required(p, k) {
    if (p == null || p[k] == null) throw new Error(`pooledEvidence: missing ${k}`);
    return p[k];
}

const _stmts = {
    select: db.prepare(`
        SELECT id, cell_key, last_refresh_ts, pooled_alpha, pooled_beta,
               sum_contribution, staleness_observations_count, updated_at
        FROM ml_pooled_evidence WHERE cell_key = ?
    `),
    upsert: db.prepare(`
        INSERT INTO ml_pooled_evidence
            (cell_key, last_refresh_ts, pooled_alpha, pooled_beta,
             sum_contribution, staleness_observations_count, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, ?)
        ON CONFLICT(cell_key) DO UPDATE SET
            last_refresh_ts = excluded.last_refresh_ts,
            pooled_alpha = excluded.pooled_alpha,
            pooled_beta = excluded.pooled_beta,
            sum_contribution = excluded.sum_contribution,
            staleness_observations_count = 0,
            updated_at = excluded.updated_at
    `),
    incrementStaleness: db.prepare(`
        UPDATE ml_pooled_evidence
        SET staleness_observations_count = staleness_observations_count + ?,
            updated_at = ?
        WHERE cell_key = ?
    `)
};

function refresh(params) {
    const cellKey = _required(params, 'cellKey');
    const nowTs = _required(params, 'nowTs');
    const sinceTs = nowTs - WINDOW_MS;
    const agg = banditEvidence.aggregateSince({ cellKey, sinceTs });
    _stmts.upsert.run(
        cellKey, nowTs,
        agg.pooledAlpha, agg.pooledBeta,
        agg.sumContribution, nowTs
    );
    return {
        refreshed: true,
        pooledAlpha: agg.pooledAlpha,
        pooledBeta: agg.pooledBeta,
        sumContribution: agg.sumContribution,
        n: agg.n
    };
}

function _hydrate(row) {
    if (!row) return null;
    return {
        cellKey: row.cell_key,
        lastRefreshTs: row.last_refresh_ts,
        pooledAlpha: row.pooled_alpha,
        pooledBeta: row.pooled_beta,
        sumContribution: row.sum_contribution,
        stalenessObservationsCount: row.staleness_observations_count
    };
}

function get(params) {
    const cellKey = _required(params, 'cellKey');
    const nowTs = _required(params, 'nowTs');
    const existing = _stmts.select.get(cellKey);

    const ttlExpired = !existing || (nowTs - existing.last_refresh_ts) > TTL_MS;
    const obsThresholdReached = existing && existing.staleness_observations_count >= OBS_THRESHOLD;
    const shouldRefresh = ttlExpired || obsThresholdReached;

    if (shouldRefresh) {
        const r = refresh({ cellKey, nowTs });
        return {
            cellKey,
            pooledAlpha: r.pooledAlpha,
            pooledBeta: r.pooledBeta,
            sumContribution: r.sumContribution,
            n: r.n,
            refreshTriggered: true,
            refreshReason: !existing ? 'never_refreshed' : (ttlExpired ? 'ttl_expired' : 'obs_threshold')
        };
    }

    return {
        ...(_hydrate(existing)),
        refreshTriggered: false
    };
}

function incrementStaleness(params) {
    const cellKey = _required(params, 'cellKey');
    const count = _required(params, 'count');
    _stmts.incrementStaleness.run(count, Date.now(), cellKey);
    return { incremented: true };
}

module.exports = { TTL_MS, OBS_THRESHOLD, WINDOW_DAYS, refresh, get, incrementStaleness };

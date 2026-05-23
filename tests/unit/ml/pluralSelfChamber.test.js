'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p124-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const psc = require('../../../server/services/ml/R6_shadowMeta/pluralSelfChamber');

const TEST_USER = 9124;
const OTHER_USER = 9125;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_worldview_agents WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
    db.prepare('DELETE FROM ml_plural_decisions WHERE user_id IN (?, ?)').run(TEST_USER, OTHER_USER);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§124 Migrations 237 + 238', () => {
    test('agent_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_worldview_agents
             (user_id, resolved_env, agent_id, worldview_kind,
              priors_json, signal_preferences_json, is_active,
              ts_registered, ts_retired)
             VALUES (?, ?, 'WA-UNIQ', 'trend_following', '{}', '{}', 1, ?, NULL)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_worldview_agents
             (user_id, resolved_env, agent_id, worldview_kind,
              priors_json, signal_preferences_json, is_active,
              ts_registered, ts_retired)
             VALUES (?, ?, 'WA-UNIQ', 'mean_reversion', '{}', '{}', 1, ?, NULL)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK worldview_kind restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_worldview_agents
             (user_id, resolved_env, agent_id, worldview_kind,
              priors_json, signal_preferences_json, is_active,
              ts_registered, ts_retired)
             VALUES (?, ?, 'WA-BAD', 'BOGUS', '{}', '{}', 1, ?, NULL)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK consensus_action restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_plural_decisions
             (user_id, resolved_env, decision_id, market_context_json,
              votes_json, dissent_index, dominant_agent_id,
              consensus_action, ts)
             VALUES (?, ?, 'PD-BAD', '{}', '[]', 0.1, NULL, 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('CHECK dissent_index range', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_plural_decisions
             (user_id, resolved_env, decision_id, market_context_json,
              votes_json, dissent_index, dominant_agent_id,
              consensus_action, ts)
             VALUES (?, ?, 'PD-OOR', '{}', '[]', 1.5, NULL, 'proceed', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§124 Constants', () => {
    test('WORLDVIEW_KINDS has 6 entries', () => {
        expect(psc.WORLDVIEW_KINDS).toEqual([
            'trend_following', 'mean_reversion',
            'liquidity_hunt', 'macro_dominant',
            'risk_minimalist', 'custom'
        ]);
    });

    test('CONSENSUS_ACTIONS has 5 entries', () => {
        expect(psc.CONSENSUS_ACTIONS).toEqual([
            'proceed', 'reduce_size', 'wait',
            'active_sensing', 'observer'
        ]);
    });

    test('HIGH > MODERATE dissent thresholds', () => {
        expect(psc.HIGH_DISSENT_THRESHOLD)
            .toBeGreaterThan(psc.MODERATE_DISSENT_THRESHOLD);
    });
});

describe('§124 computeDissentIndex (pure)', () => {
    test('all agree → 0', () => {
        const r = psc.computeDissentIndex({
            votes: [
                { agentId: 'A', confidence: 0.7 },
                { agentId: 'B', confidence: 0.7 },
                { agentId: 'C', confidence: 0.7 }
            ]
        });
        expect(r.dissentIndex).toBe(0);
    });

    test('high disagreement → high dissent', () => {
        const r = psc.computeDissentIndex({
            votes: [
                { agentId: 'A', confidence: 0.9 },
                { agentId: 'B', confidence: 0.1 },
                { agentId: 'C', confidence: 0.5 }
            ]
        });
        expect(r.dissentIndex).toBeGreaterThan(0.30);
    });

    test('single vote → 0 (no spread)', () => {
        const r = psc.computeDissentIndex({
            votes: [{ agentId: 'A', confidence: 0.5 }]
        });
        expect(r.dissentIndex).toBe(0);
    });
});

describe('§124 aggregateConsensus (pure)', () => {
    test('high dissent + low confidence → wait', () => {
        const r = psc.aggregateConsensus({
            votes: [
                { agentId: 'A', confidence: 0.9 },
                { agentId: 'B', confidence: 0.1 }
            ]
        });
        expect(r.action).toBe('wait');
    });

    test('high dissent + all moderate → reduce_size', () => {
        const r = psc.aggregateConsensus({
            votes: [
                { agentId: 'A', confidence: 0.9 },
                { agentId: 'B', confidence: 0.4 },
                { agentId: 'C', confidence: 0.45 }
            ]
        });
        expect(r.action).toBe('reduce_size');
    });

    test('moderate dissent → active_sensing', () => {
        const r = psc.aggregateConsensus({
            votes: [
                { agentId: 'A', confidence: 0.7 },
                { agentId: 'B', confidence: 0.5 }
            ]
        });
        expect(r.action).toBe('active_sensing');
    });

    test('consensus (low dissent) → proceed', () => {
        const r = psc.aggregateConsensus({
            votes: [
                { agentId: 'A', confidence: 0.75 },
                { agentId: 'B', confidence: 0.80 },
                { agentId: 'C', confidence: 0.78 }
            ]
        });
        expect(r.action).toBe('proceed');
    });
});

describe('§124 registerWorldviewAgent', () => {
    test('persists', () => {
        const r = psc.registerWorldviewAgent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            agentId: 'RWA-1', worldviewKind: 'trend_following',
            priors: { vol_expansion_bullish: 0.6 },
            signalPreferences: { weight_ema: 0.4 }
        });
        expect(r.registered).toBe(true);
    });

    test('duplicate throws', () => {
        psc.registerWorldviewAgent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            agentId: 'RWA-DUP', worldviewKind: 'trend_following',
            priors: {}, signalPreferences: {}
        });
        expect(() => psc.registerWorldviewAgent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            agentId: 'RWA-DUP', worldviewKind: 'mean_reversion',
            priors: {}, signalPreferences: {}
        })).toThrow();
    });

    test('invalid kind throws', () => {
        expect(() => psc.registerWorldviewAgent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            agentId: 'RWA-BAD', worldviewKind: 'BOGUS',
            priors: {}, signalPreferences: {}
        })).toThrow();
    });
});

describe('§124 recordPluralDecision', () => {
    test('atomic + auto-computes dissent + action', () => {
        const r = psc.recordPluralDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'PD-1',
            marketContext: { btc_price: 67000 },
            votes: [
                { agentId: 'trend-self', confidence: 0.85, verdict: 'LONG' },
                { agentId: 'mean-self', confidence: 0.15, verdict: 'SHORT' }
            ],
            dominantAgentId: 'trend-self'
        });
        expect(r.recorded).toBe(true);
        expect(r.consensusAction).toBe('wait'); // high dissent + low conf side
    });

    test('empty votes throws', () => {
        expect(() => psc.recordPluralDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'PD-EMPTY',
            marketContext: {}, votes: [], dominantAgentId: null
        })).toThrow();
    });

    test('duplicate throws', () => {
        psc.recordPluralDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'PD-DUP', marketContext: {},
            votes: [{ agentId: 'A', confidence: 0.5 }],
            dominantAgentId: 'A'
        });
        expect(() => psc.recordPluralDecision({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            decisionId: 'PD-DUP', marketContext: {},
            votes: [{ agentId: 'B', confidence: 0.5 }],
            dominantAgentId: 'B'
        })).toThrow();
    });
});

describe('§124 retireAgent', () => {
    test('marks inactive', () => {
        psc.registerWorldviewAgent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            agentId: 'RT-1', worldviewKind: 'liquidity_hunt',
            priors: {}, signalPreferences: {}
        });
        const r = psc.retireAgent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            agentId: 'RT-1', reason: 'stale_paradigm'
        });
        expect(r.retired).toBe(true);
    });
});

describe('§124 getActiveAgents', () => {
    test('filter by kind', () => {
        psc.registerWorldviewAgent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            agentId: 'GA-T', worldviewKind: 'trend_following',
            priors: {}, signalPreferences: {}
        });
        psc.registerWorldviewAgent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            agentId: 'GA-M', worldviewKind: 'mean_reversion',
            priors: {}, signalPreferences: {}
        });
        const r = psc.getActiveAgents({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            kindFilter: 'trend_following'
        });
        expect(r).toHaveLength(1);
        expect(r[0].agentId).toBe('GA-T');
    });

    test('excludes retired', () => {
        psc.registerWorldviewAgent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            agentId: 'GA-R', worldviewKind: 'macro_dominant',
            priors: {}, signalPreferences: {}
        });
        psc.retireAgent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            agentId: 'GA-R', reason: 'r'
        });
        const r = psc.getActiveAgents({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(r.find(a => a.agentId === 'GA-R')).toBeUndefined();
    });
});

describe('§124 isolation', () => {
    test('per (user × env) isolation', () => {
        psc.registerWorldviewAgent({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            agentId: 'ISO-1', worldviewKind: 'risk_minimalist',
            priors: {}, signalPreferences: {}
        });
        const a = psc.getActiveAgents({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const b = psc.getActiveAgents({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(0);
    });
});

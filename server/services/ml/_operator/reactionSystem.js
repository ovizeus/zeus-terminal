'use strict';

/**
 * OMEGA Operator Interaction — reactionSystem (A-Z Raid item R)
 *
 * RAID-R REACTION SYSTEM — Ω COMMENTS ON MANUAL/DSL TRADES.
 * Source: A-Z Raid Wave 1 UX additions MUST-ADD item R.
 *
 * Ω personality (per memory `project_ml_v3_expert_acceptance_and_ux_scope_20260514`):
 * sarcastic + humorous + swears with intent. Each trade outcome triggers
 * a reaction from a curated template pool.
 *
 * Tone control: PERSONALITY_TONES allows tuning per operator preference.
 * Silent mode disables reactions entirely.
 */

const { db } = require('../../database');

const REACTION_OUTCOME_TYPES = Object.freeze([
    'big_win', 'win', 'breakeven', 'loss', 'big_loss', 'missed_opportunity'
]);

const PERSONALITY_TONES = Object.freeze([
    'sarcastic', 'encouraging', 'dry', 'silent'
]);

// Reaction templates per outcome (mild personality, no excessive swearing in defaults)
const REACTION_TEMPLATES = Object.freeze({
    big_win: [
        'Now THAT was a trade, boss. Cooking with gas.',
        'Beautiful. Absolutely beautiful. Encore.',
        'Big move. The market obeyed for once.',
        'You called that one. Smug face activated.'
    ],
    win: [
        'Solid hit. Banked.',
        'Won. Keep moving.',
        'Money. Next.',
        'OK that worked. Don\'t let it go to your head.'
    ],
    breakeven: [
        'Even-Steven. Could be worse, could be better.',
        'Wash. Living to fight another day.',
        'Zero done. Now do something better next time.'
    ],
    loss: [
        'Lost one. Reset. The market doesn\'t care about feelings.',
        'Loss. Move on. Don\'t revenge trade.',
        'Stop is the lesson. Pay attention.',
        'OK that hurt. Breathe. Re-read the regime.'
    ],
    big_loss: [
        'OUCH. Big one. Stop trading for an hour. Seriously.',
        'That stung. Step away. Walk. Come back when calm.',
        'Big red candle hit. Time to check your assumptions, boss.',
        'NOT GOOD. Time for a hard reset on this session.'
    ],
    missed_opportunity: [
        'Watched that move. Should have entered.',
        'Boom went up without us. Note the regime — next time.',
        'Sat on hands while the trend ate. Fine. Discipline counts.',
        'Pattern played out perfectly without us. Annoying.'
    ]
});

const DEFAULT_TONE = 'sarcastic';

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`reactionSystem: missing ${key}`);
    }
    return params[key];
}

function _validateOutcome(outcome) {
    if (!REACTION_OUTCOME_TYPES.includes(outcome)) {
        throw new Error(`reactionSystem: invalid outcome "${outcome}"`);
    }
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertReaction: db.prepare(`
        INSERT INTO ml_omega_reactions
        (user_id, resolved_env, pos_id, outcome_type, reaction_text,
         trade_context_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    listHistory: db.prepare(`
        SELECT * FROM ml_omega_reactions
        WHERE user_id = ? AND resolved_env = ?
          AND (? = 0 OR created_at >= ?)
        ORDER BY created_at DESC, id DESC
        LIMIT ?
    `)
};

// ── generateReaction (pure) ────────────────────────────────────────
function generateReaction(params) {
    const outcome = _required(params, 'tradeOutcome');
    const personality = (params && params.personality) ? params.personality : DEFAULT_TONE;
    void params.tradeContext;

    _validateOutcome(outcome);

    if (personality === 'silent') {
        return { text: null, outcomeType: outcome, tone: 'silent' };
    }

    const templates = REACTION_TEMPLATES[outcome] || [];
    if (templates.length === 0) {
        return { text: '...', outcomeType: outcome, tone: personality };
    }

    // Pick deterministic template based on Date.now() bucket (or hash if specified)
    const idx = Date.now() % templates.length;
    const text = templates[idx];

    return {
        text,
        outcomeType: outcome,
        tone: personality
    };
}

// ── getReactionTemplates (pure) ────────────────────────────────────
function getReactionTemplates(params) {
    const outcomeType = _required(params, 'outcomeType');
    if (!REACTION_OUTCOME_TYPES.includes(outcomeType)) {
        return [];
    }
    return [...REACTION_TEMPLATES[outcomeType]];
}

// ── recordReaction ─────────────────────────────────────────────────
function recordReaction(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const outcomeType = _required(params, 'outcomeType');
    const reactionText = _required(params, 'reactionText');
    const tradeContext = _required(params, 'tradeContext');
    const posId = (params && params.posId) ? params.posId : null;

    _validateOutcome(outcomeType);

    _stmts.insertReaction.run(
        userId, env, posId, outcomeType, reactionText,
        JSON.stringify(tradeContext),
        Date.now()
    );

    return { recorded: true };
}

// ── getReactionHistory ─────────────────────────────────────────────
function getReactionHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listHistory.all(
        userId, env,
        since > 0 ? 1 : 0, since,
        limit
    );

    return rows.map(r => ({
        id: r.id,
        posId: r.pos_id,
        outcomeType: r.outcome_type,
        reactionText: r.reaction_text,
        tradeContext: JSON.parse(r.trade_context_json),
        createdAt: r.created_at
    }));
}

module.exports = {
    REACTION_OUTCOME_TYPES,
    PERSONALITY_TONES,
    REACTION_TEMPLATES,
    DEFAULT_TONE,
    generateReaction,
    getReactionTemplates,
    recordReaction,
    getReactionHistory
};

'use strict';

/**
 * OMEGA Wave 3 §158 — AUTOBIOGRAPHICAL CONTINUITY / SELF-NARRATIVE ENGINE.
 *
 * Canonical PDF §158 (ml_brain_canonic.txt lines 5306-5334).
 *
 * "nu doar exist acum; stiu si cum am devenit ceea ce sunt."
 *
 * Distinct de:
 *   - §117 epistemicProvenance (_audit)   — lineage of beliefs (not self-history)
 *   - §127 identityContinuity             — cumulative drift score over time
 *   - §137 memoryDensity                  — memory density representation
 *   - §146 identityUnderTransformation    — verdict per transformation
 *   - §147 intellectualHonestyAudit       — reason drift on decisions
 *   - §156 identityKernel                 — current self atomic definition
 *
 * §158 = NARATIVUL "cum am ajuns aici". Fiecare schimbare majoră primește o
 *        linie cu explicație ("m-am schimbat aici pentru că..."), iar la
 *        intervale regulate se ia un snapshot complet al narațiunii self.
 *
 * 5 canonical event types (PDF lines 5320-5325):
 *   major_change           — schimbare semnificativă a comportamentului
 *   identity_milestone     — punct de cotitură pe linia identității
 *   promise                — promisiune făcută sieși (constraint viitor)
 *   lesson_learned         — învățătură care a schimbat policy
 *   continuity_checkpoint  — punct intermediar de re-afirmare a continuității
 *
 * Snapshots per version capture: narrative_summary + stable_principles +
 * evolved_aspects + abandoned_aspects + promises_to_self.
 *
 * Per-(user × resolved_env) isolated. Server-only.
 */

const { db } = require('../../database');

const EVENT_TYPES = Object.freeze([
    'major_change', 'identity_milestone', 'promise',
    'lesson_learned', 'continuity_checkpoint'
]);

const DEFAULT_MAX_NARRATIVE_GAP_MS = 90 * 24 * 3600 * 1000;  // 90 days
const NARRATIVE_CONTINUITY_THRESHOLDS = Object.freeze({
    strong: 0.70, weak: 0.30
});

const RESOLVED_ENVS = new Set(['DEMO', 'TESTNET', 'REAL']);

function _required(params, key) {
    if (params == null || params[key] == null) {
        throw new Error(`§158 missing required param: ${key}`);
    }
    return params[key];
}
function _requireEnv(env) {
    if (!RESOLVED_ENVS.has(env)) {
        throw new Error(`§158 invalid resolvedEnv: ${env}`);
    }
    return env;
}
function _requireArray(name, v) {
    if (!Array.isArray(v)) {
        throw new Error(`§158 ${name} must be array`);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

function computeNarrativeContinuityScore(params) {
    const eventCount = _required(params, 'eventCount');
    const snapshotCount = _required(params, 'snapshotCount');
    const gapBetweenSnapshotsMs = _required(params, 'gapBetweenSnapshotsMs');
    const maxGapMs = _required(params, 'maxGapMs');
    if (eventCount < 0 || snapshotCount < 0 || maxGapMs <= 0) {
        throw new Error('§158 invalid input: counts must be non-negative, maxGap positive');
    }
    // Three components, each in [0,1]:
    //   eventActivity = saturating function of event count (10 = full credit)
    //   snapshotPresence = saturating on snapshot count (3 = full credit)
    //   gapHealth = 1 - (gap / maxGap), clamped
    const eventActivity = Math.min(1, eventCount / 10);
    const snapshotPresence = Math.min(1, snapshotCount / 3);
    let gapHealth;
    if (!Number.isFinite(gapBetweenSnapshotsMs)) {
        gapHealth = 0;
    } else {
        gapHealth = Math.max(0, Math.min(1, 1 - (gapBetweenSnapshotsMs / maxGapMs)));
    }
    // gapHealth weighted heaviest — narrative gap is structurally diagnostic
    // of broken self-history (events may still happen but without snapshots
    // they don't compose into a story).
    const score = (eventActivity * 0.30) + (snapshotPresence * 0.30) + (gapHealth * 0.40);
    return {
        score: Math.max(0, Math.min(1, score)),
        components: { eventActivity, snapshotPresence, gapHealth }
    };
}

function detectNarrativeGap(params) {
    const lastSnapshotTs = params.lastSnapshotTs ?? null;
    const currentTs = _required(params, 'currentTs');
    const maxGapMs = _required(params, 'maxGapMs');
    if (lastSnapshotTs === null) {
        return { gapDetected: true, elapsedMs: null };
    }
    const elapsed = currentTs - lastSnapshotTs;
    return {
        gapDetected: elapsed > maxGapMs,
        elapsedMs: elapsed
    };
}

function summarizeRecentChanges(params) {
    const events = _required(params, 'events');
    _requireArray('events', events);
    const summary = {};
    for (const e of events) {
        const type = e.eventType;
        if (!summary[type]) {
            summary[type] = { count: 0, titles: [] };
        }
        summary[type].count += 1;
        summary[type].titles.push(e.title);
    }
    return { summary, totalEvents: events.length };
}

// ──────────────────────────────────────────────────────────────────────────
// DB-BOUND FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

const _stmts = {
    insertEvent: db.prepare(`
        INSERT INTO ml_autobiographical_events (
            user_id, resolved_env, event_id, event_type, title, narrative_text,
            affected_components_json, before_state_summary_json,
            after_state_summary_json, version_label, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectEvent: db.prepare(`
        SELECT id, event_id AS eventId, event_type AS eventType,
               title, narrative_text AS narrativeText,
               affected_components_json AS affectedComponentsJson,
               before_state_summary_json AS beforeStateSummaryJson,
               after_state_summary_json AS afterStateSummaryJson,
               version_label AS versionLabel, ts
        FROM ml_autobiographical_events
        WHERE event_id = ?
    `),
    selectRecentEvents: db.prepare(`
        SELECT id, event_id AS eventId, event_type AS eventType,
               title, narrative_text AS narrativeText,
               affected_components_json AS affectedComponentsJson,
               version_label AS versionLabel, ts
        FROM ml_autobiographical_events
        WHERE user_id = ? AND resolved_env = ? AND ts >= ?
        ORDER BY ts DESC
    `),
    selectRecentEventsByType: db.prepare(`
        SELECT id, event_id AS eventId, event_type AS eventType,
               title, narrative_text AS narrativeText,
               affected_components_json AS affectedComponentsJson,
               version_label AS versionLabel, ts
        FROM ml_autobiographical_events
        WHERE user_id = ? AND resolved_env = ? AND ts >= ? AND event_type = ?
        ORDER BY ts DESC
    `),
    selectEventTimeline: db.prepare(`
        SELECT id, event_id AS eventId, event_type AS eventType,
               title, narrative_text AS narrativeText,
               affected_components_json AS affectedComponentsJson,
               version_label AS versionLabel, ts
        FROM ml_autobiographical_events
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
        LIMIT ?
    `),
    countEvents: db.prepare(`
        SELECT COUNT(*) AS count FROM ml_autobiographical_events
        WHERE user_id = ? AND resolved_env = ?
    `),
    insertSnapshot: db.prepare(`
        INSERT INTO ml_self_narrative_snapshots (
            user_id, resolved_env, snapshot_id, version_label, narrative_summary,
            stable_principles_json, evolved_aspects_json, abandoned_aspects_json,
            promises_to_self_json, events_count_at_snapshot, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectSnapshot: db.prepare(`
        SELECT id, snapshot_id AS snapshotId, version_label AS versionLabel,
               narrative_summary AS narrativeSummary,
               stable_principles_json AS stablePrinciplesJson,
               evolved_aspects_json AS evolvedAspectsJson,
               abandoned_aspects_json AS abandonedAspectsJson,
               promises_to_self_json AS promisesToSelfJson,
               events_count_at_snapshot AS eventsCountAtSnapshot, ts
        FROM ml_self_narrative_snapshots
        WHERE snapshot_id = ?
    `),
    selectLatestSnapshot: db.prepare(`
        SELECT id, snapshot_id AS snapshotId, version_label AS versionLabel,
               narrative_summary AS narrativeSummary,
               stable_principles_json AS stablePrinciplesJson,
               evolved_aspects_json AS evolvedAspectsJson,
               abandoned_aspects_json AS abandonedAspectsJson,
               promises_to_self_json AS promisesToSelfJson,
               events_count_at_snapshot AS eventsCountAtSnapshot, ts
        FROM ml_self_narrative_snapshots
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC
        LIMIT 1
    `)
};

function recordAutobiographicalEvent(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const eventId = _required(params, 'eventId');
    const eventType = _required(params, 'eventType');
    const title = _required(params, 'title');
    const narrativeText = _required(params, 'narrativeText');
    const affectedComponents = _required(params, 'affectedComponents');
    const ts = _required(params, 'ts');
    const beforeStateSummary = params.beforeStateSummary ?? null;
    const afterStateSummary = params.afterStateSummary ?? null;
    const versionLabel = params.versionLabel ?? null;

    if (!EVENT_TYPES.includes(eventType)) {
        throw new Error(`§158 invalid eventType: ${eventType}`);
    }
    _requireArray('affectedComponents', affectedComponents);
    if (_stmts.selectEvent.get(eventId)) {
        throw new Error(`§158 duplicate eventId: ${eventId}`);
    }

    _stmts.insertEvent.run(
        userId, resolvedEnv, eventId, eventType, title, narrativeText,
        JSON.stringify(affectedComponents),
        beforeStateSummary !== null ? JSON.stringify(beforeStateSummary) : null,
        afterStateSummary !== null ? JSON.stringify(afterStateSummary) : null,
        versionLabel, ts
    );

    return { recorded: true, eventId, eventType };
}

function recordSelfNarrativeSnapshot(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const snapshotId = _required(params, 'snapshotId');
    const versionLabel = _required(params, 'versionLabel');
    const narrativeSummary = _required(params, 'narrativeSummary');
    const stablePrinciples = _required(params, 'stablePrinciples');
    const evolvedAspects = _required(params, 'evolvedAspects');
    const abandonedAspects = _required(params, 'abandonedAspects');
    const promisesToSelf = _required(params, 'promisesToSelf');
    const ts = _required(params, 'ts');

    _requireArray('stablePrinciples', stablePrinciples);
    _requireArray('evolvedAspects', evolvedAspects);
    _requireArray('abandonedAspects', abandonedAspects);
    _requireArray('promisesToSelf', promisesToSelf);

    if (_stmts.selectSnapshot.get(snapshotId)) {
        throw new Error(`§158 duplicate snapshotId: ${snapshotId}`);
    }

    const eventsCount = _stmts.countEvents.get(userId, resolvedEnv).count;

    _stmts.insertSnapshot.run(
        userId, resolvedEnv, snapshotId, versionLabel, narrativeSummary,
        JSON.stringify(stablePrinciples), JSON.stringify(evolvedAspects),
        JSON.stringify(abandonedAspects), JSON.stringify(promisesToSelf),
        eventsCount, ts
    );

    return {
        recorded: true,
        snapshotId, versionLabel,
        eventsCountAtSnapshot: eventsCount
    };
}

function getRecentEvents(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const sinceTs = params.sinceTs ?? 0;
    const eventType = params.eventType;
    if (eventType !== undefined && !EVENT_TYPES.includes(eventType)) {
        throw new Error(`§158 invalid eventType filter: ${eventType}`);
    }
    return eventType
        ? _stmts.selectRecentEventsByType.all(userId, resolvedEnv, sinceTs, eventType)
        : _stmts.selectRecentEvents.all(userId, resolvedEnv, sinceTs);
}

function getLatestSnapshot(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const row = _stmts.selectLatestSnapshot.get(userId, resolvedEnv);
    return row || null;
}

function getEventTimeline(params) {
    const userId = _required(params, 'userId');
    const resolvedEnv = _requireEnv(_required(params, 'resolvedEnv'));
    const limit = _required(params, 'limit');
    return _stmts.selectEventTimeline.all(userId, resolvedEnv, limit);
}

module.exports = {
    // constants
    EVENT_TYPES,
    DEFAULT_MAX_NARRATIVE_GAP_MS,
    NARRATIVE_CONTINUITY_THRESHOLDS,
    // pure
    computeNarrativeContinuityScore,
    detectNarrativeGap,
    summarizeRecentChanges,
    // DB
    recordAutobiographicalEvent,
    recordSelfNarrativeSnapshot,
    getRecentEvents,
    getLatestSnapshot,
    getEventTimeline
};

// FILE END §158 autobiographicalContinuity.js

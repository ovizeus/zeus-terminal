'use strict';

const TRUST_DELTA_THRESHOLD = 0.2;

function compareSnapshots(params) {
    const fromId = params && params.fromId;
    if (!fromId) return { error: 'fromId required' };

    const cs = require('./cognitiveSnapshot');
    const fromSnap = cs.getSnapshot(fromId);
    if (!fromSnap) return { error: `Snapshot ${fromId} not found` };

    let toSnap;
    const toId = params && params.toId;
    if (toId) {
        toSnap = cs.getSnapshot(toId);
        if (!toSnap) return { error: `Snapshot ${toId} not found` };
    } else {
        const live = cs.captureSnapshot({ triggerType: 'manual' });
        toSnap = cs.getSnapshot(live.id);
    }

    let fromState, toState;
    try { fromState = JSON.parse(fromSnap.snapshot_json); } catch (_) { fromState = {}; }
    try { toState = JSON.parse(toSnap.snapshot_json); } catch (_) { toState = {}; }

    const fromTrust = fromState.trustScores || {};
    const toTrust = toState.trustScores || {};
    const fromQuarantines = new Set((fromState.quarantines || []).map(q => q.module_id || q.moduleId || ''));
    const toQuarantines = new Set((toState.quarantines || []).map(q => q.module_id || q.moduleId || ''));

    const allModules = new Set([...Object.keys(fromTrust), ...Object.keys(toTrust)]);
    const divergences = [];

    for (const mod of allModules) {
        const ft = typeof fromTrust[mod] === 'number' ? fromTrust[mod] : 1.0;
        const tt = typeof toTrust[mod] === 'number' ? toTrust[mod] : 1.0;
        const delta = tt - ft;
        const quarantineChanged = fromQuarantines.has(mod) !== toQuarantines.has(mod);

        if (Math.abs(delta) >= TRUST_DELTA_THRESHOLD || quarantineChanged) {
            let severity = 'low';
            if (Math.abs(delta) >= 0.4 || quarantineChanged) severity = 'high';
            else if (Math.abs(delta) >= 0.2) severity = 'medium';

            divergences.push({
                moduleId: mod,
                trustDelta: +delta.toFixed(4),
                fromTrust: +ft.toFixed(4),
                toTrust: +tt.toFixed(4),
                quarantineChanged,
                severity,
            });
        }
    }

    divergences.sort((a, b) => Math.abs(b.trustDelta) - Math.abs(a.trustDelta));

    return {
        from: { id: fromSnap.id, ts: fromSnap.created_at, state: fromSnap.cognitive_state },
        to: { id: toSnap.id, ts: toSnap.created_at, state: toSnap.cognitive_state },
        divergences,
        totalDiverged: divergences.length,
        totalModules: allModules.size,
    };
}

module.exports = { compareSnapshots, TRUST_DELTA_THRESHOLD };

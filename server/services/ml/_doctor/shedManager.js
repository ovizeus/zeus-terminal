'use strict';

/**
 * OMEGA Doctor D-5.3 — Shed Manager (cognitive load shedding).
 *
 * Per FAILURE_ONTOLOGY shed states 1-4 (airplane progressive failure metaphor):
 *   STATE 1: full cognition           — default, everything runs
 *   STATE 2: shed philosophical       — registers + introspection_meta off
 *   STATE 3: shed forensic            — forensic modules off (philosophical still)
 *   STATE 4: safety + execution only  — only hot_path_critical runs
 *
 * Hot path: isCurrentlyShed({roleTag}) — pure in-memory lookup, <0.01ms.
 * Modules SHOULD check this before doing expensive work; if shed, skip and
 * return null (let caller use static fallback or just no-op).
 *
 * Auto-promotion: autoEvaluate({pressureScore}) called by analyzer every 5s
 * with combined CPU/queue/latency pressure metric. Pressure thresholds:
 *   - pressure >= 0.90 → state 4
 *   - pressure >= 0.75 → state 3
 *   - pressure >= 0.50 → state 2
 *   - pressure <  0.50 → state 1 (auto-recovery)
 *
 * Manual override via setState({state, reason, ts}). Emits 'shed_state' event
 * on transition.
 */

const eventBus = require('./eventBus');

const SHED_STATES = Object.freeze([1, 2, 3, 4]);

// Role tags shed per state (inclusive — state 3 includes state 2's tags).
const _SHED_BY_STATE = Object.freeze({
    1: Object.freeze([]),
    2: Object.freeze(['philosophical', 'introspection_meta']),
    3: Object.freeze(['philosophical', 'introspection_meta', 'forensic']),
    4: Object.freeze(['philosophical', 'introspection_meta', 'forensic',
                      'shadow_assist', 'governance', 'hot_path_assist'])
});

const SHED_THRESHOLDS = Object.freeze({
    2: 0.50,
    3: 0.75,
    4: 0.90
});

let _currentState = 1;
let _lastTransitionTs = 0;

function _required(p, k) {
    if (p == null || p[k] == null) {
        throw new Error(`shedManager: missing required field ${k}`);
    }
    return p[k];
}

function getCurrentState() {
    return _currentState;
}

function isModuleSheddedAtState(params) {
    const roleTag = _required(params, 'roleTag');
    const state = _required(params, 'state');
    if (!SHED_STATES.includes(state)) {
        throw new Error(`shedManager: invalid state ${state} (must be in SHED_STATES)`);
    }
    return _SHED_BY_STATE[state].includes(roleTag);
}

function isCurrentlyShed(params) {
    const roleTag = _required(params, 'roleTag');
    return _SHED_BY_STATE[_currentState].includes(roleTag);
}

function _emitTransition(from, to, reason, ts) {
    if (from === to) return;
    eventBus.emit({
        eventType: 'shed_state',
        moduleId: '_doctor_shedManager',
        severity: to > 1 ? 'P1' : 'P3',
        payload: { from, to, reason },
        ts
    });
}

function setState(params) {
    const state = _required(params, 'state');
    const reason = _required(params, 'reason');
    const ts = _required(params, 'ts');
    if (!SHED_STATES.includes(state)) {
        throw new Error(`shedManager.setState: invalid state ${state} (must be in SHED_STATES)`);
    }
    const prev = _currentState;
    _currentState = state;
    _lastTransitionTs = ts;
    _emitTransition(prev, state, reason, ts);
    return { state, previous: prev };
}

function autoEvaluate(params) {
    const pressureScore = _required(params, 'pressureScore');
    const ts = _required(params, 'ts');
    if (typeof pressureScore !== 'number' || pressureScore < 0 || pressureScore > 1) {
        throw new Error(`shedManager.autoEvaluate: pressureScore must be in [0,1], got ${pressureScore}`);
    }

    let desiredState;
    if (pressureScore >= SHED_THRESHOLDS[4]) desiredState = 4;
    else if (pressureScore >= SHED_THRESHOLDS[3]) desiredState = 3;
    else if (pressureScore >= SHED_THRESHOLDS[2]) desiredState = 2;
    else desiredState = 1;

    const prev = _currentState;
    if (desiredState !== prev) {
        _currentState = desiredState;
        _lastTransitionTs = ts;
        _emitTransition(prev, desiredState,
            `auto-evaluate: pressure=${pressureScore.toFixed(3)}`, ts);
    }
    return { newState: _currentState, pressureScore };
}

function resetForTest() {
    _currentState = 1;
    _lastTransitionTs = 0;
}

module.exports = {
    SHED_STATES, SHED_THRESHOLDS,
    getCurrentState, isModuleSheddedAtState, isCurrentlyShed,
    setState, autoEvaluate, resetForTest
};

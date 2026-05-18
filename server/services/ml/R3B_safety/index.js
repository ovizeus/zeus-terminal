'use strict';

// [Wave 4] R3B Safety — public surface combining Conformal Prediction
// intervals + Out-Of-Distribution detection. Pure observability layer;
// does NOT block any brain decision. Snapshot consumer (Doctor, audit,
// UI) can gate downstream if score thresholds are crossed.

const cp = require('./conformalPrediction');
const ood = require('./oodDetector');

function evaluate({ regime, confidence, predicted, features }) {
    return {
        cp: cp.predictInterval({ regime, confidence, predicted }),
        ood: ood.score(features || {}),
    };
}

function observeOutcome({ regime, confidence, predicted, actual, features }) {
    cp.recordOutcome({ regime, confidence, predicted, actual });
    ood.observe(features || {});
}

module.exports = { evaluate, observeOutcome };

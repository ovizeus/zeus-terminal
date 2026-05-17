'use strict';

/**
 * OMEGA Doctor D-1.3 — Seed Registry (declarative module DNA).
 *
 * Source of truth for who exists in OMEGA brain at boot. Populates
 * ml_module_registry via registry.registerModule. Idempotent: skips entries
 * already in DB.
 *
 * Initial pass: 50 ops-critical modules + 8 philosophical cluster groupings +
 * 1 Doctor self-entry. Follow-up commits expand to full 220+ as contract
 * details are reviewed per remaining canonical point.
 */

const registry = require('./moduleRegistry');

const _defaultContract = (deps = [], maxMs = 5, failurePolicy = 'log') => ({
    acceptedInputs: [],
    emittedOutputs: [],
    authorityScope: '',
    maxRuntimeMs: maxMs,
    allowedDeps: deps,
    forbiddenDeps: [],
    failurePolicy
});

const SEED_ENTRIES = Object.freeze([
    // === HOT PATH CRITICAL (execution + reconcile + circuit breakers) ===
    { moduleId: 'positionStateMachine', roleTag: 'hot_path_critical',
      criticality: 'critical', runtimeMode: 'live',
      contract: _defaultContract([], 3, 'halt') },
    { moduleId: 'reconcilePosition', roleTag: 'hot_path_critical',
      criticality: 'critical', runtimeMode: 'live',
      contract: _defaultContract([], 5, 'halt') },
    { moduleId: 'circuitBreaker', roleTag: 'hot_path_critical',
      criticality: 'critical', runtimeMode: 'live',
      contract: _defaultContract([], 2, 'halt') },
    { moduleId: 'dataFreshness', roleTag: 'hot_path_critical',
      criticality: 'critical', runtimeMode: 'live',
      contract: _defaultContract([], 2, 'halt') },
    { moduleId: 'conflictResolution', roleTag: 'hot_path_critical',
      criticality: 'high', runtimeMode: 'live',
      contract: _defaultContract([], 5, 'halt') },
    { moduleId: 'realityContactRatio', roleTag: 'hot_path_critical',
      criticality: 'high', runtimeMode: 'live',
      contract: _defaultContract([], 5, 'halt') },

    // === HOT PATH ASSIST (advisory on tick) ===
    { moduleId: 'thinkingPipeline', roleTag: 'hot_path_assist',
      criticality: 'high', runtimeMode: 'live',
      contract: _defaultContract([], 50, 'log') },
    { moduleId: 'confidenceDecay', roleTag: 'hot_path_assist',
      criticality: 'medium', runtimeMode: 'live',
      contract: _defaultContract([], 5, 'log') },
    { moduleId: 'smartMoneyDetector', roleTag: 'hot_path_assist',
      criticality: 'medium', runtimeMode: 'live',
      contract: _defaultContract([], 10, 'log') },
    { moduleId: 'temporalPatterns', roleTag: 'hot_path_assist',
      criticality: 'medium', runtimeMode: 'live',
      contract: _defaultContract([], 10, 'log') },
    { moduleId: 'detectorRegistry', roleTag: 'hot_path_assist',
      criticality: 'high', runtimeMode: 'live',
      contract: _defaultContract([], 15, 'log') },
    { moduleId: 'optionsContextAnalyzer', roleTag: 'hot_path_assist',
      criticality: 'medium', runtimeMode: 'live',
      contract: _defaultContract([], 10, 'log') },
    { moduleId: 'lossStreakDetection', roleTag: 'hot_path_assist',
      criticality: 'high', runtimeMode: 'live',
      contract: _defaultContract([], 5, 'log') },
    { moduleId: 'latencyAwareExecution', roleTag: 'hot_path_assist',
      criticality: 'high', runtimeMode: 'live',
      contract: _defaultContract([], 5, 'log') },

    // === GOVERNANCE (decision gates) ===
    { moduleId: 'shadowMode', roleTag: 'governance',
      criticality: 'high', runtimeMode: 'live',
      contract: _defaultContract([], 20, 'log') },
    { moduleId: 'versionRegistry', roleTag: 'governance',
      criticality: 'high', runtimeMode: 'live',
      contract: _defaultContract([], 10, 'log') },
    { moduleId: 'tieredPromotion', roleTag: 'governance',
      criticality: 'high', runtimeMode: 'live',
      contract: _defaultContract([], 30, 'log') },
    { moduleId: 'preRegistration', roleTag: 'governance',
      criticality: 'high', runtimeMode: 'live',
      contract: _defaultContract([], 20, 'log') },
    { moduleId: 'autoQuarantine', roleTag: 'governance',
      criticality: 'critical', runtimeMode: 'live',
      contract: _defaultContract([], 15, 'halt') },
    { moduleId: 'autoResumeDD', roleTag: 'governance',
      criticality: 'high', runtimeMode: 'live',
      contract: _defaultContract([], 15, 'log') },
    { moduleId: 'thresholdRegistry', roleTag: 'governance',
      criticality: 'high', runtimeMode: 'live',
      contract: _defaultContract([], 10, 'log') },

    // === SHADOW ASSIST (async learning + audit) ===
    { moduleId: 'attributionEngine', roleTag: 'shadow_assist',
      criticality: 'high', runtimeMode: 'shadow',
      contract: _defaultContract([], 200, 'log') },
    { moduleId: 'regimeMetrics', roleTag: 'shadow_assist',
      criticality: 'medium', runtimeMode: 'shadow',
      contract: _defaultContract([], 100, 'log') },
    { moduleId: 'calibration', roleTag: 'shadow_assist',
      criticality: 'medium', runtimeMode: 'shadow',
      contract: _defaultContract([], 100, 'log') },
    { moduleId: 'driftDetector', roleTag: 'shadow_assist',
      criticality: 'high', runtimeMode: 'shadow',
      contract: _defaultContract([], 100, 'log') },
    { moduleId: 'targetLabels', roleTag: 'shadow_assist',
      criticality: 'medium', runtimeMode: 'shadow',
      contract: _defaultContract([], 50, 'log') },
    { moduleId: 'counterfactualPortfolio', roleTag: 'shadow_assist',
      criticality: 'medium', runtimeMode: 'shadow',
      contract: _defaultContract([], 150, 'log') },
    { moduleId: 'ddRecoveryGraduated', roleTag: 'shadow_assist',
      criticality: 'high', runtimeMode: 'shadow',
      contract: _defaultContract([], 50, 'log') },
    { moduleId: 'blackSwanAbstention', roleTag: 'shadow_assist',
      criticality: 'critical', runtimeMode: 'shadow',
      contract: _defaultContract([], 50, 'halt') },
    { moduleId: 'learningPrinciples', roleTag: 'shadow_assist',
      criticality: 'low', runtimeMode: 'shadow',
      contract: _defaultContract([], 30, 'log') },
    { moduleId: 'dataHygiene', roleTag: 'shadow_assist',
      criticality: 'medium', runtimeMode: 'shadow',
      contract: _defaultContract([], 50, 'log') },
    { moduleId: 'abTesting', roleTag: 'shadow_assist',
      criticality: 'medium', runtimeMode: 'shadow',
      contract: _defaultContract([], 100, 'log') },
    { moduleId: 'rlPositionManager', roleTag: 'shadow_assist',
      criticality: 'medium', runtimeMode: 'shadow',
      contract: _defaultContract([], 100, 'log') },

    // === FORENSIC (incident / on-demand only) ===
    { moduleId: 'counterfactualSelfAbsence', roleTag: 'forensic',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 100, 'log') },
    { moduleId: 'selfTriangulation', roleTag: 'forensic',
      criticality: 'medium', runtimeMode: 'offline',
      contract: _defaultContract([], 200, 'log') },
    { moduleId: 'onticFrictionMeter', roleTag: 'forensic',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 50, 'log') },
    { moduleId: 'unchosenQuestionDetector', roleTag: 'forensic',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 50, 'log') },
    { moduleId: 'semanticEventHorizon', roleTag: 'forensic',
      criticality: 'medium', runtimeMode: 'offline',
      contract: _defaultContract([], 50, 'log') },
    { moduleId: 'epistemicFasting', roleTag: 'forensic',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 30, 'log') },
    { moduleId: 'proportionEngine', roleTag: 'forensic',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 30, 'log') },
    { moduleId: 'preconceptualTraceVault', roleTag: 'forensic',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 50, 'log') },

    // === INTROSPECTION META (self-awareness) ===
    { moduleId: 'selfKnowledgeReport', roleTag: 'introspection_meta',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 500, 'log') },
    { moduleId: 'identityKernel', roleTag: 'introspection_meta',
      criticality: 'medium', runtimeMode: 'offline',
      contract: _defaultContract([], 200, 'log') },
    { moduleId: 'jurisdiction', roleTag: 'introspection_meta',
      criticality: 'high', runtimeMode: 'offline',
      contract: _defaultContract([], 100, 'log') },
    { moduleId: 'autobiographicalContinuity', roleTag: 'introspection_meta',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 200, 'log') },
    { moduleId: 'selfPreservationWithoutGoalCorruption', roleTag: 'introspection_meta',
      criticality: 'critical', runtimeMode: 'offline',
      contract: _defaultContract([], 100, 'halt') },
    { moduleId: 'alivenessSimulationLayer', roleTag: 'introspection_meta',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 100, 'log') },
    { moduleId: 'agencyAttributionLedger', roleTag: 'introspection_meta',
      criticality: 'medium', runtimeMode: 'offline',
      contract: _defaultContract([], 100, 'log') },
    { moduleId: 'sacredIncompletionCovenant', roleTag: 'introspection_meta',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 50, 'log') },
    { moduleId: 'rightfulUnknown', roleTag: 'introspection_meta',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 50, 'log') },
    { moduleId: 'returnPathCovenant', roleTag: 'introspection_meta',
      criticality: 'high', runtimeMode: 'offline',
      contract: _defaultContract([], 100, 'log') },
    { moduleId: 'voluntaryPowerRenunciation', roleTag: 'introspection_meta',
      criticality: 'medium', runtimeMode: 'offline',
      contract: _defaultContract([], 50, 'log') },
    { moduleId: 'articulationLossLaw', roleTag: 'introspection_meta',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 50, 'log') },
    { moduleId: 'legibilityTax', roleTag: 'introspection_meta',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 50, 'log') },
    { moduleId: 'enactiveTruthResidue', roleTag: 'introspection_meta',
      criticality: 'medium', runtimeMode: 'offline',
      contract: _defaultContract([], 50, 'log') },

    // === PHILOSOPHICAL CLUSTER ENTRIES ===
    // 40 bullet-only canonical points (§162-§166, §172-§176, §182-§186,
    // §192-§196, §202-§206, §212-§216, §222-§226, §232-§236) grouped into
    // 8 cluster register entries — they never run, only documented.
    { moduleId: 'cluster_active_inference', roleTag: 'philosophical',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 1, 'skip') },
    { moduleId: 'cluster_reflexive_meta', roleTag: 'philosophical',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 1, 'skip') },
    { moduleId: 'cluster_transcendental', roleTag: 'philosophical',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 1, 'skip') },
    { moduleId: 'cluster_incompleteness', roleTag: 'philosophical',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 1, 'skip') },
    { moduleId: 'cluster_kairos', roleTag: 'philosophical',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 1, 'skip') },
    { moduleId: 'cluster_reflexive_temporal', roleTag: 'philosophical',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 1, 'skip') },
    { moduleId: 'cluster_constitutive', roleTag: 'philosophical',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 1, 'skip') },
    { moduleId: 'cluster_limit', roleTag: 'philosophical',
      criticality: 'low', runtimeMode: 'offline',
      contract: _defaultContract([], 1, 'skip') },

    // === DOCTOR'S OWN MODULES (NOT exempt from contracts, per ontology) ===
    { moduleId: '_doctor_moduleRegistry', roleTag: 'forensic',
      criticality: 'high', runtimeMode: 'offline',
      contract: _defaultContract([], 1000, 'halt') }
]);

function runSeed() {
    for (const e of SEED_ENTRIES) {
        if (registry.getModule({ moduleId: e.moduleId })) continue; // idempotent
        registry.registerModule({ ...e, ts: Date.now() });
    }
}

module.exports = { SEED_ENTRIES, runSeed };

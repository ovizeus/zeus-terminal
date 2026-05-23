'use strict';

/**
 * OMEGA R5B Governance — tieredPromotion (§252* Claude-extras)
 *
 * §252* = approved 2026-04-29 architectural decision. Source: memory
 * project_ml_architecture_frozen.md + project_ml_brain_pro_244.md.
 * NOT in canonical PDF — Claude-extras frozen.
 *
 * 3-tier promotion mechanism for governance proposals:
 *   - MINOR    → auto-apply when ML_BANDIT_AUTO_APPLY_MINOR=true, never on REAL
 *   - MAJOR    → operator approval queue (no cooldown)
 *   - CRITICAL → operator approval + 24h cooldown before apply allowed
 *
 * Composition (no new migration):
 *   - versionRegistry (§19) — proposes + activates versions
 *   - approvalQueue (Wave 1D) — enqueues operator approval requests
 *
 * Tier classification rules (initial heuristics; tuneable later):
 *   - CRITICAL: risk_config / isCharter / feature_schema breaking
 *               / weight delta >= 0.20
 *   - MAJOR:    weight delta in [0.05, 0.20) / scope expansion
 *               / detector config change with non-trivial delta
 *   - MINOR:    weight delta < 0.05 + non-charter + USER_CELL scope
 *
 * REAL invariant: tier MINOR never auto-applies on REAL env regardless
 * of flag (REAL requires explicit operator opt-in per ML_LIVE_OPTIN_REQUIRED).
 */

const versionRegistry = require('./versionRegistry');
const approvalQueue = require('../_operator/approvalQueue');
// Path: server/services/ml/R5B_governance/ → server/migrationFlags.js
const MF = require('../../../migrationFlags');

const TIERS = Object.freeze(['MINOR', 'MAJOR', 'CRITICAL']);

// ── Thresholds (tuneable) ──────────────────────────────────────────
const MINOR_MAX_DELTA = 0.05;
const MAJOR_MAX_DELTA = 0.20;
const CRITICAL_COMPONENT_TYPES = ['risk_config'];

const SCOPE_ORDER = Object.freeze([
    'USER_CELL', 'ENV_SYMBOL', 'SYMBOL', 'RESOLVED_ENV', 'GLOBAL', 'CHARTER'
]);

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`tieredPromotion: missing ${key}`);
    }
    return params[key];
}

function weightDelta(oldConfig, newConfig) {
    if (!oldConfig || !newConfig) return 0;
    const keys = new Set([...Object.keys(oldConfig), ...Object.keys(newConfig)]);
    let maxDiff = 0;
    for (const k of keys) {
        const o = oldConfig[k];
        const n = newConfig[k];
        const oNum = typeof o === 'number' && Number.isFinite(o) ? o : null;
        const nNum = typeof n === 'number' && Number.isFinite(n) ? n : null;
        if (oNum === null && nNum === null) continue;
        const diff = Math.abs((nNum ?? 0) - (oNum ?? 0));
        if (diff > maxDiff) maxDiff = diff;
    }
    return maxDiff;
}

function _isFeatureSchemaBreaking(oldConfig, newConfig) {
    if (!oldConfig || !newConfig) return false;
    const oldFields = Array.isArray(oldConfig.fields) ? oldConfig.fields : null;
    const newFields = Array.isArray(newConfig.fields) ? newConfig.fields : null;
    if (!oldFields || !newFields) return false;
    // Removed fields = breaking change
    for (const f of oldFields) {
        if (!newFields.includes(f)) return true;
    }
    return false;
}

function _scopeRank(scope) {
    const idx = SCOPE_ORDER.indexOf(scope);
    return idx === -1 ? 0 : idx;
}

// ── classifyChange ──────────────────────────────────────────────────
function classifyChange(params) {
    const componentType = _required(params, 'componentType');
    const oldConfig = params.oldConfig || {};
    const newConfig = params.newConfig || {};
    const scope = params.scope || 'USER_CELL';
    // Default oldScope to USER_CELL (least scope) — when only scope=SYMBOL
    // is provided, that's interpreted as expansion from the default.
    const oldScope = params.oldScope || 'USER_CELL';
    const isCharter = !!params.isCharter;

    // CRITICAL rules (any triggers it)
    if (isCharter) return 'CRITICAL';
    if (CRITICAL_COMPONENT_TYPES.includes(componentType)) return 'CRITICAL';
    if (componentType === 'feature_schema' && _isFeatureSchemaBreaking(oldConfig, newConfig)) {
        return 'CRITICAL';
    }
    const delta = weightDelta(oldConfig, newConfig);
    if (delta >= MAJOR_MAX_DELTA) return 'CRITICAL';

    // MAJOR rules
    if (delta >= MINOR_MAX_DELTA) return 'MAJOR';
    if (_scopeRank(scope) > _scopeRank(oldScope)) return 'MAJOR';   // scope expansion

    // Default
    return 'MINOR';
}

// ── proposeWithTier ────────────────────────────────────────────────
function proposeWithTier(params) {
    const componentType = _required(params, 'componentType');
    const componentId = _required(params, 'componentId');
    const version = _required(params, 'version');
    const config = _required(params, 'config');
    const motivation = _required(params, 'motivation');
    const actor = _required(params, 'actor');
    const oldConfig = params.oldConfig || {};
    const scope = params.scope || 'USER_CELL';
    const env = params.env || 'DEMO';
    const userId = params.userId !== undefined ? params.userId : null;
    const parentVersionId = params.parentVersionId || null;
    const isCharter = !!params.isCharter;

    const tier = classifyChange({
        componentType, oldConfig, newConfig: config, scope,
        oldScope: params.oldScope, isCharter
    });

    // 1. Always create the version row first (PROPOSED state)
    const proposal = versionRegistry.proposeVersion({
        componentType, componentId, version, config,
        motivation, actor, parentVersionId
    });

    // 2. REAL env always blocks auto-apply (operator opt-in required)
    if (env === 'REAL') {
        // Even MINOR cannot auto-apply on REAL; queue for operator
        if (userId === null) {
            // Without userId we can't enqueue; mark blocked
            return {
                versionId: proposal.id,
                tier,
                autoApplied: false,
                state: 'BLOCKED_REAL'
            };
        }
        const approval = approvalQueue.enqueue({
            userId,
            requestType: 'PROMOTION',
            payload: { versionId: proposal.id, componentType, componentId, version, tier, env },
            tier
        });
        return {
            versionId: proposal.id,
            tier,
            autoApplied: false,
            approvalId: approval.id,
            state: 'BLOCKED_REAL'
        };
    }

    // 3. MINOR + flag on + non-REAL → auto-apply
    if (tier === 'MINOR' && MF.ML_BANDIT_AUTO_APPLY_MINOR) {
        versionRegistry.activateVersion({
            id: proposal.id,
            motivation: `auto-apply ${tier} (§252* flag on)`,
            actor
        });
        return {
            versionId: proposal.id,
            tier,
            autoApplied: true,
            state: 'APPLIED'
        };
    }

    // 4. All other paths → queue for operator
    if (userId === null) {
        // No user to attribute approval to — leave as PROPOSED, return PENDING with no approvalId
        return {
            versionId: proposal.id,
            tier,
            autoApplied: false,
            state: 'PENDING_APPROVAL'
        };
    }
    const approval = approvalQueue.enqueue({
        userId,
        requestType: 'PROMOTION',
        payload: { versionId: proposal.id, componentType, componentId, version, tier, env },
        tier
    });
    return {
        versionId: proposal.id,
        tier,
        autoApplied: false,
        approvalId: approval.id,
        state: 'PENDING_APPROVAL'
    };
}

// ── applyApproved ──────────────────────────────────────────────────
function applyApproved(params) {
    const approvalId = _required(params, 'approvalId');
    const actor = _required(params, 'actor');

    const approval = approvalQueue.getById(approvalId);
    if (!approval) {
        throw new Error(`applyApproved: approval ${approvalId} not found`);
    }
    if (approval.queue_state !== 'APPROVED') {
        throw new Error(`applyApproved: approval ${approvalId} state is ${approval.queue_state}, must be APPROVED`);
    }

    // CRITICAL cooldown enforcement
    if (approval.tier === 'CRITICAL' && approval.cooldown_until) {
        const now = Date.now();
        if (approval.cooldown_until > now) {
            const remainingMs = approval.cooldown_until - now;
            const remainingH = (remainingMs / 3600000).toFixed(1);
            throw new Error(`applyApproved: CRITICAL cooldown active, ${remainingH}h remaining (cooldown_until=${approval.cooldown_until})`);
        }
    }

    const payload = JSON.parse(approval.request_payload_json);
    const versionId = payload.versionId;
    if (!versionId) {
        throw new Error(`applyApproved: approval ${approvalId} payload missing versionId`);
    }

    versionRegistry.activateVersion({
        id: versionId,
        motivation: `operator-approved via approval #${approvalId}`,
        actor
    });
    const row = versionRegistry.getById(versionId);
    return {
        versionId,
        activated_at: row.activated_at
    };
}

// ── processMinor — batch auto-apply of all PENDING MINOR approvals ──
function processMinor() {
    const result = { applied_count: 0, skipped_count: 0, errors: [] };
    if (!MF.ML_BANDIT_AUTO_APPLY_MINOR) {
        return result;  // flag off → nothing applied
    }
    // Find all PENDING MINOR approvals
    const { db } = require('../../database');
    const rows = db.prepare(`
        SELECT * FROM ml_operator_approval
        WHERE queue_state = 'PENDING' AND tier = 'MINOR'
        ORDER BY requested_at ASC
        LIMIT 200
    `).all();

    for (const approval of rows) {
        try {
            // Mark APPROVED automatically (auto-apply means we're the operator)
            approvalQueue.decide({
                id: approval.id,
                decision: 'APPROVED',
                decidedBy: 'auto_minor_processor',
                signature: null
            });
            applyApproved({ approvalId: approval.id, actor: 'auto_minor_processor' });
            result.applied_count++;
        } catch (err) {
            result.errors.push({ approvalId: approval.id, error: String(err && err.message || err) });
            result.skipped_count++;
        }
    }
    return result;
}

module.exports = {
    TIERS,
    classifyChange,
    weightDelta,
    proposeWithTier,
    applyApproved,
    processMinor
};

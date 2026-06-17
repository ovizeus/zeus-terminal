// Zeus Terminal — Migration Feature Flags
// Controls gradual migration from client-side to server-side architecture.
// All flags default to SAFE state: client runs everything, server runs nothing.
//
// Usage:   const MF = require('./migrationFlags');
//          if (MF.SERVER_MARKET_DATA) { /* server subscribes to Binance WS */ }
//
// RULE: CLIENT_AT and SERVER_AT must NEVER both be true simultaneously.
//       Same for CLIENT_BRAIN / SERVER_BRAIN.
'use strict';

const fs = require('fs');
const path = require('path');

const FLAGS_FILE = path.join(__dirname, '..', 'data', 'migration_flags.json');

// ── Defaults: current safe behavior (client does everything) ──
// Adding a REAL-path flag? Add a coherence rule in services/realGateCoherence.js.
const DEFAULTS = {
    SERVER_MARKET_DATA: false,  // Phase 3: server subscribes to Binance WS
    SERVER_BRAIN: false,  // Phase 4: server runs brain/confluence/regime
    SERVER_AT: false,  // Phase 6: server runs AutoTrade decision engine
    CLIENT_BRAIN: true,   // Phase 4: client runs brain (flip when SERVER_BRAIN proven)
    CLIENT_AT: true,   // Phase 6: client runs AT (flip when SERVER_AT proven)
    // [MIGRATION-F5] Server→client `positions.changed` broadcast over /ws/sync.
    // When ON, serverAT._persistPosition / _persistClose emit a full
    // PositionsSnapshot AFTER the SQLite commit succeeds. OFF by default —
    // flipped ON only at Phase 5 C5, after the client subscriber (C4) lands
    // and is paper-traded. Polling (bootstrapInit livePosSync 30s) remains
    // parallel until C6.
    POSITIONS_WS: false,
    // [Phase 2 S3] Parity harness — shadow-only logging of client fusion
    // decisions against server `serverBrain` fusion on the same tick. Writes
    // to `brain_parity_log`; zero runtime influence on live AT/Brain paths.
    // Independent of the SERVER_/CLIENT_ mutex — turning this on does NOT
    // flip ownership; it only enables the /api/brain/parity/client POST
    // handler and the optional `_runShadowCycle` server-side writer. Default
    // OFF so the harness ships dormant.
    PARITY_SHADOW_ENABLED: false,
    // [Phase 2 S3.1d] Binance Futures WS lane workaround. When some
    // production streams (markPrice@1s, kline_*, aggTrade) are silently
    // throttled by Binance on our IP while others (bookTicker, trade, depth)
    // still deliver, this flag routes marketFeed + client WS through the
    // working streams + REST kline polling. Default OFF — behavior identical
    // to pre-S3.1d. Flip ON via admin API or data/migration_flags.json when
    // Binance is misbehaving; flip OFF when the primary lane recovers. No
    // trading-path change, no DSL/Brain engine change; only the input layer.
    ALT_WS_FEEDS: false,
    // [Phase 2 S4-B0] Bybit safety flags — INERT BY DESIGN.
    // S4-B0 introduces ONLY the flag surface and mutex assertions; no signer,
    // no route, no order builder, no exchange dispatch. Every Bybit code path
    // landed in later batches (S4-B1..S4-B9) MUST gate on these flags AND on
    // explicit operator approval. Defaults are chosen so a fresh boot or a
    // mis-edited migration_flags.json cannot enable any Bybit execution.
    //
    // BYBIT_TESTNET_ENABLED — when true, future Bybit signer is allowed to send
    // signed requests to api-testnet.bybit.com only. Default OFF until S4-B7
    // testnet validation matrix passes.
    BYBIT_TESTNET_ENABLED: false,
    // BYBIT_LIVE_ENABLED — when true, future Bybit signer is allowed to send
    // signed requests to api.bybit.com (REAL money). Default OFF; gated by
    // S4-B9 final report + operator GO + per-user opt-in (S10 pattern).
    // Boot mutex below ALSO requires BYBIT_DRY_RUN_ONLY=false before LIVE
    // can ever flip true.
    BYBIT_LIVE_ENABLED: false,
    // BYBIT_PARITY_ENABLED — when true, S4-B4 shadow harness logs Binance
    // intent vs Bybit equivalent intent on the same decision into a future
    // bybit_intent_parity_log table. Pure shadow, no orders. Default OFF
    // until S4-B4 ships.
    BYBIT_PARITY_ENABLED: false,
    // BYBIT_DRY_RUN_ONLY — master safety latch. While TRUE, NO Bybit signer
    // is permitted to send any HTTP request to a Bybit endpoint, even on
    // testnet, even with TESTNET_ENABLED=true. Boot mutex enforces that
    // LIVE_ENABLED cannot be true while DRY_RUN_ONLY is true. Default ON
    // (true); only flipped to false in S4-B5+ once integration tests prove
    // the signer matches Bybit V5 contract on a vector basis.
    BYBIT_DRY_RUN_ONLY: true,
    // [Phase 2 S6-B0] DEMO server-authority carve-out flags — INERT BY DESIGN.
    // S6-B0 introduces ONLY the flag surface and mutex carve-out rules; no
    // dispatch logic, no client gating, no execution path. Every code path
    // landed in later batches (S6-B1..S6-B6) MUST gate on these flags AND on
    // explicit operator approval + 7-day demo soak. Defaults are chosen so a
    // fresh boot or a mis-edited migration_flags.json cannot enable any
    // server-side decisioning or execution for ANY user.
    //
    // SERVER_BRAIN_DEMO — when true, serverBrain._runCycle is allowed to run
    // and dispatch decisions for users in engineMode='demo' ONLY. Independent
    // of SERVER_BRAIN. Default OFF; flipped ON only at S6-B6 after S6-B1..B5
    // ship and probes are green. Mutex below ALSO requires SERVER_BRAIN=false
    // before SERVER_BRAIN_DEMO can ever flip true (one-way ratchet).
    SERVER_BRAIN_DEMO: false,
    // SERVER_AT_DEMO — when true, serverAT.processBrainDecision is allowed to
    // fire for users in engineMode='demo' ONLY. Independent of SERVER_AT.
    // Default OFF; flipped ON only at S6-B6. Mutex below ALSO requires
    // SERVER_AT=false (one-way ratchet) and BYBIT_TESTNET_ENABLED=false +
    // BYBIT_LIVE_ENABLED=false (TESTNET/REAL safety — DEMO carve-out must
    // never accidentally route to a real exchange).
    SERVER_AT_DEMO: false,
    // SERVER_AT_TESTNET — when true, brain dispatches AT for users in
    // engineMode='live' + exchangeMode='testnet'. REAL stays blocked.
    // Separate from SERVER_AT to prevent accidental real-money AT.
    SERVER_AT_TESTNET: false,
    // SP2: master toggle to allow serverAT to EXECUTE testnet entries (not just
    // shadow). Gated additionally per-user by data/sp2_cutover_users.json. OFF by default.
    SERVER_AT_TESTNET_EXEC: false,
    // [SP2-b 2026-06-07] FULL server ownership of entries for cutover users:
    // server opens even when the client is PRESENT (SP2-a hybrid deferred to a
    // present client → two engines commanded one account). Also flips the
    // `serverActive` sync field so the client locks its own AT engine, and arms
    // the /api/order/place auto-open reject. Testnet-only (creds.mode==='testnet'
    // enforced in serverAT.serverFullyOwnsEntries). OFF by default; this flag is
    // the rollback lever back to the hybrid handover.
    SERVER_AT_FULL_OWNERSHIP: false,
    // [SERVER-ARES 2026-06-07] Server-side ARES engine (serverAres.js): decisions
    // from aresRules, execution through serverAT (owner='ARES'), wallet in
    // ares_state. Additionally gated per-user by serverFullyOwnsEntries —
    // testnet cutover only. OFF = client ARES rules (locked under full
    // ownership → ARES dormant). This flag is the ARES rollback lever.
    SERVER_ARES: false,
    // [M1.2 Cat C 2026-05-14] LIVE_ENTRY_UNIFIED controls Path A/B unification
    // burn-in per ADR-001 Decision 3.1. Default TRUE = safe path (registerManualPosition
    // delegates la _executeLiveEntryCore + hard SafetyAssertionError pre-fill).
    // Set FALSE pentru emergency rollback la legacy Path B (silent sl=null accept,
    // no exchange SL placement). Flag toggle e mecanism rollback, NU staged rollout
    // — default ON because production safety must NOT default to unsafe behavior
    // (Master Working Rule 0: server-truth/no-fake-data).
    LIVE_ENTRY_UNIFIED: true,
    // [LIQ-FEED PROXY 2026-05-14] When true, clients listen to server-side
    // aggregated liq feed (`liq.feed` WS frames) instead of opening direct
    // exchange WebSockets. Eliminates DNS/network filter failures on
    // ERR_NAME_NOT_RESOLVED for fstream.binance.com etc. Default true post-
    // deploy. Set false to fall back to client-side direct connections.
    // Spec: _review/audit/LIQ_FEED_PROXY_PLAN_20260514.md
    LIQ_FEED_VIA_SERVER: true,

    // ─── OMEGA ML migration flags (Wave 1A 2026-05-14) ───
    // All default OFF. Influence gates chained per spec frozen:
    // DEMO (post S6) → TESTNET (post S8) → REAL (post S10/S11).
    // Spec: project_ml_architecture_frozen.md migration flags section.
    //
    // ML_INGEST_ENABLED — Stage 1 ingest activator. When true, R-1 test
    // harness + R0 substrate can write decision logs to ml_decision_*
    // tables. Pure observability; no trading influence.
    ML_INGEST_ENABLED: false,
    // ML_PIPELINE_SHADOW — shadow mode for pipeline stages. Pipeline runs
    // but never influences live trading; outputs compared against client
    // brain via parity log. Required for soak validation pre-influence.
    ML_PIPELINE_SHADOW: false,
    // ML_DEMO_INFLUENCE_ENABLED — DEMO env influence gate (post S6).
    // When true, R4 execution may consult R5A bandit on DEMO trades.
    // Per-user opt-in NOT required for DEMO (no real money).
    ML_DEMO_INFLUENCE_ENABLED: false,
    // ML_TESTNET_INFLUENCE_ENABLED — TESTNET influence gate (post S8).
    // Same as DEMO but for testnet flow. Per-user opt-in not required.
    ML_TESTNET_INFLUENCE_ENABLED: false,
    // ML_LIVE_INFLUENCE_ENABLED — REAL influence gate (post S10/S11).
    // Master switch for real-money ML influence. Requires LIVE_OPTIN_REQUIRED
    // per-user check below. NEVER flip without operator GO + canary plan.
    ML_LIVE_INFLUENCE_ENABLED: false,
    // ML_LIVE_OPTIN_REQUIRED — per-user explicit opt-in for REAL ML influence.
    // When true (default, fail-closed), user MUST acknowledge ML influence
    // before R4 may use bandit on REAL trades, even if
    // ML_LIVE_INFLUENCE_ENABLED is true. [REAL-GATE P0-3 2026-06-09]
    ML_LIVE_OPTIN_REQUIRED: true,
    // WS_PROXY_ENABLED — route client Binance WS through server proxy.
    // Phase B.6: client checks this flag to decide direct vs proxy path.
    WS_PROXY_ENABLED: false,
    // ML_BANDIT_AUTO_APPLY_MINOR — auto-apply MINOR proposals without
    // operator approval (per spec point 252* tiered authority). MAJOR
    // and CRITICAL always require operator decision. Default OFF until
    // R5B governance proven in shadow.
    ML_BANDIT_AUTO_APPLY_MINOR: false,
    // ML_HYBRID_POOLING_ENABLED — Cornercase A hybrid partial pooling.
    // When true, pooled evidence is computed as read-only prior for
    // proposals but writes remain strict per-(user, env, symbol, feature).
    // Default OFF until R5A learning facade ships.
    ML_HYBRID_POOLING_ENABLED: false,
    // ML_OVERRIDE_RESOLVER_ENABLED — Cornercase B 7-layer effectiveStatus
    // resolver. When true, R5B reads ml_feature_global_overrides table
    // to compute effective feature status per (scope → cell → registry).
    // Default OFF until R5B governance facade ships.
    ML_OVERRIDE_RESOLVER_ENABLED: false,
    ML_CRON_SCAN_ENABLED: true,
    USERDATA_STREAM_ENABLED: false,
    _USERDATA_STREAM_TESTNET_ENABLED: false,
    _USERDATA_STREAM_REAL_ENABLED: false,
    SERVER_AUTHORITATIVE_POSITIONS: false,
    _SRV_POS_TESTNET_ENABLED: false,
    _SRV_POS_REAL_ENABLED: false,
};
// [REVIEW of 109b8962] DEFAULTS is the immutable fail-closed baseline pinned
// by tests; freeze so no code path can mutate it (module never writes to it).
Object.freeze(DEFAULTS);

// ── Load persisted flags (survives restarts) ──
const flags = Object.assign({}, DEFAULTS);

try {
    if (fs.existsSync(FLAGS_FILE)) {
        const saved = JSON.parse(fs.readFileSync(FLAGS_FILE, 'utf8'));
        for (const k of Object.keys(DEFAULTS)) {
            if (typeof saved[k] === 'boolean') flags[k] = saved[k];
        }
    }
} catch (err) {
    console.error('[MF] Failed to load migration flags, using defaults:', err.message);
}

// ── DSL Parity Shadow — read-only from env var ──
// [BUG-S7] Independent environment variable for DSL parity shadow logging.
// When enabled, serverDSL.tick logs source='server' rows. Default OFF = zero runtime.
const _DSL_PARITY_SHADOW_ENABLED = (process.env.DSL_PARITY_SHADOW_ENABLED || 'false') === 'true';

// ── ML-DSL Shadow — read-only from env var ──
// [ML-DSL v1] When enabled, serverAT records shadow DSL-drive proposals (policy →
// safety net) for the read-only DSL Drive endpoint + OMEGA box. Default OFF = zero
// runtime, no behaviour change. Shadow NEVER applies to the real stop.
const _ML_DSL_SHADOW_ENABLED = (process.env.ML_DSL_SHADOW_ENABLED || 'false') === 'true';

// [ML-DSL v2] When enabled, serverAT records the price path per position and, on close,
// computes the baseline counterfactual + trains the learner. Default OFF = zero runtime.
const _ML_DSL_LEARN_ENABLED = (process.env.ML_DSL_LEARN_ENABLED || 'false') === 'true';

// ── Safety invariant: mutual exclusion ──
// [Phase 2 S1.C] Two enforcement modes:
//   1. _validateMutex(f)  — pure check, returns {ok,violations[]}. No mutation.
//   2. _enforceMutexStrict() — called at module load. If invalid, THROWS so the
//      server process dies at boot. No silent coercion — a corrupt / manually
//      edited data/migration_flags.json must never boot into dual-execution.
//   3. set() uses _validateMutex and REJECTS the write instead of coercing.
//      An admin flipping a flag via /api/migration/flags that would create a
//      conflict gets an error, not a silent half-applied state.
function _validateMutex(f) {
    const violations = [];
    if (f.SERVER_AT && f.CLIENT_AT) {
        violations.push('SERVER_AT && CLIENT_AT both true — only one side may own execution');
    }
    if (f.SERVER_BRAIN && f.CLIENT_BRAIN) {
        violations.push('SERVER_BRAIN && CLIENT_BRAIN both true — only one side may own decisioning');
    }
    // [Phase 2 S4-B0] Bybit safety mutex — see DEFAULTS for full semantics.
    // (1) TESTNET and LIVE cannot both be true; an account/process can only
    //     be pointing at one Bybit environment at a time. The single-exchange
    //     + single-env rule remains DB-enforced (exchange_accounts UNIQUE
    //     INDEX); these flags add a process-wide guard rail on top.
    if (f.BYBIT_TESTNET_ENABLED && f.BYBIT_LIVE_ENABLED) {
        violations.push('BYBIT_TESTNET_ENABLED && BYBIT_LIVE_ENABLED both true — only one Bybit env may be enabled per process');
    }
    // (2) DRY_RUN is the master safety latch. While true, NO Bybit HTTP must
    //     ever leave the process — even testnet. LIVE explicitly cannot flip
    //     true while DRY_RUN is still on; operator must lower DRY_RUN first.
    if (f.BYBIT_LIVE_ENABLED && f.BYBIT_DRY_RUN_ONLY) {
        violations.push('BYBIT_LIVE_ENABLED && BYBIT_DRY_RUN_ONLY both true — disable BYBIT_DRY_RUN_ONLY before enabling LIVE');
    }
    // [Phase 2 S6-B0] DEMO server-authority carve-out mutex. The carve-out
    // flags must NEVER co-exist with their global counterparts (one-way
    // ratchet — once full SERVER_AT/SERVER_BRAIN is on, the demo-only carve
    // is redundant and confusing) and must NEVER co-exist with any Bybit
    // execution flag (DEMO carve cannot accidentally route to a real
    // exchange).
    if (f.SERVER_AT_DEMO && f.SERVER_AT) {
        violations.push('SERVER_AT_DEMO && SERVER_AT both true — DEMO carve-out is redundant once full SERVER_AT is enabled; disable one before enabling the other');
    }
    if (f.SERVER_BRAIN_DEMO && f.SERVER_BRAIN) {
        violations.push('SERVER_BRAIN_DEMO && SERVER_BRAIN both true — DEMO carve-out is redundant once full SERVER_BRAIN is enabled; disable one before enabling the other');
    }
    // [P6 2026-05-29] Uniform-mode revision — the SERVER_AT_DEMO && BYBIT_*_ENABLED
    // mutexes are LIFTED. Demo execution is SIMULATED by mode (mode==='demo' →
    // registerManualPosition, _entryCreds=null → no real exchange order), NOT by the
    // absence of Bybit flags. So demo (simulated) coexists with a real Bybit env in
    // the same process — different users/modes route independently. The genuine
    // Bybit-env safety mutexes (TESTNET⊕LIVE @214, LIVE⊕DRY_RUN @220) remain in force,
    // as do the SERVER_AT_DEMO/SERVER_BRAIN_DEMO redundancy ratchets vs full server flags.
    // [Task C 2026-05-28] TESTNET carve-out mutex vs full SERVER_AT.
    // Full SERVER_AT covers TESTNET; the carve-out is redundant + confusing
    // if both flags ever flip true via manual edit or admin route race.
    // Same rationale as SERVER_AT_DEMO above — one-way ratchet.
    if (f.SERVER_AT_TESTNET && f.SERVER_AT) {
        violations.push('SERVER_AT_TESTNET && SERVER_AT both true — TESTNET carve-out is redundant once full SERVER_AT is enabled; disable one before enabling the other');
    }
    // [SP2-5 2026-06-02] TESTNET_EXEC carve-out mutex vs full SERVER_AT.
    // Same one-way ratchet rationale as SERVER_AT_TESTNET above — full
    // SERVER_AT subsumes the testnet-exec carve-out, so both true is
    // incoherent and must never boot into dual-execution.
    if (f.SERVER_AT_TESTNET_EXEC && f.SERVER_AT) {
        violations.push('SERVER_AT_TESTNET_EXEC && SERVER_AT both true — TESTNET_EXEC carve-out is redundant once full SERVER_AT is enabled; disable one before enabling the other');
    }
    return { ok: violations.length === 0, violations };
}

function _enforceMutexStrict() {
    const v = _validateMutex(flags);
    if (v.ok) return;
    const header = '[MF] FATAL: migration flag mutex violated — refusing to start.';
    const detail = v.violations.map((m) => '  • ' + m).join('\n');
    const hint = '\nFix by editing data/migration_flags.json so at most ONE of '
        + '{CLIENT_AT,SERVER_AT} and ONE of {CLIENT_BRAIN,SERVER_BRAIN} is true.';
    console.error(header + '\n' + detail + hint);
    const err = new Error('Migration flag mutex violation: ' + v.violations.join('; '));
    err.code = 'MF_MUTEX_VIOLATION';
    throw err;
}
_enforceMutexStrict();

// ── Persist to disk ──
function save() {
    try {
        const dir = path.dirname(FLAGS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const tmp = FLAGS_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(flags, null, 2));
        fs.renameSync(tmp, FLAGS_FILE);
    } catch (err) {
        console.error('[MF] Failed to persist migration flags:', err.message);
    }
}

// ── Update a flag safely ──
// [Phase 2 S1.C] Reject the write if the resulting state would violate mutex
// instead of silently coercing the opposite flag to false. Caller (admin)
// must disable the conflicting flag first.
function set(key, value) {
    if (!(key in DEFAULTS)) throw new Error(`Unknown migration flag: ${key}`);
    if (typeof value !== 'boolean') throw new Error(`Migration flag value must be boolean`);
    const candidate = Object.assign({}, flags, { [key]: value });
    const v = _validateMutex(candidate);
    if (!v.ok) {
        const err = new Error('Migration flag mutex violation: ' + v.violations.join('; '));
        err.code = 'MF_MUTEX_VIOLATION';
        throw err;
    }
    flags[key] = value;
    save();
    console.log(`[MF] ${key} = ${flags[key]}`);
    // [Wave 1] R0 config rollback — snapshot every flag change for <60s rollback.
    try {
        const cr = require('./services/ml/R0_substrate/configRollback');
        const { db: _db } = require('./services/database');
        const currentVersion = _db.prepare(
            "SELECT MAX(version) as v FROM ml_config_snapshots WHERE config_key = ?"
        ).get(key);
        const nextVersion = (currentVersion && currentVersion.v ? currentVersion.v : 0) + 1;
        cr.snapshotConfig({
            userId: 0, resolvedEnv: 'SYSTEM',
            configKey: key, value, version: nextVersion,
            actor: 'migrationFlags.set', reason: 'flag_change',
        });
    } catch (_) { /* never block flag set on rollback snapshot */ }
    // [REAL-GATE P0-4 2026-06-09] Any flip re-checks REAL-gate coherence (lazy
    // require avoids a boot-order cycle; assertAndAlert never throws).
    try {
        require('./services/realGateCoherence').assertAndAlert(getAll(), `set(${key})`);
    } catch (e) { console.error('[REAL_GATE] coherence guard failed to load: ' + e.message); }
    return Object.assign({}, flags);
}

// ── Read-only snapshot ──
function getAll() {
    return Object.assign({}, flags);
}

module.exports = {
    // Direct flag access (read-only semantics — use set() to change)
    get SERVER_MARKET_DATA() { return flags.SERVER_MARKET_DATA; },
    get SERVER_BRAIN() { return flags.SERVER_BRAIN; },
    get SERVER_AT() { return flags.SERVER_AT; },
    get CLIENT_BRAIN() { return flags.CLIENT_BRAIN; },
    get CLIENT_AT() { return flags.CLIENT_AT; },
    get POSITIONS_WS() { return flags.POSITIONS_WS; },
    get PARITY_SHADOW_ENABLED() { return flags.PARITY_SHADOW_ENABLED; },
    get DSL_PARITY_SHADOW_ENABLED() { return _DSL_PARITY_SHADOW_ENABLED; },
    get ML_DSL_SHADOW_ENABLED() { return _ML_DSL_SHADOW_ENABLED; },
    get ML_DSL_LEARN_ENABLED() { return _ML_DSL_LEARN_ENABLED; },
    get ALT_WS_FEEDS() { return flags.ALT_WS_FEEDS; },
    // [Phase 2 S4-B0] Bybit safety flags — inert until S4-B1+ ship.
    get BYBIT_TESTNET_ENABLED() { return flags.BYBIT_TESTNET_ENABLED; },
    get BYBIT_LIVE_ENABLED() { return flags.BYBIT_LIVE_ENABLED; },
    get BYBIT_PARITY_ENABLED() { return flags.BYBIT_PARITY_ENABLED; },
    get BYBIT_DRY_RUN_ONLY() { return flags.BYBIT_DRY_RUN_ONLY; },
    // [Phase 2 S6-B0] DEMO server-authority carve-out flags — inert until
    // S6-B1..B6 ship.
    get SERVER_BRAIN_DEMO() { return flags.SERVER_BRAIN_DEMO; },
    get SERVER_AT_DEMO() { return flags.SERVER_AT_DEMO; },
    get SERVER_AT_TESTNET() { return flags.SERVER_AT_TESTNET; },
    // SP2 testnet-exec master toggle (per-user gated by sp2_cutover_users.json).
    get SERVER_AT_TESTNET_EXEC() { return flags.SERVER_AT_TESTNET_EXEC; },
    // [SP2-b 2026-06-07] FULL server ownership — server opens with client present;
    // client AT engine locked via serverActive. Rollback lever to SP2-a hybrid.
    get SERVER_AT_FULL_OWNERSHIP() { return flags.SERVER_AT_FULL_OWNERSHIP; },
    // [SERVER-ARES 2026-06-07] Server-side ARES engine. Rollback lever.
    get SERVER_ARES() { return flags.SERVER_ARES; },
    // [M1.2 Cat C 2026-05-14] LIVE_ENTRY_UNIFIED — controls Path A/B unification
    // burn-in per ADR-001 Decision 3.1. Default TRUE = safe path.
    get LIVE_ENTRY_UNIFIED() { return flags.LIVE_ENTRY_UNIFIED; },
    // [LIQ-FEED PROXY 2026-05-14] LIQ_FEED_VIA_SERVER — client liq feed
    // source: server proxy (true) vs direct exchange WS (false).
    get LIQ_FEED_VIA_SERVER() { return flags.LIQ_FEED_VIA_SERVER; },
    // [OMEGA Wave 1A 2026-05-14] ML influence chain — default OFF on all.
    // DEMO (post S6) → TESTNET (post S8) → REAL (post S10/S11).
    get ML_INGEST_ENABLED() { return flags.ML_INGEST_ENABLED; },
    get ML_PIPELINE_SHADOW() { return flags.ML_PIPELINE_SHADOW; },
    get ML_DEMO_INFLUENCE_ENABLED() { return flags.ML_DEMO_INFLUENCE_ENABLED; },
    get ML_TESTNET_INFLUENCE_ENABLED() { return flags.ML_TESTNET_INFLUENCE_ENABLED; },
    get ML_LIVE_INFLUENCE_ENABLED() { return flags.ML_LIVE_INFLUENCE_ENABLED; },
    get WS_PROXY_ENABLED() { return flags.WS_PROXY_ENABLED; },
    get ML_LIVE_OPTIN_REQUIRED() { return flags.ML_LIVE_OPTIN_REQUIRED; },
    get ML_BANDIT_AUTO_APPLY_MINOR() { return flags.ML_BANDIT_AUTO_APPLY_MINOR; },
    get ML_HYBRID_POOLING_ENABLED() { return flags.ML_HYBRID_POOLING_ENABLED; },
    get ML_OVERRIDE_RESOLVER_ENABLED() { return flags.ML_OVERRIDE_RESOLVER_ENABLED; },
    get ML_CRON_SCAN_ENABLED() { return flags.ML_CRON_SCAN_ENABLED; },
    get USERDATA_STREAM_ENABLED() { return flags.USERDATA_STREAM_ENABLED; },
    get _USERDATA_STREAM_TESTNET_ENABLED() { return flags._USERDATA_STREAM_TESTNET_ENABLED; },
    get _USERDATA_STREAM_REAL_ENABLED() { return flags._USERDATA_STREAM_REAL_ENABLED; },
    get SERVER_AUTHORITATIVE_POSITIONS() { return flags.SERVER_AUTHORITATIVE_POSITIONS; },
    get _SRV_POS_TESTNET_ENABLED() { return flags._SRV_POS_TESTNET_ENABLED; },
    get _SRV_POS_REAL_ENABLED() { return flags._SRV_POS_REAL_ENABLED; },
    // Methods
    set,
    getAll,
    save,
    DEFAULTS,
    // [Phase 2 S6-B0] Test-only hook for the S6-B0 probe. Exposes
    // _validateMutex so the probe can exercise mutex carve-outs against
    // synthetic flag combinations without mutating live state. Frozen;
    // never called by any runtime path (mirrors the _s5TestHooks /
    // _s6TestHooks pattern in serverAT/serverBrain).
    _s6b0TestHooks: Object.freeze({
        validateMutex: _validateMutex,
    }),
};

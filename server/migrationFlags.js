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
};

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
    get ALT_WS_FEEDS() { return flags.ALT_WS_FEEDS; },
    // Methods
    set,
    getAll,
    save,
    DEFAULTS,
};

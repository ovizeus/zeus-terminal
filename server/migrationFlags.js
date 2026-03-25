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
function _enforceMutex() {
    if (flags.SERVER_AT && flags.CLIENT_AT) {
        console.error('[MF] SAFETY VIOLATION: SERVER_AT and CLIENT_AT both true! Forcing CLIENT_AT=false');
        flags.CLIENT_AT = false;
    }
    if (flags.SERVER_BRAIN && flags.CLIENT_BRAIN) {
        console.error('[MF] SAFETY VIOLATION: SERVER_BRAIN and CLIENT_BRAIN both true! Forcing CLIENT_BRAIN=false');
        flags.CLIENT_BRAIN = false;
    }
}
_enforceMutex();

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
function set(key, value) {
    if (!(key in DEFAULTS)) throw new Error(`Unknown migration flag: ${key}`);
    if (typeof value !== 'boolean') throw new Error(`Migration flag value must be boolean`);
    flags[key] = value;
    _enforceMutex();
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
    // Methods
    set,
    getAll,
    save,
    DEFAULTS,
};

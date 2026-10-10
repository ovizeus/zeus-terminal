const fs = require('fs');
const path = require('path');

// [P15 2026-10-10] The client builds its user-context push from one object
// literal and the server accepts one hardcoded set of section names. When the
// two drift, the server does not fail — it increments a `rejected` counter and
// returns ok. That is exactly how `chartExtras` was lost: the client emitted it,
// the whitelist did not list it, and it produced 7,175 SILENT rejections over
// one soak before anybody noticed, with the operator's chart toggles quietly
// not persisting the whole time (see the [SEC-29] note in userContext.js).
//
// Adding `drawings` for the cross-device sync put a second section through that
// same gate, so the drift is pinned here instead of being rediscovered.

const ROOT = path.join(__dirname, '..', '..', '..', '..');

/** Section names the client actually emits, read from _buildAllSections. */
function clientSections() {
    const src = fs.readFileSync(path.join(ROOT, 'client', 'src', 'core', 'config.ts'), 'utf8');
    const lines = src.split('\n');
    const start = lines.findIndex((l) => l.includes('function _buildAllSections'));
    expect(start).toBeGreaterThan(-1);
    const out = [];
    // The literal is `return { ... }`; walk to its closing brace at that indent.
    let inReturn = false;
    for (let i = start; i < lines.length; i++) {
        const line = lines[i];
        if (!inReturn) { if (/^\s*return \{\s*$/.test(line)) inReturn = true; continue; }
        if (/^\s{2}\}\s*$/.test(line)) break;
        // Top-level keys only: exactly four spaces of indent, `name: {`
        const m = line.match(/^ {4}([a-zA-Z][a-zA-Z0-9_]*):\s*\{/);
        if (m) out.push(m[1]);
    }
    return out;
}

const { ALLOWED_SECTIONS, SQLITE_SECTIONS } = require('../../../../server/routes/userContext');

describe('user-context sections stay in step across client and server', () => {
    const client = clientSections();

    it('reads a plausible set of client sections (guard on the parser itself)', () => {
        // If this parser silently matched nothing, every assertion below would
        // pass vacuously — the failure mode of the first version of the
        // indicator-list parity test.
        expect(client.length).toBeGreaterThanOrEqual(15);
        expect(client).toContain('settings');
        expect(client).toContain('chartExtras');
    });

    it('accepts every section the client emits — a missing one is REJECTED SILENTLY', () => {
        const unlisted = client.filter((s) => !ALLOWED_SECTIONS.has(s));
        expect(unlisted).toEqual([]);
    });

    it('accepts the drawings section added for the cross-device sync', () => {
        expect(client).toContain('drawings');
        expect(ALLOWED_SECTIONS.has('drawings')).toBe(true);
    });

    it('stores drawings in SQLite like the other content sections', () => {
        expect(SQLITE_SECTIONS.has('drawings')).toBe(true);
    });

    it('never lists a SQLite section the whitelist does not also allow', () => {
        const orphans = [...SQLITE_SECTIONS].filter((s) => !ALLOWED_SECTIONS.has(s));
        expect(orphans).toEqual([]);
    });
});

'use strict';
// [2026-10-10] Zeus has a crash alert — process.on('uncaughtException') sends
// "🔴 ZEUS CRASH" to Telegram. It did not fire once during last night's 1082
// crashes, and the reason is pure ordering: the database is required on line
// 19 of server.js and the handler was registered on line 2134, so a failure
// while modules load — which is exactly the failure that causes a crash loop —
// died 2115 lines before anything was listening.
//
// The handlers must be armed before the first require that can throw.

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
const lines = SRC.split('\n');

function lineOf(re) {
    for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
    return -1;
}

describe('the crash alert is armed before anything can crash', () => {
    const uncaught = lineOf(/process\.on\(\s*'uncaughtException'/);
    const rejection = lineOf(/process\.on\(\s*'unhandledRejection'/);

    test('both handlers exist', () => {
        expect(uncaught).toBeGreaterThan(0);
        expect(rejection).toBeGreaterThan(0);
    });

    test('they are registered before the first local require', () => {
        // Node builtins cannot realistically throw on load; our own modules can,
        // and database.js is the one that did.
        // Top-level only (column 0): the lazy requires inside the handlers are
        // deliberate — they run at crash time, not load time.
        const firstLocal = lineOf(/^(?:const|let|var)\s+.*=\s*require\(\s*'\.\//);
        expect(firstLocal).toBeGreaterThan(0);
        expect(uncaught).toBeLessThan(firstLocal);
        expect(rejection).toBeLessThan(firstLocal);
    });

    test('specifically before the database, which is what killed it', () => {
        const dbLine = lineOf(/require\(\s*'\.\/server\/services\/database'/);
        expect(dbLine).toBeGreaterThan(0);
        expect(uncaught).toBeLessThan(dbLine);
    });
});

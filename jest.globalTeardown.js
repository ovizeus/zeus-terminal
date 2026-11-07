'use strict';

// [2026-11-07] Remove the throwaway database created by jest.globalSetup.
// Only ever removes a directory this run created, never a path somebody else
// chose: deleting a database because of a tidy-up is not a mistake worth
// risking.
const fs = require('fs');

module.exports = async () => {
    const dir = process.env.ZEUS_JEST_TMPDIR;
    if (!dir || !/zeus-jest-/.test(dir)) return;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* a leftover temp dir is harmless */ }
};

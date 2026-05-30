'use strict';

// [P3] telegram.send() defaults parse_mode='Markdown' (_sendWithRetry). Plain
// informational alerts that contain Markdown specials — e.g. the restart-anomaly
// message "... SERVER_BOOT events ..." (underscore) — fail the first Markdown
// attempt ("can't parse entities"), log "[TELEGRAM] Send failed", and only
// deliver on the 2s plain-text retry. escapeMarkdown lets such callers escape
// dynamic identifiers so the first attempt succeeds (no error spam, no 2s delay).

const telegram = require('../../server/services/telegram');

describe('telegram.escapeMarkdown', () => {
    it('escapes the underscore in identifiers like SERVER_BOOT', () => {
        expect(telegram.escapeMarkdown('SERVER_BOOT')).toBe('SERVER\\_BOOT');
    });
    it('escapes the legacy-Markdown specials _ * ` [', () => {
        expect(telegram.escapeMarkdown('a_b*c`d[e')).toBe('a\\_b\\*c\\`d\\[e');
    });
    it('leaves safe text untouched', () => {
        expect(telegram.escapeMarkdown('Zeus restart count anomaly: 14')).toBe('Zeus restart count anomaly: 14');
    });
    it('handles null/undefined/number safely', () => {
        expect(telegram.escapeMarkdown(null)).toBe('');
        expect(telegram.escapeMarkdown(undefined)).toBe('');
        expect(telegram.escapeMarkdown(42)).toBe('42');
    });
});

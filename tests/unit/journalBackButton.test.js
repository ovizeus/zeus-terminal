/**
 * [2026-11-06] The trade journal is reached from inside the app, but its Back
 * control was a bare cyan text link while every in-app Back is the framed
 * .zpv-back button. This pins the journal to the app's button so a future edit
 * cannot quietly drift it back to a text link.
 *
 * It reads the shipped files, not a copy: public/journal.html is served
 * statically, so the file on disk IS what the browser gets.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('trade journal Back button', () => {
    const journal = read('public/journal.html');

    it('uses the app\'s .zpv-back class, exactly once', () => {
        const hits = journal.match(/class="zpv-back"/g) || [];
        expect(hits).toHaveLength(1);
    });

    it('no longer renders a bare text link', () => {
        expect(journal).not.toMatch(/←\s*BACK/);
        // the giveaway of the old one: a hand-rolled cyan inline style
        expect(journal).not.toMatch(/color:#00d4ff;text-decoration:none;font-size:12px/);
    });

    it('carries the same arrow glyph as the app\'s PageView header', () => {
        const pageView = read('client/src/components/layout/PageView.tsx');
        const appArrow = (pageView.match(/d="(M19 12H5M12 19l-7-7 7-7)"/) || [])[1];
        expect(appArrow).toBeTruthy();
        expect(journal).toContain(`d="${appArrow}"`);
    });

    it('labels it "Back", like the app, not "BACK"', () => {
        expect(journal).toContain('<span>Back</span>');
    });

    it('resets text-decoration, because .zpv-back was written for a <button>', () => {
        expect(journal).toMatch(/class="zpv-back"[^>]*text-decoration:\s*none/);
    });

    it('loads the stylesheet that actually defines .zpv-back', () => {
        expect(journal).toContain('/css/main.css');
        expect(read('public/css/main.css')).toContain('.zpv-back {');
    });
});

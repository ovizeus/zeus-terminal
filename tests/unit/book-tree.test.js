// Operatorul citeşte cartea DIN APLICAŢIE, de pe telefon. Reorganizarea pe
// foldere (docs/book/) era pe disc, deci invizibilă pentru el: „pai intru in
// book si e la fel". Modulul ăsta e puntea — serveşte folderele deja generate
// de `scripts/book-split.py`, ca să nu existe o a doua clasificare care să
// plece în altă direcţie decât prima.
//
// Ce pin-uiesc testele: structura servită, titlurile citite din fişiere, şi —
// cel mai important — că numele venite din cerere NU pot ieşi din docs/book/.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { listTree, resolveSection } = require('../../server/services/bookTree');

let base;

beforeAll(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'booktree-'));
    fs.writeFileSync(path.join(base, 'START.md'), '# START\n\nstarea de acum\n');
    fs.writeFileSync(path.join(base, 'INDEX.md'), '# Index\n');
    fs.writeFileSync(path.join(base, '0-PREAMBUL.md'), '# Book of All\n');

    const cat = path.join(base, '4-LIVRATE');
    fs.mkdirSync(cat);
    fs.writeFileSync(path.join(cat, 'README.md'), '# Livrate\n\n> ce s-a facut\n');
    fs.writeFileSync(path.join(cat, '01-ceva-reparat.md'),
        '<!-- generat din docs/BOOK_OF_ALL.md linia 10 -->\n\n## 🏁 2026-10-24 — ceva reparat (b311)\n\ncorp\n');
    fs.writeFileSync(path.join(cat, '02-altceva.md'), '## Altceva, fara data\n\ncorp\n');

    const gol = path.join(base, '9-ARHIVA');
    fs.mkdirSync(gol);
});

describe('listTree', () => {
    test('serveşte START.md ca pagina de intrare', () => {
        expect(listTree(base).start).toContain('starea de acum');
    });

    test('listează coşurile, cu numărul de secţiuni', () => {
        const t = listTree(base);
        const ids = t.cats.map((c) => c.id);
        expect(ids).toContain('4-LIVRATE');
        expect(ids).toContain('9-ARHIVA');
        expect(t.cats.find((c) => c.id === '4-LIVRATE').count).toBe(2);
        expect(t.cats.find((c) => c.id === '9-ARHIVA').count).toBe(0);
    });

    test('README.md nu e o secţiune — e indexul coşului', () => {
        const files = listTree(base).cats.find((c) => c.id === '4-LIVRATE').items.map((i) => i.file);
        expect(files).not.toContain('README.md');
        expect(files).toEqual(['01-ceva-reparat.md', '02-altceva.md']);
    });

    test('titlul vine din `## ` al secţiunii, nu din numele fişierului', () => {
        const it = listTree(base).cats.find((c) => c.id === '4-LIVRATE').items[0];
        expect(it.title).toBe('🏁 2026-10-24 — ceva reparat (b311)');
        expect(it.date).toBe('2026-10-24');
    });

    test('o secţiune fără dată în titlu nu inventează una', () => {
        expect(listTree(base).cats.find((c) => c.id === '4-LIVRATE').items[1].date).toBe(null);
    });

    test('un folder lipsă nu aruncă — întoarce o carte goală', () => {
        const t = listTree(path.join(base, 'nu-exista'));
        expect(t.cats).toEqual([]);
        expect(t.start).toBe(null);
    });
});

describe('resolveSection — nu se iese din docs/book/', () => {
    test('citeşte o secţiune reală', () => {
        expect(resolveSection(base, '4-LIVRATE', '01-ceva-reparat.md')).toContain('ceva reparat');
    });

    test.each([
        ['..', 'README.md'],
        ['4-LIVRATE', '../../../etc/passwd'],
        ['4-LIVRATE', '..%2f..%2fetc%2fpasswd'],
        ['../../server', 'index.js'],
        ['4-LIVRATE/../..', 'package.json'],
        ['', 'START.md'],
        ['4-LIVRATE', 'README.md.bak'],
        ['4-LIVRATE', '/etc/passwd'],
    ])('refuză cat=%s file=%s', (cat, file) => {
        expect(resolveSection(base, cat, file)).toBe(null);
    });

    test('refuză un fişier care nu există, fără să arunce', () => {
        expect(resolveSection(base, '4-LIVRATE', '99-nu-exista.md')).toBe(null);
    });

    test('refuză un coş care nu respectă tiparul, chiar dacă există pe disc', () => {
        fs.mkdirSync(path.join(base, 'secret'), { recursive: true });
        fs.writeFileSync(path.join(base, 'secret', '01-x.md'), 'x');
        expect(resolveSection(base, 'secret', '01-x.md')).toBe(null);
    });
});

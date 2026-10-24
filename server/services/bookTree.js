'use strict';

// ─── Book of All — puntea dintre folderele de pe disc şi aplicaţie ───
//
// [2026-10-24] Operatorul citeşte cartea DIN APLICAŢIE, de pe telefon.
// Reorganizarea pe coşuri (`docs/book/`, generată de `scripts/book-split.py`)
// era doar pe disc, deci pentru el nu se schimbase nimic: „pai intru in book
// si e la fel".
//
// Modulul ăsta serveşte folderele DEJA generate. Nu re-clasifică nimic:
// o a doua clasificare, scrisă în altă limbă, ar pleca în altă direcţie decât
// prima la prima secţiune ambiguă.

const fs = require('fs');
const path = require('path');

// Un coş arată aşa: `4-LIVRATE`. Orice altceva nu e coş, chiar dacă există pe disc.
const CAT_RE = /^[1-9]-[A-Z-]+$/;
// O secţiune arată aşa: `07-ceva-oarecare.md`, exact cum o scrie scriptul.
const FILE_RE = /^[0-9]{2}-[a-z0-9-]+\.md$/;

function _read(p) {
    try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
}

/** Titlul unei secţiuni e primul `## ` din ea — nu numele fişierului, care e tăiat la 64 de caractere. */
function _titleOf(text, fallback) {
    const line = String(text || '').split('\n').find((l) => l.startsWith('## '));
    return line ? line.slice(3).trim() : fallback;
}

function _dateOf(title) {
    const m = String(title || '').match(/\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : null;
}

/** Descrierea coşului stă în `README.md`-ul lui, pe rândul de citat. */
function _descOf(readme) {
    const line = String(readme || '').split('\n').find((l) => l.startsWith('> '));
    return line ? line.slice(2).trim() : null;
}

function listTree(baseDir) {
    const empty = { start: null, index: null, cats: [], updatedAt: null };
    let entries;
    try { entries = fs.readdirSync(baseDir, { withFileTypes: true }); } catch (e) { return empty; }

    const cats = entries
        .filter((e) => e.isDirectory() && CAT_RE.test(e.name))
        .map((e) => e.name)
        .sort()
        .map((id) => {
            const dir = path.join(baseDir, id);
            let files = [];
            try {
                files = fs.readdirSync(dir).filter((f) => FILE_RE.test(f)).sort();
            } catch (e) { files = []; }
            const items = files.map((f) => {
                const title = _titleOf(_read(path.join(dir, f)), f.replace(/\.md$/, ''));
                return { file: f, title, date: _dateOf(title) };
            });
            return {
                id,
                title: id.split('-').slice(1).join(' '),
                desc: _descOf(_read(path.join(dir, 'README.md'))),
                count: items.length,
                items,
            };
        });

    let updatedAt = null;
    try { updatedAt = fs.statSync(path.join(baseDir, 'START.md')).mtime.toISOString(); } catch (e) { /* fără START */ }

    return {
        start: _read(path.join(baseDir, 'START.md')),
        index: _read(path.join(baseDir, 'INDEX.md')),
        cats,
        updatedAt,
    };
}

/**
 * Citeşte o secţiune, sau `null`. Numele vin din cerere, deci se validează
 * întâi tiparul şi apoi se verifică pe calea rezolvată că n-am ieşit din coş —
 * tiparul singur e o promisiune, `path.dirname` e o dovadă.
 */
function resolveSection(baseDir, cat, file) {
    if (!CAT_RE.test(String(cat || '')) || !FILE_RE.test(String(file || ''))) return null;
    const dir = path.resolve(baseDir, cat);
    const full = path.resolve(dir, file);
    if (path.dirname(full) !== dir) return null;
    if (path.relative(path.resolve(baseDir), full).startsWith('..')) return null;
    return _read(full);
}

module.exports = { listTree, resolveSection, CAT_RE, FILE_RE };

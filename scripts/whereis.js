#!/usr/bin/env node
'use strict';
// Zeus — turn a minified crash location back into a real file and line.
//
// [2026-10-13] The reason this exists: the operator crash on 2026-10-11 arrived
// in the log as
//
//   filename: ".../index-CorJ7oIn.js"  lineno: 54  colno: 70
//
// A content hash and a column. Working out that it meant DslDrivePanel.tsx took
// a day of reading candidates. The build now emits hidden sourcemaps, stashed
// outside the served directory, and this translates one back in a second.
//
// Usage:
//   node scripts/whereis.js index-CnsB7JyC.js 54 70
//   node scripts/whereis.js index-CnsB7JyC.js:54:70
//   node scripts/whereis.js            # reads the latest CLIENT_ERR from the log
//
// Reads only local files. Sends nothing anywhere — that is the whole point of
// keeping the maps here instead of handing them to a third party.

const fs = require('fs');
const path = require('path');
const { TraceMap, originalPositionFor } = require('@jridgewell/trace-mapping');

const ROOT = '/opt/zeus-terminal';
const MAPDIR = path.join(ROOT, 'sourcemaps');

function findMap(file) {
  const base = path.basename(String(file).split('?')[0]);
  if (!fs.existsSync(MAPDIR)) return null;
  // newest build first, so a current bundle wins over a stale one
  const builds = fs.readdirSync(MAPDIR)
    .filter((d) => /^b\d+$/.test(d))
    .sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
  for (const b of builds) {
    const p = path.join(MAPDIR, b, base + '.map');
    if (fs.existsSync(p)) return { path: p, build: b };
  }
  return null;
}

function resolve(file, line, col) {
  const found = findMap(file);
  if (!found) {
    return { error: `no stashed map for ${path.basename(file)} — maps live in ${MAPDIR}/b<build>/` };
  }
  const tm = new TraceMap(JSON.parse(fs.readFileSync(found.path, 'utf8')));
  const pos = originalPositionFor(tm, { line: Number(line), column: Number(col) });
  return { ...pos, build: found.build };
}

function latestFromLog() {
  const dir = path.join(ROOT, 'data', 'logs');
  const rows = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.startsWith('zeus.log'))) {
    for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!l.includes('CLIENT_ERR')) continue;
      try {
        const d = JSON.parse(l);
        if (d.data && d.data.filename && d.data.lineno != null) rows.push(d);
      } catch (_) { /* a truncated line is not an error worth reporting */ }
    }
  }
  rows.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  return rows[rows.length - 1] || null;
}

const args = process.argv.slice(2);
let file, line, col, ctx = '';

if (args.length === 0) {
  const row = latestFromLog();
  if (!row) { console.log('no CLIENT_ERR with a file and line in the logs yet'); process.exit(0); }
  file = row.data.filename; line = row.data.lineno; col = row.data.colno || 0;
  ctx = `latest client error: ${row.ts}\n  ${row.msg}\n`;
} else if (args.length === 1 && args[0].includes(':')) {
  const p = args[0].split(':');
  col = p.pop(); line = p.pop(); file = p.join(':');
} else {
  [file, line, col] = args;
}

if (ctx) console.log(ctx);
const r = resolve(file, line, col || 0);
if (r.error) { console.error(r.error); process.exit(1); }
console.log(`  ${path.basename(file)}:${line}:${col}   (map from ${r.build})`);
if (!r.source) {
  // A position can genuinely have no mapping: a column past the end of that
  // line, a fabricated location, or generated glue the compiler owns. Say so,
  // rather than printing question marks that read like a broken tool.
  console.log('  -> no mapping at that position.');
  console.log('     Check the line and column are the ones the log reported, and that');
  console.log('     the bundle name matches the build the user was actually running.');
  process.exit(2);
}
// Maps record the source relative to themselves; print it relative to the repo.
const clean = String(r.source).replace(/^(\.\.\/)+/, '').replace(/^\/+/, '');
console.log(`  -> ${clean}:${r.line}:${r.column}`);
if (r.name) console.log(`  -> in ${r.name}`);

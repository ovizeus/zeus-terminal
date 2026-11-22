'use strict';
// [2026-11-22] Curatarea saptamanala a resturilor de teste: sterge DOAR dosare `prefix-XXXXXX`
// mai vechi decat pragul; nu atinge fisiere, nume obisnuite sau dosare recente.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '../../scripts/cleanup-test-tmp.sh');
let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-root-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

function mk(name, ageMin, isDir = true) {
    const p = path.join(root, name);
    if (isDir) { fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'test.db'), 'x'); } else fs.writeFileSync(p, 'x');
    const t = new Date(Date.now() - ageMin * 60_000);
    fs.utimesSync(p, t, t);
    return p;
}

test('sterge doar dosarele de test vechi', () => {
    const oldTest = mk('r5-post-AbC123', 4000);
    const oldTest2 = mk('omega-w3-p150-x7Y29z', 4000);
    const fresh = mk('chat-learn-QwErTy', 10);
    const normal = mk('zeuswork', 4000);
    const shortSuffix = mk('build-abc', 4000);
    const file = mk('notes-AbC123', 4000, false);
    const log = path.join(root, 'cleanup.log');
    execFileSync('bash', [SCRIPT], { env: { ...process.env, TMP_ROOT: root, MIN_AGE_MIN: '2880', LOG: log, SKIP_RUNNING_CHECK: '1' } });
    expect(fs.existsSync(oldTest)).toBe(false);
    expect(fs.existsSync(oldTest2)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(normal)).toBe(true);
    expect(fs.existsSync(shortSuffix)).toBe(true);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(log, 'utf8')).toMatch(/OK: sterse 2 dosare de test/);
});

test('nu ruleaza cat timp ruleaza teste (aici chiar ruleaza jest)', () => {
    const oldTest = mk('r5-post-AbC123', 4000);
    const log = path.join(root, 'cleanup.log');
    execFileSync('bash', [SCRIPT], { env: { ...process.env, TMP_ROOT: root, LOG: log } });
    expect(fs.existsSync(oldTest)).toBe(true);
    expect(fs.readFileSync(log, 'utf8')).toMatch(/SKIP: teste in curs/);
});

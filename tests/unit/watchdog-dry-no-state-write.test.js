'use strict';
// [2026-10-20 b290] `--dry` scria starea persistenta. Bug preexistent, dar
// fereastra noua de suprimare a alertei de backup (24h) i-a dat dinti: o
// simpla rulare de proba cu --dry seta `lastBackupAlertAt` si INABUSEA o
// alerta adevarata timp de o zi. L-am produs chiar eu, proband fixul.
// O rulare de proba nu are voie sa schimbe nimic pe disc.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'health-watchdog.js');
const STATE = path.join(ROOT, 'data', 'health-watchdog-state.json');

describe('health-watchdog --dry', () => {
    test('NU modifica fisierul de stare', () => {
        const before = fs.existsSync(STATE) ? fs.readFileSync(STATE, 'utf8') : null;
        const backup = before;
        try {
            execFileSync('node', [SCRIPT, '--dry'], { encoding: 'utf8', timeout: 40000 });
        } catch (e) {
            // pm2 poate lipsi in mediul de test — ne interesează doar efectul pe disc
        }
        const after = fs.existsSync(STATE) ? fs.readFileSync(STATE, 'utf8') : null;
        expect(after).toBe(before);
        if (backup !== null && after !== backup) fs.writeFileSync(STATE, backup);
    });
});

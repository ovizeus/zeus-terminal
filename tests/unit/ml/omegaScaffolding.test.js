const fs = require('fs');
const path = require('path');

const ML_ROOT = path.join(__dirname, '..', '..', '..', 'server', 'services', 'ml');

const REQUIRED_DIRS = [
    'R-1_testHarness',
    'R0_substrate',
    'R1_constitution',
    'R2_brain',
    'R3A_safety',
    'R3B_validation',
    'R4_execution',
    'R5A_learning',
    'R5B_governance',
    'R6_shadowMeta',
    'R7_communication',
    '_audit',
    '_voice',
    '_operator',
];

describe('OMEGA Wave 1A — Scaffolding', () => {
    test('server/services/ml/ directory exists', () => {
        expect(fs.existsSync(ML_ROOT)).toBe(true);
        expect(fs.statSync(ML_ROOT).isDirectory()).toBe(true);
    });

    test.each(REQUIRED_DIRS)('subdirectory %s exists', (dirName) => {
        const dirPath = path.join(ML_ROOT, dirName);
        expect(fs.existsSync(dirPath)).toBe(true);
        expect(fs.statSync(dirPath).isDirectory()).toBe(true);
    });

    test('README.md exists with architecture overview', () => {
        const readmePath = path.join(ML_ROOT, 'README.md');
        expect(fs.existsSync(readmePath)).toBe(true);
        const content = fs.readFileSync(readmePath, 'utf8');
        expect(content).toContain('OMEGA');
        expect(content).toContain('9-ring');
    });
});

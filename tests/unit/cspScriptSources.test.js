'use strict';
// [2026-11-27] Securitate extra 8 — CSP: unpkg.com si cdn.jsdelivr.net gazduiesc ORICE pachet npm, deci o
// injectie ar putea incarca de acolo cod strain. Singurul lor folos era pagina /legacy (lightweight-charts
// 4.1.3) — servita acum local, acelasi fisier (aceeasi amprenta SRI).
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const ROOT = path.join(__dirname, '../..');
const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const scriptSrc = (srv.match(/scriptSrc:\s*\[([^\]]*)\]/) || [])[1] || '';

test('CSP script-src nu mai permite unpkg sau jsdelivr', () => {
    expect(scriptSrc).toBeTruthy();
    expect(scriptSrc).not.toMatch(/unpkg\.com|cdn\.jsdelivr\.net/);
});
test('pagina /legacy incarca graficele local, cu SRI', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public/legacy/index.html'), 'utf8');
    expect(html).not.toMatch(/unpkg\.com|cdn\.jsdelivr\.net/);
    expect(html).toMatch(/src="\/vendor\/lightweight-charts-4\.1\.3\.standalone\.production\.js"[\s\S]*?integrity="sha384-JZigAjwiaZtkUbA44CWkPaT3iBb\/mU5pO6QOANp\+OqHd4q\+1\+7MG1kzp2OOP9ZfP"/);
});
test('fisierul local e exact cel de pe CDN (amprenta SRI)', () => {
    const buf = fs.readFileSync(path.join(ROOT, 'public/vendor/lightweight-charts-4.1.3.standalone.production.js'));
    expect('sha384-' + crypto.createHash('sha384').update(buf).digest('base64')).toBe('sha384-JZigAjwiaZtkUbA44CWkPaT3iBb/mU5pO6QOANp+OqHd4q+1+7MG1kzp2OOP9ZfP');
});

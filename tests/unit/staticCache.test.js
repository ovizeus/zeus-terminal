'use strict';
// [2026-11-22] Pachetele cu cod in nume se tin in cache; restul (index.html, css/main.css) ramane proaspat.
const fs = require('fs');
const path = require('path');
const { cacheControlFor } = require('../../server/utils/staticCache');

test('pachetele Vite din /app/assets cu cod de 8 caractere → cache 1 an, immutable', () => {
    for (const f of ['/opt/z/public/app/assets/index-BcSSfbih.js', '/opt/z/public/app/assets/index-D8T_OrGe.css', '/opt/z/public/app/assets/marketDataChart-_fWnOOVd.js']) {
        expect(cacheControlFor(f)).toBe('public, max-age=31536000, immutable');
    }
});
test('index.html, foile vechi si fisierele fara cod raman „no-store" (o versiune noua ajunge imediat)', () => {
    for (const f of ['/opt/z/public/app/index.html', '/opt/z/public/css/main.css', '/opt/z/public/sw.js', '/opt/z/public/app/assets/chunk.js', '/opt/z/public/login.html']) {
        expect(cacheControlFor(f)).toBe('no-cache, no-store, must-revalidate');
    }
    expect(cacheControlFor('/opt/z/public/assets/icon-192.png')).toBeNull();
});
test('service worker-ul ia din cache doar pachetele cu cod; restul JS/CSS ramane „retea intai"', () => {
    const sw = fs.readFileSync(path.join(__dirname, '../../public/sw.js'), 'utf8');
    const m = sw.match(/if \(\/(.+?)\/\.test\(url\)\) \{\s*event\.respondWith\(\s*caches\.match/);
    expect(m).toBeTruthy();
    const re = new RegExp(m[1]);
    expect(re.test('https://zeus-terminal.com/app/assets/index-BcSSfbih.js')).toBe(true);
    expect(re.test('https://zeus-terminal.com/app/assets/index-D8T_OrGe.css?x=1')).toBe(true);
    expect(re.test('https://zeus-terminal.com/css/main.css')).toBe(false);
    expect(re.test('https://zeus-terminal.com/app/index.html')).toBe(false);
    expect(re.test('https://zeus-terminal.com/api/assets/x-12345678.js')).toBe(false);
});

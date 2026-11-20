'use strict';
// [2026-11-21] Share pentru cardul din jurnal: urcare autentificata, pagina publica cu og:image.
const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const request = require('supertest');

const S = require('../../server/routes/share');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const dataUrl = (buf, t = 'png') => `data:image/${t};base64,` + buf.toString('base64');

function app(uid) {
    const a = express();
    a.use(express.json({ limit: '1mb' }));
    a.use(S.publicRouter);
    a.use('/api/brain/share', (req, _res, next) => { if (uid != null) req.user = { id: uid }; next(); }, S.apiRouter);
    return a;
}

describe('share — cardul jurnalului', () => {
    const made = [];
    afterAll(() => { for (const f of made) { try { fs.unlinkSync(f); } catch (_) {} } });

    test('sniff: tipul REAL dupa primii octeti, nu ce declara clientul', () => {
        expect(S.sniff(PNG)).toBe('png');
        expect(S.sniff(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(20)]))).toBe('jpg');
        expect(S.sniff(Buffer.from('RIFF0000WEBPxxxx'))).toBe('webp');
        expect(S.sniff(Buffer.from('<svg onload=alert(1)>xxxxx'))).toBeNull();
    });

    test('urcare: fara cont 401; continut fals 400; imagine buna → link /s/<id> care chiar raspunde', async () => {
        expect((await request(app(null)).post('/api/brain/share').send({ image: dataUrl(PNG) })).status).toBe(401);
        expect((await request(app(1)).post('/api/brain/share').send({ image: dataUrl(Buffer.from('<html>not an image at all</html>')) })).status).toBe(400);
        expect((await request(app(1)).post('/api/brain/share').send({ image: 'javascript:alert(1)' })).status).toBe(400);
        const r = await request(app(1)).post('/api/brain/share').set('Host', 'zeus-terminal.com').send({ image: dataUrl(PNG) });
        expect(r.status).toBe(200);
        expect(r.body.url).toMatch(/^https?:\/\/zeus-terminal\.com\/s\/[A-Za-z0-9_-]{12}$/);
        const id = r.body.id;
        made.push(path.join(S._dir, id + '.png'));
        const page = await request(app(null)).get('/s/' + id).set('Host', 'zeus-terminal.com');
        expect(page.status).toBe(200);
        expect(page.text).toContain('property="og:image"');
        expect(page.text).toContain('/s/' + id + '.png');
        const img = await request(app(null)).get('/s/' + id + '.png');
        expect(img.status).toBe(200);
        expect(img.headers['content-type']).toBe('image/png');
    });

    test('pagina publica refuza id-uri false si calatorii prin dosare', async () => {
        expect((await request(app(null)).get('/s/..%2F..%2Fetc%2Fpasswd')).status).toBe(404);
        expect((await request(app(null)).get('/s/short')).status).toBe(404);
        expect((await request(app(null)).get('/s/AAAAAAAAAAAA')).status).toBe(404);
    });

    test('limita: 30 pe ora pe cont', () => {
        const t = Date.now();
        for (let i = 0; i < 30; i++) expect(S.allow(999, t)).toBe(true);
        expect(S.allow(999, t)).toBe(false);
        expect(S.allow(999, t + 3600_001)).toBe(true);
    });
});

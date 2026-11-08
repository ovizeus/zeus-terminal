'use strict';

// [2026-11-06] /api/byoi — Build Your Own Indicator.
// The database is mocked: these tests must never touch the live file, and the
// point here is the GATE and the OWNERSHIP checks, not SQLite.

const express = require('express');
const supertest = require('supertest');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '../../server/services/database');

function makeDb(overrides = {}) {
    return Object.assign({
        byoiInsertDraft: jest.fn((uid, d) => ({ id: 7, user_id: uid, status: 'draft', tier: d.tier, title: d.title, spec_json: d.specJson, notes: d.notes, price_cents: d.priceCents, currency: 'USD', created_at: 1, updated_at: 1 })),
        byoiUpdateDraft: jest.fn(() => null),
        byoiGetOwned: jest.fn(() => null),
        byoiListForUser: jest.fn(() => []),
        byoiDeleteDraft: jest.fn(() => false),
        byoiMarkSubmitted: jest.fn((id, uid, o) => ({ id, user_id: uid, status: o.status, tier: 'custom', title: 't', spec_json: '{}', notes: '', price_cents: 14900, currency: 'USD', payment_ref: o.paymentRef, created_at: 1, updated_at: 2 })),
        byoiAddAttachment: jest.fn(() => ({ id: 1, filename: 'a.png', mime: 'image/png', bytes: 10 })),
        byoiListAttachments: jest.fn(() => []),
        byoiGetAttachment: jest.fn(() => null),
        byoiDeleteAttachment: jest.fn(() => true),
        byoiListForAdmin: jest.fn(() => []),
        byoiGetForAdmin: jest.fn(() => null),
        byoiSetStatus: jest.fn((id, st) => ({ id, status: st, tier: 'custom', title: 't', spec_json: '{}', notes: '', price_cents: 14900, currency: 'USD', created_at: 1, updated_at: 2 })),
        byoiCountForAdmin: jest.fn(() => 0),
        getAdminUserIds: jest.fn(() => [1]),
    }, overrides);
}

const FULL_SPEC = {
    title: 'Ovi Wave', placement: 'pane', visuals: ['line'], sources: ['price'],
    timeframes: ['1h'], notes: 'draws a wave when the trend turns',
};

function build(db, env = {}) {
    jest.resetModules();
    jest.doMock(DB_PATH, () => db);
    for (const k of Object.keys(env)) process.env[k] = env[k];
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        const id = parseInt(req.headers['x-test-uid'], 10) || 0;
        if (id) req.user = { id, role: req.headers['x-test-role'] || 'user' };
        next();
    });
    app.use('/api/byoi', require('../../server/routes/byoi'));
    return app;
}

afterEach(() => { delete process.env.BYOI_BILLING_MODE; });

describe('/api/byoi — auth', () => {
    it('refuses everything without a session', async () => {
        const app = build(makeDb());
        for (const [m, u] of [['get', '/api/byoi/config'], ['get', '/api/byoi/requests'], ['post', '/api/byoi/draft'], ['post', '/api/byoi/submit/1']]) {
            const r = await supertest(app)[m](u);
            expect(r.status).toBe(401);
        }
    });

    it('keeps the operator endpoints away from a plain user', async () => {
        const app = build(makeDb());
        const r = await supertest(app).get('/api/byoi/admin/requests').set('x-test-uid', '5');
        expect(r.status).toBe(403);
    });
});

describe('/api/byoi/config', () => {
    it('serves the form and the prices from the one source', async () => {
        const app = build(makeDb());
        const r = await supertest(app).get('/api/byoi/config').set('x-test-uid', '5');
        expect(r.status).toBe(200);
        expect(r.body.fields.length).toBeGreaterThan(5);
        const custom = r.body.tiers.find((t) => t.id === 'custom');
        expect(custom.price).toBe('$149');
    });

    it('tells a plain user they cannot submit while billing is disabled', async () => {
        const app = build(makeDb(), { BYOI_BILLING_MODE: 'disabled' });
        const r = await supertest(app).get('/api/byoi/config').set('x-test-uid', '5');
        expect(r.body.canSubmit).toBe(false);
    });

    it('lets the operator walk it', async () => {
        const app = build(makeDb(), { BYOI_BILLING_MODE: 'disabled' });
        const r = await supertest(app).get('/api/byoi/config').set('x-test-uid', '1').set('x-test-role', 'admin');
        expect(r.body.canSubmit).toBe(true);
    });
});

describe('/api/byoi drafts', () => {
    it('saves a half-finished draft — that is what drafts are for', async () => {
        const db = makeDb();
        const app = build(db);
        const r = await supertest(app).post('/api/byoi/draft').set('x-test-uid', '5')
            .send({ tier: 'custom', spec: { title: 'half done' } });
        expect(r.status).toBe(200);
        expect(db.byoiInsertDraft).toHaveBeenCalled();
    });

    it('rejects an unknown tier', async () => {
        const app = build(makeDb());
        const r = await supertest(app).post('/api/byoi/draft').set('x-test-uid', '5')
            .send({ tier: 'platinum', spec: FULL_SPEC });
        expect(r.status).toBe(400);
    });

    it('rejects a value that is not one of the offered options', async () => {
        const app = build(makeDb());
        const r = await supertest(app).post('/api/byoi/draft').set('x-test-uid', '5')
            .send({ tier: 'custom', spec: { ...FULL_SPEC, visuals: ['laser-beam'] } });
        expect(r.status).toBe(400);
        expect(r.body.errors.visuals).toBeTruthy();
    });

    it('prices the draft from the tier, never from the client', async () => {
        const db = makeDb();
        const app = build(db);
        await supertest(app).post('/api/byoi/draft').set('x-test-uid', '5')
            .send({ tier: 'signature', spec: FULL_SPEC, priceCents: 1 });
        expect(db.byoiInsertDraft.mock.calls[0][1].priceCents).toBe(2900);
    });

    it('will not edit someone else\'s draft, and says the same thing as for a missing one', async () => {
        const db = makeDb({ byoiUpdateDraft: jest.fn(() => null) });
        const app = build(db);
        const r = await supertest(app).put('/api/byoi/draft/99').set('x-test-uid', '5')
            .send({ tier: 'custom', spec: FULL_SPEC });
        expect(r.status).toBe(404);
        expect(db.byoiUpdateDraft.mock.calls[0][1]).toBe(5); // scoped by user id
    });
});

describe('/api/byoi/submit — the gate', () => {
    const draftRow = { id: 3, user_id: 5, status: 'draft', tier: 'custom', title: 'Ovi Wave', spec_json: JSON.stringify(FULL_SPEC), notes: '', price_cents: 14900, currency: 'USD', created_at: 1, updated_at: 1 };

    it('refuses a plain user with 402 while billing is disabled', async () => {
        const db = makeDb({ byoiGetOwned: jest.fn(() => draftRow) });
        const app = build(db, { BYOI_BILLING_MODE: 'disabled' });
        const r = await supertest(app).post('/api/byoi/submit/3').set('x-test-uid', '5');
        expect(r.status).toBe(402);
        expect(r.body.error).toBe('not_launched');
        expect(db.byoiMarkSubmitted).not.toHaveBeenCalled();
    });

    it('refuses in live mode with no payment reference', async () => {
        const db = makeDb({ byoiGetOwned: jest.fn(() => draftRow) });
        const app = build(db, { BYOI_BILLING_MODE: 'live' });
        const r = await supertest(app).post('/api/byoi/submit/3').set('x-test-uid', '5').send({});
        expect(r.status).toBe(402);
        expect(db.byoiMarkSubmitted).not.toHaveBeenCalled();
    });

    it('will not send an incomplete order, even for the operator', async () => {
        const thin = { ...draftRow, spec_json: JSON.stringify({ title: 'x' }) };
        const db = makeDb({ byoiGetOwned: jest.fn(() => thin) });
        const app = build(db, { BYOI_BILLING_MODE: 'disabled' });
        const r = await supertest(app).post('/api/byoi/submit/3').set('x-test-uid', '1').set('x-test-role', 'admin');
        expect(r.status).toBe(400);
        expect(r.body.error).toBe('incomplete');
        expect(db.byoiMarkSubmitted).not.toHaveBeenCalled();
    });

    it('lets the operator through, stamped as a bypass', async () => {
        const db = makeDb({ byoiGetOwned: jest.fn(() => draftRow) });
        const app = build(db, { BYOI_BILLING_MODE: 'disabled' });
        const r = await supertest(app).post('/api/byoi/submit/3').set('x-test-uid', '1').set('x-test-role', 'admin');
        expect(r.status).toBe(200);
        expect(db.byoiMarkSubmitted.mock.calls[0][2].paymentRef).toMatch(/^BYPASS:/);
    });

    it('refuses to send the same order twice', async () => {
        const db = makeDb({ byoiGetOwned: jest.fn(() => ({ ...draftRow, status: 'paid' })) });
        const app = build(db, { BYOI_BILLING_MODE: 'test' });
        const r = await supertest(app).post('/api/byoi/submit/3').set('x-test-uid', '5');
        expect(r.status).toBe(409);
        expect(db.byoiMarkSubmitted).not.toHaveBeenCalled();
    });

    it('does not send another user\'s draft', async () => {
        const db = makeDb({ byoiGetOwned: jest.fn(() => null) });
        const app = build(db, { BYOI_BILLING_MODE: 'test' });
        const r = await supertest(app).post('/api/byoi/submit/3').set('x-test-uid', '5');
        expect(r.status).toBe(404);
        expect(db.byoiGetOwned).toHaveBeenCalledWith(3, 5);
    });
});

describe('/api/byoi attachments', () => {
    it('takes images only', async () => {
        const app = build(makeDb());
        const r = await supertest(app).post('/api/byoi/draft/3/attachment').set('x-test-uid', '5')
            .send({ filename: 'x.pdf', mime: 'application/pdf', dataB64: 'AAAA' });
        expect(r.status).toBe(400);
    });

    it('measures the DECODED size against the stated limit', async () => {
        const app = build(makeDb());
        // base64 is 4/3 of the real bytes; this decodes to just over 2 MB
        const big = 'A'.repeat(Math.ceil((2 * 1024 * 1024 + 1024) * 4 / 3));
        const r = await supertest(app).post('/api/byoi/draft/3/attachment').set('x-test-uid', '5')
            .send({ filename: 'x.png', mime: 'image/png', dataB64: big });
        expect(r.status).toBe(413);
    });

    it('does not hand one user another user\'s screenshot', async () => {
        const db = makeDb({ byoiGetAttachment: jest.fn(() => ({ id: 1, user_id: 9, mime: 'image/png', data_b64: 'AAAA' })) });
        const app = build(db);
        const r = await supertest(app).get('/api/byoi/attachment/1').set('x-test-uid', '5');
        expect(r.status).toBe(404);
    });

    it('lets the operator see it, because they have to build from it', async () => {
        const db = makeDb({ byoiGetAttachment: jest.fn(() => ({ id: 1, user_id: 9, mime: 'image/png', data_b64: 'AAAA' })) });
        const app = build(db);
        const r = await supertest(app).get('/api/byoi/attachment/1').set('x-test-uid', '1').set('x-test-role', 'admin');
        expect(r.status).toBe(200);
    });
});

describe('/api/byoi/admin — status moves', () => {
    it('refuses an illegal move', async () => {
        const db = makeDb({ byoiGetForAdmin: jest.fn(() => ({ id: 3, status: 'delivered' })) });
        const app = build(db);
        const r = await supertest(app).post('/api/byoi/admin/request/3/status').set('x-test-uid', '1').set('x-test-role', 'admin')
            .send({ status: 'paid' });
        expect(r.status).toBe(409);
        expect(db.byoiSetStatus).not.toHaveBeenCalled();
    });

    it('declining reports that a refund is owed', async () => {
        const db = makeDb({ byoiGetForAdmin: jest.fn(() => ({ id: 3, status: 'paid' })) });
        const app = build(db);
        const r = await supertest(app).post('/api/byoi/admin/request/3/status').set('x-test-uid', '1').set('x-test-role', 'admin')
            .send({ status: 'declined', declineReason: 'out of scope' });
        expect(r.status).toBe(200);
        expect(r.body.refundOwed).toBe(true);
    });

    it('delivering owes nothing back', async () => {
        const db = makeDb({ byoiGetForAdmin: jest.fn(() => ({ id: 3, status: 'in_progress' })) });
        const app = build(db);
        const r = await supertest(app).post('/api/byoi/admin/request/3/status').set('x-test-uid', '1').set('x-test-role', 'admin')
            .send({ status: 'delivered' });
        expect(r.body.refundOwed).toBe(false);
    });

    it('never shows the operator someone\'s unsent draft', async () => {
        const db = makeDb();
        const app = build(db);
        await supertest(app).get('/api/byoi/admin/requests').set('x-test-uid', '1').set('x-test-role', 'admin');
        expect(db.byoiListForAdmin).toHaveBeenCalled();
    });
});

describe('the copy-paste build brief', () => {
    // [2026-11-07] The operator copies ONE block of text and hands it to
    // whoever builds the order. Nothing is built automatically.
    const row = {
        id: 42, user_id: 5, tier: 'custom', title: 'Ovi Wave', status: 'paid',
        price_cents: 14900, currency: 'USD', payment_ref: 'pay_secret',
        spec_json: JSON.stringify({ title: 'Ovi Wave', placement: 'pane', visuals: ['line'],
            sources: ['price'], timeframes: ['1h'], notes: 'draws a wave when the trend turns',
            acceptance: 'it turns where I turn' }),
        created_at: 1, updated_at: 2, submitted_at: Date.UTC(2026, 10, 7),
    };

    it('is never handed to a plain user — it carries another buyer\'s order', async () => {
        const app = build(makeDb({ byoiGetForAdmin: jest.fn(() => row) }));
        const r = await supertest(app).get('/api/byoi/admin/request/42/brief').set('x-test-uid', '5');
        expect(r.status).toBe(403);
    });

    it('gives the operator one block of plain text', async () => {
        const app = build(makeDb({ byoiGetForAdmin: jest.fn(() => row) }));
        const r = await supertest(app).get('/api/byoi/admin/request/42/brief')
            .set('x-test-uid', '1').set('x-test-role', 'admin');
        expect(r.status).toBe(200);
        expect(r.body.ok).toBe(true);
        expect(r.body.brief).toContain('Ovi Wave');
        expect(r.body.brief).toContain('it turns where I turn');
        expect(r.body.brief).toMatch(/never repaints/i);
    });

    it('leaves the payment reference out of what gets pasted around', async () => {
        const app = build(makeDb({ byoiGetForAdmin: jest.fn(() => row) }));
        const r = await supertest(app).get('/api/byoi/admin/request/42/brief')
            .set('x-test-uid', '1').set('x-test-role', 'admin');
        expect(r.body.brief).not.toContain('pay_secret');
    });

    it('says 404 for an order that is not there, and 400 for a nonsense id', async () => {
        const app = build(makeDb());
        const miss = await supertest(app).get('/api/byoi/admin/request/9/brief')
            .set('x-test-uid', '1').set('x-test-role', 'admin');
        expect(miss.status).toBe(404);
        const bad = await supertest(app).get('/api/byoi/admin/request/abc/brief')
            .set('x-test-uid', '1').set('x-test-role', 'admin');
        expect(bad.status).toBe(400);
    });

    it('survives a spec that is not valid JSON rather than 500ing the page', async () => {
        const app = build(makeDb({ byoiGetForAdmin: jest.fn(() => ({ ...row, spec_json: '{broken' })) }));
        const r = await supertest(app).get('/api/byoi/admin/request/42/brief')
            .set('x-test-uid', '1').set('x-test-role', 'admin');
        expect(r.status).toBe(200);
        expect(typeof r.body.brief).toBe('string');
    });
});

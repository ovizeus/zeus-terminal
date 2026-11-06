'use strict';

// [2026-11-06] Private vs public.
//
// The line this file defends: a buyer may ASK for public, and only the
// operator may grant it. Public means a place in every user's indicator list,
// and that list is the operator's product, not the buyer's.

const express = require('express');
const supertest = require('supertest');
const path = require('path');
const SPEC = require('../../server/services/byoiSpec');

const DB_PATH = path.resolve(__dirname, '../../server/services/database');

function makeDb(o = {}) {
    return Object.assign({
        byoiGetForAdmin: jest.fn(() => ({ id: 3, user_id: 9, status: 'in_progress', title: 'Ovi Wave', spec_json: '{}', notes: '', price_cents: 14900, currency: 'USD', created_at: 1, updated_at: 1 })),
        byoiIndicatorBySlug: jest.fn(() => null),
        byoiCreateIndicator: jest.fn((a) => ({ id: 1, ...a })),
        byoiSetStatus: jest.fn((id, st) => ({ id, status: st, tier: 'custom', title: 'Ovi Wave', spec_json: '{}', notes: '', price_cents: 14900, currency: 'USD', created_at: 1, updated_at: 2 })),
        byoiSetIndicatorVisibility: jest.fn((id, v) => ({ id, visibility: v })),
        byoiListIndicatorsForAdmin: jest.fn(() => []),
        byoiIndicatorsForUser: jest.fn(() => ({ mine: [], community: [] })),
        byoiListAttachments: jest.fn(() => []),
        getAdminUserIds: jest.fn(() => [1]),
    }, o);
}
function build(db) {
    jest.resetModules();
    jest.doMock(DB_PATH, () => db);
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

describe('the form offers a REQUEST, never a grant', () => {
    it('replaced the old exclusive boolean — one axis, one field', () => {
        expect(SPEC.FIELD_BY_KEY.exclusive).toBeUndefined();
        expect(SPEC.FIELD_BY_KEY.visibility).toBeTruthy();
    });

    it('offers only private and public_request', () => {
        const vals = SPEC.FIELD_BY_KEY.visibility.options.map((o) => o.v);
        expect(vals).toEqual(['private', 'public_request']);
    });

    it('an order that says nothing is PRIVATE, never public', () => {
        // the safe value has to be the silent one
        const base = { title: 't', placement: 'pane', visuals: ['line'], sources: ['price'], timeframes: ['1h'], notes: 'n' };
        const r = SPEC.validateSpec(base, { draft: false });
        expect(r.ok).toBe(true);
        expect(r.clean.visibility).toBe('private');
    });

    it('a missing visibility never blocks an order — that is a lost sale', () => {
        const base = { title: 't', placement: 'pane', visuals: ['line'], sources: ['price'], timeframes: ['1h'], notes: 'n' };
        expect(SPEC.validateSpec(base, { draft: false }).errors.visibility).toBeUndefined();
    });

    it('a buyer cannot set visibility to public directly', () => {
        const base = { title: 't', placement: 'pane', visuals: ['line'], sources: ['price'], timeframes: ['1h'], notes: 'n' };
        expect(SPEC.validateSpec({ ...base, visibility: 'public' }).ok).toBe(false);
        expect(SPEC.validateSpec({ ...base, visibility: 'public_request' }).ok).toBe(true);
    });
});

describe('the chart list', () => {
    it('needs a session', async () => {
        const r = await supertest(build(makeDb())).get('/api/byoi/indicators');
        expect(r.status).toBe(401);
    });

    it('returns the two groups, scoped to the caller', async () => {
        const db = makeDb();
        const r = await supertest(build(db)).get('/api/byoi/indicators').set('x-test-uid', '9');
        expect(r.status).toBe(200);
        expect(r.body.mine).toEqual([]);
        expect(r.body.community).toEqual([]);
        expect(db.byoiIndicatorsForUser).toHaveBeenCalledWith(9);
    });

    it('returns an empty list rather than an error, so the chart still opens', async () => {
        const db = makeDb({ byoiIndicatorsForUser: jest.fn(() => { throw new Error('db down'); }) });
        const r = await supertest(build(db)).get('/api/byoi/indicators').set('x-test-uid', '9');
        expect(r.status).toBe(200);
        expect(r.body.mine).toEqual([]);
    });
});

describe('deliver — only the operator registers a built indicator', () => {
    const asAdmin = (app, body) => supertest(app).post('/api/byoi/admin/request/3/deliver')
        .set('x-test-uid', '1').set('x-test-role', 'admin').send(body);

    it('is closed to a plain user', async () => {
        const r = await supertest(build(makeDb())).post('/api/byoi/admin/request/3/deliver')
            .set('x-test-uid', '9').send({ slug: 'ovi_wave' });
        expect(r.status).toBe(403);
    });

    it('defaults to private when nothing is said', async () => {
        const db = makeDb();
        await asAdmin(build(db), { slug: 'ovi_wave' });
        expect(db.byoiCreateIndicator.mock.calls[0][0].visibility).toBe('private');
    });

    it('registers the owner as the buyer, not the admin pressing the button', async () => {
        const db = makeDb();
        await asAdmin(build(db), { slug: 'ovi_wave' });
        expect(db.byoiCreateIndicator.mock.calls[0][0].ownerUserId).toBe(9);
    });

    it('refuses a slug that is not a safe chart id', async () => {
        for (const slug of ['', 'ab', 'Has Caps', 'has space', '-leading', 'x'.repeat(41), '../etc']) {
            const r = await asAdmin(build(makeDb()), { slug });
            expect(r.status).toBe(400);
        }
    });

    it('refuses a slug that is already registered', async () => {
        const db = makeDb({ byoiIndicatorBySlug: jest.fn(() => ({ id: 1 })) });
        const r = await asAdmin(build(db), { slug: 'ovi_wave' });
        expect(r.status).toBe(409);
        expect(db.byoiCreateIndicator).not.toHaveBeenCalled();
    });

    it('will not publish without an author label — "by someone" is the point', async () => {
        const db = makeDb();
        const r = await asAdmin(build(db), { slug: 'ovi_wave', visibility: 'public' });
        expect(r.status).toBe(400);
        expect(db.byoiCreateIndicator).not.toHaveBeenCalled();
    });

    it('publishes when the label is there', async () => {
        const db = makeDb();
        const r = await asAdmin(build(db), { slug: 'ovi_wave', visibility: 'public', authorLabel: 'Ovi' });
        expect(r.status).toBe(200);
        expect(db.byoiCreateIndicator.mock.calls[0][0].visibility).toBe('public');
        expect(db.byoiCreateIndicator.mock.calls[0][0].authorLabel).toBe('Ovi');
    });

    it('reports a clashing public name instead of a 500', async () => {
        const db = makeDb({ byoiCreateIndicator: jest.fn(() => { throw new Error('UNIQUE constraint failed: byoi_indicators.name'); }) });
        const r = await asAdmin(build(db), { slug: 'ovi_wave2', visibility: 'public', authorLabel: 'Ovi' });
        expect(r.status).toBe(409);
        expect(r.body.error).toMatch(/name/);
    });

    it('does not deliver an order that is not in a deliverable state', async () => {
        const db = makeDb({ byoiGetForAdmin: jest.fn(() => ({ id: 3, user_id: 9, status: 'declined' })) });
        const r = await asAdmin(build(db), { slug: 'ovi_wave' });
        expect(r.status).toBe(409);
        expect(db.byoiCreateIndicator).not.toHaveBeenCalled();
    });

    it('marks the request delivered only after the indicator is registered', async () => {
        const db = makeDb();
        await asAdmin(build(db), { slug: 'ovi_wave' });
        const createOrder = db.byoiCreateIndicator.mock.invocationCallOrder[0];
        const statusOrder = db.byoiSetStatus.mock.invocationCallOrder[0];
        expect(createOrder).toBeLessThan(statusOrder);
    });
});

describe('visibility can be changed later, by the operator only', () => {
    it('is closed to a plain user', async () => {
        const r = await supertest(build(makeDb())).post('/api/byoi/admin/indicator/1/visibility')
            .set('x-test-uid', '9').send({ visibility: 'public' });
        expect(r.status).toBe(403);
    });

    it('treats anything that is not the word public as private', async () => {
        const db = makeDb();
        await supertest(build(db)).post('/api/byoi/admin/indicator/1/visibility')
            .set('x-test-uid', '1').set('x-test-role', 'admin').send({ visibility: 'PUBLIC' });
        expect(db.byoiSetIndicatorVisibility.mock.calls[0][1]).toBe('private');
    });
});

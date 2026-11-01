'use strict';
// tests/unit/syncZombiePositions.test.js
//
// [SYNC ZOMBIE 2026-11-01] Measured on the live box before this fix: the
// operator's per-user sync snapshot (data/sync_user/1_state.json) listed 13 open
// demo positions while serverAT held 4. The other 9 were all present in
// at_closed — closed by the server itself with DSL_PL / DSL_ML_CUT, the oldest
// since 2026-10-30 — and they were SHORTs, so the phone showed a mixed
// LONG+SHORT demo book the engine never had, growing by one every time the
// server closed a position.
//
// Cause: the only resurrection guard in POST /api/sync/state is the `closedIds`
// list the CLIENT sends. A server-side close never reaches it, so the merge
// ("add server positions not present in incoming AND not closed") re-added the
// row on every sync, forever.

const express = require('express');
const supertest = require('supertest');
const fs = require('fs');
const path = require('path');

const zf = require('../../server/services/syncZombieFilter');

describe('syncZombieFilter — pure', () => {
    test('drops positions whose id is an archived seq, keeps the rest', () => {
        const r = zf.partitionArchived(
            [{ id: 100, sym: 'BTCUSDT' }, { id: 200, sym: 'ETHUSDT' }, { id: 300, sym: 'SOLUSDT' }],
            new Set(['100', '300']));
        expect(r.kept.map(p => p.id)).toEqual([200]);
        expect(r.dropped.map(p => p.id)).toEqual([100, 300]);
    });

    test('a numeric id matches a string seq and vice versa', () => {
        expect(zf.partitionArchived([{ id: 7 }], new Set(['7'])).dropped).toHaveLength(1);
        expect(zf.partitionArchived([{ id: '7' }], new Set(['7'])).dropped).toHaveLength(1);
        // Array input is accepted and stringified by the filter itself.
        expect(zf.partitionArchived([{ id: 7 }], [7]).dropped).toHaveLength(1);
    });

    test('a null id is NEVER matched — Number(null) is 0 and would match seq 0', () => {
        expect(zf.idKey(null)).toBeNull();
        expect(zf.idKey(undefined)).toBeNull();
        expect(zf.idKey('')).toBeNull();
        expect(zf.idKey(NaN)).toBeNull();
        const r = zf.partitionArchived([{ id: null }, { id: undefined }], new Set(['0', '']));
        expect(r.dropped).toHaveLength(0);
        expect(r.kept).toHaveLength(2);
    });

    test('empty archive keeps everything; malformed entries never survive', () => {
        expect(zf.partitionArchived([{ id: 1 }, { id: 2 }], new Set()).kept).toHaveLength(2);
        const r = zf.partitionArchived([null, 'x', { id: 1 }], new Set());
        expect(r.kept).toHaveLength(1);
    });
});

// ── Route level: the guard must live in the ROUTE, not only in the helper ──
// Mocking the database module is what makes this a contract test: the route has
// to ASK which seqs are archived and act on the answer.
const TEST_UID = 987655;
const stateFile = path.join(__dirname, '..', '..', 'data', 'sync_user', TEST_UID + '_state.json');

jest.mock('../../server/services/database', () => ({
    atClosedSeqsForUser: jest.fn(() => new Set()),
    journalGetClosed: jest.fn(() => []),
}));
const dbMock = require('../../server/services/database');

function app() {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => { req.user = { id: TEST_UID }; next(); });
    a.use('/api/sync', require('../../server/routes/sync'));
    return a;
}
function persisted() {
    if (!fs.existsSync(stateFile)) return null;
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
}
function cleanup() { try { if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile); } catch (_) { /* */ } }

describe('POST /api/sync/state — server-closed positions do not come back', () => {
    beforeEach(() => { cleanup(); dbMock.atClosedSeqsForUser.mockReset(); });
    afterAll(cleanup);

    test('REGRESSION: a position the server already closed is dropped from the snapshot', async () => {
        // The exact live shape: 1 open + 2 the server closed behind the client's back.
        dbMock.atClosedSeqsForUser.mockReturnValue(new Set(['1791754240943', '1791754240957']));
        const res = await supertest(app()).post('/api/sync/state').send({
            ts: Date.now(),
            positions: [
                { id: 1791754240962, sym: 'BTCUSDT', side: 'LONG', mode: 'demo' },
                { id: 1791754240943, sym: 'BTCUSDT', side: 'SHORT', mode: 'demo' },
                { id: 1791754240957, sym: 'BNBUSDT', side: 'SHORT', mode: 'demo' },
            ],
        });
        expect(res.status).toBe(200);
        const p = persisted();
        expect(p.positions.map(x => x.id)).toEqual([1791754240962]);
        // And their ids are remembered, so a stale phone payload cannot re-add them.
        expect(p.closedIds).toContain('1791754240943');
        expect(p.closedIds).toContain('1791754240957');
    });

    test('the route asks the archive, scoped to THIS user, with the ids it holds', async () => {
        dbMock.atClosedSeqsForUser.mockReturnValue(new Set());
        await supertest(app()).post('/api/sync/state').send({
            ts: Date.now(),
            positions: [{ id: 555, sym: 'BTCUSDT' }, { id: 666, sym: 'ETHUSDT' }],
        });
        expect(dbMock.atClosedSeqsForUser).toHaveBeenCalled();
        const [uidArg, seqArg] = dbMock.atClosedSeqsForUser.mock.calls[0];
        expect(Number(uidArg)).toBe(TEST_UID);
        expect(seqArg).toEqual([555, 666]);
    });

    test('nothing archived → snapshot untouched', async () => {
        dbMock.atClosedSeqsForUser.mockReturnValue(new Set());
        await supertest(app()).post('/api/sync/state').send({
            ts: Date.now(), positions: [{ id: 1, sym: 'BTCUSDT' }, { id: 2, sym: 'ETHUSDT' }],
        });
        expect(persisted().positions.map(x => x.id)).toEqual([1, 2]);
    });

    test('a failing archive lookup must not break the sync', async () => {
        dbMock.atClosedSeqsForUser.mockImplementation(() => { throw new Error('db down'); });
        const res = await supertest(app()).post('/api/sync/state').send({
            ts: Date.now(), positions: [{ id: 9, sym: 'BTCUSDT' }],
        });
        expect(res.status).toBe(200);
        expect(persisted().positions.map(x => x.id)).toEqual([9]);
    });
});

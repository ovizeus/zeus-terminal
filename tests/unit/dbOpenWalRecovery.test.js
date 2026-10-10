'use strict';
// [2026-10-10] Zeus was down for three and a half hours overnight: 1082 restart
// attempts, 502 to every visitor, nobody told. The database itself was FINE —
// a full PRAGMA integrity_check on it came back ok. Only the write-ahead log
// was corrupt, and because the very first schema read happens at require time,
// the whole process died before it could do anything about it.
//
// Recovery was moving the -wal and -shm aside and starting again. That is
// thirty seconds of work a machine can do on its own, and the data in an
// unreadable WAL is already unreachable by SQLite, so quarantining it loses
// nothing that could have been recovered — the file is kept for forensics
// either way.

const { openWithWalRecovery } = require('../../server/services/dbOpen');

function makeDeps(behaviour) {
    const moved = [];
    const logged = [];
    let opens = 0;
    return {
        moved, logged, opens: () => opens,
        deps: {
            open: () => {
                opens++;
                const n = opens;
                return {
                    prepare: () => ({
                        get: () => {
                            const r = behaviour(n);
                            if (r instanceof Error) throw r;
                            return r;
                        },
                    }),
                    close: () => {},
                };
            },
            exists: () => true,
            rename: (from, to) => { moved.push({ from, to }); },
            log: (msg) => { logged.push(msg); },
        },
    };
}

function corrupt() {
    const e = new Error('malformed database schema (9054)');
    e.code = 'SQLITE_CORRUPT';
    return e;
}

describe('opening the database survives a corrupt write-ahead log', () => {
    test('a healthy database is opened once and nothing is moved', () => {
        const h = makeDeps(() => ({ ok: 1 }));
        openWithWalRecovery('/x/zeus.db', h.deps);
        expect(h.opens()).toBe(1);
        expect(h.moved).toEqual([]);
    });

    test('a corrupt WAL is quarantined and the database reopens', () => {
        // First open throws; after the WAL is moved aside the second succeeds.
        const h = makeDeps((n) => (n === 1 ? corrupt() : { ok: 1 }));
        openWithWalRecovery('/x/zeus.db', h.deps);

        expect(h.opens()).toBe(2);
        expect(h.moved.map((m) => m.from).sort()).toEqual(['/x/zeus.db-shm', '/x/zeus.db-wal']);
        // Renamed, never deleted — the evidence has to survive.
        for (const m of h.moved) expect(m.to).toMatch(/\.corrupt-/);
        expect(h.logged.join(' ')).toMatch(/corrupt/i);
    });

    test('corruption in the database itself is NOT hidden — it still throws', () => {
        // Both opens fail → this is not a WAL problem, and pretending otherwise
        // would start a server on a broken database.
        const h = makeDeps(() => corrupt());
        expect(() => openWithWalRecovery('/x/zeus.db', h.deps)).toThrow(/malformed/);
        expect(h.opens()).toBe(2);
    });

    test('a non-corruption error is passed straight through', () => {
        const h = makeDeps(() => new Error('disk is on fire'));
        expect(() => openWithWalRecovery('/x/zeus.db', h.deps)).toThrow(/on fire/);
        expect(h.moved).toEqual([]);
    });
});

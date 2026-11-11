/**
 * De ce exista acest test.
 *
 * Pe 11 nov IP-ul a intrat in OPT banuri intr-o zi, fiecare la cateva minute
 * dupa expirarea precedentului, si nu am putut spune CINE cere: telemetria pe
 * surse traieste doar in memorie, in spatele sesiunii de admin. Martorul scrie
 * o singura data, in clipa banului, cine a cerut cel mai mult — in jurnalul de
 * stare din baza, ca sa supravietuiasca rotirii logurilor.
 */
const { banWitness } = require('../../server/services/banWitness');

const snap = {
    callsPer1min: 412, callsPer5min: 1900,
    quotaPressure: { 'fapi.binance.com': 0.31 },
    bySource: {
        'marketFeed:klines': { calls: 300, weightSum: 1500, errors4xx: 2, rejectedByScheduler: 10 },
        'bookmap:depth':     { calls: 40,  weightSum: 800,  errors4xx: 0, rejectedByScheduler: 0 },
        'recon:positionRisk':{ calls: 12,  weightSum: 60,   errors4xx: 12, rejectedByScheduler: 0 },
        'tiny':              { calls: 1,   weightSum: 1,    errors4xx: 0, rejectedByScheduler: 0 },
    },
};

describe('banWitness — cine cerea in clipa banului', () => {
    test('ordoneaza dupa GREUTATE, nu dupa numar de apeluri', () => {
        const w = banWitness(snap, 2);
        expect(w.top.map((t) => t.src)).toEqual(['marketFeed:klines', 'bookmap:depth']);
        expect(w.top[0]).toEqual({ src: 'marketFeed:klines', calls: 300, weight: 1500, e4xx: 2, rejected: 10 });
    });

    test('pastreaza ritmul si presiunea, ca sa se vada daca eram aproape de plafon', () => {
        const w = banWitness(snap, 3);
        expect(w.calls1m).toBe(412);
        expect(w.calls5m).toBe(1900);
        expect(w.pressure).toEqual({ 'fapi.binance.com': 0.31 });
        expect(w.sources).toBe(4);
    });

    test('sursa cu cele mai multe 4xx apare chiar daca e usoara', () => {
        // Un 418 vine si din a insista dupa 429, nu doar din greutate.
        const w = banWitness(snap, 1);
        expect(w.top).toHaveLength(1);
        expect(w.worst4xx).toEqual({ src: 'recon:positionRisk', e4xx: 12, calls: 12 });
    });

    test('nu arunca NICIODATA — sta pe drumul banului', () => {
        expect(() => banWitness(null)).not.toThrow();
        expect(() => banWitness({ bySource: 'stricat' })).not.toThrow();
        expect(banWitness(undefined)).toEqual({ top: [], sources: 0, calls1m: null, calls5m: null, pressure: null, worst4xx: null });
    });
});

describe('martorul e CABLAT pe drumul banului, nu doar scris', () => {
    const path = require('path');
    const S = (m) => path.join(__dirname, '../../server/services', m);
    let logged;

    function load({ snapshotThrows }) {
        jest.resetModules();
        logged = [];
        jest.doMock(S('binanceRateState'), () => ({
            load: () => ({ banned_until: 0 }),
            recordBan: jest.fn(),
            appendTransitionLog: (e) => logged.push(e),
        }));
        jest.doMock(S('binanceTelemetry'), () => ({
            getSnapshot: () => {
                if (snapshotThrows) throw new Error('telemetrie cazuta');
                return { callsPer1min: 7, bySource: { 'x:y': { calls: 7, weightSum: 70, errors4xx: 1 } } };
            },
        }));
        return require(S('binanceSigner'));
    }

    test('tranzitia in SUPPRESSED poarta martorul', () => {
        const signer = load({ snapshotThrows: false });
        signer._setIpBan(Date.now() + 60000, 'HTTP 418: test');
        expect(logged).toHaveLength(1);
        expect(logged[0].to).toBe('SUPPRESSED');
        expect(logged[0].witness.top[0]).toMatchObject({ src: 'x:y', weight: 70 });
        expect(logged[0].witness.calls1m).toBe(7);
    });

    test('telemetria cazuta NU impiedica inregistrarea banului', () => {
        const signer = load({ snapshotThrows: true });
        signer._setIpBan(Date.now() + 60000, 'HTTP 418: test');
        expect(logged).toHaveLength(1);
        expect(logged[0].to).toBe('SUPPRESSED');
        expect(logged[0].witness).toBeNull();
        expect(signer.getIpCbStatus().banned).toBe(true);
    });
});

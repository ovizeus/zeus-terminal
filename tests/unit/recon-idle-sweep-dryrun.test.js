'use strict';
// [RECON-DRYRUN 2026-10-20] Gasit la auditul manual/autotrade cerut de operator.
//
// `reconcileFilter.shouldReconcileExchange` exista EXACT pentru asta: Bybit cu
// zavorul BYBIT_DRY_RUN_ONLY pornit nu are poziti reale si blocheaza dispatch-ul
// HTTP, deci orice incercare produce „un spurious reconciliation failed".
// Filtrul era insa aplicat DOAR in recoveryBoot.js. Recon-ul PERIODIC din
// serverAT.js nu l-a primit niciodata — iar maturatoarea de orfani „in gol"
// enumera fiecare rand activ din exchange_accounts, deci interoga bybit la
// fiecare 120 s, la infinit.
//
// Dovada vie: in pm2-error.log, un WARN la fiecare 2 minute, fara pauza:
//   [RECON] positionRisk query failed uid=2 exchange=bybit:
//   BYBIT_DRY_RUN_ONLY=true — real HTTP dispatch blocked
//
// Aceeasi clasa ca bug-ul de culoare al lumanarilor de la b286: fix-ul exista,
// dar a fost cablat la unul din doua locuri.

function bootServerAT({ accounts, getPositions, dryRun }) {
    jest.resetModules();

    const _prep = (sql) => ({
        run: () => ({}),
        get: () => null,
        all: () => (/exchange_accounts/.test(sql) ? accounts : []),
    });

    jest.doMock('../../server/services/database', () => ({
        prepare: _prep,
        db: { prepare: _prep },
        atGetState: () => null,
        atSetState: () => {},
        atGetOpenUserIds: () => [],
        atLoadOpenPositions: () => [],
        auditLog: () => {},
        getGhostCandidates: () => [],
    }));

    jest.doMock('../../server/migrationFlags', () => ({
        BYBIT_DRY_RUN_ONLY: dryRun,
        WS_PROXY_ENABLED: false,
        LIVE_ENTRY_UNIFIED: true,
    }));

    jest.doMock('../../server/services/credentialStore', () => ({
        getExchangeCreds: () => ({ apiKey: 'k', apiSecret: 's', baseUrl: 'https://x' }),
        getExchangeCredsFor: () => ({ apiKey: 'k', apiSecret: 's', baseUrl: 'https://x' }),
    }));

    jest.doMock('../../server/services/exchangeOps', () => ({
        getPositions,
        getUserTrades: jest.fn(async () => []),
        getBalance: jest.fn(async () => []),
    }));

    return require('../../server/services/serverAT');
}

const ACCOUNTS = [
    { user_id: 1, exchange: 'binance' },
    { user_id: 2, exchange: 'bybit' },
];

/** Maturatoarea „in gol" ruleaza doar la fiecare al 2-lea ciclu inactiv. */
async function sweepTwice(at) {
    await at._runReconciliation(false);
    await at._runReconciliation(false);
}

function exchangesQueried(getPositions) {
    return getPositions.mock.calls
        .map(c => (c[1] && c[1].exchangeOverride) || 'binance')
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort();
}

describe('maturatoarea de orfani in gol vs zavorul dry-run', () => {
    test('THE FIX: bybit NU mai e interogat cat timp dry-run e pornit', async () => {
        const getPositions = jest.fn(async () => []);
        const at = bootServerAT({ accounts: ACCOUNTS, getPositions, dryRun: true });

        await sweepTwice(at);

        expect(getPositions).toHaveBeenCalled();           // binance da, se interogheaza
        expect(exchangesQueried(getPositions)).toEqual(['binance']);
    });

    test('binance continua sa fie reconciliat — fixul nu opreste maturatoarea', async () => {
        const getPositions = jest.fn(async () => []);
        const at = bootServerAT({ accounts: ACCOUNTS, getPositions, dryRun: true });

        await sweepTwice(at);

        const uids = getPositions.mock.calls.map(c => c[0]);
        expect(uids).toContain(1);
        expect(uids).not.toContain(2);
    });

    test('cand bybit iese din dry-run, se reconciliaza din nou', async () => {
        const getPositions = jest.fn(async () => []);
        const at = bootServerAT({ accounts: ACCOUNTS, getPositions, dryRun: false });

        await sweepTwice(at);

        expect(exchangesQueried(getPositions)).toEqual(['binance', 'bybit']);
    });
});

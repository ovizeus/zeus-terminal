// Why a kline poll failed must survive the throw.
//
// 2026-10-19: 20.265 kline poll failures were logged over 11,4h as the bare
// string "HTTP 503" across all 21 (symbol, timeframe) series. The gateway
// returns 503 for TWO different reasons — `circuit_open` and `rate_limit` —
// and both are synthesised BEFORE the fetch, so binanceTelemetry never saw
// them either (errors5xx stayed 0). The reason was on the response object and
// thrown away one line later, which left the incident undiagnosable after the
// fact. These tests pin the reason to the error message.

jest.mock('../../server/services/binanceGateway', () => ({ fetch: jest.fn() }));

const gateway = require('../../server/services/binanceGateway');
const marketFeed = require('../../server/services/marketFeed');

function gatewayReject(extra) {
    gateway.fetch.mockResolvedValue(Object.assign({
        ok: false,
        status: 503,
        headers: { get: () => null },
        json: async () => ({}),
    }, extra));
}

describe('_altFetchKlinesLatest — the 503 says WHY', () => {
    beforeEach(() => jest.clearAllMocks());

    it('names circuit_open, and the backoff, instead of a bare HTTP 503', async () => {
        gatewayReject({ _reason: 'circuit_open', _backoffMs: 42000 });
        const err = await marketFeed._altFetchKlinesLatest('BTCUSDT', '1h', 2).catch(e => e);
        expect(err.message).toMatch(/circuit_open/);
        // The backoff is the half that says how long it will stay broken —
        // asserted explicitly, because an unasserted branch is decoration.
        expect(err.message).toMatch(/42000/);
    });

    it('names rate_limit when the limiter is what refused', async () => {
        gatewayReject({ _reason: 'rate_limit' });
        await expect(marketFeed._altFetchKlinesLatest('BTCUSDT', '1h', 2))
            .rejects.toThrow(/rate_limit/);
    });

    it('still reports the status when there is no reason (a real upstream 503)', async () => {
        gatewayReject({});
        const err = await marketFeed._altFetchKlinesLatest('BTCUSDT', '1h', 2).catch(e => e);
        expect(err.message).toMatch(/HTTP 503/);
        expect(err.message).not.toMatch(/undefined/);
    });

    it('a successful poll still parses bars (the guard did not eat the happy path)', async () => {
        gateway.fetch.mockResolvedValue({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => [[1700000000000, '1', '2', '0.5', '1.5', '10', 1700000059999]],
        });
        const bars = await marketFeed._altFetchKlinesLatest('BTCUSDT', '1h', 2);
        expect(bars).toHaveLength(1);
        expect(bars[0].close).toBe(1.5);
    });
});

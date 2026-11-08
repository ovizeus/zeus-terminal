'use strict';

/**
 * [2026-11-07] The fields that pin down HOW an indicator calculates, and the
 * `showIf` rules that keep nonsense out of an order.
 *
 * The one that matters most here is the last block: a field the buyer could
 * never see must not end up in the stored spec, because a stored option is a
 * promise AND a price.
 */
const S = require('../../server/services/byoiSpec');

const base = {
    title: 'Mine', placement: 'overlay', visuals: ['line'], sources: ['price'],
    timeframes: ['5m'], notes: 'a line on price',
};
const clean = (extra) => S.validateSpec({ ...base, ...extra });

describe('how it calculates is now part of the order', () => {
    it('defaults are the safe, honest answers', () => {
        const r = clean({});
        expect(r.ok).toBe(true);
        expect(r.clean.confirmOn).toBe('close');   // never repaints
        expect(r.clean.smoothing).toBe('none');
        expect(r.clean.normalize).toBe('raw');
        expect(r.clean.symbols).toBe('all');
    });

    it('accepts every smoothing and scaling option it offers', () => {
        for (const o of S.FIELD_BY_KEY.smoothing.options) {
            expect(clean({ smoothing: o.v }).ok).toBe(true);
        }
        for (const o of S.FIELD_BY_KEY.normalize.options) {
            expect(clean({ normalize: o.v }).ok).toBe(true);
        }
    });

    it('refuses an option it never offered', () => {
        expect(clean({ smoothing: 'kalman' }).errors.smoothing).toBe('not an option');
        expect(clean({ confirmOn: 'maybe' }).errors.confirmOn).toBe('not an option');
        expect(clean({ signalLogic: ['telepathy'] }).errors.signalLogic).toBe('not an option');
    });

    it('keeps the signal rules the buyer ticked, without duplicates', () => {
        const r = clean({ signalLogic: ['cross', 'divergence', 'cross'] });
        expect(r.clean.signalLogic).toEqual(['cross', 'divergence']);
    });

    it('takes conditions as rows and drops the blank ones', () => {
        const r = clean({ conditions: [
            { when: 'RSI', op: 'above', then: 'red zone' },
            { when: '', op: '', then: '' },
        ] });
        expect(r.ok).toBe(true);
        expect(r.clean.conditions).toHaveLength(1);
        expect(r.clean.conditions[0].then).toBe('red zone');
    });

    it('caps the rows rather than accepting a spec nobody can build', () => {
        const many = Array.from({ length: 9 }, (_, i) => ({ value: String(i), label: 'L' }));
        expect(clean({ levels: many }).errors.levels).toMatch(/too many/);
    });

    it('holds the acceptance criterion — the cheapest protection either side has', () => {
        const r = clean({ acceptance: 'it marks the same bars I marked by hand on BTC 5m' });
        expect(r.clean.acceptance).toMatch(/same bars/);
        expect(clean({ acceptance: 'x'.repeat(201) }).errors.acceptance).toMatch(/too long/);
    });
});

describe('a field the buyer cannot see is not part of his order', () => {
    it('the pane scale is absent while nothing draws in a pane', () => {
        expect(S.isFieldVisible(S.FIELD_BY_KEY.scale, { placement: 'overlay' })).toBe(false);
        expect(clean({ scale: 'fixed100' }).clean.scale).toBeUndefined();
    });

    it('and present as soon as something does', () => {
        expect(S.isFieldVisible(S.FIELD_BY_KEY.scale, { placement: 'pane' })).toBe(true);
        expect(clean({ placement: 'pane', scale: 'fixed100' }).clean.scale).toBe('fixed100');
        expect(clean({ placement: 'both', scale: 'price' }).clean.scale).toBe('price');
    });

    it('the credit line exists only on a public request', () => {
        expect(clean({ creditLine: 'Ovi' }).clean.creditLine).toBeUndefined();
        expect(clean({ visibility: 'public_request', creditLine: 'Ovi' }).clean.creditLine).toBe('Ovi');
    });

    it('alert details exist only if alerts were ticked', () => {
        const without = clean({ alertText: 'fires now', alertWhere: ['telegram'] });
        expect(without.clean.alertText).toBeUndefined();
        expect(without.clean.alertWhere).toBeUndefined();
        const withAlerts = clean({ signals: ['alert'], alertText: 'fires now', alertWhere: ['telegram'] });
        expect(withAlerts.clean.alertText).toBe('fires now');
        expect(withAlerts.clean.alertWhere).toEqual(['telegram']);
    });

    it('the market list exists only when the buyer said "only the ones I list"', () => {
        expect(clean({ symbolList: 'BTCUSDT' }).clean.symbolList).toBeUndefined();
        expect(clean({ symbols: 'some', symbolList: 'BTCUSDT' }).clean.symbolList).toBe('BTCUSDT');
    });

    it('a hidden field cannot be used to smuggle in paid scope', () => {
        // the gate prices the CLEAN spec, so a hidden option must not reach it
        const P = require('../../server/services/byoiPricing');
        const smuggled = clean({ alertWhere: ['telegram'], signals: [] }).clean;
        expect(P.requiredTierFor(smuggled)).toBe('signature');
    });

    it('a hidden REQUIRED field never blocks the order', () => {
        // a form that cannot be submitted because of a question nobody was
        // asked is a lost sale, not a validation success
        expect(clean({}).ok).toBe(true);
    });
});

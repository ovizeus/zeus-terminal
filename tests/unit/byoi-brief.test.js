'use strict';

/**
 * [2026-11-07] The copy-paste build brief — the operator's own request.
 *
 * An order is not built automatically. The buyer pays, the operator copies ONE
 * block of text out of Admin and hands it over to be built. So the brief has to
 * stand alone: everything the buyer answered, nothing he did not, and the two
 * lines that decide whether the finished build is accepted (the repaint policy
 * and his acceptance criterion) stated outright rather than buried.
 *
 * It is rendered on the SERVER, from the same field definitions the form is
 * rendered from, so a label can never drift from the question that was asked.
 */
const B = require('../../server/services/byoiBrief');
const { validateSpec } = require('../../server/services/byoiSpec');

const full = validateSpec({
    title: 'OviFlow', placement: 'pane', visuals: ['line', 'histogram'],
    sources: ['price', 'volume', 'book'], timeframes: ['5m', '1h'],
    signals: ['entry', 'alert'], signalLogic: ['cross', 'divergence'],
    smoothing: 'ema', normalize: 'pct', confirmOn: 'close',
    conditions: [{ when: 'RSI', op: 'above 70', then: 'red zone' }],
    levels: [{ value: '70', label: 'hot' }, { value: '30', label: 'cold' }],
    scale: 'fixed100', barColoring: true, symbols: 'some', symbolList: 'BTCUSDT',
    defaultOn: true, likeExisting: 'RSI', acceptance: 'it marks the bars I marked by hand',
    alertWhere: ['telegram'], alertText: 'OviFlow crossed', alertRate: 'bar',
    inputs: [{ name: 'Length', def: '14' }],
    colorUp: '#00ff88', colorDown: '#ff4455', lineWidth: '3',
    visibility: 'public_request', creditLine: 'Ovi',
    notes: 'I want it to tell me when volume disagrees with price.',
}).clean;

const row = {
    id: 42, tier: 'custom', status: 'paid', price_cents: 14900, currency: 'USD',
    user_id: 7, email: 'buyer@example.com', payment_ref: 'pay_abc',
    submitted_at: Date.UTC(2026, 10, 7, 12, 0, 0),
};

describe('the brief stands on its own', () => {
    const text = B.renderBrief({ row, spec: full, attachmentCount: 2 });

    it('is one plain-text block, not JSON', () => {
        expect(typeof text).toBe('string');
        expect(text.length).toBeGreaterThan(200);
        expect(() => JSON.parse(text)).toThrow();
    });

    it('names the order, the tier and what was paid', () => {
        expect(text).toContain('#42');
        expect(text).toContain('Custom');
        expect(text).toContain('$149');
    });

    it('carries every answer the buyer gave, under its own question', () => {
        for (const needle of [
            'OviFlow', 'In its own pane below', 'Histogram', 'Order book', '1h',
            'EMA', '0 to 100', 'Divergence against price', 'RSI', 'red zone',
            'hot', 'Fixed, 0 to 100', 'BTCUSDT', 'Telegram', 'OviFlow crossed',
            'Length', '14', '#00ff88', 'Bold', 'Ovi',
        ]) {
            expect(text).toContain(needle);
        }
    });

    it('states the repaint policy outright — the thing arguments are made of', () => {
        expect(text).toMatch(/never repaints/i);
    });

    it('states the acceptance criterion outright', () => {
        expect(text).toContain('it marks the bars I marked by hand');
    });

    it('says the build is public and credited, which changes what shipping means', () => {
        expect(text).toMatch(/public/i);
    });

    it('says how many images came with it, since they do not fit in text', () => {
        expect(text).toMatch(/2 image/i);
    });

    it('ends by saying what is being asked for', () => {
        expect(text.trim()).toMatch(/build/i);
    });
});

describe('it never pads an order with answers nobody gave', () => {
    const bare = validateSpec({
        title: 'Plain', placement: 'overlay', visuals: ['line'], sources: ['price'],
        timeframes: ['5m'], notes: 'just a line',
    }).clean;
    const text = B.renderBrief({ row: { ...row, tier: 'signature', price_cents: 2900 }, spec: bare, attachmentCount: 0 });

    it('leaves out sections the buyer skipped', () => {
        expect(text).not.toMatch(/Alerts:/);
        expect(text).not.toMatch(/Credit line/);
        expect(text).not.toMatch(/Reference lines/);
    });

    it('does not claim images that do not exist', () => {
        expect(text).not.toMatch(/image/i);
    });

    it('still states the repaint policy, because the default IS an answer', () => {
        expect(text).toMatch(/never repaints/i);
    });

    it('does not invent an acceptance criterion the buyer never wrote', () => {
        expect(text).not.toMatch(/consider it correct/i);
    });
});

describe('it cannot throw on a damaged row', () => {
    it('survives a missing spec, row or both', () => {
        expect(() => B.renderBrief({})).not.toThrow();
        expect(() => B.renderBrief({ row: null, spec: null })).not.toThrow();
        expect(() => B.renderBrief({ row, spec: { visuals: 'not-an-array' } })).not.toThrow();
        expect(typeof B.renderBrief({})).toBe('string');
    });

    it('does not leak the payment reference into something that gets pasted around', () => {
        // the brief is handed to whoever builds it; a payment id is not theirs
        expect(B.renderBrief({ row, spec: full, attachmentCount: 0 })).not.toContain('pay_abc');
    });
});

describe('what the Custom tier bought is spelled out', () => {
    // [2026-11-08] Each of these lines is work that has to actually be done.
    // An option that never reaches this text is an option nobody builds, and
    // the buyer paid for it.
    const premium = validateSpec({
        title: 'Pro', placement: 'pane', visuals: ['line'], sources: ['price'],
        timeframes: ['5m'], notes: 'n', strength: 'score', serverSide: true,
        signalHistory: true, multiSymbol: 'watchlist', autoLevels: true,
        presets: true, customIcon: true, exportData: true,
    }).clean;
    const text = B.renderBrief({ row: { id: 7, tier: 'custom', price_cents: 14900 }, spec: premium });

    it('names every premium option that was ticked', () => {
        for (const needle of [
            'Strength score', 'SERVER-SIDE', 'stored and reviewable',
            'watchlist', 'own levels', 'setting profiles', 'glyph', 'Export',
        ]) {
            expect(text).toContain(needle);
        }
    });

    it('says outright that server-side means working with the app closed', () => {
        expect(text).toMatch(/app closed/i);
    });

    it('and says nothing about them when none was ticked', () => {
        const plain = validateSpec({
            title: 'Plain', placement: 'overlay', visuals: ['line'], sources: ['price'],
            timeframes: ['5m'], notes: 'n',
        }).clean;
        const t = B.renderBrief({ row: { id: 8, tier: 'signature', price_cents: 2900 }, spec: plain });
        expect(t).not.toMatch(/INCLUDED AT THIS TIER/);
        expect(t).not.toMatch(/SERVER-SIDE/);
    });

    it('an unticked box is never read as ticked', () => {
        const off = validateSpec({
            title: 'Off', placement: 'overlay', visuals: ['line'], sources: ['price'],
            timeframes: ['5m'], notes: 'n', serverSide: false, signalHistory: false,
        }).clean;
        expect(B.renderBrief({ row: { id: 9, tier: 'signature' }, spec: off })).not.toMatch(/INCLUDED AT THIS TIER/);
    });
});

'use strict';

/**
 * Build Your Own Indicator — the specification form.
 *
 * [2026-11-06] The form lives HERE, on the server, and the client renders it
 * from /api/byoi/config. One definition, so the form the buyer fills and the
 * rules that validate it can never drift apart — and a new field is a server
 * edit, not a client rebuild.
 *
 * Why the form is mostly checkboxes: a free-text-only order turns every sale
 * into a negotiation, because prose has no edges. The structured fields put a
 * boundary around the work, and `notes` is the supplement, not the spec.
 */

const FIELDS = Object.freeze([
    { key: 'title', type: 'text', label: 'Indicator name', required: true, max: 40,
      hint: 'This is what shows on the chart. Your own name is a popular choice.' },

    { key: 'placement', type: 'select', label: 'Where it draws', required: true,
      options: [
          { v: 'overlay', l: 'On the price chart' },
          { v: 'pane', l: 'In its own pane below' },
          { v: 'both', l: 'Both' },
      ] },

    { key: 'visuals', type: 'multi', label: 'What it draws', required: true, min: 1,
      options: [
          { v: 'line', l: 'Line' }, { v: 'histogram', l: 'Histogram' },
          { v: 'area', l: 'Filled area' }, { v: 'bands', l: 'Bands / channel' },
          { v: 'dots', l: 'Dots' }, { v: 'arrows', l: 'Arrows' },
          { v: 'zones', l: 'Zones / boxes' }, { v: 'labels', l: 'Text labels' },
          { v: 'table', l: 'Readout table' },
      ] },

    { key: 'sources', type: 'multi', label: 'What it reads', required: true, min: 1,
      options: [
          { v: 'price', l: 'Price' }, { v: 'volume', l: 'Volume' },
          { v: 'oi', l: 'Open interest' }, { v: 'funding', l: 'Funding' },
          { v: 'liq', l: 'Liquidations' }, { v: 'book', l: 'Order book' },
          { v: 'mtf', l: 'Higher timeframes' },
      ] },

    { key: 'timeframes', type: 'multi', label: 'Timeframes it must work on', required: true, min: 1,
      options: [
          { v: '1m', l: '1m' }, { v: '5m', l: '5m' }, { v: '15m', l: '15m' },
          { v: '1h', l: '1h' }, { v: '4h', l: '4h' }, { v: '1d', l: '1D' },
      ] },

    { key: 'signals', type: 'multi', label: 'Signals', required: false,
      options: [
          { v: 'entry', l: 'Entry markers' }, { v: 'exit', l: 'Exit markers' },
          { v: 'tint', l: 'Background tint by state' },
          { v: 'alert', l: 'Alerts' }, { v: 'sound', l: 'Sound' },
      ] },

    // ── How it CALCULATES. [2026-11-07] The form said what an indicator draws
    // and what it reads, and left the expensive part — how it decides — to free
    // text. That is exactly where a fixed price turns into a negotiation.
    { key: 'smoothing', type: 'select', label: 'Smoothing', required: false, def: 'none',
      options: [
          { v: 'none', l: 'None — raw value' }, { v: 'sma', l: 'SMA' }, { v: 'ema', l: 'EMA' },
          { v: 'wma', l: 'WMA' }, { v: 'hma', l: 'HMA' }, { v: 'rma', l: 'RMA (Wilder)' },
      ] },

    { key: 'normalize', type: 'select', label: 'How the value is scaled', required: false, def: 'raw',
      options: [
          { v: 'raw', l: 'Raw value' }, { v: 'pct', l: '0 to 100' },
          { v: 'zscore', l: 'Z-score' }, { v: 'percentile', l: 'Percentile rank' },
      ] },

    { key: 'signalLogic', type: 'multi', label: 'What makes a signal', required: false,
      options: [
          { v: 'cross', l: 'Two lines cross' }, { v: 'threshold', l: 'A level is crossed' },
          { v: 'divergence', l: 'Divergence against price' }, { v: 'slope', l: 'The slope flips' },
          { v: 'breakout', l: 'A level breaks' }, { v: 'state', l: 'The regime changes' },
      ],
      hint: 'Tick every rule that applies. This is the part that decides what you actually see.' },

    { key: 'conditions', type: 'rows', label: 'Exact conditions', required: false, maxRows: 6,
      columns: [
          { key: 'when', label: 'When', max: 40 },
          { key: 'op', label: 'is', max: 20 },
          { key: 'then', label: 'then show', max: 40 },
      ],
      hint: 'One rule per row, in your own words — "RSI / above 70 / red zone".' },

    // The single biggest source of argument over a paid indicator. Settled
    // before the build instead of after: a buyer watching arrows move will
    // call it broken, and he is not wrong to.
    { key: 'confirmOn', type: 'select', label: 'When a signal counts', required: false, def: 'close',
      options: [
          { v: 'close', l: 'Only when the bar closes — never repaints' },
          { v: 'live', l: 'Live inside the bar — can appear and vanish' },
      ],
      hint: 'Bar close is the honest one. A live signal can show up mid-candle and be gone by the close.' },

    // ── [2026-11-08] What the Custom tier actually buys.
    //
    // The operator wanted the $149 tier to be visibly worth it rather than
    // just "the same thing, bigger". These are the options that are genuinely
    // out of reach of "your name on an existing engine", so they are priced
    // there — and every one of them is listed on the tier card, because a
    // buyer cannot want what he cannot see.
    { key: 'strength', type: 'select', label: 'How a signal is reported', required: false, def: 'onoff',
      options: [
          { v: 'onoff', l: 'On or off' },
          { v: 'score', l: 'A strength score, 0 to 100' },
      ],
      hint: 'A score tells you how strong the setup is, not just that there is one.' },

    { key: 'multiSymbol', type: 'select', label: 'What it watches', required: false, def: 'chart',
      options: [
          { v: 'chart', l: 'The chart I am looking at' },
          { v: 'watchlist', l: 'My whole watchlist' },
          { v: 'top', l: 'The most active markets' },
      ],
      hint: 'Beyond the open chart it becomes a scanner: it tells you WHERE the setup is, not just whether it is here.' },

    { key: 'serverSide', type: 'bool', label: 'Keeps working with the app closed', required: false,
      hint: 'Evaluated on the server instead of in your browser, so it still watches — and can still alert you — while your phone is in your pocket.' },

    { key: 'signalHistory', type: 'bool', label: 'Keep every signal it ever gave', required: false,
      hint: 'Stored on the server so you can look back and judge it on its record instead of your memory.' },

    { key: 'autoLevels', type: 'bool', label: 'Find its own levels', required: false,
      hint: 'Levels taken from real pivots in the price instead of numbers you type in by hand.' },

    { key: 'presets', type: 'bool', label: 'Save several setting profiles', required: false,
      hint: 'One set of settings for scalping, another for swings, switched in one tap.' },

    { key: 'customIcon', type: 'bool', label: 'Its own icon in the indicator list', required: false,
      hint: 'A drawn glyph of your own, not a letter — it sits next to the built-in indicators as an equal.' },

    { key: 'exportData', type: 'bool', label: 'Export what it measured', required: false,
      hint: 'Take its values and its signals out as a file, for your own records or your own spreadsheet.' },

    { key: 'levels', type: 'rows', label: 'Reference lines', required: false, maxRows: 6,
      columns: [{ key: 'value', label: 'Value', max: 12 }, { key: 'label', label: 'Label', max: 20 }],
      hint: 'Horizontal guides — 0, 50, 70/30, or anything you watch.' },

    { key: 'scale', type: 'select', label: 'Scale of its pane', required: false, def: 'own',
      showIf: { key: 'placement', in: ['pane', 'both'] },
      options: [
          { v: 'own', l: 'Fits itself' }, { v: 'fixed100', l: 'Fixed, 0 to 100' },
          { v: 'price', l: 'Same as price' },
      ] },

    { key: 'barColoring', type: 'bool', label: 'Colour the candles by its state', required: false },

    { key: 'symbols', type: 'select', label: 'Markets it must work on', required: false, def: 'all',
      options: [{ v: 'all', l: 'Every market' }, { v: 'some', l: 'Only the ones I list' }] },

    { key: 'symbolList', type: 'text', label: 'Which markets', required: false, max: 120,
      showIf: { key: 'symbols', in: ['some'] }, hint: 'For example: BTCUSDT, ETHUSDT' },

    { key: 'defaultOn', type: 'bool', label: 'Switched on by default in my list', required: false },

    { key: 'likeExisting', type: 'text', label: 'Closest existing indicator', required: false, max: 40,
      hint: '"Like X, but…" says more in four words than four paragraphs. Leave it blank if it is like nothing.' },

    { key: 'acceptance', type: 'text', label: 'I will consider it correct if', required: false, max: 200,
      hint: 'One sentence. This is what the finished build gets measured against — by both of us.' },

    { key: 'alertWhere', type: 'multi', label: 'Where alerts arrive', required: false,
      showIf: { key: 'signals', has: 'alert' },
      options: [{ v: 'app', l: 'In the app' }, { v: 'telegram', l: 'Telegram' }] },

    { key: 'alertText', type: 'text', label: 'What the alert says', required: false, max: 160,
      showIf: { key: 'signals', has: 'alert' } },

    { key: 'alertRate', type: 'select', label: 'How often it may fire', required: false, def: 'bar',
      showIf: { key: 'signals', has: 'alert' },
      options: [{ v: 'bar', l: 'Once per bar' }, { v: 'signal', l: 'Every signal' }] },

    { key: 'colorUp', type: 'color', label: 'Bullish colour', required: false, def: '#00ff88' },
    { key: 'colorDown', type: 'color', label: 'Bearish colour', required: false, def: '#ff4455' },
    { key: 'colorNeutral', type: 'color', label: 'Neutral colour', required: false, def: '#00afff' },

    { key: 'lineWidth', type: 'select', label: 'Line weight', required: false, def: '2',
      options: [{ v: '1', l: 'Hairline' }, { v: '2', l: 'Normal' }, { v: '3', l: 'Bold' }] },

    { key: 'inputs', type: 'rows', label: 'Adjustable inputs', required: false, maxRows: 8,
      columns: [{ key: 'name', label: 'Input', max: 24 }, { key: 'def', label: 'Default', max: 12 }],
      hint: 'Anything you want a settings box for — lengths, thresholds, multipliers.' },

    // [2026-11-06] This replaced a separate `exclusive` boolean. Private/public
    // is ONE axis, and two fields meaning nearly the same thing is a bug waiting
    // to happen — someone ticks "exclusive" and picks "public" and nobody knows
    // what they wanted. Public is a REQUEST, never a purchase: the operator has
    // not seen the build at the moment of payment, and selling a place in every
    // user's list sight-unseen means either shipping something weak or declining
    // and owing a refund.
    // required:false with def 'private' on purpose. A missing answer must mean
    // PRIVATE, not a blocked order: the safe value is the silent one, and an
    // order that cannot be sent because nobody ticked a box is a lost sale.
    { key: 'visibility', type: 'select', label: 'Who can see it', required: false, def: 'private',
      options: [
          { v: 'private', l: 'Only me' },
          { v: 'public_request', l: 'Everyone, credited to me — subject to approval' },
      ],
      hint: 'Private is yours alone. Public puts it in every trader\'s list with your name on it, if we agree it is ready — same price either way.' },

    { key: 'creditLine', type: 'text', label: 'The credit line everyone sees', required: false, max: 40,
      showIf: { key: 'visibility', in: ['public_request'] },
      hint: 'Your name, spelled the way you want it shown on every chart.' },

    { key: 'notes', type: 'textarea', label: 'Describe it in your own words', required: true, max: 4000,
      hint: 'What should it tell you, and when? The more precisely you say it, the closer the build lands.' },
]);

const FIELD_BY_KEY = Object.freeze(Object.fromEntries(FIELDS.map((f) => [f.key, f])));
const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024; // 2 MB each — six of these is already 12 MB inside the DB file
const ALLOWED_MIME = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function _str(v) { return typeof v === 'string' ? v.trim() : ''; }

/**
 * [2026-11-07] Is this field even on screen?
 *
 * `showIf` keeps nonsense combinations out of the order — a pane scale when
 * nothing draws in a pane, a credit line on a private build. A hidden field is
 * dropped rather than trusted: it never reaches `clean`, so it can neither be
 * stored nor priced. A field the buyer could not see must not cost him money.
 */
function _visible(f, src) {
    const cond = f && f.showIf;
    if (!cond) return true;
    const v = src ? src[cond.key] : undefined;
    if (typeof cond.has === 'string') return Array.isArray(v) && v.indexOf(cond.has) !== -1;
    if (Array.isArray(cond.in)) {
        const s = typeof v === 'string' && v ? v : (FIELD_BY_KEY[cond.key] && FIELD_BY_KEY[cond.key].def) || '';
        return cond.in.indexOf(s) !== -1;
    }
    return true;
}


/**
 * Validates a submitted spec. Returns { ok, errors: {key: message}, clean }.
 * `draft` relaxes required-ness: a half-filled draft must still be savable,
 * because the whole point of drafts is thinking out loud.
 */
function validateSpec(raw, { draft = false } = {}) {
    const errors = {};
    const clean = {};
    const src = (raw && typeof raw === 'object') ? raw : {};

    for (const f of FIELDS) {
        // Hidden means absent. Not defaulted, not kept, not charged for.
        if (!_visible(f, src)) continue;
        const v = src[f.key];
        switch (f.type) {
            case 'text':
            case 'textarea': {
                const s = _str(v);
                if (s.length > f.max) { errors[f.key] = `too long (max ${f.max})`; break; }
                if (!draft && f.required && !s) { errors[f.key] = 'required'; break; }
                clean[f.key] = s;
                break;
            }
            case 'select': {
                const s = _str(v);
                const ok = f.options.some((o) => o.v === s);
                if (!s) { if (!draft && f.required) errors[f.key] = 'required'; else clean[f.key] = f.def || ''; break; }
                if (!ok) { errors[f.key] = 'not an option'; break; }
                clean[f.key] = s;
                break;
            }
            case 'multi': {
                const arr = Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
                const allowed = arr.filter((x) => f.options.some((o) => o.v === x));
                if (allowed.length !== arr.length) { errors[f.key] = 'not an option'; break; }
                if (!draft && f.required && allowed.length < (f.min || 1)) { errors[f.key] = 'pick at least one'; break; }
                clean[f.key] = Array.from(new Set(allowed));
                break;
            }
            case 'color': {
                const s = _str(v) || f.def || '';
                if (s && !/^#[0-9a-fA-F]{6}$/.test(s)) { errors[f.key] = 'not a colour'; break; }
                clean[f.key] = s;
                break;
            }
            case 'bool': {
                clean[f.key] = v === true || v === 'true';
                break;
            }
            case 'rows': {
                const arr = Array.isArray(v) ? v : [];
                if (arr.length > f.maxRows) { errors[f.key] = `too many (max ${f.maxRows})`; break; }
                const rows = [];
                let bad = false;
                for (const r of arr) {
                    if (!r || typeof r !== 'object') { bad = true; break; }
                    const row = {};
                    for (const c of f.columns) {
                        const s = _str(r[c.key]);
                        if (s.length > c.max) { bad = true; break; }
                        row[c.key] = s;
                    }
                    if (bad) break;
                    if (row[f.columns[0].key]) rows.push(row); // drop blank rows silently
                }
                if (bad) { errors[f.key] = 'invalid row'; break; }
                clean[f.key] = rows;
                break;
            }
            default:
                break;
        }
    }

    // Unknown keys are dropped rather than rejected: a client one version ahead
    // should degrade, not fail.
    return { ok: Object.keys(errors).length === 0, errors, clean };
}

module.exports = {
    FIELDS, FIELD_BY_KEY, validateSpec, isFieldVisible: _visible,
    MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, ALLOWED_MIME,
};

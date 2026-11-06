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

    { key: 'notes', type: 'textarea', label: 'Describe it in your own words', required: true, max: 4000,
      hint: 'What should it tell you, and when? The more precisely you say it, the closer the build lands.' },
]);

const FIELD_BY_KEY = Object.freeze(Object.fromEntries(FIELDS.map((f) => [f.key, f])));
const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024; // 2 MB each — six of these is already 12 MB inside the DB file
const ALLOWED_MIME = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function _str(v) { return typeof v === 'string' ? v.trim() : ''; }

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
    FIELDS, FIELD_BY_KEY, validateSpec,
    MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, ALLOWED_MIME,
};

'use strict';

/**
 * Build Your Own Indicator — the copy-paste build brief.
 *
 * [2026-11-07] The operator's own design, and it is deliberate: an order is
 * NEVER built automatically. The buyer pays, the operator copies one block of
 * text out of Admin, hands it to whoever builds it, and keeps the decision.
 *
 * So this text has to stand on its own. Three rules follow from that:
 *
 *   1. It renders from the SAME field definitions the form renders from, so a
 *      label here can never drift from the question the buyer was actually
 *      asked. A brief that misquotes the order is worse than no brief.
 *   2. It says nothing the buyer did not answer. An invented default reads as
 *      a requirement, and the build then gets measured against something
 *      nobody asked for. The only exception is the repaint policy, which is
 *      always stated, because silence there is what arguments are made of.
 *   3. It never throws. It runs on an admin page over possibly damaged rows,
 *      and an exception would turn a bad row into a broken page.
 *
 * It also leaves the payment reference out. The brief travels to whoever
 * builds the indicator; a payment id is not theirs to hold.
 */

const { FIELD_BY_KEY } = require('./byoiSpec');
const { TIERS, formatPrice } = require('./byoiPricing');

/** The human label for a stored option value, as the buyer saw it. */
function _optionLabel(key, value) {
    const f = FIELD_BY_KEY[key];
    if (!f || !Array.isArray(f.options)) return String(value);
    const hit = f.options.find((o) => o.v === value);
    return hit ? hit.l : String(value);
}

function _labelsFor(key, arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map((v) => _optionLabel(key, v));
}

function _title(key, fallback) {
    const f = FIELD_BY_KEY[key];
    return (f && f.label) || fallback || key;
}

function _str(v) { return typeof v === 'string' ? v.trim() : ''; }

/** One "Question: answer" line, or nothing at all if there is no answer. */
function _line(out, label, value) {
    if (value === undefined || value === null) return;
    const s = Array.isArray(value) ? value.filter(Boolean).join(', ') : String(value).trim();
    if (!s) return;
    out.push(label + ': ' + s);
}

function _rowsBlock(out, label, rows, columns) {
    if (!Array.isArray(rows) || rows.length === 0) return;
    const lines = [];
    for (const r of rows) {
        if (!r || typeof r !== 'object') continue;
        const parts = columns.map((c) => _str(r[c])).filter(Boolean);
        if (parts.length) lines.push('  - ' + parts.join(' / '));
    }
    if (!lines.length) return;
    out.push(label + ':');
    out.push(...lines);
}

function _date(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return '';
    try { return new Date(n).toISOString().slice(0, 10); } catch { return ''; }
}

/**
 * Renders the brief. `row` is the byoi_requests row, `spec` the CLEAN spec
 * (hidden fields already dropped by validateSpec, so nothing the buyer could
 * not see appears here).
 */
function renderBrief({ row, spec, attachmentCount } = {}) {
    try {
        const r = (row && typeof row === 'object') ? row : {};
        const s = (spec && typeof spec === 'object') ? spec : {};
        const tier = TIERS[r.tier] || null;
        const out = [];

        // ── Header: what was bought, and therefore what is owed.
        const name = _str(s.title) || _str(r.title) || '(unnamed)';
        out.push('BUILD AN INDICATOR — order #' + (r.id != null ? r.id : '?'));
        const head = [];
        if (tier) head.push(tier.label + ' tier');
        const price = Number(r.price_cents);
        if (Number.isFinite(price) && price > 0) head.push(formatPrice(price));
        else if (tier && tier.quote_only) head.push('quoted by hand');
        const when = _date(r.submitted_at);
        if (when) head.push('ordered ' + when);
        if (head.length) out.push(head.join(' · '));
        out.push('');

        // ── What it is.
        _line(out, 'Name on the chart', name);
        if (s.placement) _line(out, _title('placement'), _optionLabel('placement', s.placement));
        _line(out, _title('visuals'), _labelsFor('visuals', s.visuals));
        _line(out, _title('sources'), _labelsFor('sources', s.sources));
        _line(out, _title('timeframes'), Array.isArray(s.timeframes) ? s.timeframes : []);
        _line(out, _title('symbols'), s.symbols ? _optionLabel('symbols', s.symbols) : undefined);
        _line(out, 'Markets listed', s.symbolList);
        _line(out, _title('likeExisting'), s.likeExisting);
        out.push('');

        // ── How it calculates. The expensive part of any build.
        out.push('HOW IT CALCULATES');
        _line(out, _title('smoothing'), s.smoothing ? _optionLabel('smoothing', s.smoothing) : undefined);
        _line(out, _title('normalize'), s.normalize ? _optionLabel('normalize', s.normalize) : undefined);
        _line(out, _title('signalLogic'), _labelsFor('signalLogic', s.signalLogic));
        _rowsBlock(out, _title('conditions'), s.conditions, ['when', 'op', 'then']);
        _line(out, _title('signals'), _labelsFor('signals', s.signals));
        // Always stated, answered or not: the default IS an answer, and a brief
        // that stays silent here is how a finished build gets called broken.
        const confirm = _str(s.confirmOn) || (FIELD_BY_KEY.confirmOn && FIELD_BY_KEY.confirmOn.def) || 'close';
        out.push(_title('confirmOn') + ': ' + _optionLabel('confirmOn', confirm));
        out.push('');

        // ── How it looks.
        const look = [];
        _rowsBlock(look, _title('levels'), s.levels, ['value', 'label']);
        _line(look, _title('scale'), s.scale ? _optionLabel('scale', s.scale) : undefined);
        _line(look, 'Bullish colour', s.colorUp);
        _line(look, 'Bearish colour', s.colorDown);
        _line(look, 'Neutral colour', s.colorNeutral);
        _line(look, _title('lineWidth'), s.lineWidth ? _optionLabel('lineWidth', s.lineWidth) : undefined);
        if (s.barColoring === true) look.push(_title('barColoring') + ': yes');
        if (s.defaultOn === true) look.push(_title('defaultOn') + ': yes');
        _rowsBlock(look, _title('inputs'), s.inputs, ['name', 'def']);
        if (look.length) { out.push('HOW IT LOOKS'); out.push(...look); out.push(''); }

        // ── Alerts, only if asked for. They need plumbing that does not exist
        // yet, which is why they are priced at the Custom tier.
        const alerts = [];
        _line(alerts, 'Alerts', _labelsFor('alertWhere', s.alertWhere));
        _line(alerts, 'Alert text', s.alertText);
        _line(alerts, 'Alert rate', s.alertRate ? _optionLabel('alertRate', s.alertRate) : undefined);
        if (alerts.length) { out.push(...alerts); out.push(''); }

        // ── Who sees it. Public changes what shipping means.
        if (_str(s.visibility) === 'public_request') {
            out.push('VISIBILITY: public request — every trader\'s list, credited to the buyer, if approved.');
            _line(out, 'Credit line', s.creditLine);
            out.push('');
        }

        // ── His own words, last, because they qualify everything above.
        const notes = _str(s.notes) || _str(r.notes);
        if (notes) { out.push('IN THE BUYER\'S OWN WORDS'); out.push(notes); out.push(''); }

        const acc = _str(s.acceptance);
        if (acc) { out.push('ACCEPTED WHEN: ' + acc); out.push(''); }

        const n = Number(attachmentCount);
        if (Number.isFinite(n) && n > 0) {
            out.push('Came with ' + n + ' image' + (n === 1 ? '' : 's') + ' — see the order in Admin.');
            out.push('');
        }

        out.push('Please build this as a Zeus indicator, following the answers above.');
        return out.join('\n');
    } catch {
        // A damaged row must not break the admin page it is shown on.
        return 'BUILD AN INDICATOR\n\n(This order could not be rendered. Open it in Admin.)';
    }
}

module.exports = { renderBrief };

'use strict';

// Zeus Terminal — Build Your Own Indicator
// Mounted at /api/byoi after sessionAuth in server.js.
//
// [2026-11-06] A buyer describes an indicator, keeps as many drafts as they
// like, and on send passes the billing gate before the order reaches the
// operator. The rules that decide money live in services/byoiPricing.js and
// the form lives in services/byoiSpec.js; this file is plumbing between them
// and the database, and holds no prices of its own.

const express = require('express');
const router = express.Router();
const db = require('../services/database');
const P = require('../services/byoiPricing');
const SPEC = require('../services/byoiSpec');

function _requireAuth(req, res, next) {
    if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'Authentication required' });
    next();
}
function _requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ ok: false, error: 'admin only' });
    next();
}
function _id(v) {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
}
function _mode() { return P.billingMode(process.env); }

/** Never ship the buyer's base64 blobs or another user's email by accident. */
function _publicRow(row) {
    if (!row) return null;
    let spec = {};
    try { spec = JSON.parse(row.spec_json || '{}'); } catch (_) { spec = {}; }
    return {
        id: row.id, tier: row.tier, title: row.title, spec, notes: row.notes,
        status: row.status, priceCents: row.price_cents, currency: row.currency,
        isBypass: P.isBypass(row.payment_ref),
        declineReason: row.decline_reason || null,
        createdAt: row.created_at, updatedAt: row.updated_at,
        submittedAt: row.submitted_at, deliveredAt: row.delivered_at,
        attachments: db.byoiListAttachments(row.id),
    };
}

// ── What the client needs to render the form and the prices ──
router.get('/config', _requireAuth, (req, res) => {
    const mode = _mode();
    const isAdmin = req.user.role === 'admin';
    res.json({
        ok: true,
        fields: SPEC.FIELDS,
        tiers: P.TIER_IDS.map((id) => ({ ...P.TIERS[id], price: P.formatPrice(P.TIERS[id].price_cents) })),
        currency: P.CURRENCY,
        billingMode: mode,
        // The client must not infer this from the mode: the rule is one place.
        canSubmit: P.evaluateSubmission({ tier: 'custom', mode, isAdmin, paymentRef: null }).allowed,
        maxAttachments: SPEC.MAX_ATTACHMENTS,
        maxAttachmentBytes: SPEC.MAX_ATTACHMENT_BYTES,
        allowedMime: SPEC.ALLOWED_MIME,
    });
});

// ── The buyer's own requests, drafts included ──
router.get('/requests', _requireAuth, (req, res) => {
    try {
        res.json({ ok: true, requests: db.byoiListForUser(req.user.id).map(_publicRow) });
    } catch (e) {
        res.status(500).json({ ok: false, error: 'could not read requests' });
    }
});

function _readBody(req) {
    const b = req.body || {};
    const tier = typeof b.tier === 'string' ? b.tier : '';
    const v = SPEC.validateSpec(b.spec, { draft: true });
    return { tier, v, title: (v.clean.title || '').slice(0, 40), notes: (v.clean.notes || '') };
}

router.post('/draft', _requireAuth, (req, res) => {
    const { tier, v, title, notes } = _readBody(req);
    if (!P.TIERS[tier]) return res.status(400).json({ ok: false, error: 'unknown tier' });
    if (!v.ok) return res.status(400).json({ ok: false, error: 'invalid spec', errors: v.errors });
    try {
        const row = db.byoiInsertDraft(req.user.id, {
            tier, title, specJson: JSON.stringify(v.clean), notes,
            priceCents: P.priceCentsFor(tier), currency: P.CURRENCY,
        });
        res.json({ ok: true, request: _publicRow(row) });
    } catch (e) {
        res.status(500).json({ ok: false, error: 'could not save draft' });
    }
});

router.put('/draft/:id', _requireAuth, (req, res) => {
    const id = _id(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'bad id' });
    const { tier, v, title, notes } = _readBody(req);
    if (!P.TIERS[tier]) return res.status(400).json({ ok: false, error: 'unknown tier' });
    if (!v.ok) return res.status(400).json({ ok: false, error: 'invalid spec', errors: v.errors });
    try {
        const row = db.byoiUpdateDraft(id, req.user.id, {
            tier, title, specJson: JSON.stringify(v.clean), notes, priceCents: P.priceCentsFor(tier),
        });
        // No match means it is not yours, or no longer a draft. Same answer
        // either way: a submitted order is not editable, and probing for one
        // must not reveal whether it exists.
        if (!row) return res.status(404).json({ ok: false, error: 'no editable draft with that id' });
        res.json({ ok: true, request: _publicRow(row) });
    } catch (e) {
        res.status(500).json({ ok: false, error: 'could not save draft' });
    }
});

router.delete('/draft/:id', _requireAuth, (req, res) => {
    const id = _id(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'bad id' });
    const gone = db.byoiDeleteDraft(id, req.user.id);
    if (!gone) return res.status(404).json({ ok: false, error: 'no editable draft with that id' });
    res.json({ ok: true });
});

// ── Attachments. Its own body parser: the global limit is 1 MB and a
//    screenshot base64-inflates by a third, so a 2 MB image needs headroom
//    here without widening every other route in the app. ──
router.post('/draft/:id/attachment', _requireAuth, express.json({ limit: '4mb' }), (req, res) => {
    const id = _id(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'bad id' });
    const b = req.body || {};
    const filename = (typeof b.filename === 'string' ? b.filename : 'image').slice(0, 120);
    const mime = typeof b.mime === 'string' ? b.mime : '';
    const dataB64 = typeof b.dataB64 === 'string' ? b.dataB64 : '';
    if (SPEC.ALLOWED_MIME.indexOf(mime) === -1) return res.status(400).json({ ok: false, error: 'images only' });
    if (!dataB64) return res.status(400).json({ ok: false, error: 'empty file' });
    // Measure the DECODED size: base64 length is 4/3 of the real bytes, and
    // the limit the buyer was told about is in real bytes.
    const bytes = Math.floor(dataB64.length * 3 / 4);
    if (bytes > SPEC.MAX_ATTACHMENT_BYTES) return res.status(413).json({ ok: false, error: 'file too large' });
    if (db.byoiListAttachments(id).length >= SPEC.MAX_ATTACHMENTS) {
        return res.status(400).json({ ok: false, error: 'too many attachments' });
    }
    const att = db.byoiAddAttachment(id, req.user.id, { filename, mime, bytes, dataB64 });
    if (!att) return res.status(404).json({ ok: false, error: 'no editable draft with that id' });
    res.json({ ok: true, attachment: att });
});

router.get('/attachment/:id', _requireAuth, (req, res) => {
    const id = _id(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'bad id' });
    const att = db.byoiGetAttachment(id);
    if (!att) return res.status(404).json({ ok: false, error: 'not found' });
    // The owner, or the operator who has to build the thing. Nobody else.
    if (att.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(404).json({ ok: false, error: 'not found' });
    }
    const buf = Buffer.from(att.data_b64, 'base64');
    res.setHeader('Content-Type', att.mime);
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.end(buf);
});

router.delete('/attachment/:id', _requireAuth, (req, res) => {
    const id = _id(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'bad id' });
    res.json({ ok: db.byoiDeleteAttachment(id, req.user.id) });
});

// ── Send. The gate. ──
router.post('/submit/:id', _requireAuth, (req, res) => {
    const id = _id(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'bad id' });
    const row = db.byoiGetOwned(id, req.user.id);
    if (!row) return res.status(404).json({ ok: false, error: 'not found' });
    if (row.status !== P.STATUS.DRAFT) return res.status(409).json({ ok: false, error: 'already sent' });

    // Full validation now — a draft may be half-finished, an order may not.
    let spec = {};
    try { spec = JSON.parse(row.spec_json || '{}'); } catch (_) { spec = {}; }
    const v = SPEC.validateSpec(spec, { draft: false });
    if (!v.ok) return res.status(400).json({ ok: false, error: 'incomplete', errors: v.errors });

    const mode = _mode();
    const verdict = P.evaluateSubmission({
        tier: row.tier, mode,
        isAdmin: req.user.role === 'admin',
        paymentRef: req.body && req.body.paymentRef,
    });
    if (!verdict.allowed) {
        return res.status(402).json({ ok: false, error: verdict.reason, billingMode: mode });
    }

    const saved = db.byoiMarkSubmitted(id, req.user.id, {
        status: verdict.status, paymentRef: verdict.paymentRef, billingMode: mode,
    });
    if (!saved) return res.status(409).json({ ok: false, error: 'already sent' });

    // Tell the operator, through the channel they already watch.
    try {
        const fn = req.app && req.app.locals && req.app.locals.wsBroadcastToUser;
        if (typeof fn === 'function') {
            for (const adminId of db.getAdminUserIds()) {
                fn(adminId, { type: 'byoi.request', data: { id: saved.id, tier: saved.tier, title: saved.title } });
            }
        }
    } catch (_) { /* a failed ping must never undo a paid order */ }

    res.json({ ok: true, request: _publicRow(saved) });
});

// ── The chart's SELECT INDICATOR list, above the built-in set ──
// Two groups: what this user owns, and what anyone made public. A row exists
// only once the operator registered a delivered slug, so nothing listed here
// can be a toggle that does nothing.
router.get('/indicators', _requireAuth, (req, res) => {
    try {
        const { mine, community } = db.byoiIndicatorsForUser(req.user.id);
        const shape = (r) => ({
            id: r.slug, name: r.name, desc: r.description || '',
            author: r.author_label || null, visibility: r.visibility,
        });
        res.json({ ok: true, mine: mine.map(shape), community: community.map(shape) });
    } catch (e) {
        // The chart must open even if this fails — an empty list is a far
        // better outcome than a toolbar that will not render.
        res.json({ ok: true, mine: [], community: [] });
    }
});

// ── Operator side ──
router.get('/admin/requests', _requireAuth, _requireAdmin, (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const rows = db.byoiListForAdmin(status && P.STATUS[status.toUpperCase()] ? status : null);
    res.json({
        ok: true,
        requests: rows.map((r) => ({
            ..._publicRow(r),
            email: r.email || null,
            userId: r.user_id,
            paymentRef: r.payment_ref || null,
            billingMode: r.billing_mode || null,
            adminNote: r.admin_note || null,
        })),
    });
});

router.get('/admin/count', _requireAuth, _requireAdmin, (req, res) => {
    res.json({ ok: true, count: db.byoiCountForAdmin() });
});

router.post('/admin/request/:id/status', _requireAuth, _requireAdmin, (req, res) => {
    const id = _id(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'bad id' });
    const to = typeof (req.body && req.body.status) === 'string' ? req.body.status : '';
    const cur = db.byoiGetForAdmin(id);
    if (!cur) return res.status(404).json({ ok: false, error: 'not found' });
    if (!P.canTransition(cur.status, to)) {
        return res.status(409).json({ ok: false, error: `cannot go ${cur.status} -> ${to}` });
    }
    const saved = db.byoiSetStatus(id, to, {
        declineReason: req.body && req.body.declineReason,
        adminNote: req.body && req.body.adminNote,
    });
    res.json({
        ok: true,
        request: { ..._publicRow(saved), email: saved.email || null },
        // Declining owes the money back — the operator's standing decision.
        // Surfaced so the UI states it rather than leaving it to memory.
        refundOwed: P.refundOwed(to),
    });
});

/**
 * Deliver: register the indicator that was actually built.
 *
 * The slug must match the id the indicator has in the chart code, which is why
 * this is a separate step from the status move — pressing "delivered" without
 * having shipped code would put a dead toggle in someone's list.
 *
 * visibility is decided HERE, by the operator. The buyer could only ask.
 */
router.post('/admin/request/:id/deliver', _requireAuth, _requireAdmin, (req, res) => {
    const id = _id(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'bad id' });
    const reqRow = db.byoiGetForAdmin(id);
    if (!reqRow) return res.status(404).json({ ok: false, error: 'not found' });
    if (!P.canTransition(reqRow.status, P.STATUS.DELIVERED)) {
        return res.status(409).json({ ok: false, error: `cannot go ${reqRow.status} -> delivered` });
    }

    const b = req.body || {};
    const slug = String(b.slug || '').trim().toLowerCase();
    const visibility = b.visibility === 'public' ? 'public' : 'private';
    const authorLabel = typeof b.authorLabel === 'string' ? b.authorLabel.trim().slice(0, 40) : '';

    if (!/^[a-z0-9][a-z0-9_-]{2,39}$/.test(slug)) {
        return res.status(400).json({ ok: false, error: 'slug must be 3-40 chars, a-z 0-9 _ -' });
    }
    if (db.byoiIndicatorBySlug(slug)) {
        return res.status(409).json({ ok: false, error: 'that slug is already registered' });
    }
    if (visibility === 'public' && !authorLabel) {
        // "by <someone>" is the whole point of a public one.
        return res.status(400).json({ ok: false, error: 'a public indicator needs an author label' });
    }

    let created;
    try {
        created = db.byoiCreateIndicator({
            requestId: reqRow.id, ownerUserId: reqRow.user_id, slug,
            name: reqRow.title || slug, description: '', authorLabel, visibility,
        });
    } catch (e) {
        // The unique index on public names fires here.
        const msg = String((e && e.message) || '');
        if (/UNIQUE/i.test(msg)) return res.status(409).json({ ok: false, error: 'a public indicator already has that name' });
        return res.status(500).json({ ok: false, error: 'could not register the indicator' });
    }

    const saved = db.byoiSetStatus(id, P.STATUS.DELIVERED, { adminNote: b.adminNote });
    res.json({ ok: true, request: { ..._publicRow(saved), email: saved.email || null }, indicator: created });
});

router.get('/admin/indicators', _requireAuth, _requireAdmin, (req, res) => {
    res.json({ ok: true, indicators: db.byoiListIndicatorsForAdmin() });
});

router.post('/admin/indicator/:id/visibility', _requireAuth, _requireAdmin, (req, res) => {
    const id = _id(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'bad id' });
    const to = (req.body && req.body.visibility) === 'public' ? 'public' : 'private';
    try {
        const row = db.byoiSetIndicatorVisibility(id, to);
        if (!row) return res.status(404).json({ ok: false, error: 'not found' });
        res.json({ ok: true, indicator: row });
    } catch (e) {
        if (/UNIQUE/i.test(String((e && e.message) || ''))) {
            return res.status(409).json({ ok: false, error: 'a public indicator already has that name' });
        }
        res.status(500).json({ ok: false, error: 'could not change visibility' });
    }
});

module.exports = router;

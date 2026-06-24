'use strict';
// [2026-06-24] User profile (flip-header). Own profile read+write; public profile read.
// Public fields only — never email or anything sensitive. Save is validated + username-unique.
const express = require('express');
const router = express.Router();
const db = require('../services/database');
const { validateProfileFields } = require('../middleware/validate');

const PUBLIC = ['id', 'display_name', 'username', 'avatar', 'accent_color', 'tagline'];
function pick(row, keys) { const o = {}; if (row) for (const k of keys) o[k] = row[k] ?? null; return o; }

// own full profile
router.get('/', (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'auth' });
  res.json({ ok: true, profile: pick(db.getUserProfileById(req.user.id), PUBLIC) });
});

// public profile of any user — public fields only, never email
router.get('/:userId', (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'auth' });
  const id = parseInt(req.params.userId, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
  res.json({ ok: true, profile: pick(db.getUserProfileById(id), PUBLIC) });
});

// save own profile
router.post('/', (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'auth' });
  const body = (req.body && req.body.profile) || {};
  const v = validateProfileFields(body);
  if (!v.ok) return res.status(400).json({ ok: false, error: 'invalid: ' + v.error });
  if (body.username) {
    const taken = db.findUserByUsername(body.username);
    if (taken && taken.id !== req.user.id) return res.status(409).json({ ok: false, error: 'username_taken' });
  }
  const cur = db.getUserProfileById(req.user.id) || {};
  db.setUserProfile(req.user.id, {
    display_name: body.display_name ?? cur.display_name,
    username: (body.username ?? cur.username) || null,
    avatar: body.avatar ?? cur.avatar,
    accent_color: body.accent_color ?? cur.accent_color,
    tagline: body.tagline ?? cur.tagline,
  });
  res.json({ ok: true, profile: pick(db.getUserProfileById(req.user.id), PUBLIC) });
});

module.exports = router;

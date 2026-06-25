'use strict';
// [2026-06-25] Referral (Phase 3 backend). Returns the user's stable unique code + how many users
// have joined with it. Code is generated once on first request and stored (unique per user).
const express = require('express');
const router = express.Router();
const db = require('../services/database');

router.get('/', (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'auth' });
  try {
    const code = db.getOrCreateReferralCode(req.user.id);
    const joined = db.countReferrals(req.user.id);
    res.json({ ok: true, code, joined });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'referral_failed' });
  }
});

module.exports = router;

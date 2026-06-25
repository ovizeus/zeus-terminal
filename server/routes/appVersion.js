'use strict';
// [2026-06-26] App version reporting. The native Android app (AppUpdateChecker) already reads its
// installed APK versionCode/Name on boot to compare against /app-version.json. It also POSTs it here
// so the admin can see which build each user runs and who is behind. Pure web — no APK rebuild needed.
const express = require('express');
const router = express.Router();
const db = require('../services/database');

// Coerce the untrusted POST body into a clean record, or null if it is not a usable report.
function normalizeAppVersion(body) {
  if (!body || typeof body !== 'object') return null;
  const versionCode = Number(body.versionCode);
  if (!Number.isInteger(versionCode) || versionCode <= 0 || versionCode > 1e9) return null;
  let versionName = typeof body.versionName === 'string' ? body.versionName.trim() : '';
  versionName = versionName.replace(/[^0-9A-Za-z.\-_]/g, '').slice(0, 32);
  let platform = typeof body.platform === 'string' ? body.platform.trim().toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  if (!platform) platform = 'android';
  platform = platform.slice(0, 16);
  return { versionCode, versionName, platform };
}

router.post('/version', (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'auth' });
  const v = normalizeAppVersion(req.body);
  if (!v) return res.status(400).json({ ok: false, error: 'bad_version' });
  try {
    db.setAppVersion(req.user.id, v.versionCode, v.versionName, v.platform);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'report_failed' });
  }
});

module.exports = router;
module.exports.normalizeAppVersion = normalizeAppVersion;

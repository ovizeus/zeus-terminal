// Zeus v122 — teacher/teacherStorage.js
// THE TEACHER — LocalStorage persistence layer
// Uses zeus_teacher_ prefix — fully isolated from live storage keys
// NO DOM, NO live state reads/writes
'use strict';

// ══════════════════════════════════════════════════════════════════
// SAFE READ / WRITE (mirrors storage.js pattern, independent impl)
// ══════════════════════════════════════════════════════════════════
function _teacherStorageSet(key, data) {
  try {
    var str = typeof data === 'string' ? data : JSON.stringify(data);
    if (str.length > 500000) {
      console.warn('[TEACHER] Storage cap hit for key:', key, str.length, 'bytes');
      return false;
    }
    localStorage.setItem(key, str);
    if (typeof _ucMarkDirty === 'function') _ucMarkDirty('teacherData');
    if (typeof _userCtxPush === 'function') _userCtxPush();
    return true;
  } catch (e) {
    console.warn('[TEACHER] Storage write failed:', key, e.message);
    return false;
  }
}

function _teacherStorageGet(key) {
  try {
    var raw = localStorage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[TEACHER] Storage read failed:', key, e.message);
    return null;
  }
}

function _teacherStorageRemove(key) {
  try { localStorage.removeItem(key); } catch (e) { /* silent */ }
}

// ══════════════════════════════════════════════════════════════════
// CONFIG — User overrides for trade defaults
// ══════════════════════════════════════════════════════════════════
function teacherSaveConfig() {
  var cfg = window.TEACHER && window.TEACHER.config;
  if (!cfg) return false;
  return _teacherStorageSet(TEACHER_STORAGE_KEYS.config, cfg);
}

function teacherLoadConfig() {
  var saved = _teacherStorageGet(TEACHER_STORAGE_KEYS.config);
  if (!saved || typeof saved !== 'object') return false;
  if (window.TEACHER) {
    var cfg = window.TEACHER.config;
    // Merge saved values into current config (preserves any new fields from updates)
    var keys = Object.keys(saved);
    for (var i = 0; i < keys.length; i++) {
      if (cfg.hasOwnProperty(keys[i])) cfg[keys[i]] = saved[keys[i]];
    }
  }
  return true;
}

// ══════════════════════════════════════════════════════════════════
// SESSIONS — Completed replay session summaries
// Each session: { id, ts, tf, bars, trades, stats, duration }
// ══════════════════════════════════════════════════════════════════
function teacherSaveSessions(sessions) {
  if (!Array.isArray(sessions)) return false;
  // Keep max 50 sessions in storage
  var toSave = sessions.slice(0, 50);
  return _teacherStorageSet(TEACHER_STORAGE_KEYS.sessions, toSave);
}

function teacherLoadSessions() {
  var data = _teacherStorageGet(TEACHER_STORAGE_KEYS.sessions);
  return Array.isArray(data) ? data : [];
}

function teacherAddSession(session) {
  var sessions = teacherLoadSessions();
  sessions.unshift(session);
  if (sessions.length > 50) sessions.length = 50;
  return teacherSaveSessions(sessions);
}

// ══════════════════════════════════════════════════════════════════
// LESSONS — Extracted pattern insights
// Each lesson: { id, ts, type, description, tags[], winRate, sampleSize }
// ══════════════════════════════════════════════════════════════════
function teacherSaveLessons(lessons) {
  if (!Array.isArray(lessons)) return false;
  var toSave = lessons.slice(0, 200);
  return _teacherStorageSet(TEACHER_STORAGE_KEYS.lessons, toSave);
}

function teacherLoadLessons() {
  var data = _teacherStorageGet(TEACHER_STORAGE_KEYS.lessons);
  return Array.isArray(data) ? data : [];
}

function teacherAddLesson(lesson) {
  var lessons = teacherLoadLessons();
  lessons.unshift(lesson);
  if (lessons.length > 200) lessons.length = 200;
  teacherSaveLessons(lessons);
  if (window.TEACHER) window.TEACHER.lessons = lessons;
  return true;
}

// ══════════════════════════════════════════════════════════════════
// STATS — Aggregated performance stats across sessions
// ══════════════════════════════════════════════════════════════════
function teacherSaveStats(stats) {
  if (!stats || typeof stats !== 'object') return false;
  return _teacherStorageSet(TEACHER_STORAGE_KEYS.stats, stats);
}

function teacherLoadStats() {
  return _teacherStorageGet(TEACHER_STORAGE_KEYS.stats);
}

// ══════════════════════════════════════════════════════════════════
// MEMORY — Patterns, edges, mistakes (learning layer)
// ══════════════════════════════════════════════════════════════════
function teacherSaveMemory(memory) {
  if (!memory || typeof memory !== 'object') return false;
  // Cap each category
  var toSave = {
    patterns: Array.isArray(memory.patterns) ? memory.patterns.slice(0, 100) : [],
    edges: Array.isArray(memory.edges) ? memory.edges.slice(0, 100) : [],
    mistakes: Array.isArray(memory.mistakes) ? memory.mistakes.slice(0, 100) : [],
  };
  return _teacherStorageSet(TEACHER_STORAGE_KEYS.memory, toSave);
}

function teacherLoadMemory() {
  var data = _teacherStorageGet(TEACHER_STORAGE_KEYS.memory);
  if (data && typeof data === 'object') {
    return {
      patterns: Array.isArray(data.patterns) ? data.patterns : [],
      edges: Array.isArray(data.edges) ? data.edges : [],
      mistakes: Array.isArray(data.mistakes) ? data.mistakes : [],
    };
  }
  return { patterns: [], edges: [], mistakes: [] };
}

// ══════════════════════════════════════════════════════════════════
// INIT — Load all persistent data into TEACHER state
// ══════════════════════════════════════════════════════════════════
function teacherLoadAllPersistent() {
  if (!window.TEACHER) return;
  teacherLoadConfig();
  window.TEACHER.lessons = teacherLoadLessons();
  window.TEACHER.memory = teacherLoadMemory();
  window.TEACHER.stats = teacherLoadStats();
}

// ══════════════════════════════════════════════════════════════════
// EXPORT / IMPORT — Full teacher data as JSON file
// ══════════════════════════════════════════════════════════════════
function teacherExportAll() {
  var payload = {
    version: 'teacher_v2',
    exportedAt: new Date().toISOString(),
    config: window.TEACHER ? window.TEACHER.config : null,
    sessions: teacherLoadSessions(),
    lessons: teacherLoadLessons(),
    stats: teacherLoadStats(),
    memory: teacherLoadMemory(),
    v2state: _teacherStorageGet(TEACHER_STORAGE_KEYS.v2state),
  };
  var str = JSON.stringify(payload, null, 2);
  var blob = new Blob([str], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'zeus_teacher_export_' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function teacherImportAll(jsonString) {
  try {
    var data = JSON.parse(jsonString);
    if (!data || (data.version !== 'teacher_v1' && data.version !== 'teacher_v2')) return { ok: false, error: 'Invalid format or version' };
    var imported = 0;
    if (data.config && typeof data.config === 'object') {
      _teacherStorageSet(TEACHER_STORAGE_KEYS.config, data.config);
      imported++;
    }
    if (Array.isArray(data.sessions)) {
      teacherSaveSessions(data.sessions);
      imported++;
    }
    if (Array.isArray(data.lessons)) {
      teacherSaveLessons(data.lessons);
      imported++;
    }
    if (data.stats && typeof data.stats === 'object') {
      teacherSaveStats(data.stats);
      imported++;
    }
    if (data.memory && typeof data.memory === 'object') {
      teacherSaveMemory(data.memory);
      imported++;
    }
    if (data.v2state && typeof data.v2state === 'object') {
      _teacherStorageSet(TEACHER_STORAGE_KEYS.v2state, data.v2state);
      imported++;
    }
    // Reload into state
    teacherLoadAllPersistent();
    return { ok: true, imported: imported };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ══════════════════════════════════════════════════════════════════
// V2 STATE — Autonomous engine persistent state
// Saves: capability, curriculum, lifetime trades (capped), fail count, capital
// ══════════════════════════════════════════════════════════════════
function teacherSaveV2State() {
  var T = window.TEACHER;
  if (!T || !T.v2) return false;
  var v2 = T.v2;
  var toSave = {
    capability: v2.capability,
    capabilityLabel: v2.capabilityLabel,
    capabilityBreakdown: v2.capabilityBreakdown,
    currentCapital: v2.currentCapital,
    failCount: v2.failCount,
    reloadCount: v2.reloadCount,
    lifetimeSessions: v2.lifetimeSessions,
    lifetimeStats: v2.lifetimeStats,
    lifetimeTrades: v2.lifetimeTrades.slice(-500), // cap storage to last 500
    curriculum: v2.curriculum,
    recentActivity: v2.recentActivity,
  };
  return _teacherStorageSet(TEACHER_STORAGE_KEYS.v2state, toSave);
}

function teacherLoadV2State() {
  var T = window.TEACHER;
  if (!T || !T.v2) return false;
  var data = _teacherStorageGet(TEACHER_STORAGE_KEYS.v2state);
  if (!data || typeof data !== 'object') return false;
  var v2 = T.v2;
  if (typeof data.capability === 'number') v2.capability = data.capability;
  if (typeof data.capabilityLabel === 'string') v2.capabilityLabel = data.capabilityLabel;
  if (data.capabilityBreakdown) v2.capabilityBreakdown = data.capabilityBreakdown;
  if (typeof data.currentCapital === 'number') v2.currentCapital = data.currentCapital;
  if (typeof data.failCount === 'number') v2.failCount = data.failCount;
  if (typeof data.reloadCount === 'number') v2.reloadCount = data.reloadCount;
  if (typeof data.lifetimeSessions === 'number') v2.lifetimeSessions = data.lifetimeSessions;
  if (data.lifetimeStats) v2.lifetimeStats = data.lifetimeStats;
  if (Array.isArray(data.lifetimeTrades)) v2.lifetimeTrades = data.lifetimeTrades;
  if (data.curriculum) v2.curriculum = data.curriculum;
  if (Array.isArray(data.recentActivity)) v2.recentActivity = data.recentActivity;
  return true;
}

// ══════════════════════════════════════════════════════════════════
// CLEAR — Wipe all teacher data from storage
// ══════════════════════════════════════════════════════════════════
function teacherClearAllStorage() {
  var keys = Object.keys(TEACHER_STORAGE_KEYS);
  for (var i = 0; i < keys.length; i++) {
    _teacherStorageRemove(TEACHER_STORAGE_KEYS[keys[i]]);
  }
  // Reset state
  if (window.TEACHER) {
    window.TEACHER.lessons = [];
    window.TEACHER.memory = { patterns: [], edges: [], mistakes: [] };
    window.TEACHER.stats = null;
    if (window.TEACHER.v2) {
      window.TEACHER.v2 = null;
      teacherInitV2State();
    }
  }
}

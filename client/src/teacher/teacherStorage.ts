// Zeus — teacher/teacherStorage.ts
// Ported 1:1 from public/js/teacher/teacherStorage.js (Phase 7C)
// THE TEACHER — LocalStorage persistence layer
// [8E-3] w.TEACHER reads migrated to getTeacher()
import { getTeacher } from '../services/stateAccessors'
// Uses zeus_teacher_ prefix — fully isolated from live storage keys
// NO DOM, NO live state reads/writes

const w = window as any

// ══════════════════════════════════════════════════════════════════
// SAFE READ / WRITE (mirrors storage.js pattern, independent impl)
// ══════════════════════════════════════════════════════════════════
export function _teacherStorageSet(key: any, data: any): boolean {
  try {
    const str = typeof data === 'string' ? data : JSON.stringify(data)
    if (str.length > 500000) {
      console.warn('[TEACHER] Storage cap hit for key:', key, str.length, 'bytes')
      return false
    }
    localStorage.setItem(key, str)
    if (typeof w._ucMarkDirty === 'function') w._ucMarkDirty('teacherData')
    if (typeof w._userCtxPush === 'function') w._userCtxPush()
    return true
  } catch (e: any) {
    console.warn('[TEACHER] Storage write failed:', key, e.message)
    return false
  }
}

export function _teacherStorageGet(key: any): any {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return null
    return JSON.parse(raw)
  } catch (e: any) {
    console.warn('[TEACHER] Storage read failed:', key, e.message)
    return null
  }
}

export function _teacherStorageRemove(key: any): void {
  try { localStorage.removeItem(key) } catch (_e) { /* silent */ }
}

// ══════════════════════════════════════════════════════════════════
// CONFIG — User overrides for trade defaults
// ══════════════════════════════════════════════════════════════════
export function teacherSaveConfig(): boolean {
  const _Tc = getTeacher(); const cfg = _Tc && _Tc.config
  if (!cfg) return false
  return _teacherStorageSet(w.TEACHER_STORAGE_KEYS.config, cfg)
}

export function teacherLoadConfig(): boolean {
  const saved = _teacherStorageGet(w.TEACHER_STORAGE_KEYS.config)
  if (!saved || typeof saved !== 'object') return false
  const _Ts = getTeacher()
  if (_Ts) {
    const cfg = _Ts.config
    // Merge saved values into current config (preserves any new fields from updates)
    const keys = Object.keys(saved)
    for (let i = 0; i < keys.length; i++) {
      if (cfg.hasOwnProperty(keys[i])) cfg[keys[i]] = saved[keys[i]]
    }
  }
  return true
}

// ══════════════════════════════════════════════════════════════════
// SESSIONS — Completed replay session summaries
// Each session: { id, ts, tf, bars, trades, stats, duration }
// ══════════════════════════════════════════════════════════════════
export function teacherSaveSessions(sessions: any): boolean {
  if (!Array.isArray(sessions)) return false
  // Keep max 50 sessions in storage
  const toSave = sessions.slice(0, 50)
  return _teacherStorageSet(w.TEACHER_STORAGE_KEYS.sessions, toSave)
}

export function teacherLoadSessions(): any[] {
  const data = _teacherStorageGet(w.TEACHER_STORAGE_KEYS.sessions)
  return Array.isArray(data) ? data : []
}

export function teacherAddSession(session: any): boolean {
  const sessions = teacherLoadSessions()
  sessions.unshift(session)
  if (sessions.length > 50) sessions.length = 50
  return teacherSaveSessions(sessions)
}

// ══════════════════════════════════════════════════════════════════
// LESSONS — Extracted pattern insights
// Each lesson: { id, ts, type, description, tags[], winRate, sampleSize }
// ══════════════════════════════════════════════════════════════════
export function teacherSaveLessons(lessons: any): boolean {
  if (!Array.isArray(lessons)) return false
  const toSave = lessons.slice(0, 200)
  return _teacherStorageSet(w.TEACHER_STORAGE_KEYS.lessons, toSave)
}

export function teacherLoadLessons(): any[] {
  const data = _teacherStorageGet(w.TEACHER_STORAGE_KEYS.lessons)
  return Array.isArray(data) ? data : []
}

export function teacherAddLesson(lesson: any): boolean {
  const lessons = teacherLoadLessons()
  lessons.unshift(lesson)
  if (lessons.length > 200) lessons.length = 200
  teacherSaveLessons(lessons)
  const _Tsl = getTeacher(); if (_Tsl) _Tsl.lessons = lessons
  return true
}

// ══════════════════════════════════════════════════════════════════
// STATS — Aggregated performance stats across sessions
// ══════════════════════════════════════════════════════════════════
export function teacherSaveStats(stats: any): boolean {
  if (!stats || typeof stats !== 'object') return false
  return _teacherStorageSet(w.TEACHER_STORAGE_KEYS.stats, stats)
}

export function teacherLoadStats(): any {
  return _teacherStorageGet(w.TEACHER_STORAGE_KEYS.stats)
}

// ══════════════════════════════════════════════════════════════════
// MEMORY — Patterns, edges, mistakes (learning layer)
// ══════════════════════════════════════════════════════════════════
export function teacherSaveMemory(memory: any): boolean {
  if (!memory || typeof memory !== 'object') return false
  // Cap each category
  const toSave = {
    patterns: Array.isArray(memory.patterns) ? memory.patterns.slice(0, 100) : [],
    edges: Array.isArray(memory.edges) ? memory.edges.slice(0, 100) : [],
    mistakes: Array.isArray(memory.mistakes) ? memory.mistakes.slice(0, 100) : [],
  }
  return _teacherStorageSet(w.TEACHER_STORAGE_KEYS.memory, toSave)
}

export function teacherLoadMemory(): any {
  const data = _teacherStorageGet(w.TEACHER_STORAGE_KEYS.memory)
  if (data && typeof data === 'object') {
    return {
      patterns: Array.isArray(data.patterns) ? data.patterns : [],
      edges: Array.isArray(data.edges) ? data.edges : [],
      mistakes: Array.isArray(data.mistakes) ? data.mistakes : [],
    }
  }
  return { patterns: [], edges: [], mistakes: [] }
}

// ══════════════════════════════════════════════════════════════════
// INIT — Load all persistent data into TEACHER state
// ══════════════════════════════════════════════════════════════════
export function teacherLoadAllPersistent(): void {
  if (!getTeacher()) return
  teacherLoadConfig()
  getTeacher().lessons = teacherLoadLessons()
  getTeacher().memory = teacherLoadMemory()
  getTeacher().stats = teacherLoadStats()
}

// ══════════════════════════════════════════════════════════════════
// EXPORT / IMPORT — Full teacher data as JSON file
// ══════════════════════════════════════════════════════════════════
export function teacherExportAll(): void {
  const payload = {
    version: 'teacher_v2',
    exportedAt: new Date().toISOString(),
    config: getTeacher() ? getTeacher().config : null,
    sessions: teacherLoadSessions(),
    lessons: teacherLoadLessons(),
    stats: teacherLoadStats(),
    memory: teacherLoadMemory(),
    v2state: _teacherStorageGet(w.TEACHER_STORAGE_KEYS.v2state),
  }
  const str = JSON.stringify(payload, null, 2)
  const blob = new Blob([str], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'zeus_teacher_export_' + new Date().toISOString().slice(0, 10) + '.json'
  a.click()
  URL.revokeObjectURL(a.href)
}

export function teacherImportAll(jsonString: string): any {
  try {
    const data = JSON.parse(jsonString)
    if (!data || (data.version !== 'teacher_v1' && data.version !== 'teacher_v2')) return { ok: false, error: 'Invalid format or version' }
    let imported = 0
    if (data.config && typeof data.config === 'object') {
      _teacherStorageSet(w.TEACHER_STORAGE_KEYS.config, data.config)
      imported++
    }
    if (Array.isArray(data.sessions)) {
      teacherSaveSessions(data.sessions)
      imported++
    }
    if (Array.isArray(data.lessons)) {
      teacherSaveLessons(data.lessons)
      imported++
    }
    if (data.stats && typeof data.stats === 'object') {
      teacherSaveStats(data.stats)
      imported++
    }
    if (data.memory && typeof data.memory === 'object') {
      teacherSaveMemory(data.memory)
      imported++
    }
    if (data.v2state && typeof data.v2state === 'object') {
      _teacherStorageSet(w.TEACHER_STORAGE_KEYS.v2state, data.v2state)
      imported++
    }
    // Reload into state
    teacherLoadAllPersistent()
    return { ok: true, imported: imported }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

// ══════════════════════════════════════════════════════════════════
// V2 STATE — Autonomous engine persistent state
// Saves: capability, curriculum, lifetime trades (capped), fail count, capital
// ══════════════════════════════════════════════════════════════════
export function teacherSaveV2State(): boolean {
  const T = getTeacher()
  if (!T || !T.v2) return false
  const v2 = T.v2
  const toSave = {
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
  }
  return _teacherStorageSet(w.TEACHER_STORAGE_KEYS.v2state, toSave)
}

export function teacherLoadV2State(): boolean {
  const T = getTeacher()
  if (!T || !T.v2) return false
  const data = _teacherStorageGet(w.TEACHER_STORAGE_KEYS.v2state)
  if (!data || typeof data !== 'object') return false
  const v2 = T.v2
  if (typeof data.capability === 'number') v2.capability = data.capability
  if (typeof data.capabilityLabel === 'string') v2.capabilityLabel = data.capabilityLabel
  if (data.capabilityBreakdown) v2.capabilityBreakdown = data.capabilityBreakdown
  if (typeof data.currentCapital === 'number') v2.currentCapital = data.currentCapital
  if (typeof data.failCount === 'number') v2.failCount = data.failCount
  if (typeof data.reloadCount === 'number') v2.reloadCount = data.reloadCount
  if (typeof data.lifetimeSessions === 'number') v2.lifetimeSessions = data.lifetimeSessions
  if (data.lifetimeStats) v2.lifetimeStats = data.lifetimeStats
  if (Array.isArray(data.lifetimeTrades)) v2.lifetimeTrades = data.lifetimeTrades
  if (data.curriculum) v2.curriculum = data.curriculum
  if (Array.isArray(data.recentActivity)) v2.recentActivity = data.recentActivity
  return true
}

// ══════════════════════════════════════════════════════════════════
// CLEAR — Wipe all teacher data from storage
// ══════════════════════════════════════════════════════════════════
export function teacherClearAllStorage(): void {
  const keys = Object.keys(w.TEACHER_STORAGE_KEYS)
  for (let i = 0; i < keys.length; i++) {
    _teacherStorageRemove(w.TEACHER_STORAGE_KEYS[keys[i]])
  }
  // Reset state
  const _Tr = getTeacher(); if (_Tr) {
    _Tr.lessons = []
    _Tr.memory = { patterns: [], edges: [], mistakes: [] }
    _Tr.stats = null
    if (_Tr.v2) {
      _Tr.v2 = null
      w.teacherInitV2State()
    }
  }
}

// Attach to window for cross-file access
;(function _teacherStorageGlobals() {
  if (typeof window !== 'undefined') {
    w._teacherStorageSet = _teacherStorageSet
    w._teacherStorageGet = _teacherStorageGet
    w._teacherStorageRemove = _teacherStorageRemove
    w.teacherSaveConfig = teacherSaveConfig
    w.teacherLoadConfig = teacherLoadConfig
    w.teacherSaveSessions = teacherSaveSessions
    w.teacherLoadSessions = teacherLoadSessions
    w.teacherAddSession = teacherAddSession
    w.teacherSaveLessons = teacherSaveLessons
    w.teacherLoadLessons = teacherLoadLessons
    w.teacherAddLesson = teacherAddLesson
    w.teacherSaveStats = teacherSaveStats
    w.teacherLoadStats = teacherLoadStats
    w.teacherSaveMemory = teacherSaveMemory
    w.teacherLoadMemory = teacherLoadMemory
    w.teacherLoadAllPersistent = teacherLoadAllPersistent
    w.teacherExportAll = teacherExportAll
    w.teacherImportAll = teacherImportAll
    w.teacherSaveV2State = teacherSaveV2State
    w.teacherLoadV2State = teacherLoadV2State
    w.teacherClearAllStorage = teacherClearAllStorage
  }
})()

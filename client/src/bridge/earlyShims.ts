// Early shims — runs BEFORE any other module import
// Must set globals needed by modules that execute IIFEs at import time
const _w = window as any

// ZT_safeInterval — needed by arianova.ts IIFE
if (typeof _w.ZT_safeInterval !== 'function') {
  _w.ZT_safeInterval = function (_name: string, fn: any) {
    return function () { try { fn() } catch (e: any) { console.warn('[ZT interval error]', _name, e?.message || e) } }
  }
}

// _ZI (icons) — needed by config.ts at module level for INDICATORS definitions
import { _ZI } from '../constants/icons'
_w._ZI = _ZI

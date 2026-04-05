// Early shims — runs BEFORE any other module import
// ZT_safeInterval is defined in config.js but needed by arianova.ts IIFE at import time
const _w = window as any
if (typeof _w.ZT_safeInterval !== 'function') {
  _w.ZT_safeInterval = function (_name: string, fn: any) {
    return function () { try { fn() } catch (e: any) { console.warn('[ZT interval error]', _name, e?.message || e) } }
  }
}

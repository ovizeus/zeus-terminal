import { describe, it, expect } from 'vitest'
import { _shouldReportGlobalError } from '../bootstrapError'

// [2026-10-11] The global error reporter only fired when the filename contained
// /brain/, /core/, /trading/, /data/, /engine/ or /bridge/. That was written
// against the unbundled dev tree. In production every script is
// /app/assets/index-<hash>.js, so the test is never true and no engine error
// has been reported with detail since the app was bundled.
//
// The operator's crash proved it: [CLIENT_ERR] unknown, no message, no file.

describe('which global errors get reported', () => {
  it('reports an error from the production bundle', () => {
    expect(_shouldReportGlobalError(
      "Cannot read properties of null (reading 'toFixed')",
      'https://zeus.example/app/assets/index-DLxVgXhE.js',
    )).toBe(true)
  })

  it('still reports from the dev tree paths it always handled', () => {
    expect(_shouldReportGlobalError('boom', '/src/trading/autotrade.ts')).toBe(true)
    expect(_shouldReportGlobalError('boom', '/src/core/config.ts')).toBe(true)
  })

  it('ignores ResizeObserver noise, which is not a fault', () => {
    expect(_shouldReportGlobalError('ResizeObserver loop limit exceeded', '/app/assets/index-x.js')).toBe(false)
  })

  it('ignores cross-origin "Script error." with no detail to give', () => {
    expect(_shouldReportGlobalError('Script error.', '')).toBe(false)
  })

  it('ignores an error with no message at all', () => {
    expect(_shouldReportGlobalError('', '/app/assets/index-x.js')).toBe(false)
    expect(_shouldReportGlobalError(undefined as unknown as string, 'x')).toBe(false)
  })

  it('reports an extension or unknown-origin error that still carries a message', () => {
    // Better a little noise than another silent production crash; the server
    // throttles to one report per user per five seconds.
    expect(_shouldReportGlobalError("undefined is not a function", 'chrome-extension://abc/x.js')).toBe(true)
  })
})

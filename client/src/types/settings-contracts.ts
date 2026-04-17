/**
 * Zeus Terminal — settings wire contracts (Phase 1, typed contracts).
 *
 * Flat shape exchanged between client ↔ server for /api/user/settings.
 * Server whitelist (server/routes/trading.js `SETTINGS_WHITELIST`) MUST stay
 * in sync with `SettingsPayload`. Any new key added in one side must be
 * mirrored in the other; see MIGRATION_LOG Phase 1 note.
 *
 * NOTE: USER_SETTINGS (client-side, nested — `autoTrade.*`, `chart.*`, ...)
 * is a DIFFERENT shape and is NOT modelled here. Projection between the
 * nested legacy tree and this flat payload lives in stores/settingsStore.ts
 * (`_projectFromLegacy` / `_projectToLegacy`).
 */

/**
 * Flat settings payload — mirrors server SETTINGS_WHITELIST (40 keys).
 * All fields are optional: the server merges partial updates with the
 * existing row, and the client boots with DEFAULT_SETTINGS + overlay.
 */
export interface SettingsPayload {
  // AT
  confMin?: number
  sigMin?: number
  size?: number
  riskPct?: number
  maxDay?: number
  maxPos?: number
  sl?: number
  rr?: number
  killPct?: number
  lossStreak?: number
  maxAddon?: number
  lev?: number
  adaptEnabled?: boolean
  adaptLive?: boolean
  smartExitEnabled?: boolean

  // Multi-Symbol scan
  mscanEnabled?: boolean
  mscanSyms?: string[] | null

  // UI
  theme?: string
  uiScale?: number
  soundEnabled?: boolean

  // Chart
  chartTf?: string
  chartTz?: string | number | null
  chartType?: string
  candleColors?: Record<string, unknown> | null
  heatmapSettings?: Record<string, unknown> | null
  timezoneOffset?: number | null

  // Indicators / Liq / LLV / Supremus / S-R / Alerts (opaque nested blobs)
  indSettings?: Record<string, unknown> | null
  liqSettings?: Record<string, unknown> | null
  llvSettings?: Record<string, unknown> | null
  zsSettings?: Record<string, unknown> | null
  srSettings?: Record<string, unknown> | null
  alertSettings?: Record<string, unknown> | null

  // Brain / profile
  profile?: string
  bmMode?: string
  assistArmed?: boolean

  // Manual live defaults + per-account leverage
  manualLive?: Record<string, unknown> | null
  ptLevDemo?: number
  ptLevLive?: number
  ptMarginMode?: string

  // DSL
  dslSettings?: Record<string, unknown> | null
}

/** GET /api/user/settings response */
export interface SettingsGetResponse {
  ok: boolean
  settings: SettingsPayload
  updated_at: number
  error?: string
}

/** POST /api/user/settings request body */
export interface SettingsPostRequest {
  settings: SettingsPayload
}

/** POST /api/user/settings response */
export interface SettingsPostResponse {
  ok: boolean
  updated_at?: number
  error?: string
}

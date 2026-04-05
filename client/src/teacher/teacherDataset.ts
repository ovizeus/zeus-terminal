// Zeus — teacher/teacherDataset.ts
// Ported 1:1 from public/js/teacher/teacherDataset.js (Phase 7C)
// THE TEACHER — Dataset loader for BTC historical klines

const w = window as any

// ══════════════════════════════════════════════════════════════════
// BINANCE KLINE FETCHER (BTC-only, public API, paginated)
// ══════════════════════════════════════════════════════════════════

// Single page fetch (max 1500 per Binance docs, we use 1000)
export async function _teacherFetchPage(tf: any, startTime: any, endTime: any): Promise<any> {
  let url = 'https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=' + tf + '&limit=1000'
  if (startTime) url += '&startTime=' + startTime
  if (endTime) url += '&endTime=' + endTime

  const ac = new AbortController()
  const timer = setTimeout(function () { ac.abort() }, 15000)
  let r: any
  try {
    r = await fetch(url, { signal: ac.signal })
  } catch (err: any) {
    clearTimeout(timer)
    if (err.name === 'AbortError') throw new Error('Timeout fetching klines (>15s)')
    throw err
  }
  clearTimeout(timer)
  if (!r || !r.ok) throw new Error('HTTP ' + (r ? r.status : 'no response'))
  const data = await r.json()
  if (!Array.isArray(data)) throw new Error('Invalid Binance response')
  return data
}

// Normalize raw Binance array to bar objects
export function _teacherNormalizeBars(raw: any): any[] {
  const bars: any[] = []
  for (let i = 0; i < raw.length; i++) {
    const k = raw[i]
    const bar = {
      time:   Math.floor(k[0] / 1000),  // UNIX seconds
      open:   +k[1],
      high:   +k[2],
      low:    +k[3],
      close:  +k[4],
      volume: +k[5],
      timeMs: k[0],  // keep ms for pagination
    }
    // Sanity: skip aberrant candles
    if (bar.open <= 0 || bar.close <= 0) continue
    if (bar.high < bar.low) continue
    if (bar.close < bar.low || bar.close > bar.high) continue
    bars.push(bar)
  }
  return bars
}

// Deduplicate + sort by time
export function _teacherDedupSort(bars: any): any[] {
  const seen: any = {}
  const unique: any[] = []
  for (let i = 0; i < bars.length; i++) {
    const key = bars[i].time
    if (!seen[key]) {
      seen[key] = true
      unique.push(bars[i])
    }
  }
  unique.sort(function (a: any, b: any) { return a.time - b.time })
  return unique
}

// ══════════════════════════════════════════════════════════════════
// MAIN LOADER — Multi-page fetch with progress callback
// ══════════════════════════════════════════════════════════════════

export async function teacherLoadDataset(opts: any): Promise<any> {
  if (!opts || !opts.tf || !opts.startMs || !opts.endMs) {
    throw new Error('teacherLoadDataset: tf, startMs, endMs required')
  }

  const tfConfig = w.TEACHER_TIMEFRAMES[opts.tf]
  if (!tfConfig) throw new Error('Unknown timeframe: ' + opts.tf)

  const maxBars = opts.maxBars || w.TEACHER_REPLAY_DEFAULTS.maxBars
  const allBars: any[] = []
  let cursor = opts.startMs
  const endMs = opts.endMs
  let pages = 0
  const maxPages = 10 // safety: 10 pages x 1000 bars = 10k max iterations

  while (cursor < endMs && pages < maxPages) {
    pages++
    const raw = await _teacherFetchPage(opts.tf, cursor, endMs)
    if (!raw.length) break

    const batch = _teacherNormalizeBars(raw)
    if (!batch.length) break

    for (let i = 0; i < batch.length; i++) allBars.push(batch[i])

    // Move cursor past last bar
    const lastMs = raw[raw.length - 1][0]
    cursor = lastMs + tfConfig.ms

    // Progress callback
    if (typeof opts.onProgress === 'function') {
      const estimatedTotal = Math.ceil((endMs - opts.startMs) / tfConfig.ms)
      opts.onProgress(allBars.length, Math.min(estimatedTotal, maxBars))
    }

    // Respect rate limits — small delay between pages
    if (cursor < endMs && pages < maxPages) {
      await new Promise(function (r: any) { setTimeout(r, 300) })
    }

    // Hard cap
    if (allBars.length >= maxBars) break
  }

  // Dedup, sort, cap
  let finalBars = _teacherDedupSort(allBars)
  if (finalBars.length > maxBars) finalBars = finalBars.slice(0, maxBars)

  if (finalBars.length < w.TEACHER_REPLAY_DEFAULTS.minBars) {
    throw new Error('Insufficient data: got ' + finalBars.length + ' bars, need ' + w.TEACHER_REPLAY_DEFAULTS.minBars)
  }

  const dataset = {
    bars:     finalBars,
    tf:       opts.tf,
    symbol:   'BTCUSDT',
    loadedAt: Date.now(),
    range: {
      from: finalBars[0].time,
      to:   finalBars[finalBars.length - 1].time,
    },
  }

  return dataset
}

// ══════════════════════════════════════════════════════════════════
// QUICK PRESETS — Common dataset configurations
// ══════════════════════════════════════════════════════════════════

export function teacherPresetLast24h(): any {
  const now = Date.now()
  return { tf: '5m', startMs: now - 86400000, endMs: now }
}

export function teacherPresetLast7d(): any {
  const now = Date.now()
  return { tf: '15m', startMs: now - 7 * 86400000, endMs: now }
}

export function teacherPresetLast30d(): any {
  const now = Date.now()
  return { tf: '1h', startMs: now - 30 * 86400000, endMs: now }
}

export function teacherPresetCustom(tf: any, daysBack: any): any {
  const now = Date.now()
  return { tf: tf, startMs: now - daysBack * 86400000, endMs: now }
}

// ══════════════════════════════════════════════════════════════════
// DATASET VALIDATION — verify integrity before replay
// ══════════════════════════════════════════════════════════════════

export function teacherValidateDataset(dataset: any): any {
  const errors: any[] = []
  if (!dataset || !dataset.bars) { return { valid: false, errors: ['No dataset'] } }
  if (!Array.isArray(dataset.bars)) { return { valid: false, errors: ['Bars not array'] } }
  if (dataset.bars.length < w.TEACHER_REPLAY_DEFAULTS.minBars) {
    errors.push('Too few bars: ' + dataset.bars.length + ' < ' + w.TEACHER_REPLAY_DEFAULTS.minBars)
  }

  // Check time ordering
  let outOfOrder = 0
  for (let i = 1; i < dataset.bars.length; i++) {
    if (dataset.bars[i].time <= dataset.bars[i - 1].time) outOfOrder++
  }
  if (outOfOrder > 0) errors.push(outOfOrder + ' bars out of order')

  // Check for gaps (>3x expected interval)
  const tfMs = w.TEACHER_TIMEFRAMES[dataset.tf] ? w.TEACHER_TIMEFRAMES[dataset.tf].ms / 1000 : 300
  let gaps = 0
  for (let i = 1; i < dataset.bars.length; i++) {
    const dt = dataset.bars[i].time - dataset.bars[i - 1].time
    if (dt > tfMs * 3) gaps++
  }
  if (gaps > 0) errors.push(gaps + ' gaps detected (>3x interval)')

  return { valid: errors.length === 0, errors: errors, barCount: dataset.bars.length, gaps: gaps }
}

// Attach to window for cross-file access
;(function _teacherDatasetGlobals() {
  if (typeof window !== 'undefined') {
    w._teacherFetchPage = _teacherFetchPage
    w._teacherNormalizeBars = _teacherNormalizeBars
    w._teacherDedupSort = _teacherDedupSort
    w.teacherLoadDataset = teacherLoadDataset
    w.teacherPresetLast24h = teacherPresetLast24h
    w.teacherPresetLast7d = teacherPresetLast7d
    w.teacherPresetLast30d = teacherPresetLast30d
    w.teacherPresetCustom = teacherPresetCustom
    w.teacherValidateDataset = teacherValidateDataset
  }
})()

// Zeus v122 — teacher/teacherDataset.js
// THE TEACHER — Dataset loader for BTC historical klines
// Fetches from Binance public futures API — zero auth, zero live state writes
// Only writes to TEACHER.dataset — fully sandboxed
'use strict';

// ══════════════════════════════════════════════════════════════════
// BINANCE KLINE FETCHER (BTC-only, public API, paginated)
// ══════════════════════════════════════════════════════════════════

// Single page fetch (max 1500 per Binance docs, we use 1000)
async function _teacherFetchPage(tf, startTime, endTime) {
  var url = 'https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=' + tf + '&limit=1000';
  if (startTime) url += '&startTime=' + startTime;
  if (endTime) url += '&endTime=' + endTime;

  var ac = new AbortController();
  var timer = setTimeout(function () { ac.abort(); }, 15000);
  var r;
  try {
    r = await fetch(url, { signal: ac.signal });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('Timeout fetching klines (>15s)');
    throw err;
  }
  clearTimeout(timer);
  if (!r || !r.ok) throw new Error('HTTP ' + (r ? r.status : 'no response'));
  var data = await r.json();
  if (!Array.isArray(data)) throw new Error('Invalid Binance response');
  return data;
}

// Normalize raw Binance array to bar objects
function _teacherNormalizeBars(raw) {
  var bars = [];
  for (var i = 0; i < raw.length; i++) {
    var k = raw[i];
    var bar = {
      time:   Math.floor(k[0] / 1000),  // UNIX seconds
      open:   +k[1],
      high:   +k[2],
      low:    +k[3],
      close:  +k[4],
      volume: +k[5],
      timeMs: k[0],  // keep ms for pagination
    };
    // Sanity: skip aberrant candles
    if (bar.open <= 0 || bar.close <= 0) continue;
    if (bar.high < bar.low) continue;
    if (bar.close < bar.low || bar.close > bar.high) continue;
    bars.push(bar);
  }
  return bars;
}

// Deduplicate + sort by time
function _teacherDedupSort(bars) {
  var seen = {};
  var unique = [];
  for (var i = 0; i < bars.length; i++) {
    var key = bars[i].time;
    if (!seen[key]) {
      seen[key] = true;
      unique.push(bars[i]);
    }
  }
  unique.sort(function (a, b) { return a.time - b.time; });
  return unique;
}

// ══════════════════════════════════════════════════════════════════
// MAIN LOADER — Multi-page fetch with progress callback
// ══════════════════════════════════════════════════════════════════

/**
 * Load BTC historical dataset.
 * @param {Object} opts
 * @param {string} opts.tf — Timeframe: '1m','3m','5m','15m','1h','4h'
 * @param {number} opts.startMs — Start time in ms (Date.getTime)
 * @param {number} opts.endMs — End time in ms
 * @param {number} [opts.maxBars=5000] — Hard cap on total bars
 * @param {Function} [opts.onProgress] — callback(loaded, estimated)
 * @returns {Promise<{bars:Array, tf:string, symbol:string, loadedAt:number, range:{from:number,to:number}}>}
 */
async function teacherLoadDataset(opts) {
  if (!opts || !opts.tf || !opts.startMs || !opts.endMs) {
    throw new Error('teacherLoadDataset: tf, startMs, endMs required');
  }

  var tfConfig = TEACHER_TIMEFRAMES[opts.tf];
  if (!tfConfig) throw new Error('Unknown timeframe: ' + opts.tf);

  var maxBars = opts.maxBars || TEACHER_REPLAY_DEFAULTS.maxBars;
  var allBars = [];
  var cursor = opts.startMs;
  var endMs = opts.endMs;
  var pages = 0;
  var maxPages = 10; // safety: 10 pages × 1000 bars = 10k max iterations

  while (cursor < endMs && pages < maxPages) {
    pages++;
    var raw = await _teacherFetchPage(opts.tf, cursor, endMs);
    if (!raw.length) break;

    var batch = _teacherNormalizeBars(raw);
    if (!batch.length) break;

    for (var i = 0; i < batch.length; i++) allBars.push(batch[i]);

    // Move cursor past last bar
    var lastMs = raw[raw.length - 1][0];
    cursor = lastMs + tfConfig.ms;

    // Progress callback
    if (typeof opts.onProgress === 'function') {
      var estimatedTotal = Math.ceil((endMs - opts.startMs) / tfConfig.ms);
      opts.onProgress(allBars.length, Math.min(estimatedTotal, maxBars));
    }

    // Respect rate limits — small delay between pages
    if (cursor < endMs && pages < maxPages) {
      await new Promise(function (r) { setTimeout(r, 300); });
    }

    // Hard cap
    if (allBars.length >= maxBars) break;
  }

  // Dedup, sort, cap
  var finalBars = _teacherDedupSort(allBars);
  if (finalBars.length > maxBars) finalBars = finalBars.slice(0, maxBars);

  if (finalBars.length < TEACHER_REPLAY_DEFAULTS.minBars) {
    throw new Error('Insufficient data: got ' + finalBars.length + ' bars, need ' + TEACHER_REPLAY_DEFAULTS.minBars);
  }

  var dataset = {
    bars:     finalBars,
    tf:       opts.tf,
    symbol:   'BTCUSDT',
    loadedAt: Date.now(),
    range: {
      from: finalBars[0].time,
      to:   finalBars[finalBars.length - 1].time,
    },
  };

  return dataset;
}

// ══════════════════════════════════════════════════════════════════
// QUICK PRESETS — Common dataset configurations
// ══════════════════════════════════════════════════════════════════

function teacherPresetLast24h() {
  var now = Date.now();
  return { tf: '5m', startMs: now - 86400000, endMs: now };
}

function teacherPresetLast7d() {
  var now = Date.now();
  return { tf: '15m', startMs: now - 7 * 86400000, endMs: now };
}

function teacherPresetLast30d() {
  var now = Date.now();
  return { tf: '1h', startMs: now - 30 * 86400000, endMs: now };
}

function teacherPresetCustom(tf, daysBack) {
  var now = Date.now();
  return { tf: tf, startMs: now - daysBack * 86400000, endMs: now };
}

// ══════════════════════════════════════════════════════════════════
// DATASET VALIDATION — verify integrity before replay
// ══════════════════════════════════════════════════════════════════

function teacherValidateDataset(dataset) {
  var errors = [];
  if (!dataset || !dataset.bars) { return { valid: false, errors: ['No dataset'] }; }
  if (!Array.isArray(dataset.bars)) { return { valid: false, errors: ['Bars not array'] }; }
  if (dataset.bars.length < TEACHER_REPLAY_DEFAULTS.minBars) {
    errors.push('Too few bars: ' + dataset.bars.length + ' < ' + TEACHER_REPLAY_DEFAULTS.minBars);
  }

  // Check time ordering
  var outOfOrder = 0;
  for (var i = 1; i < dataset.bars.length; i++) {
    if (dataset.bars[i].time <= dataset.bars[i - 1].time) outOfOrder++;
  }
  if (outOfOrder > 0) errors.push(outOfOrder + ' bars out of order');

  // Check for gaps (>3× expected interval)
  var tfMs = TEACHER_TIMEFRAMES[dataset.tf] ? TEACHER_TIMEFRAMES[dataset.tf].ms / 1000 : 300;
  var gaps = 0;
  for (var i = 1; i < dataset.bars.length; i++) {
    var dt = dataset.bars[i].time - dataset.bars[i - 1].time;
    if (dt > tfMs * 3) gaps++;
  }
  if (gaps > 0) errors.push(gaps + ' gaps detected (>3x interval)');

  return { valid: errors.length === 0, errors: errors, barCount: dataset.bars.length, gaps: gaps };
}

// Zeus v122 — ui/dom.js
// DOM utilities, render helpers
'use strict';

// Audio init & alerts
function _initAudio() {
  try {
    if (!_audioCtx) {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // FIX 17: always try resume — suspended on iOS until user gesture
    if (_audioCtx.state === 'suspended') {
      _audioCtx.resume().then(() => {
        _audioReady = (_audioCtx.state === 'running');
        _updateAudioBadge();
      }).catch(() => { _audioReady = false; _updateAudioBadge(); });
    } else {
      _audioReady = (_audioCtx.state === 'running');
    }
  } catch (_) { _audioReady = false; }
  _updateAudioBadge();
}

function _updateAudioBadge() {
  const b = el('soundBadge');
  if (b) {
    b.textContent = _audioReady ? '🔊 SOUND READY' : '🔇 SOUND';
    b.style.color = _audioReady ? '#39ff14' : '#ff6644';
    b.style.cursor = _audioReady ? 'default' : 'pointer';
  }
}

// FIX 17: Unlock on multiple gesture types for iOS compatibility
['click', 'touchstart', 'touchend', 'pointerdown', 'keydown'].forEach(ev => {
  document.addEventListener(ev, _initAudio, { once: true, passive: true });
});

async function _safePlayTone(freqs, dur) {
  try {
    if (!_audioCtx) return;
    if (_audioCtx.state === 'suspended') await _audioCtx.resume().catch(() => { });
    if (_audioCtx.state !== 'running') return;
    _audioReady = true;
    const osc = _audioCtx.createOscillator();
    const gain = _audioCtx.createGain();
    osc.connect(gain); gain.connect(_audioCtx.destination);
    const now = _audioCtx.currentTime;
    freqs.forEach((f, i) => osc.frequency.setValueAtTime(f, now + i * 0.1));
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.start(now); osc.stop(now + dur);
  } catch (_) { }
}

function playAlertSound() { _safePlayTone([880, 1100, 880], 0.5); }
function playEntrySound() { _safePlayTone([440, 660, 880], 0.4); }
function playExitSound(win) { _safePlayTone(win ? [880, 1100] : [440, 330], 0.4); }

// ===== ALERT SOUND ON NOTIFICATIONS =====
const _origSendAlert = typeof sendAlert !== 'undefined' ? sendAlert : null;

// ===== FIX: Toggle alert button visual =====
function toggleAlerts(en) {
  S.alerts = S.alerts || {};
  S.alerts.enabled = en;
  const btn = el('bellBtn');
  if (btn) btn.innerHTML = en ? '🔔' : '🔕';
  // Fix toggle slider visual
  const dot = el('alertToggleDot');
  const slider = el('alertToggleSlider');
  if (dot) dot.style.cssText = en ? 'position:absolute;height:18px;width:18px;background:#00d97a;border-radius:50%;bottom:2px;transition:.3s;transform:translateX(22px);box-shadow:0 0 6px #00d97a' : 'position:absolute;height:18px;width:18px;background:#555;border-radius:50%;bottom:2px;transition:.3s;left:2px';
  if (slider) slider.style.background = en ? '#00d97a33' : '#1e2530';
  if (en && typeof Notification !== 'undefined' && Notification.permission === 'default') {
    try { Notification.requestPermission(); } catch (_) { }
  }
  if (en) playAlertSound();
  toast(en ? '🔔 Alerte ON' : '🔕 Alerte OFF');
}


// Price scale settings
// ===== PRICE SCALE COLOR SETTINGS =====
// Added to chart settings modal via applyChartColors

// Override applyChartColors to also handle price scale colors
const _origApplyCC = typeof applyChartColors === 'undefined' ? null : applyChartColors;

function applyChartColors() {
  const bull = el('ccBull')?.value || '#00d97a';
  const bear = el('ccBear')?.value || '#ff3355';
  const bw = el('ccBullW')?.value || '#00d97a';
  const brw = el('ccBearW')?.value || '#ff3355';
  const pText = el('ccPriceText')?.value || '#7a9ab8';
  const pBg = el('ccPriceBg')?.value || '#0a0f16';
  if (cSeries) { cSeries.applyOptions({ upColor: bull, downColor: bear, borderUpColor: bull, borderDownColor: bear, wickUpColor: bw + '77', wickDownColor: brw + '77' }); }
  if (mainChart) { mainChart.applyOptions({ layout: { background: { color: pBg }, textColor: pText }, rightPriceScale: { textColor: pText } }); }
  if (cvdChart) { cvdChart.applyOptions({ layout: { background: { color: pBg }, textColor: pText } }); }
  if (volChart) { volChart.applyOptions({ layout: { background: { color: pBg }, textColor: pText } }); }
  closeM('mcharts'); toast('Culori aplicate ✓');
  // Salvăm culorile în USER_SETTINGS
  if (typeof _usScheduleSave === 'function') _usScheduleSave();
}

// ===== INIT ACT BAR =====
function initActBar() {
  if (window._actBarBuilt) return;  // guard: never init twice
  window._actBarBuilt = true;
  renderActBar();
  // Apply initial visibility based on S.activeInds
  INDICATORS.forEach(ind => {
    if (S.activeInds[ind.id] === false) {
      applyIndVisibility(ind.id, false);
    }
  });
}

// Store chart bars for signal analysis
const _origSetData = typeof cSeries !== 'undefined' ? null : null;


// ===== PRICE AXIS WIDTH =====
function applyPriceAxisWidth(px, btn) {
  document.querySelectorAll(".qb").forEach(b => b.classList.remove("act"));
  if (btn) btn.classList.add("act");
  const w = parseInt(px) || 60;
  // v96: apply to all 4 charts so plot area stays aligned
  [mainChart, cvdChart, volChart].forEach(c => {
    if (c) c.applyOptions({ rightPriceScale: { width: w } });
  });
  if (typeof _macdChart !== 'undefined' && _macdChart)
    _macdChart.applyOptions({ rightPriceScale: { width: w } });
}

// Store RSI data from fetch
const _origFetchRSI = fetchAllRSI;

// backwards compat aliases  
function togInd(id, btn) {
  // [FIX BUG1+2] Unified toggle — syncs BOTH state dicts + renders chart
  const newVal = !S.activeInds[id];
  S.activeInds[id] = newVal;
  S.indicators[id] = newVal;
  if (btn) btn.classList.toggle('act', newVal);
  applyIndVisibility(id, newVal);
  if (newVal && typeof renderChart === 'function') renderChart();
  renderActBar();
}

function applyPriceAxisColors() {
  const pText = el('ccPriceText2')?.value || '#7a9ab8';
  const pBg = el('ccPriceBg2')?.value || '#0a0f16';
  const gh = el('ccGridH')?.value || '#1a2530';
  const gv = el('ccGridV')?.value || '#1a2530';
  [mainChart, cvdChart, volChart].forEach(c => {
    if (c) c.applyOptions({
      layout: { background: { color: pBg }, textColor: pText },
      grid: { vertLines: { color: gv }, horzLines: { color: gh } },
      rightPriceScale: { borderColor: gh }
    });
  });
  closeM('mcharts'); toast('Culori price axis aplicate ✓');
}
// ===== TRADE JOURNAL =====
if (!TP.journal) TP.journal = [];


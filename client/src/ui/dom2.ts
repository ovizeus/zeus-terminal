import { toast } from '../data/marketDataHelpers'
import { el } from '../utils/dom'
import { _ZI } from '../constants/icons'
import { applyIndVisibility, renderActBar, getMacdChart } from '../engine/indicators'
import { closeM } from '../data/marketDataWS'
import { _usSave, _userCtxPush, _userCtxPushNow, INDICATORS } from '../core/config'
import { renderChart } from '../data/marketDataChart'
// Zeus v122 — ui/dom2.ts (ported from ui/dom.js)
// DOM utilities, render helpers
const w = window as any; // kept for w.S (self-ref writes), chart objects (cSeries/mainChart/cvdChart/_macdChart), w.TP, AudioContext

// Audio init & alerts
let _audioCtx: any = null;
let _audioReady = false;
// [BUG5] Persistent mute flag — user can silence all app tones.
// Default OFF (sound enabled) on first boot; survives reload.
let _soundMuted = (() => {
  try { return localStorage.getItem('zt:sound_muted') === '1' } catch (_) { return false }
})();

export function _initAudio(): void {
  try {
    if (!_audioCtx) {
      _audioCtx = new ((w.AudioContext || w.webkitAudioContext))();
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

export function _updateAudioBadge(): void {
  const b = el('soundBadge');
  if (!b) return;
  if (!_audioReady) {
    b.innerHTML = _ZI.mute + ' SOUND';
    b.style.color = 'var(--orange)';
    b.title = 'Click to enable sound';
  } else if (_soundMuted) {
    b.innerHTML = _ZI.mute + ' SOUND MUTED';
    b.style.color = 'var(--dim)';
    b.title = 'Click to unmute';
  } else {
    b.innerHTML = _ZI.vol + ' SOUND READY';
    b.style.color = 'var(--lime)';
    b.title = 'Click to mute';
  }
  b.style.cursor = 'pointer';
}

// FIX 17: Unlock on multiple gesture types for iOS compatibility
['click', 'touchstart', 'touchend', 'pointerdown', 'keydown'].forEach(ev => {
  document.addEventListener(ev, _initAudio as EventListener, { once: true, passive: true });
});

// [BUG5] Smart click handler for #soundBadge:
//   1st click (not-ready): init AudioContext + enable + play chime.
//   Subsequent clicks: toggle mute ↔ unmute, persist, chime on unmute.
export function _soundBadgeClick(): void {
  if (!_audioReady) {
    _initAudio();
    // _initAudio may resume asynchronously; schedule chime after a short tick.
    setTimeout(() => {
      if (_audioReady && !_soundMuted) _playReadyChime();
      _updateAudioBadge();
    }, 60);
    return;
  }
  _soundMuted = !_soundMuted;
  try { localStorage.setItem('zt:sound_muted', _soundMuted ? '1' : '0') } catch (_) { }
  _updateAudioBadge();
  if (!_soundMuted) _playReadyChime();
}

export function isSoundMuted(): boolean { return _soundMuted }

export async function _safePlayTone(freqs: any, dur: any): Promise<void> {
  try {
    if (_soundMuted) return;
    if (!_audioCtx) return;
    if (_audioCtx.state === 'suspended') await _audioCtx.resume().catch(() => { });
    if (_audioCtx.state !== 'running') return;
    _audioReady = true;
    const osc = _audioCtx.createOscillator();
    const gain = _audioCtx.createGain();
    osc.connect(gain); gain.connect(_audioCtx.destination);
    const now = _audioCtx.currentTime;
    freqs.forEach((f: any, i: any) => osc.frequency.setValueAtTime(f, now + i * 0.1));
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.start(now); osc.stop(now + dur);
  } catch (_) { }
}

// [BUG5] Premium confirmation chime — triangle-wave major-triad arpeggio
// (E5 → G5 → C6) with soft attack/decay. Plays on SOUND-READY activation
// and on unmute. Respects mute but not the usual _safePlayTone gate
// because the chime is itself the audio-enable confirmation.
export function _playReadyChime(): void {
  try {
    if (!_audioCtx || _audioCtx.state !== 'running') return;
    const notes: Array<[number, number, number]> = [
      // [freq, startOffset, dur]
      [659.25, 0.00, 0.18],
      [783.99, 0.08, 0.22],
      [1046.50, 0.18, 0.38],
    ];
    const now = _audioCtx.currentTime;
    notes.forEach(([freq, start, dur]) => {
      const osc = _audioCtx.createOscillator();
      const gain = _audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.22, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0005, now + start + dur);
      osc.connect(gain); gain.connect(_audioCtx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.02);
    });
  } catch (_) { }
}

export function playAlertSound(): void { _safePlayTone([880, 1100, 880], 0.5); }
export function playEntrySound(): void { _safePlayTone([440, 660, 880], 0.4); }
export function playExitSound(win: any): void { _safePlayTone(win ? [880, 1100] : [440, 330], 0.4); }

// ===== ALERT SOUND ON NOTIFICATIONS =====


// ===== FIX: Toggle alert button visual =====
export function toggleAlerts(en: any): void {
  const S = w.S;
  S.alerts = S.alerts || {};
  S.alerts.enabled = en;
  const btn = el('bellBtn');
  if (btn) {
    const svgOn = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
    const svgOff = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
    btn.innerHTML = en ? svgOn : svgOff;
  }
  // Fix toggle slider visual
  const dot = el('alertToggleDot');
  const slider = el('alertToggleSlider');
  if (dot) dot.style.cssText = en ? 'position:absolute;height:18px;width:18px;background:var(--grn);border-radius:50%;bottom:2px;transition:.3s;transform:translateX(22px);box-shadow:0 0 6px var(--grn)' : 'position:absolute;height:18px;width:18px;background:#555;border-radius:50%;bottom:2px;transition:.3s;left:2px';
  if (slider) slider.style.background = en ? '#00d97a33' : '#1e2530';
  if (en && typeof Notification !== 'undefined' && Notification.permission === 'default') {
    try { Notification.requestPermission(); } catch (_) { }
  }
  if (en) playAlertSound();
  toast(en ? 'Alerte ON' : 'Alerte OFF', 0, en ? _ZI.bell : _ZI.bellX);
}


// Price scale settings
// ===== PRICE SCALE COLOR SETTINGS =====
// Added to chart settings modal via applyChartColors

// Override applyChartColors to also handle price scale colors


export function applyChartColors(): void {
  const bull = el('ccBull')?.value || '#00d97a';
  const bear = el('ccBear')?.value || '#ff3355';
  const bw = el('ccBullW')?.value || '#00d97a';
  const brw = el('ccBearW')?.value || '#ff3355';
  const pText = el('ccPriceText')?.value || '#7a9ab8';
  const pBg = el('ccPriceBg')?.value || '#0a0f16';
  if (w.cSeries) { w.cSeries.applyOptions({ upColor: bull, downColor: bear, borderUpColor: bull, borderDownColor: bear, wickUpColor: bw + '77', wickDownColor: brw + '77' }); }
  if (w.mainChart) { w.mainChart.applyOptions({ layout: { background: { color: pBg }, textColor: pText }, rightPriceScale: { textColor: pText } }); }
  if (w.cvdChart) { w.cvdChart.applyOptions({ layout: { background: { color: pBg }, textColor: pText } }); }
  closeM('mcharts'); toast('Culori aplicate \u2713');
  // Save + IMMEDIATE push to server (no debounce — explicit user action)
  _usSave();
  _userCtxPushNow();
}

// ===== INIT ACT BAR =====
let _actBarBuilt = false
export function initActBar(): void {
  if (_actBarBuilt) return;  // guard: never init twice
  _actBarBuilt = true;
  renderActBar();
  // Apply initial visibility for ALL indicators — enable active ones + hide disabled ones
  const S = w.S;
  INDICATORS.forEach((ind: any) => {
    var on = (ind.id in S.activeInds) ? !!S.activeInds[ind.id] : !!ind.def;
    applyIndVisibility(ind.id, on);
  });
}

// Store chart bars for signal analysis



// ===== PRICE AXIS WIDTH =====
export function applyPriceAxisWidth(px: any, btn: any): void {
  document.querySelectorAll(".qb").forEach((b: any) => b.classList.remove("act"));
  if (btn) btn.classList.add("act");
  const width = parseInt(px) || 60;
  // v96: apply to all 4 charts so plot area stays aligned
  [w.mainChart, w.cvdChart].forEach((c: any) => {
    if (c) c.applyOptions({ rightPriceScale: { width: width } });
  });
  const mc = getMacdChart(); if (mc) mc.applyOptions({ rightPriceScale: { width: width } });
}

// Store RSI data from fetch


// backwards compat aliases
export function togInd(id: any, btn: any): void {
  const S = w.S;
  // [FIX BUG1+2] Unified toggle — syncs BOTH state dicts + renders chart
  const newVal = !S.activeInds[id];
  S.activeInds[id] = newVal;
  S.indicators[id] = newVal;
  if (btn) btn.classList.toggle('act', newVal);
  applyIndVisibility(id, newVal);
  if (newVal) renderChart();
  renderActBar();
  // [P5 FIX] Persist indicator state so it survives refresh
  _usSave();
  _userCtxPush();
}

export function applyPriceAxisColors(): void {
  const pText = el('ccPriceText2')?.value || '#7a9ab8';
  const pBg = el('ccPriceBg2')?.value || '#0a0f16';
  const gh = el('ccGridH')?.value || '#1a2530';
  const gv = el('ccGridV')?.value || '#1a2530';
  [w.mainChart, w.cvdChart].forEach((c: any) => {
    if (c) c.applyOptions({
      layout: { background: { color: pBg }, textColor: pText },
      grid: { vertLines: { color: gv }, horzLines: { color: gh } },
      rightPriceScale: { borderColor: gh }
    });
  });
  closeM('mcharts'); toast('Culori price axis aplicate \u2713');
}
// ===== TRADE JOURNAL =====
// IIFE: guarded — TP may not exist yet at import time
;(function () {
  if (typeof w.TP !== 'undefined' && w.TP) {
    if (!w.TP.journal) w.TP.journal = []
  }
})()

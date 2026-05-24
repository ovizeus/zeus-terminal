/**
 * OMEGA Ambient Sound — procedural Web Audio (Interstellar/Blade Runner vibe).
 * Base drone 55Hz + decision blips + warning tones. Zero external assets.
 */

let _ctx: AudioContext | null = null
let _droneOsc: OscillatorNode | null = null
let _droneGain: GainNode | null = null
let _masterVolume = 0.3
let _running = false

function _ensureCtx(): AudioContext {
  if (!_ctx) {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext
    _ctx = new AC()
  }
  if (_ctx!.state === 'suspended') _ctx!.resume().catch(() => {})
  return _ctx!
}

export function startAmbient(): void {
  if (_running) return
  const ctx = _ensureCtx()

  _droneGain = ctx.createGain()
  _droneGain.gain.value = 0.03 * _masterVolume
  _droneGain.connect(ctx.destination)

  _droneOsc = ctx.createOscillator()
  _droneOsc.type = 'sine'
  _droneOsc.frequency.value = 55
  _droneOsc.connect(_droneGain)
  _droneOsc.start()

  _running = true

  document.addEventListener('visibilitychange', _handleVisibility)
}

export function stopAmbient(): void {
  if (_droneOsc) { try { _droneOsc.stop() } catch (_) {} _droneOsc = null }
  if (_droneGain) { _droneGain.disconnect(); _droneGain = null }
  _running = false
  document.removeEventListener('visibilitychange', _handleVisibility)
}

export function pulseDecision(): void {
  if (!_running) return
  try {
    const ctx = _ensureCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 220
    gain.gain.value = 0.08 * _masterVolume
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.05)
  } catch (_) {}
}

export function pulseWarning(): void {
  if (!_running) return
  try {
    const ctx = _ensureCtx()
    const osc1 = ctx.createOscillator()
    const osc2 = ctx.createOscillator()
    const gain = ctx.createGain()
    osc1.type = 'sine'
    osc1.frequency.value = 440
    osc2.type = 'sine'
    osc2.frequency.value = 880
    gain.gain.value = 0.15 * _masterVolume
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2)
    osc1.connect(gain)
    osc2.connect(gain)
    gain.connect(ctx.destination)
    osc1.start()
    osc2.start()
    osc1.stop(ctx.currentTime + 0.2)
    osc2.stop(ctx.currentTime + 0.2)
  } catch (_) {}
}

export function setAmbientVolume(vol: number): void {
  _masterVolume = Math.max(0, Math.min(1, vol))
  if (_droneGain) _droneGain.gain.value = 0.03 * _masterVolume
}

export function isRunning(): boolean { return _running }

function _handleVisibility(): void {
  if (!_ctx) return
  if (document.hidden) {
    _ctx.suspend().catch(() => {})
  } else {
    _ctx.resume().catch(() => {})
  }
}

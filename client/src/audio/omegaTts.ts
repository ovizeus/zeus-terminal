/**
 * OMEGA TTS Provider — queue-based text-to-speech via /api/omega/tts proxy.
 * Abstraction layer: swap internals for ElevenLabs/OpenAI without changing interface.
 */

let _speed = parseFloat(localStorage.getItem('omega_tts_speed') || '1.0') || 1.0
let _volume = parseFloat(localStorage.getItem('omega_tts_volume') || '0.7') || 0.7
let _queue: string[] = []
let _playing = false
let _currentAudio: HTMLAudioElement | null = null
const MAX_QUEUE = 5
const CHUNK_MAX = 180

function _chunk(text: string): string[] {
  if (text.length <= CHUNK_MAX) return [text]
  const chunks: string[] = []
  let rest = text
  while (rest.length > 0) {
    if (rest.length <= CHUNK_MAX) { chunks.push(rest); break }
    let cut = rest.lastIndexOf('.', CHUNK_MAX)
    if (cut < 20) cut = rest.lastIndexOf(' ', CHUNK_MAX)
    if (cut < 20) cut = CHUNK_MAX
    chunks.push(rest.slice(0, cut + 1).trim())
    rest = rest.slice(cut + 1).trim()
  }
  return chunks
}

function _playNext(): void {
  if (_queue.length === 0) { _playing = false; return }
  _playing = true
  const text = _queue.shift()!
  const url = `/api/omega/tts?text=${encodeURIComponent(text)}&lang=en`
  const audio = new Audio(url)
  audio.playbackRate = _speed
  audio.volume = _volume
  _currentAudio = audio
  audio.onended = () => { _currentAudio = null; _playNext() }
  audio.onerror = () => { _currentAudio = null; _playNext() }
  audio.play().catch(() => { _currentAudio = null; _playNext() })
}

export function speak(text: string, priority = false): void {
  if (!text) return
  const chunks = _chunk(text)
  if (priority) {
    _queue.unshift(...chunks)
  } else {
    _queue.push(...chunks)
  }
  while (_queue.length > MAX_QUEUE) _queue.shift()
  if (!_playing) _playNext()
}

export function stop(): void {
  _queue = []
  if (_currentAudio) {
    try { _currentAudio.pause() } catch (_) {}
    _currentAudio = null
  }
  _playing = false
}

export function setSpeed(rate: number): void {
  _speed = Math.max(0.5, Math.min(2.0, rate))
  localStorage.setItem('omega_tts_speed', String(_speed))
  if (_currentAudio) _currentAudio.playbackRate = _speed
}

export function setVolume(vol: number): void {
  _volume = Math.max(0, Math.min(1, vol))
  localStorage.setItem('omega_tts_volume', String(_volume))
  if (_currentAudio) _currentAudio.volume = _volume
}

export function getSpeed(): number { return _speed }
export function getVolume(): number { return _volume }
export function isSpeaking(): boolean { return _playing }

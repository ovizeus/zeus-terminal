# OMEGA Voice TTS Completion — Config + Thought Stream + Ambient Sound

> **Status:** APPROVED 2026-05-25
> **Operator:** Ovi (wsov2@protonmail.com)
> **Builds on:** Existing TTS (Google Translate proxy + chat playback + ON/OFF toggle)

## Goal

Complete the OMEGA voice experience: speed/volume config, auto-read thought stream, procedural ambient sound. Browser-first (gratis), with provider abstraction for future ElevenLabs/OpenAI swap.

## 1. TTS Provider Abstraction (`omegaTts.ts`)

Wraps the existing Google Translate TTS proxy with a swappable interface.

**Exports:**
- `speak(text, opts?)` → Promise<void> — queues text for playback
- `stop()` — cancel current + clear queue
- `setSpeed(rate)` — 0.5 to 2.0
- `setVolume(vol)` — 0 to 1.0
- `isSpeaking()` → boolean

**Implementation:** Fetches `/api/omega/tts?text=...`, creates `Audio()`, applies `playbackRate` + `volume`. Queue FIFO — one utterance at a time, next plays on `onended`.

**Future swap:** Replace `_fetchAudio()` internals with ElevenLabs/OpenAI API call. Interface unchanged.

## 2. Speed/Volume Config (OmegaPage)

- Two sliders next to VOICE ON/OFF toggle
- Speed: 0.5x → 2.0x, step 0.1, default 1.0
- Volume: 0% → 100%, step 5, default 70%
- Persist in localStorage (`omega_tts_speed`, `omega_tts_volume`)
- Applied via `omegaTts.setSpeed()` / `omegaTts.setVolume()` on change

## 3. Auto-Read Thought Stream (TheVoice)

- When `voiceOn=true`, new thoughts from `ml_voice_log` auto-read via `omegaTts.speak()`
- **Queue rules:**
  - Only read thoughts newer than 30s (skip backlog on connect/refresh)
  - FIFO queue — no overlap
  - ALERT/CAUTIOUS mood thoughts skip to front of queue (priority)
  - Max queue depth: 5 (older unread dropped)
- Skip read when user is in TalkWithMe chat input (focused) — don't talk over typing

## 4. Procedural Ambient Sound (`omegaAmbient.ts`)

**Web Audio API — zero external assets:**

- **Base drone:** OscillatorNode 55Hz (A1) sine wave, gain 0.03 (barely audible)
- **Pulse on brain decision:** Short 220Hz blip, 50ms, gain 0.08 — triggered by new thought in stream
- **Warning tone on P0:** 440Hz + 880Hz dual-oscillator, 200ms, gain 0.15 — triggered by DoctorPanel P0 event

**Controls:**
- Volume tied to main voiceVolume slider × 0.3 (ambient at 30% of voice volume)
- Auto-start when OMEGA page opens + voiceOn=true
- Auto-stop on page exit or voiceOn=false
- Suspend AudioContext when tab not visible (save CPU)

**Interstellar vibe:** Deep, minimal, spatial. No melody — just presence.

**Exports:**
- `startAmbient()` / `stopAmbient()`
- `pulseDecision()` — brain thought blip
- `pulseWarning()` — P0 warning tone
- `setAmbientVolume(vol)` — 0 to 1.0

## File Map

| File | Action |
|------|--------|
| `client/src/audio/omegaTts.ts` | CREATE — TTS provider abstraction + queue |
| `client/src/audio/omegaAmbient.ts` | CREATE — Web Audio procedural ambient |
| `client/src/components/omega/OmegaPage.tsx` | MODIFY — speed/volume sliders |
| `client/src/components/omega/TheVoice.tsx` | MODIFY — auto-read on new thoughts |
| `client/src/app.css` | MODIFY — slider styles |

## Constraints

- Zero external audio assets — all procedural
- Zero API costs — Google Translate TTS proxy (existing)
- AudioContext created on first user interaction (browser autoplay policy)
- Provider abstraction: swap internals, not interface
- Ambient CPU: oscillators suspended on hidden tab

## Testing

- Manual browser test: toggle voice, adjust sliders, verify playback
- Verify ambient starts/stops with page lifecycle
- Verify queue skips old thoughts on refresh
- Verify priority queue (ALERT jumps ahead of CALM)

## Out of Scope

- ElevenLabs/OpenAI integration (future — abstraction ready)
- Voice selection UI (multiple voices)
- Per-thought voice pitch variation

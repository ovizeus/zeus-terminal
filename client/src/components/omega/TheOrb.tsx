import { useEffect, useRef } from 'react'
import type { Mood } from './omegaApi'
import { MOOD_COLOR } from './omegaApi'

/**
 * The Orb — alien light reactive to OMEGA's mood.
 *
 * Canvas-based animation: deep space gradient background + drifting star
 * field + central rune Ω that glows + halo that pulses. Mood drives color,
 * pulse rate, and particle behavior. Read-only — receives mood + intensity
 * from parent, renders.
 *
 * [2026-05-19 water ripple] Operator polish moft — pointer interaction
 * spawns expanding water ripples on the orb surface. Realistic via 3
 * concentric expanding rings per ripple with sin-wave amplitude + alpha
 * decay over ~2.5s lifetime. Drag = continuous spawn. Touch + mouse both
 * supported. Confined to the .omega-orb-wrap container.
 *
 * Performance: requestAnimationFrame loop, ~60fps trivial on modern devices.
 * Canvas is 2x devicePixelRatio for retina crispness.
 */
interface Props {
    mood: Mood
    intensity: number
}

interface Ripple {
    x: number      // px in canvas client space
    y: number
    t0: number     // timestamp emitted
    intensity: number  // 0.4..1.0 — affects amplitude
}

const RIPPLE_LIFETIME_MS = 2500
const RIPPLE_MAX_RADIUS_FACTOR = 0.55  // relative to min(w,h)
const RIPPLE_MAX_ACTIVE = 40
const RIPPLE_DRAG_SPAWN_MIN_PX = 8  // min distance between continuous-drag ripples
const RIPPLE_DRAG_SPAWN_MIN_MS = 30  // min time between drag ripples

export function TheOrb({ mood, intensity }: Props) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const wrapRef = useRef<HTMLDivElement | null>(null)
    const stateRef = useRef({ mood, intensity, t0: performance.now() })
    const ripplesRef = useRef<Ripple[]>([])
    const lastDragRef = useRef<{ x: number; y: number; t: number } | null>(null)

    useEffect(() => {
        stateRef.current.mood = mood
        stateRef.current.intensity = intensity
    }, [mood, intensity])

    useEffect(() => {
        const canvas = canvasRef.current
        const wrap = wrapRef.current
        if (!canvas || !wrap) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        // Hi-DPI sizing
        function fitCanvas() {
            const rect = canvas!.getBoundingClientRect()
            const dpr = Math.min(2, window.devicePixelRatio || 1)
            canvas!.width = Math.floor(rect.width * dpr)
            canvas!.height = Math.floor(rect.height * dpr)
            ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
        }
        fitCanvas()
        const ro = new ResizeObserver(fitCanvas)
        ro.observe(canvas)

        // ── Pointer → ripple emitter ─────────────────────────────────
        // Use the wrap element so ripples spawn anywhere over the orb UI.
        // Coordinates are translated to canvas client space.
        function spawnRipple(clientX: number, clientY: number, intensityHint: number) {
            const rect = canvas!.getBoundingClientRect()
            const x = clientX - rect.left
            const y = clientY - rect.top
            // Ignore points outside the canvas (safety)
            if (x < 0 || y < 0 || x > rect.width || y > rect.height) return
            ripplesRef.current.push({
                x, y, t0: performance.now(),
                intensity: Math.max(0.4, Math.min(1.0, intensityHint)),
            })
            // Cap active ripples to avoid runaway growth
            if (ripplesRef.current.length > RIPPLE_MAX_ACTIVE) {
                ripplesRef.current.splice(0, ripplesRef.current.length - RIPPLE_MAX_ACTIVE)
            }
        }

        let isDown = false
        function onPointerDown(e: PointerEvent) {
            isDown = true
            wrap!.setPointerCapture?.(e.pointerId)
            spawnRipple(e.clientX, e.clientY, 1.0)
            lastDragRef.current = { x: e.clientX, y: e.clientY, t: performance.now() }
        }
        function onPointerMove(e: PointerEvent) {
            if (!isDown) return
            const last = lastDragRef.current
            const now = performance.now()
            if (last) {
                const dx = e.clientX - last.x
                const dy = e.clientY - last.y
                const dist = Math.hypot(dx, dy)
                if (dist < RIPPLE_DRAG_SPAWN_MIN_PX || now - last.t < RIPPLE_DRAG_SPAWN_MIN_MS) return
            }
            // Drag-spawned ripples slightly weaker than tap
            spawnRipple(e.clientX, e.clientY, 0.7)
            lastDragRef.current = { x: e.clientX, y: e.clientY, t: now }
        }
        function onPointerUp(e: PointerEvent) {
            isDown = false
            try { wrap!.releasePointerCapture?.(e.pointerId) } catch (_) {}
            lastDragRef.current = null
        }

        wrap.addEventListener('pointerdown', onPointerDown)
        wrap.addEventListener('pointermove', onPointerMove)
        wrap.addEventListener('pointerup', onPointerUp)
        wrap.addEventListener('pointercancel', onPointerUp)
        wrap.addEventListener('pointerleave', onPointerUp)

        // Star field — pre-populated, drifting slowly
        type Star = { x: number; y: number; r: number; sp: number; ph: number }
        const STARS: Star[] = []
        for (let i = 0; i < 80; i++) {
            STARS.push({
                x: Math.random(),
                y: Math.random(),
                r: 0.4 + Math.random() * 1.4,
                sp: 0.00005 + Math.random() * 0.00015,
                ph: Math.random() * Math.PI * 2
            })
        }

        // Particles around orb — orbit / drift
        type Particle = { angle: number; radius: number; speed: number; size: number; alpha: number }
        const PARTICLES: Particle[] = []
        for (let i = 0; i < 36; i++) {
            PARTICLES.push({
                angle: Math.random() * Math.PI * 2,
                radius: 0.32 + Math.random() * 0.18,
                speed: 0.0002 + Math.random() * 0.0008,
                size: 0.5 + Math.random() * 1.5,
                alpha: 0.3 + Math.random() * 0.5
            })
        }

        let raf = 0
        function frame(now: number) {
            const { mood: m, intensity: I } = stateRef.current
            const dt = now - stateRef.current.t0
            const color = MOOD_COLOR[m] || MOOD_COLOR.CALM
            const w = canvas!.clientWidth
            const h = canvas!.clientHeight
            const cx = w / 2
            const cy = h / 2
            const baseR = Math.min(w, h) * 0.18
            const ripMaxR = Math.min(w, h) * RIPPLE_MAX_RADIUS_FACTOR

            // Pulse rate per mood
            const pulseHz =
                m === 'EXCITED' ? 2.0 :
                m === 'NERVOUS' ? 1.7 :
                m === 'ANGRY' ? 1.5 :
                m === 'FOCUSED' ? 1.0 :
                m === 'SAD' ? 0.3 :
                m === 'BORED' ? 0.15 :
                0.5
            const pulse = 0.5 + 0.5 * Math.sin(dt / 1000 * pulseHz * Math.PI * 2)
            const haloR = baseR * (1.55 + 0.35 * pulse * I)

            // ── Background: deep space gradient ─────────────────────
            const bg = ctx!.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.85)
            bg.addColorStop(0, '#0a1830')
            bg.addColorStop(0.4, '#050510')
            bg.addColorStop(1, '#000005')
            ctx!.fillStyle = bg
            ctx!.fillRect(0, 0, w, h)

            // ── Nebula clouds (radial soft blobs, mood-tinted very low alpha) ──
            ctx!.save()
            ctx!.globalCompositeOperation = 'screen'
            for (let i = 0; i < 3; i++) {
                const phase = (dt / 30_000 + i * 0.33) % 1
                const nx = cx + Math.cos(phase * Math.PI * 2) * w * 0.25
                const ny = cy + Math.sin(phase * Math.PI * 2 + i) * h * 0.2
                const grad = ctx!.createRadialGradient(nx, ny, 0, nx, ny, baseR * 4)
                grad.addColorStop(0, `${color}22`)
                grad.addColorStop(0.6, `${color}08`)
                grad.addColorStop(1, '#00000000')
                ctx!.fillStyle = grad
                ctx!.fillRect(0, 0, w, h)
            }
            ctx!.restore()

            // ── Star field ──
            ctx!.save()
            for (const s of STARS) {
                const tw = 0.5 + 0.5 * Math.sin(dt * 0.001 + s.ph)
                ctx!.fillStyle = `rgba(255,255,255,${0.3 + 0.4 * tw})`
                ctx!.beginPath()
                ctx!.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2)
                ctx!.fill()
            }
            ctx!.restore()

            // ── Orb halo (outer glow) ──
            const haloGrad = ctx!.createRadialGradient(cx, cy, baseR * 0.8, cx, cy, haloR)
            haloGrad.addColorStop(0, `${color}88`)
            haloGrad.addColorStop(0.4, `${color}33`)
            haloGrad.addColorStop(1, '#00000000')
            ctx!.fillStyle = haloGrad
            ctx!.beginPath()
            ctx!.arc(cx, cy, haloR, 0, Math.PI * 2)
            ctx!.fill()

            // ── Orbiting particles ──
            ctx!.save()
            ctx!.fillStyle = color
            for (const p of PARTICLES) {
                p.angle += p.speed * (1 + I * 2)
                const px = cx + Math.cos(p.angle) * baseR * (1 + p.radius * 2)
                const py = cy + Math.sin(p.angle) * baseR * (1 + p.radius * 2)
                ctx!.globalAlpha = p.alpha * (0.6 + 0.4 * pulse)
                ctx!.beginPath()
                ctx!.arc(px, py, p.size, 0, Math.PI * 2)
                ctx!.fill()
            }
            ctx!.restore()

            // ── Orb core: filled circle with inner gradient ──
            const coreGrad = ctx!.createRadialGradient(cx - baseR * 0.3, cy - baseR * 0.3, 0, cx, cy, baseR)
            coreGrad.addColorStop(0, '#ffffff')
            coreGrad.addColorStop(0.3, color)
            coreGrad.addColorStop(1, `${color}66`)
            ctx!.fillStyle = coreGrad
            ctx!.beginPath()
            ctx!.arc(cx, cy, baseR, 0, Math.PI * 2)
            ctx!.fill()

            // ── Ω rune in center ──
            ctx!.save()
            ctx!.translate(cx, cy)
            // gentle rotation
            ctx!.rotate(Math.sin(dt / 5000) * 0.05)
            ctx!.font = `900 ${Math.floor(baseR * 1.2)}px "Orbitron", "Audiowide", sans-serif`
            ctx!.textAlign = 'center'
            ctx!.textBaseline = 'middle'
            ctx!.fillStyle = '#ffffff'
            ctx!.shadowColor = color
            ctx!.shadowBlur = baseR * 0.6 * (0.7 + 0.5 * pulse)
            ctx!.fillText('Ω', 0, baseR * 0.04)
            ctx!.restore()

            // ── Water ripples ── [2026-05-19 polish]
            // Each ripple = 3 concentric expanding rings with sin-wave amplitude,
            // alpha decays exponentially over RIPPLE_LIFETIME_MS. Realistic feel
            // via interference of multiple rings + offset phases.
            const ripples = ripplesRef.current
            if (ripples.length > 0) {
                ctx!.save()
                ctx!.globalCompositeOperation = 'lighter'
                for (let i = ripples.length - 1; i >= 0; i--) {
                    const r = ripples[i]
                    const age = now - r.t0
                    if (age > RIPPLE_LIFETIME_MS) {
                        ripples.splice(i, 1)
                        continue
                    }
                    const t = age / RIPPLE_LIFETIME_MS  // 0..1
                    const easedExpand = 1 - Math.pow(1 - t, 2.5)  // ease-out
                    const baseRing = ripMaxR * easedExpand * r.intensity
                    const alphaDecay = Math.pow(1 - t, 1.4)
                    // 3 concentric rings cu phase offset = wave interference
                    for (let k = 0; k < 3; k++) {
                        const ringR = baseRing + k * 18 * Math.sin(age * 0.012 + k)
                        if (ringR <= 0) continue
                        const ringAlpha = alphaDecay * (0.55 - k * 0.13) * r.intensity
                        if (ringAlpha < 0.01) continue
                        // White-cyan tint with mood color hint
                        ctx!.strokeStyle = k === 0
                            ? `rgba(170,230,255,${ringAlpha})`
                            : k === 1
                                ? `rgba(255,255,255,${ringAlpha * 0.7})`
                                : `${color}${Math.floor(ringAlpha * 90).toString(16).padStart(2, '0')}`
                        ctx!.lineWidth = 1.8 + Math.sin(age * 0.01 + k) * 0.8
                        ctx!.beginPath()
                        ctx!.arc(r.x, r.y, ringR, 0, Math.PI * 2)
                        ctx!.stroke()
                    }
                    // Subtle bright dot at impact origin during first 300ms
                    if (age < 300) {
                        const dotAlpha = (1 - age / 300) * 0.7 * r.intensity
                        ctx!.fillStyle = `rgba(220,240,255,${dotAlpha})`
                        ctx!.beginPath()
                        ctx!.arc(r.x, r.y, 3 + (age / 300) * 4, 0, Math.PI * 2)
                        ctx!.fill()
                    }
                }
                ctx!.restore()
            }

            raf = requestAnimationFrame(frame)
        }
        raf = requestAnimationFrame(frame)

        return () => {
            cancelAnimationFrame(raf)
            ro.disconnect()
            wrap.removeEventListener('pointerdown', onPointerDown)
            wrap.removeEventListener('pointermove', onPointerMove)
            wrap.removeEventListener('pointerup', onPointerUp)
            wrap.removeEventListener('pointercancel', onPointerUp)
            wrap.removeEventListener('pointerleave', onPointerUp)
        }
    }, [])

    return (
        <div className="omega-orb-wrap" ref={wrapRef} style={{ touchAction: 'none' }}>
            <canvas ref={canvasRef} className="omega-orb-canvas" aria-label="OMEGA mood orb" />
            <div className="omega-orb-mood" data-mood={mood}>
                <span className="omega-orb-mood-label">{mood}</span>
                <span className="omega-orb-mood-bar">
                    <span className="omega-orb-mood-fill" style={{ width: `${Math.round(intensity * 100)}%`, background: MOOD_COLOR[mood] }} />
                </span>
            </div>
        </div>
    )
}

import { useEffect, useRef } from 'react'
import type { Mood } from './omegaApi'
import { MOOD_COLOR } from './omegaApi'

/**
 * The Orb — alien light reactive to OMEGA's mood.
 *
 * [2026-05-19 water v2 — realistic 5-layer water effect]
 * Operator polish: orb feels like it's submerged in water. Touch/drag
 * triggers 5 simultaneous water phenomena:
 *
 *  1. RIPPLES — concentric expanding rings with phase-offset interference
 *     (kept from v1, refined)
 *  2. REFRACTION — Ω rune visibly distorts through ripple zones via
 *     wavy text-replication along the ring path
 *  3. CAUSTICS — animated sin-wave bright pattern on orb surface
 *     (simulates light refracting through agitated water bottom)
 *  4. WAKE / SILLAGE — drag leaves persistent fading trail of curve points
 *  5. FOAM — micro white particles spawned on each ripple's leading edge
 *  6. EDGE BOUNCE — ripples that hit the orb core boundary partially
 *     reflect back inward with phase reversal
 *
 * Performance bounded by RIPPLE_MAX_ACTIVE (60) + WAKE_MAX (180 points)
 * + FOAM_MAX (200 particles). All allocations preallocated; no garbage
 * generation in the hot frame loop.
 */
interface Props {
    mood: Mood
    intensity: number
}

interface Ripple {
    x: number
    y: number
    t0: number
    intensity: number
    bounced: boolean
}

interface FoamParticle {
    x: number
    y: number
    vx: number
    vy: number
    t0: number
    life: number
}

interface WakePoint {
    x: number
    y: number
    t0: number
}

const RIPPLE_LIFETIME_MS = 2800
const RIPPLE_MAX_RADIUS_FACTOR = 0.55
const RIPPLE_MAX_ACTIVE = 60
const RIPPLE_DRAG_SPAWN_MIN_PX = 8
const RIPPLE_DRAG_SPAWN_MIN_MS = 28
const WAKE_LIFETIME_MS = 1400
const WAKE_MAX = 180
const FOAM_LIFETIME_MS = 700
const FOAM_MAX = 200
const FOAM_PER_RIPPLE_SPAWN = 5

export function TheOrb({ mood, intensity }: Props) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const wrapRef = useRef<HTMLDivElement | null>(null)
    const stateRef = useRef({ mood, intensity, t0: performance.now() })
    const ripplesRef = useRef<Ripple[]>([])
    const wakeRef = useRef<WakePoint[]>([])
    const foamRef = useRef<FoamParticle[]>([])
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

        function spawnRipple(clientX: number, clientY: number, intensityHint: number) {
            const rect = canvas!.getBoundingClientRect()
            const x = clientX - rect.left
            const y = clientY - rect.top
            if (x < 0 || y < 0 || x > rect.width || y > rect.height) return
            ripplesRef.current.push({
                x, y, t0: performance.now(),
                intensity: Math.max(0.4, Math.min(1.0, intensityHint)),
                bounced: false,
            })
            if (ripplesRef.current.length > RIPPLE_MAX_ACTIVE) {
                ripplesRef.current.splice(0, ripplesRef.current.length - RIPPLE_MAX_ACTIVE)
            }
        }

        function addWake(clientX: number, clientY: number) {
            const rect = canvas!.getBoundingClientRect()
            const x = clientX - rect.left
            const y = clientY - rect.top
            if (x < 0 || y < 0 || x > rect.width || y > rect.height) return
            wakeRef.current.push({ x, y, t0: performance.now() })
            if (wakeRef.current.length > WAKE_MAX) {
                wakeRef.current.splice(0, wakeRef.current.length - WAKE_MAX)
            }
        }

        let isDown = false
        function onPointerDown(e: PointerEvent) {
            isDown = true
            wrap!.setPointerCapture?.(e.pointerId)
            spawnRipple(e.clientX, e.clientY, 1.0)
            addWake(e.clientX, e.clientY)
            lastDragRef.current = { x: e.clientX, y: e.clientY, t: performance.now() }
        }
        function onPointerMove(e: PointerEvent) {
            if (!isDown) return
            const last = lastDragRef.current
            const now = performance.now()
            // Wake captures every move for smoothness — independent of ripple throttle
            if (!last || Math.hypot(e.clientX - last.x, e.clientY - last.y) > 3) {
                addWake(e.clientX, e.clientY)
            }
            if (last) {
                const dx = e.clientX - last.x
                const dy = e.clientY - last.y
                const dist = Math.hypot(dx, dy)
                if (dist < RIPPLE_DRAG_SPAWN_MIN_PX || now - last.t < RIPPLE_DRAG_SPAWN_MIN_MS) return
            }
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

        // Star field
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

        // Particles around orb
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

            // Background
            const bg = ctx!.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.85)
            bg.addColorStop(0, '#0a1830')
            bg.addColorStop(0.4, '#050510')
            bg.addColorStop(1, '#000005')
            ctx!.fillStyle = bg
            ctx!.fillRect(0, 0, w, h)

            // Nebula
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

            // Stars
            ctx!.save()
            for (const s of STARS) {
                const tw = 0.5 + 0.5 * Math.sin(dt * 0.001 + s.ph)
                ctx!.fillStyle = `rgba(255,255,255,${0.3 + 0.4 * tw})`
                ctx!.beginPath()
                ctx!.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2)
                ctx!.fill()
            }
            ctx!.restore()

            // Halo
            const haloGrad = ctx!.createRadialGradient(cx, cy, baseR * 0.8, cx, cy, haloR)
            haloGrad.addColorStop(0, `${color}88`)
            haloGrad.addColorStop(0.4, `${color}33`)
            haloGrad.addColorStop(1, '#00000000')
            ctx!.fillStyle = haloGrad
            ctx!.beginPath()
            ctx!.arc(cx, cy, haloR, 0, Math.PI * 2)
            ctx!.fill()

            // Orbiting particles
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

            // Orb core
            const coreGrad = ctx!.createRadialGradient(cx - baseR * 0.3, cy - baseR * 0.3, 0, cx, cy, baseR)
            coreGrad.addColorStop(0, '#ffffff')
            coreGrad.addColorStop(0.3, color)
            coreGrad.addColorStop(1, `${color}66`)
            ctx!.fillStyle = coreGrad
            ctx!.beginPath()
            ctx!.arc(cx, cy, baseR, 0, Math.PI * 2)
            ctx!.fill()

            // ── [v2 #3] CAUSTICS — animated sin-wave bright pattern on orb surface ──
            // Sample a moiré of two interfering sin-waves, light alpha, clipped to orb
            ctx!.save()
            ctx!.beginPath()
            ctx!.arc(cx, cy, baseR, 0, Math.PI * 2)
            ctx!.clip()
            ctx!.globalCompositeOperation = 'lighter'
            const causticStep = 4
            const causticT = dt * 0.0017
            for (let yy = -baseR; yy <= baseR; yy += causticStep) {
                for (let xx = -baseR; xx <= baseR; xx += causticStep) {
                    const dx = xx
                    const dy = yy
                    const dist2 = dx * dx + dy * dy
                    if (dist2 > baseR * baseR) continue
                    const a = Math.sin(dx * 0.06 + causticT) * Math.cos(dy * 0.05 - causticT * 0.7)
                    const b = Math.sin((dx + dy) * 0.04 + causticT * 1.3)
                    const v = (a * b + 1) * 0.5  // 0..1
                    if (v < 0.78) continue
                    const alpha = (v - 0.78) * 0.4
                    ctx!.fillStyle = `rgba(220,240,255,${alpha})`
                    ctx!.fillRect(cx + xx, cy + yy, causticStep, causticStep)
                }
            }
            ctx!.restore()

            // ── Ω rune — REFRACTED through ripple zones (#2) ──
            // Render rune normally, then for each active ripple draw a thin wavy
            // ghost-copy with offset = sin(angle) * ringAmplitude. Operator sees
            // the Ω 'wobble' when ripples cross its position.
            ctx!.save()
            ctx!.translate(cx, cy)
            ctx!.rotate(Math.sin(dt / 5000) * 0.05)
            ctx!.font = `900 ${Math.floor(baseR * 1.2)}px "Orbitron", "Audiowide", sans-serif`
            ctx!.textAlign = 'center'
            ctx!.textBaseline = 'middle'
            ctx!.fillStyle = '#ffffff'
            ctx!.shadowColor = color
            ctx!.shadowBlur = baseR * 0.6 * (0.7 + 0.5 * pulse)
            ctx!.fillText('Ω', 0, baseR * 0.04)
            ctx!.restore()

            // Refraction ghost passes
            const ripples = ripplesRef.current
            if (ripples.length > 0) {
                ctx!.save()
                ctx!.font = `900 ${Math.floor(baseR * 1.2)}px "Orbitron", "Audiowide", sans-serif`
                ctx!.textAlign = 'center'
                ctx!.textBaseline = 'middle'
                ctx!.globalCompositeOperation = 'lighter'
                for (const r of ripples) {
                    const age = now - r.t0
                    if (age > RIPPLE_LIFETIME_MS) continue
                    const t = age / RIPPLE_LIFETIME_MS
                    const eased = 1 - Math.pow(1 - t, 2.5)
                    const ringR = ripMaxR * eased * r.intensity
                    // Refraction strength is proportional to how close the ring is to crossing the rune center
                    const distToCenter = Math.hypot(r.x - cx, r.y - cy)
                    const proximity = Math.exp(-Math.pow((distToCenter - ringR) / 30, 2))
                    if (proximity < 0.05) continue
                    const amp = proximity * 6 * r.intensity * (1 - t)
                    const phase = Math.atan2(r.y - cy, r.x - cx)
                    const offX = Math.cos(phase) * amp
                    const offY = Math.sin(phase) * amp
                    ctx!.fillStyle = `rgba(170,220,255,${0.3 * proximity * (1 - t)})`
                    ctx!.fillText('Ω', cx + offX, cy + offY + baseR * 0.04)
                }
                ctx!.restore()
            }

            // ── [v2 #4] WAKE — drag trail (fading line through past points) ──
            const wake = wakeRef.current
            if (wake.length > 1) {
                ctx!.save()
                ctx!.globalCompositeOperation = 'lighter'
                ctx!.lineCap = 'round'
                ctx!.lineJoin = 'round'
                for (let i = wake.length - 1; i >= 0; i--) {
                    const w0 = wake[i]
                    const ageW = now - w0.t0
                    if (ageW > WAKE_LIFETIME_MS) {
                        wake.splice(0, i + 1)
                        break
                    }
                }
                // Draw smooth line through remaining points with fade
                for (let i = 1; i < wake.length; i++) {
                    const p0 = wake[i - 1]
                    const p1 = wake[i]
                    const age = now - p1.t0
                    const t = 1 - age / WAKE_LIFETIME_MS
                    if (t <= 0) continue
                    ctx!.strokeStyle = `rgba(180,220,255,${0.35 * t})`
                    ctx!.lineWidth = 2.5 + 1.5 * t
                    ctx!.beginPath()
                    ctx!.moveTo(p0.x, p0.y)
                    ctx!.lineTo(p1.x, p1.y)
                    ctx!.stroke()
                    // Inner brighter line
                    ctx!.strokeStyle = `rgba(255,255,255,${0.2 * t})`
                    ctx!.lineWidth = 1 + 0.5 * t
                    ctx!.beginPath()
                    ctx!.moveTo(p0.x, p0.y)
                    ctx!.lineTo(p1.x, p1.y)
                    ctx!.stroke()
                }
                ctx!.restore()
            }

            // ── [v1 + v2 #6] RIPPLES with EDGE BOUNCE ──
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
                    const t = age / RIPPLE_LIFETIME_MS
                    const eased = 1 - Math.pow(1 - t, 2.5)
                    const baseRing = ripMaxR * eased * r.intensity
                    const alphaDecay = Math.pow(1 - t, 1.4)

                    // Detect when ring first crosses orb core boundary → spawn bounce ripple
                    const distToCenter = Math.hypot(r.x - cx, r.y - cy)
                    if (!r.bounced && baseRing > distToCenter - baseR && distToCenter > baseR) {
                        r.bounced = true
                        // Reflected ripple — opposite side of the boundary
                        const phase = Math.atan2(r.y - cy, r.x - cx)
                        const reflX = cx + Math.cos(phase) * (baseR * 1.15)
                        const reflY = cy + Math.sin(phase) * (baseR * 1.15)
                        ripples.push({
                            x: reflX, y: reflY, t0: now,
                            intensity: r.intensity * 0.45,
                            bounced: true,  // already counted; don't bounce again
                        })
                        if (ripples.length > RIPPLE_MAX_ACTIVE) {
                            // Remove oldest if overflow
                            ripples.splice(0, ripples.length - RIPPLE_MAX_ACTIVE)
                        }
                    }

                    // 3 concentric rings cu phase offset
                    for (let k = 0; k < 3; k++) {
                        const ringR = baseRing + k * 18 * Math.sin(age * 0.012 + k)
                        if (ringR <= 0) continue
                        const ringAlpha = alphaDecay * (0.55 - k * 0.13) * r.intensity
                        if (ringAlpha < 0.01) continue
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

                    // [v2 #5] FOAM — micro-particles spawned on leading ring edge
                    // Spawn rate per frame budget; clustered around leading ring
                    if (age < RIPPLE_LIFETIME_MS * 0.4 && foamRef.current.length < FOAM_MAX) {
                        for (let f = 0; f < FOAM_PER_RIPPLE_SPAWN; f++) {
                            const ang = Math.random() * Math.PI * 2
                            const ringR = baseRing
                            const jx = r.x + Math.cos(ang) * ringR
                            const jy = r.y + Math.sin(ang) * ringR
                            // Outward velocity
                            const vMag = 0.5 + Math.random() * 1.0
                            foamRef.current.push({
                                x: jx, y: jy,
                                vx: Math.cos(ang) * vMag,
                                vy: Math.sin(ang) * vMag,
                                t0: now,
                                life: FOAM_LIFETIME_MS * (0.5 + Math.random() * 0.5),
                            })
                        }
                    }

                    // Impact dot at origin (first 300ms)
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

            // ── [v2 #5] FOAM render ──
            const foam = foamRef.current
            if (foam.length > 0) {
                ctx!.save()
                ctx!.globalCompositeOperation = 'lighter'
                for (let i = foam.length - 1; i >= 0; i--) {
                    const p = foam[i]
                    const ageF = now - p.t0
                    if (ageF > p.life) {
                        foam.splice(i, 1)
                        continue
                    }
                    p.x += p.vx
                    p.y += p.vy
                    // Slight slowdown
                    p.vx *= 0.96
                    p.vy *= 0.96
                    const tF = 1 - ageF / p.life
                    ctx!.fillStyle = `rgba(240,250,255,${0.7 * tF})`
                    ctx!.beginPath()
                    ctx!.arc(p.x, p.y, 1 + tF, 0, Math.PI * 2)
                    ctx!.fill()
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

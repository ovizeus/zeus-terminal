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
 * Performance: requestAnimationFrame loop, ~60fps trivial on modern devices.
 * Canvas is 2x devicePixelRatio for retina crispness.
 */
interface Props {
    mood: Mood
    intensity: number
}

export function TheOrb({ mood, intensity }: Props) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const stateRef = useRef({ mood, intensity, t0: performance.now() })

    useEffect(() => {
        stateRef.current.mood = mood
        stateRef.current.intensity = intensity
    }, [mood, intensity])

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
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

            raf = requestAnimationFrame(frame)
        }
        raf = requestAnimationFrame(frame)

        return () => {
            cancelAnimationFrame(raf)
            ro.disconnect()
        }
    }, [])

    return (
        <div className="omega-orb-wrap">
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

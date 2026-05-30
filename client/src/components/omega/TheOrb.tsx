import { useEffect, useRef } from 'react'
import type { Mood } from './omegaApi'
import { MOOD_COLOR } from './omegaApi'
import { startFluid, type FluidHandle } from './fluidSim'

/**
 * The Orb — composed OMEGA scene over a WebGL fluid.
 *
 * [moft 2026-05-30] Dense colorful fluid (steam) flowing continuously +
 * reacting to pointer; hand-drawn ETH coin (left) + BTC coin (right) as clean
 * SVG badges with a clear gap from the centered OMEGA emblem (the multicolor
 * fluid flows THROUGH the emblem via screen blend, which also dissolves the
 * black bg + watermark). Mood at the bottom. Black background kept as-is.
 * Backup of the previous water orb: TheOrb.tsx.bak.pre-fluid-20260530.
 */
interface Props {
    mood: Mood
    intensity: number
}

const BASE = import.meta.env.BASE_URL || '/app/'
const EMBLEM = BASE + 'omega/emblem.jpg' // 1081² gold alpha-omega on black

function EthCoin() {
    return (
        <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
            <defs>
                <radialGradient id="omegaEthFace" cx="38%" cy="32%" r="78%">
                    <stop offset="0%" stopColor="#ffffff" />
                    <stop offset="55%" stopColor="#cfd3dd" />
                    <stop offset="100%" stopColor="#7e8493" />
                </radialGradient>
            </defs>
            <circle cx="50" cy="50" r="47" fill="url(#omegaEthFace)" stroke="#565c6b" strokeWidth="2" />
            <circle cx="50" cy="50" r="39" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
            <g transform="translate(50,49)">
                <polygon points="0,-30 -17,4 0,-9 17,4" fill="#3a3f4c" />
                <polygon points="0,-7 -17,5 0,8 17,5" fill="#565c6b" />
                <polygon points="0,33 -17,9 0,14 17,9" fill="#3a3f4c" />
            </g>
        </svg>
    )
}

function BtcCoin() {
    return (
        <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
            <defs>
                <radialGradient id="omegaBtcFace" cx="38%" cy="32%" r="78%">
                    <stop offset="0%" stopColor="#ffe88a" />
                    <stop offset="55%" stopColor="#f7931a" />
                    <stop offset="100%" stopColor="#9c5a08" />
                </radialGradient>
            </defs>
            <circle cx="50" cy="50" r="47" fill="url(#omegaBtcFace)" stroke="#7a4708" strokeWidth="2" />
            <circle cx="50" cy="50" r="39" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1" />
            <text x="50" y="53" fontSize="54" fontWeight="900" textAnchor="middle" dominantBaseline="central" fill="#fff" fontFamily="Arial, sans-serif">₿</text>
        </svg>
    )
}

export function TheOrb({ mood, intensity }: Props) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const fluidRef = useRef<FluidHandle | null>(null)
    const moodRef = useRef<Mood>(mood)
    const intensityRef = useRef<number>(intensity)
    moodRef.current = mood
    intensityRef.current = intensity

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const handle = startFluid(canvas)
        fluidRef.current = handle
        if (!handle) return

        const tick = () => {
            const inten = Math.max(0, Math.min(1, intensityRef.current || 0.4))
            const bursts = 1 + (Math.random() < (0.3 + inten * 0.6) ? 1 : 0)
            handle.autoSplat(MOOD_COLOR[moodRef.current] || '#00d4ff', bursts)
        }
        handle.autoSplat(MOOD_COLOR[moodRef.current] || '#00d4ff', 3)
        const id = window.setInterval(tick, 650)
        return () => { window.clearInterval(id); handle.stop(); fluidRef.current = null }
    }, [])

    useEffect(() => {
        const h = fluidRef.current
        if (h) h.autoSplat(MOOD_COLOR[mood] || '#00d4ff', 4)
    }, [mood])

    const moodColor = MOOD_COLOR[mood] || '#00d4ff'

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: 'inherit', background: 'radial-gradient(120% 120% at 50% 40%, #0a1020 0%, #05070d 70%)' }}>
            <style>{`
                @keyframes omegaFloatA { 0%,100%{ transform:translateY(-50%) translateY(0) } 50%{ transform:translateY(-50%) translateY(-7px) } }
                @keyframes omegaFloatB { 0%,100%{ transform:translateY(-50%) translateY(0) } 50%{ transform:translateY(-50%) translateY(8px) } }
                @keyframes omegaEmblem { 0%,100%{ transform:translate(-50%,-50%) translateY(0) scale(1) } 50%{ transform:translate(-50%,-50%) translateY(-6px) scale(1.015) } }
            `}</style>

            {/* fluid steam — dense + colorful, screen-blends over the dark scene */}
            <canvas ref={canvasRef} aria-hidden="true"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', mixBlendMode: 'screen', opacity: 0.96 }} />

            {/* ETH left · BTC right — hand-drawn SVG coins, clear gap from the emblem */}
            <div aria-hidden="true" style={{ position: 'absolute', top: '40%', left: '3%', width: '21%', aspectRatio: '1', filter: 'drop-shadow(0 6px 16px rgba(0,0,0,0.6))', animation: 'omegaFloatA 6.5s ease-in-out infinite' }}>
                <EthCoin />
            </div>
            <div aria-hidden="true" style={{ position: 'absolute', top: '40%', right: '3%', width: '21%', aspectRatio: '1', filter: 'drop-shadow(0 6px 16px rgba(0,0,0,0.6))', animation: 'omegaFloatB 7.5s ease-in-out infinite' }}>
                <BtcCoin />
            </div>

            {/* OMEGA emblem center — screen blend = black bg + watermark vanish, fluid flows through the gold */}
            <div aria-hidden="true" style={{
                position: 'absolute', left: '50%', top: '45%', width: '46%', aspectRatio: '1',
                transform: 'translate(-50%,-50%)', backgroundImage: `url(${EMBLEM})`,
                backgroundSize: '122%', backgroundRepeat: 'no-repeat', backgroundPosition: 'center',
                mixBlendMode: 'screen', filter: 'contrast(2.3) brightness(1.45) saturate(1.15) drop-shadow(0 0 18px rgba(255,210,140,0.25))',
                animation: 'omegaEmblem 8s ease-in-out infinite',
            }} />

            {/* mood / state at the bottom */}
            <div style={{
                position: 'absolute', bottom: '6%', left: '50%', transform: 'translateX(-50%)',
                color: moodColor, fontWeight: 700, letterSpacing: '0.28em', fontSize: '0.82rem',
                textShadow: `0 0 14px ${moodColor}aa, 0 2px 6px rgba(0,0,0,0.7)`, textTransform: 'uppercase',
                pointerEvents: 'none', userSelect: 'none',
            }}>
                {mood}
            </div>
        </div>
    )
}

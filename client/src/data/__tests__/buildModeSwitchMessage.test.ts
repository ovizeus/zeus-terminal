/**
 * Zeus Terminal — Unit Tests: _buildModeSwitchMessage (BUG-T3 FIX 2026-05-14)
 *
 * Pure helper that constructs the confirm-dialog message shown to the user
 * when switching engine mode (demo↔live). Must inject the count of
 * opposite-mode open positions so the user understands WHAT will be hidden
 * from the UI after the switch.
 *
 * BUG-T3 root cause: previous static message did not surface count; users
 * could not tell they were about to hide N positions from view, leading to
 * forgotten unprotected exposure on REAL post-S10/S11.
 *
 * Coverage:
 *   - Demo target with 0 live positions → no count phrase
 *   - Demo target with 1 live position → singular phrasing
 *   - Demo target with N>1 live positions → plural phrasing
 *   - Live target with 0 demo positions → no count phrase
 *   - Live target with N>0 demo positions → plural phrasing
 *   - Testnet target (live) — distinct title from REAL
 *
 * TDD failing-first: helper not exported yet from marketDataTrading.ts.
 */
import { describe, it, expect } from 'vitest'
import { _buildModeSwitchMessage } from '../marketDataTrading'

describe('_buildModeSwitchMessage (BUG-T3 FIX — opposite-mode count injection)', () => {
    describe('target=demo (switching live → demo)', () => {
        it('omits count phrase when zero live positions exist', () => {
            const out = _buildModeSwitchMessage('demo', 0, false)
            expect(out.message).not.toMatch(/\d+\s+LIVE position/i)
            expect(out.title).toBe('Activate Demo Mode?')
        })

        it('includes singular count phrase for 1 live position', () => {
            const out = _buildModeSwitchMessage('demo', 1, false)
            expect(out.message).toMatch(/1\s+LIVE position\b/)
            expect(out.message).not.toMatch(/positions/) // singular only
        })

        it('includes plural count phrase for 3 live positions', () => {
            const out = _buildModeSwitchMessage('demo', 3, false)
            expect(out.message).toMatch(/3\s+LIVE positions/)
        })

        it('warns hidden-but-active in message', () => {
            const out = _buildModeSwitchMessage('demo', 2, false)
            expect(out.message.toLowerCase()).toMatch(/hidden|remain active|continue/)
        })
    })

    describe('target=live (switching demo → live)', () => {
        it('omits count phrase when zero demo positions exist (REAL)', () => {
            const out = _buildModeSwitchMessage('live', 0, false)
            expect(out.message).not.toMatch(/\d+\s+DEMO position/i)
            expect(out.title).toBe('Activate Real Trading Mode?')
        })

        it('uses TESTNET title when isTestnet=true', () => {
            const out = _buildModeSwitchMessage('live', 0, true)
            expect(out.title).toBe('Activate Testnet Mode?')
        })

        it('includes plural count phrase for 2 demo positions', () => {
            const out = _buildModeSwitchMessage('live', 2, false)
            expect(out.message).toMatch(/2\s+DEMO positions/)
        })

        it('includes singular for 1 demo position', () => {
            const out = _buildModeSwitchMessage('live', 1, true)
            expect(out.message).toMatch(/1\s+DEMO position\b/)
            expect(out.message).not.toMatch(/positions/)
        })
    })

    describe('shape', () => {
        it('returns object with title, message, cancelText, confirmText', () => {
            const out = _buildModeSwitchMessage('demo', 0, false)
            expect(out).toHaveProperty('title')
            expect(out).toHaveProperty('message')
            expect(out).toHaveProperty('cancelText')
            expect(out).toHaveProperty('confirmText')
            expect(out.cancelText).toBe('Cancel')
        })

        it('confirmText differs between targets', () => {
            const demo = _buildModeSwitchMessage('demo', 0, false)
            const real = _buildModeSwitchMessage('live', 0, false)
            const testnet = _buildModeSwitchMessage('live', 0, true)
            expect(demo.confirmText).toBe('Activate Demo')
            expect(real.confirmText).toBe('Activate Live')
            expect(testnet.confirmText).toBe('Activate Testnet')
        })
    })
})

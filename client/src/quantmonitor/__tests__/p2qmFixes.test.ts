// [P2-QM 2026-06-10] Tests for the three QM panel status-line fixes:
//  1. acc L/S fallback fields (_qmLongRatio/_qmShortRatio) written from S.ls
//  2. topLongShort fetched for the ACTIVE symbol (was hardcoded BTCUSDT)
//  3. OI unit label derived from symbol (was hardcoded "BTC")
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { _syncQmVars } from '../index'
import { fetchTopTraderPositionRatio } from '../engines/liqMap'
import { oiUnitFor } from '../render/frame'

const w = window as any

describe('P2-QM fixes', () => {
  let origS: any
  beforeEach(() => { origS = w.S; w.S = {} })
  afterEach(() => { w.S = origS; vi.restoreAllMocks(); vi.unstubAllGlobals() })

  describe('Fix 1: acc L/S fields written from S.ls', () => {
    test('maps S.ls percentage split to 0..1 fractions', () => {
      w.S = { price: 100, ls: { l: 62.5, s: 37.5 } }
      _syncQmVars()
      expect(w.S._qmLongRatio).toBeCloseTo(0.625, 6)
      expect(w.S._qmShortRatio).toBeCloseTo(0.375, 6)
      // frame.ts renders (ratio * 100).toFixed(0) → "63%L/38%S"
      expect((w.S._qmLongRatio * 100).toFixed(0)).toBe('63')
    })

    test('defaults to 0 when S.ls is absent', () => {
      w.S = { price: 100 }
      _syncQmVars()
      expect(w.S._qmLongRatio).toBe(0)
      expect(w.S._qmShortRatio).toBe(0)
    })
  })

  describe('Fix 2: topLongShort uses active symbol', () => {
    test('interpolates uppercased active symbol into the request URL', async () => {
      w.S = { symbol: 'ethusdt' }
      const fetchMock = vi.fn().mockResolvedValue({
        json: () => Promise.resolve([{ longAccount: '0.61', shortAccount: '0.39' }]),
      })
      vi.stubGlobal('fetch', fetchMock)
      await fetchTopTraderPositionRatio()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const url = String(fetchMock.mock.calls[0][0])
      expect(url).toContain('symbol=ETHUSDT')
      expect(w.S._qmPosLongRatio).toBeCloseTo(0.61, 6)
      expect(w.S._qmPosShortRatio).toBeCloseTo(0.39, 6)
    })

    test('falls back to BTCUSDT when no symbol set', async () => {
      w.S = {}
      const fetchMock = vi.fn().mockResolvedValue({ json: () => Promise.resolve([]) })
      vi.stubGlobal('fetch', fetchMock)
      await fetchTopTraderPositionRatio()
      expect(String(fetchMock.mock.calls[0][0])).toContain('symbol=BTCUSDT')
    })
  })

  describe('Fix 3: OI unit label derived from symbol', () => {
    test('strips USDT/USDC/BUSD quote suffixes', () => {
      expect(oiUnitFor('ETHUSDT')).toBe('ETH')
      expect(oiUnitFor('BTCUSDT')).toBe('BTC')
      expect(oiUnitFor('SOLUSDC')).toBe('SOL')
      expect(oiUnitFor('BNBBUSD')).toBe('BNB')
      expect(oiUnitFor('ethusdt')).toBe('ETH')
    })

    test('defaults to BTC when symbol missing', () => {
      expect(oiUnitFor(undefined)).toBe('BTC')
      expect(oiUnitFor('')).toBe('BTC')
    })
  })
})

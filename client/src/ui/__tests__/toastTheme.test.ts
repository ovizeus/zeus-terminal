import { describe, it, expect } from 'vitest'
import { toastTheme, inferLevel, TOAST_LEVELS, TOAST_MAX_STACK } from '../toastTheme'

describe('the look', () => {
  it('keeps the TEXT neutral at every level — that was the amateurish part', () => {
    const texts = TOAST_LEVELS.map((l) => toastTheme(l).text)
    expect(new Set(texts).size).toBe(1)
  })

  it('carries the meaning in the accent instead', () => {
    const accents = TOAST_LEVELS.map((l) => toastTheme(l).accent)
    expect(new Set(accents).size).toBe(TOAST_LEVELS.length)
  })

  it('reserves amber for an actual warning', () => {
    expect(toastTheme('warn').accent).toBe('#f0c040')
    expect(toastTheme('info').accent).not.toBe('#f0c040')
    expect(toastTheme('ok').accent).not.toBe('#f0c040')
  })

  it('falls back to info for anything it does not know', () => {
    expect(toastTheme('nonsense')).toEqual(toastTheme('info'))
    expect(toastTheme(null)).toEqual(toastTheme('info'))
    expect(toastTheme(undefined)).toEqual(toastTheme('info'))
  })

  it('is frozen, so a caller cannot restyle everyone else', () => {
    expect(Object.isFrozen(toastTheme('info'))).toBe(true)
  })

  it('shows a few at once rather than one overwriting the next', () => {
    expect(TOAST_MAX_STACK).toBeGreaterThan(1)
  })
})

describe('guessing a level from the words', () => {
  it('spots a real failure', () => {
    expect(inferLevel('Modify failed: timeout')).toBe('error')
    expect(inferLevel('Price unavailable — cannot place order')).toBe('error')
    expect(inferLevel('Live API not available')).toBe('info') // not one of the words; stays quiet
  })

  it('spots a real warning', () => {
    expect(inferLevel('Binance quota rising: fapi 62%')).toBe('warn')
    expect(inferLevel('Kill switch active — press RESET')).toBe('warn')
  })

  it('spots a plain confirmation', () => {
    expect(inferLevel('Alert settings saved')).toBe('ok')
    expect(inferLevel('Colors applied')).toBe('ok')
  })

  it('leaves ordinary messages alone — guessing loud is how everything became a warning', () => {
    expect(inferLevel('ZeuS Terminal: Test alert working!')).toBe('info')
    expect(inferLevel('BID WALL BTCUSDT 400 @ 67000')).toBe('info')
    expect(inferLevel('RSI OVERBOUGHT 5m RSI: 74.2')).toBe('info')
    expect(inferLevel('')).toBe('info')
    expect(inferLevel(null)).toBe('info')
    expect(inferLevel(42)).toBe('info')
  })

  it('does not fire on a word merely containing one of its triggers', () => {
    expect(inferLevel('Unsaved draft kept')).toBe('info')
    expect(inferLevel('Errorless run')).toBe('info')
  })
})

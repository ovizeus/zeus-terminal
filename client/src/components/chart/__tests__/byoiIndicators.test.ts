import { describe, it, expect } from 'vitest'
import { filterCustom, customTag, showChrome, showInvite, showCommunity } from '../byoiIndicators'
import type { CustomInd } from '../byoiIndicators'

const mine: CustomInd[] = [
  { id: 'ovi_wave', name: 'Ovi Wave', desc: 'turns on the turn', author: null, visibility: 'private' },
  { id: 'ovi_pub', name: 'Ovi Pulse', desc: 'crowd pressure', author: 'Ovi', visibility: 'public' },
]
const community: CustomInd[] = [
  { id: 'zeus_pulse', name: 'Zeus Pulse', desc: 'order flow', author: 'Ovi', visibility: 'public' },
]

describe('filterCustom', () => {
  it('returns everything for an empty query', () => {
    expect(filterCustom(mine, '')).toHaveLength(2)
    expect(filterCustom(mine, '   ')).toHaveLength(2)
  })
  it('matches the name, ignoring case', () => {
    expect(filterCustom(mine, 'OVI WAVE').map((c) => c.id)).toEqual(['ovi_wave'])
  })
  it('matches the description too', () => {
    expect(filterCustom(mine, 'crowd').map((c) => c.id)).toEqual(['ovi_pub'])
  })
  it('survives a missing list rather than throwing in the toolbar', () => {
    expect(filterCustom(null, 'x')).toEqual([])
    expect(filterCustom(undefined, '')).toEqual([])
  })
})

describe('customTag', () => {
  it('credits the author on a community row — that is why it is public', () => {
    expect(customTag(community[0], 'community')).toBe('by Ovi')
  })
  it('falls back to "public" when there is no credit', () => {
    expect(customTag({ ...community[0], author: null }, 'community')).toBe('public')
  })
  it('tells the owner whether their own is private or public', () => {
    expect(customTag(mine[0], 'mine')).toBe('private')
    expect(customTag(mine[1], 'mine')).toBe('public')
  })
})

describe('what the picker shows', () => {
  it('shows headers and the invitation when nobody is searching', () => {
    expect(showChrome('')).toBe(true)
    expect(showInvite([], '')).toBe(true)
  })
  it('stands the chrome down during a search — a result set is not a catalogue', () => {
    expect(showChrome('wave')).toBe(false)
    expect(showInvite([], 'wave')).toBe(false)
  })
  it('does not invite someone who already owns one', () => {
    expect(showInvite(mine, '')).toBe(false)
  })
  it('hides Community until something is published', () => {
    expect(showCommunity([], '')).toBe(false)
    expect(showCommunity(community, '')).toBe(true)
  })
  it('hides Community when the search excludes all of it', () => {
    expect(showCommunity(community, 'nothing matches this')).toBe(false)
  })
})

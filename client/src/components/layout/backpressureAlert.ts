/**
 * When to tell the user the server is refusing its own requests.
 *
 * [2026-11-08] The indicator alerted on ANY increase in the rejected counter,
 * every poll. That is fine for a one-off hiccup and awful during a sustained
 * Binance IP ban, where rejections climb on every single poll: one toast per
 * cycle, for as long as the ban lasts, all saying the same non-actionable
 * thing. He sent a screenshot of it.
 *
 * The lesson is the same one the circuit_open flood taught this morning —
 * 19 thousand lines a day of a true statement nobody could act on. Alert on
 * the TRANSITION into trouble, stay quiet while it lasts, and say so once
 * when it clears.
 */

export interface BackpressureState {
  /** Rejections seen at the last poll. */
  last: number
  /** True while we have already announced the current episode. */
  announced: boolean
  /** When the current episode was announced, for the reminder. */
  announcedAt: number
}

export function initialState(): BackpressureState {
  return { last: -1, announced: false, announcedAt: 0 }
}

/** How long before a still-ongoing episode is worth repeating once. */
export const REMIND_AFTER_MS = 10 * 60_000

export type Decision =
  | { kind: 'none' }
  | { kind: 'started'; delta: number }
  | { kind: 'ongoing'; delta: number }
  | { kind: 'cleared' }

/**
 * Decides what to say, and mutates the state. `total` is the cumulative
 * rejected count the server reports.
 */
export function onPoll(state: BackpressureState, total: number, now: number): Decision {
  const t = Number.isFinite(total) ? total : 0
  // First poll of a session seeds silently: backpressure that already existed
  // before the user opened the app is not news.
  if (state.last < 0) {
    state.last = t
    return { kind: 'none' }
  }
  const delta = t - state.last
  state.last = t

  if (delta > 0) {
    if (!state.announced) {
      state.announced = true
      state.announcedAt = now
      return { kind: 'started', delta }
    }
    // Still being refused. Say so once in a while, not every cycle.
    if (now - state.announcedAt >= REMIND_AFTER_MS) {
      state.announcedAt = now
      return { kind: 'ongoing', delta }
    }
    return { kind: 'none' }
  }

  // No new rejections: the episode is over.
  if (state.announced) {
    state.announced = false
    state.announcedAt = 0
    return { kind: 'cleared' }
  }
  return { kind: 'none' }
}

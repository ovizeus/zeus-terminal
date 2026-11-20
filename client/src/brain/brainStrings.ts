// ZeuS Brain v7 — texte si constante (port din [CONFIG], docs/design/zeus_brain_v7_reference.html).
// Tot textul vazut de utilizator e aici (pregatit pentru traducere). Engleza: regula UI.

export const STR = {
  idle: 'Tap anything to see what it means.',
  noTrades: 'No trades yet. Each entry is captured automatically.',
  viewAll: (n: number) => `View all trades (${n})`,
  allTitle: (n: number) => `ALL TRADES (${n})`,
  noReplay: 'Replay not stored for this trade (only the last 50 trades keep replay frames).',
  replayStart: (id: string | number) => `Replaying trade #${id} from ~12s before entry. Tap the mood strip to jump, tap the replay label to exit.`,
  replayEnd: 'Replay finished. Back to live.',
  back: 'Back to live.',
  shareReady: 'Share card ready below the journal: brain at entry, result, mood and @zeusterminal.',
  woke: 'Woke up: the market started moving again.',
  collecting: (n: number, m: number) => `collecting data · ${n}/${m} trades`,
  na: 'not available yet',
  dv: 'Déjà vu compares the current shape with the shape at every past entry and shows the closest matches with their results. It is a hint, not a signal: below ~100 trades the numbers are noisy.',
  tpl: 'Template is the gold dashed ghost on the radar: the entry shape of your best winning trade. Match shows how close the current shape is to it.',
  psych: 'Psych report groups your past trades by the mood right before entry and shows the win rate of each. Rows with fewer than 30 trades are marked low.',
  moodNote: 'The mood is display only, it never changes trading decisions.',
  shape: 'Main shape is the real-time lens. Thin line is timeframe, dashed is slow, white dotted is intent, gold dashed is your best trade template. Blur means low ML confidence; trembling means fast and slow disagree.',
  // ── Adaugate pentru productie (cerute de operator, 2026-11-16) ──
  // „Ce nu avem inca scrie coming soon / waiting."
  waiting: 'waiting',
  comingSoon: 'coming soon',
  mlComingSoon: 'ML confidence is coming soon: the engine does not publish an ML confidence yet, so the shape is drawn at a neutral clarity.',
  attComingSoon: 'coming soon',
  spreadUnknown: 'Spread: no real spread data yet, shown as unknown.',
  thrNote: 'Entry threshold = your AutoTrade minimum. The server can raise it by regime and drawdown, and the server\'s own score can differ from the cockpit confluence, so a full ring does not guarantee an entry.',
  noTpNote: 'Outer ring = 2R (no fixed TP).',
  includeDemo: 'include demo trades',
  noClosed: 'No closed live trades yet.',
  loadMore: 'Load more',
  share: 'Share',
  close: 'Close',
  longPress: 'Long-press the image to save or share',
}

export const S = 360
export const C = S / 2
export const R = 100
export const SEG = Math.PI * 2 / 7
export const AX = ['TREND', 'DELTA', 'FLOW', 'OI', 'VOL', 'FUND', 'VOLAT', 'IMB', 'MOM', 'SENT', 'STRUCT', 'LIQ']
export const N = AX.length
export const AXD = ['trend strength across timeframes', 'aggressive buy vs sell delta', 'order flow pressure', 'open interest change', 'volume vs average', 'funding rate bias', 'volatility regime', 'order book imbalance', 'momentum', 'market sentiment', 'market structure', 'liquidation pressure']
export const GN = ['RISK', 'SPREAD', 'COOL', 'VOLAT', 'SESS', 'NOOPP', 'REGIME']
export const GND = ['risk limits', 'spread and slippage', 'cooldown after last trade', 'volatility window', 'trading session', 'no opposite position open', 'regime stability']
export type Rgb = [number, number, number]
export type Mode = 'LONG' | 'SHORT' | 'SQUEEZE' | 'RANGE'
export const MODECOL: Record<Mode, Rgb> = { LONG: [57, 255, 106], SHORT: [255, 77, 109], SQUEEZE: [192, 139, 255], RANGE: [95, 212, 255] }
export type Mood = 'CALM' | 'ALERT' | 'NERVOUS' | 'CONFUSED' | 'HESITANT' | 'ATTACK' | 'FOCUSED' | 'CONFIDENT' | 'FEARFUL' | 'SLEEPING'
export const MC: Record<Mood, string> = { CALM: '#7fb8d6', ALERT: '#e6f56a', NERVOUS: '#ff9f6b', CONFUSED: '#c08bff', HESITANT: '#ffb347', ATTACK: '#ffffff', FOCUSED: '#9fe8ff', CONFIDENT: '#39ff6a', FEARFUL: '#ff4d6d', SLEEPING: '#5a6b85' }
export const MX: Record<Mood, string> = {
  CALM: 'nothing is building, the brain is relaxed',
  ALERT: 'confluence is close to the threshold, getting ready',
  NERVOUS: 'fast and slow lenses disagree, the market is jumpy',
  CONFUSED: 'the signals contradict each other, the brain cannot read this market',
  HESITANT: 'it wants to enter but a safety gate is blocking',
  ATTACK: 'signal confirmed, entering now',
  FOCUSED: 'in a position, managing it',
  CONFIDENT: 'the position is well in profit',
  FEARFUL: 'the position is close to the stop-loss',
  SLEEPING: 'the market is dead, the brain rests and renders slower to save battery',
}
export const PRE_MOODS: Mood[] = ['CALM', 'ALERT', 'NERVOUS', 'CONFUSED', 'HESITANT']
export const MIN_DEJAVU = 10
export const LOW_SAMPLE = 30
export const JOURNAL_SHOW = 4
export const REPLAY_KEEP = 50
export const REC_HZ = 4
export const PRE_SEC = 12
export const POST_SEC = 2
export const LS_KEY = 'zeus.brain.ui'
export const SAT_SLOT: Array<[number, number]> = [[40, 40], [S - 40, 40], [S - 40, S - 40]]
export const PAGE = 50

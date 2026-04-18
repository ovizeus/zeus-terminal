import { memo } from 'react'
import { useAresStore } from '../../../stores/aresStore'

/* [R28.2-G] Thought stream. Replaces imperative `thoughtInner.innerHTML = ...`
 * build and `thoughtInner.style.animation = ...` mutation in _aresRender.
 *
 * Composition: [cogLines, thoughtLines, cogLines, thoughtLines] — duplicated
 * so the CSS `aresThoughtScroll` animation can loop without visible seam.
 */
export const ThoughtStream = memo(function ThoughtStream() {
  const cogLines = useAresStore((s) => s.ui.cognitive.cogLines)
  const thoughts = useAresStore((s) => s.ui.thoughts)
  const coreColor = useAresStore((s) => s.ui.core.color)

  const combined = [...cogLines, ...thoughts, ...cogLines, ...thoughts]
  const animDur = Math.max(14, combined.length * 1.2)

  if (!combined.length) {
    return (
      <div id="ares-thought-inner">
        <div className="ares-thought-line new">{'\u203a ARES 1.0 \u2014 Neural Command Center online'}</div>
        <div className="ares-thought-line">{'\u203a AUTONOMOUS mode \u2014 managing positions independently'}</div>
        <div className="ares-thought-line">{'\u203a Awaiting market data...'}</div>
      </div>
    )
  }

  return (
    <div
      id="ares-thought-inner"
      style={{ animation: `aresThoughtScroll ${animDur}s linear infinite` }}
    >
      {combined.map((line, i) => {
        const isCog = i < cogLines.length
          || (i >= thoughts.length + cogLines.length && i < combined.length - thoughts.length)
        const ll = String(line).toLowerCase()
        const isAlert = ll.includes('alert') || ll.includes('recalib')
        const cls = 'ares-thought-line' + (i === 0 ? ' new' : isAlert ? ' alert' : isCog ? ' new' : '')
        return (
          <div key={i} className={cls}>
            <span style={{ color: coreColor + '66' }}>{'\u203a'}</span> {line}
          </div>
        )
      })}
    </div>
  )
})

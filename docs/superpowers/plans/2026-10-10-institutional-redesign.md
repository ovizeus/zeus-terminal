# Institutional Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Auto Trade and Manual Trade panels on a shared set of primitives with a hueless institutional theme, move the Auto Trade settings into a configuration drawer, and move Activity / Brain Vision / Brain Dashboard into THEIA — changing no trading logic.

**Architecture:** A new theme is defined as CSS custom properties inside one gate class, `.zi`, applied to exactly three component roots. Five prefixed primitives (`ZiPanel`, `ZiSection`, `ZiMetric`, `ZiTable`, `ZiRow`) own all shared presentation, so both trade panels are siblings by construction rather than by careful matching. Panel logic — every hook call and handler — is lifted across verbatim; only returned markup changes.

**Tech Stack:** React 18 + TypeScript, Zustand stores, Vitest + @testing-library/react, plain CSS custom properties. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-10-institutional-redesign-design.md`
**Mockup:** https://claude.ai/artifact/HGSwWUV2HmbC4RdPoqp9pB
**Revert:** `git checkout pre-institutional-redesign -- <path>`; copies in `/root/zeus-backups/pre-redesign-20261010-1640`

---

## Ground rules for every task

- Run client tests as the `zeus` user, never as root: `sudo -u zeus bash -c 'cd /opt/zeus-terminal/client && npx vitest run <path>'`. Root-owned artefacts in `client/` silently break the live process.
- **Do not run `pm2 reload`.** Tasks 1–4 are client-only. One reload happens in Task 5, at the very end.
- Never edit an icon. `client/src/constants/icons.ts` and `indicatorIcons.ts` are out of bounds.
- Never change a handler body, a store call, or a `useEffect`. If a task seems to require it, stop and ask.

## File structure

| Path | Responsibility | Task |
|---|---|---|
| `client/src/styles/institutional.css` | The `.zi` token block. The only place a colour is named. | 1 |
| `client/src/components/zi/ZiPanel.tsx` | Panel frame: state rail, title, optional action slot. | 1 |
| `client/src/components/zi/ZiSection.tsx` | Titled block with one hairline above. | 1 |
| `client/src/components/zi/ZiMetric.tsx` | One label/value row with tabular figures. | 1 |
| `client/src/components/zi/ZiTable.tsx` | `ZiTable` + `ZiRow`: the shared column template. | 1 |
| `client/src/components/zi/index.ts` | Barrel export. | 1 |
| `client/src/components/zi/__tests__/` | Primitive tests. | 1 |
| `client/src/components/dock/ManualTradePanel.tsx` | Rebuilt markup; logic untouched. | 2 |
| `client/src/components/dock/AutoTradePanel.tsx` | Rebuilt markup, emptied of settings. | 3 |
| `client/src/components/dock/AutoTradeConfigDrawer.tsx` | The four-tab settings drawer. | 3 |
| `client/src/components/intel/theia/ActivityCard.tsx` | Activity log as a THEIA card. | 4 |
| `client/src/components/intel/theia/BrainVisionCard.tsx` | Brain Vision as a THEIA card. | 4 |
| `client/src/components/intel/theia/BrainDashboardCard.tsx` | Brain Dashboard as a THEIA card. | 4 |
| `client/src/components/intel/TheiaPage.tsx` | Three labelled lanes. | 4 |
| `client/src/core/bootstrapBrainDash.ts` | Deleted if proven unreferenced. | 4 |

---

## Task 1: The token layer and the five primitives

Touches no existing panel. Fully additive and safe to ship alone.

**Files:**
- Create: `client/src/styles/institutional.css`
- Create: `client/src/components/zi/ZiPanel.tsx`, `ZiSection.tsx`, `ZiMetric.tsx`, `ZiTable.tsx`, `index.ts`
- Create: `client/src/components/zi/__tests__/ZiMetric.test.tsx`, `ZiTable.test.tsx`, `ZiPanel.test.tsx`
- Modify: `client/src/App.tsx:23` (add one import line after `import './app.css'`)

- [ ] **Step 1: Write the failing test for `ZiMetric`**

Create `client/src/components/zi/__tests__/ZiMetric.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ZiMetric } from '../ZiMetric'

describe('ZiMetric', () => {
  it('renders the label and the value', () => {
    render(<ZiMetric label="Exposure" value="$1,240.00" />)
    expect(screen.getByText('Exposure')).toBeTruthy()
    expect(screen.getByText('$1,240.00')).toBeTruthy()
  })

  it('sets tabular figures on the value, so a ticking price cannot shift the column', () => {
    // This is the single most load-bearing style in the whole redesign. If it
    // is ever lost, every number column in both panels starts jittering.
    render(<ZiMetric label="Balance" value="10,084.20" />)
    const el = screen.getByText('10,084.20')
    expect(el.style.fontVariantNumeric).toBe('tabular-nums')
  })

  it('colours the value by tone, and leaves it neutral by default', () => {
    const { rerender } = render(<ZiMetric label="Today" value="+$84.20" tone="pos" />)
    expect(screen.getByText('+$84.20').style.color).toBe('var(--zi-pos)')
    rerender(<ZiMetric label="Today" value="-$12.00" tone="neg" />)
    expect(screen.getByText('-$12.00').style.color).toBe('var(--zi-neg)')
    rerender(<ZiMetric label="Today" value="0.00" />)
    expect(screen.getByText('0.00').style.color).toBe('var(--zi-val)')
  })

  it('renders a secondary note next to the value when given one', () => {
    render(<ZiMetric label="Today" value="+$84.20" secondary="3W · 1L" />)
    expect(screen.getByText('3W · 1L')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `sudo -u zeus bash -c 'cd /opt/zeus-terminal/client && npx vitest run src/components/zi/__tests__/ZiMetric.test.tsx'`
Expected: FAIL — `Failed to resolve import "../ZiMetric"`.

- [ ] **Step 3: Write the token stylesheet**

Create `client/src/styles/institutional.css`:

```css
/* Zeus — the institutional theme, 2026-10-10.
 *
 * Every colour in the redesign is named here and nowhere else. The whole look
 * is gated behind the single class `.zi`, which sits on exactly three roots:
 * the Auto Trade panel, the Manual Trade panel and the THEIA page. Removing it
 * from those three places restores the previous appearance without touching
 * anything else — that is the agreed way back if the result is not wanted.
 *
 * Contrast was checked against --zi-card: label 5.5:1, muted 5:1, pos 6.6:1,
 * neg 4.6:1, warn 6.5:1. --zi-faint is for hairlines and non-essential text
 * only. Positive and negative differ in lightness as well as hue, and the sign
 * is always rendered, so nothing depends on colour alone.
 *
 * Note on type: the app-wide --ff is 'Share Tech Mono', i.e. labels are set in
 * a monospace face everywhere. That is the main reason the old panels did not
 * read as institutional. The pairing below is scoped to .zi on purpose and must
 * never be promoted to :root.
 */
.zi {
  --zi-bg: #0a0e14;
  --zi-card: #111821;
  --zi-line: #1c2733;
  --zi-hair: #141c26;
  --zi-field: #0d141c;
  --zi-raise: #16202b;
  --zi-edge: #27343f;

  --zi-val: #e4ecf4;
  --zi-lbl: #8a9bb0;
  --zi-mut: #7c8ea4;
  --zi-faint: #5f7186;

  --zi-pos: #2bb673;
  --zi-neg: #d94f5c;
  --zi-warn: #c89b3c;

  --zi-sans: 'IBM Plex Sans', system-ui, -apple-system, sans-serif;
  --zi-mono: 'IBM Plex Mono', ui-monospace, 'SFMono-Regular', monospace;

  background: var(--zi-bg);
  color: var(--zi-val);
  font-family: var(--zi-sans);
}

.zi-lbl {
  font-size: 9px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--zi-lbl);
  font-weight: 500;
}

.zi-num {
  font-family: var(--zi-mono);
  font-variant-numeric: tabular-nums;
}

.zi-rule { height: 1px; background: var(--zi-line); }
```

- [ ] **Step 4: Load the fonts and the stylesheet**

Modify `client/src/App.tsx`. After line 23 (`import './app.css'`) add:

```tsx
import './styles/institutional.css'
```

Then add the font link to `public/app/index.html` inside `<head>` (find the existing
`<link rel="stylesheet"` block and put this immediately after it):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
```

If `public/app/index.html` does not contain a `<head>` (it is generated), instead add the
same three lines to `client/index.html`. Verify with `grep -n "IBM+Plex" client/index.html public/app/index.html`.

- [ ] **Step 5: Write `ZiMetric`**

Create `client/src/components/zi/ZiMetric.tsx`:

```tsx
import type { ReactNode } from 'react'

export type ZiTone = 'neutral' | 'pos' | 'neg' | 'warn'

const TONE_VAR: Record<ZiTone, string> = {
  neutral: 'var(--zi-val)',
  pos: 'var(--zi-pos)',
  neg: 'var(--zi-neg)',
  warn: 'var(--zi-warn)',
}

export interface ZiMetricProps {
  label: string
  value: ReactNode
  /** Colour is information, never decoration — see styles/institutional.css. */
  tone?: ZiTone
  /** A quieter note shown after the value, e.g. "3W · 1L". */
  secondary?: ReactNode
}

/**
 * One label/value row.
 *
 * `tabular-nums` lives here and in ZiRow and nowhere else, so the property
 * that stops a ticking price from shifting its column cannot be lost by
 * editing a panel later.
 */
export function ZiMetric({ label, value, tone = 'neutral', secondary }: ZiMetricProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'baseline', gap: 12 }}>
      <span className="zi-lbl">{label}</span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span
          className="zi-num"
          style={{ fontSize: 14, color: TONE_VAR[tone], fontVariantNumeric: 'tabular-nums' }}
        >
          {value}
        </span>
        {secondary != null && (
          <span className="zi-num" style={{ fontSize: 12, color: 'var(--zi-mut)' }}>{secondary}</span>
        )}
      </span>
    </div>
  )
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `sudo -u zeus bash -c 'cd /opt/zeus-terminal/client && npx vitest run src/components/zi/__tests__/ZiMetric.test.tsx'`
Expected: PASS, 4 tests.

- [ ] **Step 7: Write the failing test for `ZiTable` / `ZiRow`**

Create `client/src/components/zi/__tests__/ZiTable.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ZiTable, ZiRow, POSITION_COLUMNS } from '../ZiTable'

describe('ZiTable', () => {
  it('renders one header cell per column', () => {
    render(<ZiTable columns={POSITION_COLUMNS}><ZiRow columns={POSITION_COLUMNS} cells={['BTCUSDT', 'LONG', '$200', '+1.0%']} /></ZiTable>)
    for (const c of POSITION_COLUMNS) expect(screen.getByText(c.label)).toBeTruthy()
  })

  it('gives the header and every row the SAME column template', () => {
    // This is what makes Auto Trade and Manual Trade siblings. If the two
    // panels ever hold their own templates again, they drift apart silently.
    const { container } = render(
      <ZiTable columns={POSITION_COLUMNS}>
        <ZiRow columns={POSITION_COLUMNS} cells={['BTCUSDT', 'LONG', '$200', '+1.0%']} />
      </ZiTable>,
    )
    const grids = Array.from(container.querySelectorAll<HTMLElement>('[data-zi-grid]'))
    expect(grids.length).toBe(2)
    expect(grids[0].style.gridTemplateColumns).toBe(grids[1].style.gridTemplateColumns)
  })

  it('puts tabular figures on row cells so a long symbol cannot shift the P&L column', () => {
    render(<ZiTable columns={POSITION_COLUMNS}><ZiRow columns={POSITION_COLUMNS} cells={['AVAXUSDT', 'SHORT', '$1,000', '-12.5%']} /></ZiTable>)
    expect(screen.getByText('-12.5%').style.fontVariantNumeric).toBe('tabular-nums')
  })

  it('applies a per-cell tone when one is given', () => {
    render(
      <ZiTable columns={POSITION_COLUMNS}>
        <ZiRow columns={POSITION_COLUMNS} cells={['BTCUSDT', 'LONG', '$200', '+1.0%']} tones={[undefined, 'pos', undefined, 'pos']} />
      </ZiTable>,
    )
    expect(screen.getByText('+1.0%').style.color).toBe('var(--zi-pos)')
  })
})
```

- [ ] **Step 8: Run it to make sure it fails**

Run: `sudo -u zeus bash -c 'cd /opt/zeus-terminal/client && npx vitest run src/components/zi/__tests__/ZiTable.test.tsx'`
Expected: FAIL — `Failed to resolve import "../ZiTable"`.

- [ ] **Step 9: Write `ZiTable` and `ZiRow`**

Create `client/src/components/zi/ZiTable.tsx`:

```tsx
import type { ReactNode } from 'react'
import type { ZiTone } from './ZiMetric'

export interface ZiColumn {
  label: string
  /** CSS grid track, e.g. '1fr' or '62px'. */
  width: string
  align?: 'left' | 'right'
}

/**
 * The one position/journal column template, shared by Auto Trade and Manual
 * Trade. Defined once so the two panels cannot drift apart — which is the whole
 * point of "auto trade should read like manual trade".
 */
export const POSITION_COLUMNS: ZiColumn[] = [
  { label: 'Symbol', width: '1fr' },
  { label: 'Side', width: '42px' },
  { label: 'Size', width: '62px', align: 'right' },
  { label: 'P&L', width: '72px', align: 'right' },
]

export const JOURNAL_COLUMNS: ZiColumn[] = [
  { label: 'Time', width: '46px' },
  { label: 'Symbol', width: '1fr' },
  { label: 'P&L', width: '56px', align: 'right' },
]

const TONE_VAR: Record<ZiTone, string> = {
  neutral: 'var(--zi-val)',
  pos: 'var(--zi-pos)',
  neg: 'var(--zi-neg)',
  warn: 'var(--zi-warn)',
}

function template(columns: ZiColumn[]): string {
  return columns.map((c) => c.width).join(' ')
}

export function ZiTable({ columns, children }: { columns: ZiColumn[]; children?: ReactNode }) {
  return (
    <div>
      <div
        data-zi-grid=""
        style={{ display: 'grid', gridTemplateColumns: template(columns), gap: 8, paddingBottom: 7 }}
      >
        {columns.map((c) => (
          <span key={c.label} className="zi-lbl" style={{ textAlign: c.align ?? 'left' }}>{c.label}</span>
        ))}
      </div>
      {children}
    </div>
  )
}

export function ZiRow({
  columns,
  cells,
  tones,
}: {
  columns: ZiColumn[]
  cells: ReactNode[]
  tones?: (ZiTone | undefined)[]
}) {
  return (
    <div
      data-zi-grid=""
      style={{
        display: 'grid',
        gridTemplateColumns: template(columns),
        gap: 8,
        padding: '7px 0',
        borderTop: '1px solid var(--zi-hair)',
        alignItems: 'baseline',
      }}
    >
      {cells.map((cell, i) => (
        <span
          key={i}
          className="zi-num"
          style={{
            fontSize: 12,
            color: TONE_VAR[tones?.[i] ?? 'neutral'],
            textAlign: columns[i]?.align ?? 'left',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {cell}
        </span>
      ))}
    </div>
  )
}
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `sudo -u zeus bash -c 'cd /opt/zeus-terminal/client && npx vitest run src/components/zi/__tests__/ZiTable.test.tsx'`
Expected: PASS, 4 tests.

- [ ] **Step 11: Write the failing test for `ZiPanel` and `ZiSection`**

Create `client/src/components/zi/__tests__/ZiPanel.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ZiPanel } from '../ZiPanel'
import { ZiSection } from '../ZiSection'

describe('ZiPanel', () => {
  it('carries the .zi gate class, so removing it reverts the look', () => {
    const { container } = render(<ZiPanel title="Auto Trade" rail="pos">body</ZiPanel>)
    expect(container.querySelector('.zi')).toBeTruthy()
  })

  it('colours the state rail from the rail prop', () => {
    const { container, rerender } = render(<ZiPanel title="Auto Trade" rail="pos">body</ZiPanel>)
    const rail = () => container.querySelector<HTMLElement>('[data-zi-rail]')!
    expect(rail().style.background).toBe('var(--zi-pos)')
    rerender(<ZiPanel title="Auto Trade" rail="neutral">body</ZiPanel>)
    expect(rail().style.background).toBe('var(--zi-mut)')
  })

  it('renders the action slot only when given one', () => {
    const { container, rerender } = render(<ZiPanel title="Auto Trade" rail="pos">body</ZiPanel>)
    expect(container.querySelector('[data-zi-action]')).toBeNull()
    rerender(<ZiPanel title="Auto Trade" rail="pos" action={<button type="button">gear</button>}>body</ZiPanel>)
    expect(screen.getByRole('button', { name: 'gear' })).toBeTruthy()
  })
})

describe('ZiSection', () => {
  it('renders its title and children', () => {
    render(<ZiSection title="Positions"><div>row</div></ZiSection>)
    expect(screen.getByText('Positions')).toBeTruthy()
    expect(screen.getByText('row')).toBeTruthy()
  })

  it('renders an aside when given one', () => {
    render(<ZiSection title="Positions" aside="3"><div>row</div></ZiSection>)
    expect(screen.getByText('3')).toBeTruthy()
  })
})
```

- [ ] **Step 12: Run it to make sure it fails**

Run: `sudo -u zeus bash -c 'cd /opt/zeus-terminal/client && npx vitest run src/components/zi/__tests__/ZiPanel.test.tsx'`
Expected: FAIL — `Failed to resolve import "../ZiPanel"`.

- [ ] **Step 13: Write `ZiPanel` and `ZiSection`**

Create `client/src/components/zi/ZiPanel.tsx`:

```tsx
import type { ReactNode } from 'react'

export type ZiRail = 'pos' | 'neutral' | 'neg'

const RAIL_VAR: Record<ZiRail, string> = {
  pos: 'var(--zi-pos)',
  neutral: 'var(--zi-mut)',
  neg: 'var(--zi-neg)',
}

/**
 * The panel frame. The 2px rail is the only colour in the title area: one pixel
 * of state instead of a coloured header.
 *
 * The `.zi` class here is the gate for the whole theme — see
 * styles/institutional.css.
 */
export function ZiPanel({
  title,
  rail,
  action,
  children,
}: {
  title: string
  rail: ZiRail
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="zi" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'stretch', height: 44, flexShrink: 0 }}>
        <div data-zi-rail="" style={{ width: 2, background: RAIL_VAR[rail] }} />
        <div style={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
          <span style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 600, color: 'var(--zi-val)' }}>
            {title}
          </span>
          {action != null && <span data-zi-action="">{action}</span>}
        </div>
      </div>
      <div className="zi-rule" />
      {children}
    </div>
  )
}
```

Create `client/src/components/zi/ZiSection.tsx`:

```tsx
import type { ReactNode } from 'react'

/**
 * A titled block. One hairline above and space around it — no box, no card, no
 * coloured left border. Removing the boxes is what takes most of the noise out
 * of the old panels.
 */
export function ZiSection({
  title,
  aside,
  children,
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <>
      <div className="zi-rule" />
      <div style={{ padding: '14px 16px 8px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span className="zi-lbl">{title}</span>
        {aside != null && <span className="zi-num zi-lbl" style={{ color: 'var(--zi-mut)' }}>{aside}</span>}
      </div>
      <div style={{ padding: '0 16px 16px' }}>{children}</div>
    </>
  )
}
```

Create `client/src/components/zi/index.ts`:

```ts
export { ZiMetric } from './ZiMetric'
export type { ZiTone, ZiMetricProps } from './ZiMetric'
export { ZiPanel } from './ZiPanel'
export type { ZiRail } from './ZiPanel'
export { ZiSection } from './ZiSection'
export { ZiTable, ZiRow, POSITION_COLUMNS, JOURNAL_COLUMNS } from './ZiTable'
export type { ZiColumn } from './ZiTable'
```

- [ ] **Step 14: Run the test to verify it passes**

Run: `sudo -u zeus bash -c 'cd /opt/zeus-terminal/client && npx vitest run src/components/zi/__tests__/ZiPanel.test.tsx'`
Expected: PASS, 5 tests.

- [ ] **Step 15: Prove the tests bite (mutation check)**

Temporarily delete the line `fontVariantNumeric: 'tabular-nums',` from `ZiMetric.tsx`, run
`sudo -u zeus bash -c 'cd /opt/zeus-terminal/client && npx vitest run src/components/zi'`,
and confirm the "tabular figures" test FAILS. Then restore the line and confirm it passes
again. A test that cannot fail is not protecting anything.

- [ ] **Step 16: Run the whole suite and the typechecker**

Run: `sudo -u zeus bash -c 'cd /opt/zeus-terminal/client && npx tsc --noEmit -p tsconfig.json && npx vitest run'`
Expected: tsc exit 0; 773 tests passing (760 before + 13 new).

- [ ] **Step 17: Commit**

```bash
cd /opt/zeus-terminal
git add client/src/styles/institutional.css client/src/components/zi client/src/App.tsx client/index.html public/app/index.html
git commit -m "feat(zi): the institutional token layer and five shared primitives

Additive only - no existing panel is touched yet.

The whole theme is gated behind one class, .zi, so removing it from three
roots restores the previous look. tabular-nums lives in exactly two files
(ZiMetric, ZiRow), so the property that stops a ticking price from shifting
its column cannot be lost by editing a panel later. POSITION_COLUMNS is
defined once, which is what will make Auto Trade and Manual Trade siblings
by construction rather than by careful matching.

Checked before naming: Metric, Section, DataTable and DataRow are all unused
today, but PanelShell already exists in components/layout, so all five take
the Zi prefix - which also makes the new layer greppable and removable as
one unit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Manual Trade rebuilt

The reference shape. Done before Auto Trade because it is the simpler file and everything
else is measured against it.

**Files:**
- Modify: `client/src/components/dock/ManualTradePanel.tsx` (447 lines; markup only)
- Create: `client/src/components/dock/__tests__/ManualTradePanelZi.test.tsx`

- [ ] **Step 1: Record the logic that must survive**

Read `client/src/components/dock/ManualTradePanel.tsx` in full and write the list of every
hook call and handler into a scratch file. There are **43 hook calls and 5 handlers**:
`handleOrdTypeChange`, `handleLevChange`, `handleCustomLevChange`, `handleSizeChange`, and a
generic `handler`. None of them may change. Only the `return (...)` block changes.

- [ ] **Step 2: Write the failing test**

Create `client/src/components/dock/__tests__/ManualTradePanelZi.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { ManualTradePanel } from '../ManualTradePanel'

// [2026-10-10] The institutional rebuild. These assertions are about the FRAME,
// not the content: the panel must be built on the shared primitives, because
// that is what keeps it and Auto Trade from drifting apart again.

beforeEach(() => {
  const w = window as unknown as Record<string, unknown>
  w.S = { symbol: 'BTCUSDT', overlays: {}, activeInds: {}, indicators: {} }
  w.TP = { demoOpen: false, liveOpen: false, demoPositions: [], livePositions: [], pendingOrders: [] }
})

describe('Manual Trade panel, rebuilt', () => {
  it('is gated behind the .zi theme class', () => {
    const { container } = render(<ManualTradePanel />)
    expect(container.querySelector('.zi')).toBeTruthy()
  })

  it('uses the SHARED position column template, not its own', () => {
    const { container } = render(<ManualTradePanel />)
    const grids = Array.from(container.querySelectorAll<HTMLElement>('[data-zi-grid]'))
    expect(grids.length).toBeGreaterThan(0)
    expect(grids.some((g) => g.style.gridTemplateColumns === '1fr 42px 62px 72px')).toBe(true)
  })

  it('still labels every input, so the order ticket stays usable', () => {
    const { container } = render(<ManualTradePanel />)
    const inputs = Array.from(container.querySelectorAll('input'))
    for (const input of inputs) {
      const id = input.getAttribute('id')
      if (!id) continue
      expect(container.querySelector(`label[for="${id}"]`)).toBeTruthy()
    }
  })
})
```

Note: if `render(<ManualTradePanel />)` throws because the component requires props or more
`window` globals, extend the `beforeEach` with exactly the globals the error names — never
change the component to suit the test.

- [ ] **Step 3: Run it to make sure it fails**

Run: `sudo -u zeus bash -c 'cd /opt/zeus-terminal/client && npx vitest run src/components/dock/__tests__/ManualTradePanelZi.test.tsx'`
Expected: FAIL on the `.zi` assertion — the panel does not carry the class yet.

- [ ] **Step 4: Replace the markup**

In `ManualTradePanel.tsx`, keep everything above the `return (` untouched. Replace the
returned JSX with the structure below, wiring each control to the **same** state variable and
the **same** handler it is bound to now. The order ticket keeps its existing `value`/`onChange`
pairs verbatim; only the wrapper markup and class names change.

```tsx
import { ZiPanel, ZiSection, ZiMetric, ZiTable, ZiRow, POSITION_COLUMNS, JOURNAL_COLUMNS } from '../zi'

// ... existing hooks and handlers unchanged ...

return (
  <ZiPanel
    title="Manual Trade"
    rail="neutral"
    action={<span className="zi-num zi-lbl" style={{ color: 'var(--zi-mut)' }}>{symbol}</span>}
  >
    {/* ORDER TICKET — every input keeps its existing value + onChange */}
    <div style={{ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* order type / margin segmented controls, size / leverage / notional,
          take profit / stop loss, then the two side buttons. Reuse the existing
          handlers: handleOrdTypeChange, handleLevChange, handleCustomLevChange,
          handleSizeChange. */}
    </div>

    <ZiSection title="Open positions" aside={String(openPositions.length)}>
      <ZiTable columns={POSITION_COLUMNS}>
        {openPositions.map((p) => (
          <ZiRow
            key={p.id ?? p.symbol}
            columns={POSITION_COLUMNS}
            cells={[p.symbol, p.side, p.sizeText, p.pnlText]}
            tones={[undefined, p.side === 'LONG' ? 'pos' : 'neg', undefined, p.pnlUp ? 'pos' : 'neg']}
          />
        ))}
      </ZiTable>
    </ZiSection>

    <ZiSection title="Today">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        <ZiMetric label="Realised" value={manualPnlText} tone={manualPnlUp ? 'pos' : 'neg'} secondary={manualWlText} />
        <ZiMetric label="Win rate" value={manualWr} />
        <ZiMetric label="Trades" value={manualTrades} />
      </div>
    </ZiSection>

    <ZiSection title="Journal">
      <ZiTable columns={JOURNAL_COLUMNS}>
        {journalRows.map((r, i) => (
          <ZiRow key={i} columns={JOURNAL_COLUMNS} cells={[r.time, r.symbol, r.pnlText]} tones={[undefined, undefined, r.up ? 'pos' : 'neg']} />
        ))}
      </ZiTable>
    </ZiSection>
  </ZiPanel>
)
```

Where a derived value above (`openPositions`, `manualPnlText`, `manualWlText`, `journalRows`)
does not already exist under that name, use the existing variable in the file and do not
introduce a new computation. If a value genuinely is not computed today, render `—` rather
than inventing one.

The order ticket's inner markup follows the mockup's Manual Trade artboard: two segmented
controls on one row, then a three-up row of Size / Leverage / Notional, then Take profit /
Stop loss, then the two side buttons. Use `.zi-lbl` for labels, `.zi-num` for numeric inputs,
`var(--zi-field)` for input backgrounds and `var(--zi-line)` for their borders.

- [ ] **Step 5: Run the test to verify it passes**

Run: `sudo -u zeus bash -c 'cd /opt/zeus-terminal/client && npx vitest run src/components/dock/__tests__/ManualTradePanelZi.test.tsx'`
Expected: PASS, 3 tests.

- [ ] **Step 6: Run the whole suite and the typechecker**

Run: `sudo -u zeus bash -c 'cd /opt/zeus-terminal/client && npx tsc --noEmit -p tsconfig.json && npx vitest run'`
Expected: tsc exit 0; every existing test still green. **If a pre-existing ManualTradePanel
test fails, that is a real regression in behaviour — fix the panel, not the test.**

- [ ] **Step 7: Commit**

```bash
cd /opt/zeus-terminal
git add client/src/components/dock/ManualTradePanel.tsx client/src/components/dock/__tests__/ManualTradePanelZi.test.tsx
git commit -m "feat(zi): Manual Trade rebuilt on the shared primitives

Markup only. All 43 hook calls and all 5 handlers are unchanged - the panel
subscribes to exactly the stores it did before and every input keeps the same
value and onChange it had.

Done first because it is the simpler of the two panels and it is the shape
Auto Trade is being measured against. It now draws its positions and journal
through POSITION_COLUMNS and JOURNAL_COLUMNS, so the two panels share one
column template instead of each holding its own.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Auto Trade rebuilt, and the configuration drawer

**Files:**
- Create: `client/src/components/dock/AutoTradeConfigDrawer.tsx`
- Create: `client/src/components/dock/__tests__/AutoTradeConfigDrawer.test.tsx`
- Create: `client/src/components/dock/__tests__/AutoTradePanelZi.test.tsx`
- Modify: `client/src/components/dock/AutoTradePanel.tsx`

- [ ] **Step 1: Write the drawer's failing test**

Create `client/src/components/dock/__tests__/AutoTradeConfigDrawer.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AutoTradeConfigDrawer } from '../AutoTradeConfigDrawer'

beforeEach(() => {
  const w = window as unknown as Record<string, unknown>
  w.S = { symbol: 'BTCUSDT', overlays: {}, activeInds: {}, indicators: {} }
})

describe('AutoTradeConfigDrawer', () => {
  it('renders nothing when not visible', () => {
    const { container } = render(<AutoTradeConfigDrawer visible={false} onClose={() => {}} />)
    expect(container.textContent).toBe('')
  })

  it('offers the four tabs', () => {
    render(<AutoTradeConfigDrawer visible onClose={() => {}} />)
    for (const t of ['Symbols', 'Entry', 'Risk', 'Advanced']) {
      expect(screen.getByRole('tab', { name: t })).toBeTruthy()
    }
  })

  it('shows one tab panel at a time and switches on click', () => {
    render(<AutoTradeConfigDrawer visible onClose={() => {}} />)
    const risk = screen.getByRole('tab', { name: 'Risk' })
    fireEvent.click(risk)
    expect(risk.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Entry' }).getAttribute('aria-selected')).toBe('false')
  })

  it('labels every input it renders', () => {
    const { container } = render(<AutoTradeConfigDrawer visible onClose={() => {}} />)
    for (const input of Array.from(container.querySelectorAll('input'))) {
      const id = input.getAttribute('id')
      if (!id) continue
      expect(container.querySelector(`label[for="${id}"]`)).toBeTruthy()
    }
  })

  it('marks the live-adaptive switch as the dangerous one', () => {
    render(<AutoTradeConfigDrawer visible onClose={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Advanced' }))
    const sw = screen.getByRole('switch', { name: /adaptive on live/i })
    expect(sw).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `sudo -u zeus bash -c 'cd /opt/zeus-terminal/client && npx vitest run src/components/dock/__tests__/AutoTradeConfigDrawer.test.tsx'`
Expected: FAIL — `Failed to resolve import "../AutoTradeConfigDrawer"`.

- [ ] **Step 3: Write the drawer**

Create `client/src/components/dock/AutoTradeConfigDrawer.tsx`. Build it on the existing
`ModalOverlay` / `ModalHeader` pair from `../modals/ModalOverlay` — the same shell every other
modal uses. Skeleton, with the four tab panels:

```tsx
import { useState } from 'react'
import { ModalOverlay, ModalHeader } from '../modals/ModalOverlay'

type Tab = 'symbols' | 'entry' | 'risk' | 'advanced'
const TABS: { id: Tab; label: string }[] = [
  { id: 'symbols', label: 'Symbols' },
  { id: 'entry', label: 'Entry' },
  { id: 'risk', label: 'Risk' },
  { id: 'advanced', label: 'Advanced' },
]

/**
 * [2026-10-10] Auto Trade's settings used to sit in the trade panel, which is
 * why that panel was 563 lines and carried three diagnostic surfaces as well.
 * The panel now shows live state only; everything you set lives here.
 *
 * Every control below is bound to the SAME store field and the SAME change
 * handler it was bound to in the panel. The controls were moved, not
 * reimplemented. AutoTradePanel.handleSaveAT is invoked from this drawer's Save.
 */
export function AutoTradeConfigDrawer({
  visible,
  onClose,
  onSave,
}: {
  visible: boolean
  onClose: () => void
  onSave?: () => void
}) {
  const [tab, setTab] = useState<Tab>('risk')
  if (!visible) return null
  return (
    <ModalOverlay id="matcfg" visible={visible} onClose={onClose} zIndex={9500}>
      <div className="zi">
        <ModalHeader title="AUTO TRADE · CONFIGURATION" onClose={onClose} />
        <div role="tablist" aria-label="Configuration sections" style={{ display: 'flex', gap: 22, padding: '14px 18px 0' }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              style={{
                background: 'none',
                border: 0,
                borderBottom: `1px solid ${tab === t.id ? 'var(--zi-val)' : 'transparent'}`,
                color: tab === t.id ? 'var(--zi-val)' : 'var(--zi-mut)',
                fontFamily: 'inherit',
                fontSize: 9,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                fontWeight: 600,
                padding: '0 2px 9px',
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="zi-rule" />
        {tab === 'symbols' && <div style={{ padding: 18 }}>{/* TRADING SYMBOLS, moved verbatim */}</div>}
        {tab === 'entry' && <div style={{ padding: 18 }}>{/* ENTRY CONDITIONS, moved verbatim */}</div>}
        {tab === 'risk' && <div style={{ padding: 18 }}>{/* RISK MANAGEMENT, moved verbatim */}</div>}
        {tab === 'advanced' && <div style={{ padding: 18 }}>{/* ADVANCED CONTROLS + GLOBAL MODE + LEVERAGE AUTO, moved verbatim */}</div>}
        <div className="zi-rule" />
        <div style={{ padding: '14px 18px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10, color: 'var(--zi-mut)', flexGrow: 1 }} />
          <button
            type="button"
            onClick={() => { onSave?.(); onClose() }}
            style={{ height: 32, padding: '0 18px', background: 'var(--zi-raise)', border: '1px solid var(--zi-edge)', borderRadius: 3, color: 'var(--zi-val)', fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 600, cursor: 'pointer' }}
          >
            Save
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}
```

Then fill each tab panel by **moving the corresponding JSX out of `AutoTradePanel.tsx`**:

| Tab | Move from `AutoTradePanel.tsx` | Source marker |
|---|---|---|
| Symbols | the TRADING SYMBOLS block | `<div className="at-cond-title">TRADING SYMBOLS</div>` |
| Entry | the ENTRY CONDITIONS block | `<div className="at-cond-title">ENTRY CONDITIONS (all must be OK)</div>` |
| Risk | the RISK MANAGEMENT block | `<div className="at-cond-title">RISK MANAGEMENT</div>` |
| Advanced | ADVANCED CONTROLS, plus the GLOBAL MODE and LEVERAGE AUTO rows | `<div className="at-cond-title">ADVANCED CONTROLS</div>`, `<div className="at-lbl">GLOBAL MODE</div>`, `<div className="at-lbl">LEVERAGE AUTO</div>` |

Move the JSX **with its existing `value`, `checked`, `onChange` and `id` attributes intact**.
Swap only the class names: `at-lbl` → `zi-lbl`, and inline hex colours → the `--zi-*` vars.
Any state or handler a moved control references must be passed into the drawer as a prop
rather than duplicated: extend the props interface as needed and pass from the panel.

- [ ] **Step 4: Run the drawer test to verify it passes**

Run: `sudo -u zeus bash -c 'cd /opt/zeus-terminal/client && npx vitest run src/components/dock/__tests__/AutoTradeConfigDrawer.test.tsx'`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the panel's failing guard test**

Create `client/src/components/dock/__tests__/AutoTradePanelZi.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { AutoTradePanel } from '../AutoTradePanel'

beforeEach(() => {
  const w = window as unknown as Record<string, unknown>
  w.S = { symbol: 'BTCUSDT', overlays: {}, activeInds: {}, indicators: {} }
  w.TP = { demoOpen: false, liveOpen: false, demoPositions: [], livePositions: [], pendingOrders: [] }
})

describe('Auto Trade panel, rebuilt', () => {
  it('is gated behind the .zi theme class', () => {
    const { container } = render(<AutoTradePanel />)
    expect(container.querySelector('.zi')).toBeTruthy()
  })

  it('uses the SHARED position column template, so it reads like Manual Trade', () => {
    const { container } = render(<AutoTradePanel />)
    const grids = Array.from(container.querySelectorAll<HTMLElement>('[data-zi-grid]'))
    expect(grids.some((g) => g.style.gridTemplateColumns === '1fr 42px 62px 72px')).toBe(true)
  })

  it('CONTAINS NO SETTINGS CONTROL — the thing that would silently regress', () => {
    // The whole point of the redesign: the panel shows live trade state, and
    // every setting lives in the drawer. Nothing stops a later edit from
    // dropping one control back in here, so this is the guard.
    const { container } = render(<AutoTradePanel />)
    expect(container.querySelectorAll('input[type="number"]').length).toBe(0)
    expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(0)
    expect(container.querySelectorAll('select').length).toBe(0)
    expect(container.textContent).not.toMatch(/ENTRY CONDITIONS|RISK MANAGEMENT|ADVANCED CONTROLS|TRADING SYMBOLS/i)
  })

  it('KEEPS the emergency stop in the panel, never behind the drawer', () => {
    const { container } = render(<AutoTradePanel />)
    expect(container.textContent).toMatch(/close all|emergency/i)
  })

  it('no longer hosts the diagnostics that moved to THEIA', () => {
    const { container } = render(<AutoTradePanel />)
    expect(container.querySelector('#brainVisionBody')).toBeNull()
    expect(container.querySelector('#brainDashBody')).toBeNull()
    expect(container.textContent).not.toMatch(/activity log/i)
  })
})
```

- [ ] **Step 6: Run it to make sure it fails**

Run: `sudo -u zeus bash -c 'cd /opt/zeus-terminal/client && npx vitest run src/components/dock/__tests__/AutoTradePanelZi.test.tsx'`
Expected: FAIL on several assertions — the panel still has the settings and the brain divs.

- [ ] **Step 7: Rebuild the panel**

Keep every hook call and all three handlers (`handleSaveAT`, `handleKill`, `handleToggle`)
exactly as they are. Replace the returned JSX with:

```tsx
import { useState } from 'react'
import { ZiPanel, ZiSection, ZiMetric, ZiTable, ZiRow, POSITION_COLUMNS } from '../zi'
import { AutoTradeConfigDrawer } from './AutoTradeConfigDrawer'

// ... existing hooks and handlers unchanged ...
const [cfgOpen, setCfgOpen] = useState(false)

return (
  <>
    <ZiPanel
      title="Auto Trade"
      rail={ui.enabled ? 'pos' : 'neutral'}
      action={
        <button
          type="button"
          aria-label="Open configuration"
          onClick={() => setCfgOpen(true)}
          style={{ background: 'none', border: '1px solid var(--zi-line)', borderRadius: 3, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer' }}
        >
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="var(--zi-lbl)" strokeWidth="1.2" aria-hidden="true">
            <circle cx="8" cy="8" r="2.2" />
            <path d="M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8M3.5 3.5l1.3 1.3M11.2 11.2l1.3 1.3M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3" />
          </svg>
        </button>
      }
    >
      {/* THE ONE TRUTH LINE */}
      <div style={{ padding: '14px 16px 16px', display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span className="zi-num" style={{ fontSize: 15, fontWeight: 600, letterSpacing: '0.04em', color: ui.enabled ? 'var(--zi-pos)' : 'var(--zi-mut)' }}>
          {ui.enabled ? 'ARMED' : 'IDLE'}
        </span>
        <span style={{ color: 'var(--zi-faint)', fontSize: 12 }}>/</span>
        <span className="zi-num" style={{ fontSize: 15, fontWeight: 500, letterSpacing: '0.04em' }}>{ui.modeText}</span>
        <span style={{ flexGrow: 1 }} />
        <span className="zi-lbl">{ui.cycleText}</span>
      </div>

      {/* METRICS — the four numbers that answer "am I safe right now" */}
      <div style={{ padding: '0 16px 18px', display: 'flex', flexDirection: 'column', gap: 11 }}>
        <ZiMetric label="Exposure" value={ui.exposureText} secondary={ui.posCountText} />
        <ZiMetric label="Today" value={ui.dailyLossText} tone={ui.dailyUp ? 'pos' : 'neg'} secondary={ui.wlText} />
        <ZiMetric label="Balance" value={ui.balanceText} />
        <ZiMetric label="Day limit" value={ui.dayLimitText} tone="neutral" />
      </div>

      <ZiSection title="Positions" aside={ui.totalTradesText}>
        <ZiTable columns={POSITION_COLUMNS}>
          {atPositions.map((p) => (
            <ZiRow
              key={p.id ?? p.symbol}
              columns={POSITION_COLUMNS}
              cells={[p.symbol, p.side, p.sizeText, p.pnlText]}
              tones={[undefined, p.side === 'LONG' ? 'pos' : 'neg', undefined, p.pnlUp ? 'pos' : 'neg']}
            />
          ))}
        </ZiTable>
      </ZiSection>

      <div style={{ flexGrow: 1 }} />
      <div className="zi-rule" />
      <div style={{ padding: '14px 16px 18px', display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={handleToggle}
          style={{ flexGrow: 1, height: 34, background: 'var(--zi-raise)', border: '1px solid var(--zi-edge)', borderRadius: 3, color: 'var(--zi-val)', fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 600, cursor: 'pointer' }}
        >
          {ui.enabled ? 'Disarm' : 'Arm'}
        </button>
        <button
          type="button"
          onClick={handleKill}
          style={{ flexGrow: 1, height: 34, background: 'none', border: '1px solid #4a2630', borderRadius: 3, color: 'var(--zi-neg)', fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 600, cursor: 'pointer' }}
        >
          Close all
        </button>
      </div>
    </ZiPanel>
    <AutoTradeConfigDrawer visible={cfgOpen} onClose={() => setCfgOpen(false)} onSave={handleSaveAT} />
  </>
)
```

Where a `ui.*` field above does not exist under that exact name, use the field the file
already computes (the existing code has `ui.balanceText`, `ui.totalTradesText`,
`ui.winRateText`, `ui.dailyLabel`, `ui.dailyLossText`, `ui.dailyLossColor`). Do not add a new
computation; if a value is genuinely not computed today, render `—`.

Delete from the panel: the ACTIVITY LOG block, the `#brainVisionWrap` block, the
`#brainDashWrap` block, the SAVE SETTINGS button (the drawer owns it now), and the
`brainVisionOpen` / `brainDashOpen` state with their persistence — Task 4 re-homes that
content.

- [ ] **Step 8: Run both tests to verify they pass**

Run: `sudo -u zeus bash -c 'cd /opt/zeus-terminal/client && npx vitest run src/components/dock/__tests__'`
Expected: PASS — the 5 Auto Trade assertions, the 5 drawer assertions, the 3 Manual Trade ones.

- [ ] **Step 9: Run the whole suite and the typechecker**

Run: `sudo -u zeus bash -c 'cd /opt/zeus-terminal/client && npx tsc --noEmit -p tsconfig.json && npx vitest run'`
Expected: tsc exit 0; all green. A failing pre-existing AutoTradePanel test is a real
regression — fix the panel.

- [ ] **Step 10: Commit**

```bash
cd /opt/zeus-terminal
git add client/src/components/dock/AutoTradePanel.tsx client/src/components/dock/AutoTradeConfigDrawer.tsx client/src/components/dock/__tests__
git commit -m "feat(zi): Auto Trade shows live state only, settings move to a drawer

The panel kept about thirty settings and three diagnostic surfaces, which is
why it was 563 lines. It now shows the state line, four metrics, the positions
table and two actions. Everything you set lives in a four-tab drawer behind the
gear; the controls were MOVED with their existing value, checked and onChange
attributes, not reimplemented.

handleSaveAT, handleKill and handleToggle keep their exact bodies. handleSaveAT
is now invoked from the drawer's Save.

The emergency stop deliberately stays in the panel and never goes behind the
drawer. A guard test asserts the panel body contains no number input, no
checkbox and no select, because nothing else would stop a later edit from
quietly putting a setting back.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: The three THEIA cards, and deleting the imperative brain code

**Files:**
- Create: `client/src/components/intel/theia/ActivityCard.tsx`, `BrainVisionCard.tsx`, `BrainDashboardCard.tsx`
- Create: `client/src/components/intel/theia/__tests__/operationsCards.test.tsx`
- Modify: `client/src/components/intel/TheiaPage.tsx`
- Delete (conditionally): `client/src/core/bootstrapBrainDash.ts`

- [ ] **Step 1: Write the failing test**

Create `client/src/components/intel/theia/__tests__/operationsCards.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActivityCard } from '../ActivityCard'
import { BrainVisionCard } from '../BrainVisionCard'
import { BrainDashboardCard } from '../BrainDashboardCard'
import { useBrainStore } from '../../../../stores/brainStore'

// [2026-10-10] Brain Vision and Brain Dashboard were never React components:
// bootstrapBrainDash.ts polled and wrote innerHTML into two fixed DOM ids. Their
// data already came from these stores, so they become real cards here.
//
// The rule they inherit from THEIA: real data only. A value that is genuinely
// unavailable renders as an em dash, never as an invented number.

beforeEach(() => {
  useBrainStore.setState({ thoughts: [], brainState: '' } as never)
})

describe('the three cards that moved out of Auto Trade', () => {
  it('BrainVisionCard renders from an empty store without throwing', () => {
    expect(() => render(<BrainVisionCard />)).not.toThrow()
  })

  it('BrainVisionCard shows an em dash rather than a fabricated value', () => {
    const { container } = render(<BrainVisionCard />)
    expect(container.textContent).toContain('—')
  })

  it('BrainDashboardCard renders from an empty store without throwing', () => {
    expect(() => render(<BrainDashboardCard />)).not.toThrow()
  })

  it('ActivityCard renders its title with no entries', () => {
    render(<ActivityCard />)
    expect(screen.getByText(/activity/i)).toBeTruthy()
  })

  it('BrainVisionCard reflects a real store value when there is one', () => {
    useBrainStore.setState({ brainState: 'scanning', thoughts: ['range holding'] } as never)
    const { container } = render(<BrainVisionCard />)
    expect(container.textContent?.toLowerCase()).toContain('scanning')
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `sudo -u zeus bash -c 'cd /opt/zeus-terminal/client && npx vitest run src/components/intel/theia/__tests__/operationsCards.test.tsx'`
Expected: FAIL — `Failed to resolve import "../ActivityCard"`.

- [ ] **Step 3: Read the source of truth before writing the cards**

Read `client/src/core/bootstrapBrainDash.ts` in full. For each value the two IIFEs render,
note the exact store field it reads (`useBrainStore.getState().brain`, `.brainState`,
`.thoughts`, `.adaptParams`, `.blockReason`; `useATStore.getState().enabled`, `.killTriggered`,
`.totalTrades`, `.wins`). The cards must read the **same fields**, so the content is identical
and only the rendering changes. Write that mapping into the card files as comments.

- [ ] **Step 4: Write the three cards**

Each card follows the existing THEIA card pattern — read
`client/src/components/intel/theia/BrainPulseCard.tsx` first and match its structure, its
`.card`-equivalent styling and its null handling. Render every value through `ZiMetric` where
it is a label/value pair. Example shape for `BrainVisionCard.tsx`:

```tsx
import { useBrainStore } from '../../../stores/brainStore'
import { ZiMetric } from '../../zi'

const DASH = '—'

/**
 * [2026-10-10] Was `#brainVisionBody`, an empty div filled with innerHTML by
 * one of the two polling IIFEs in core/bootstrapBrainDash.ts. Same store, same
 * fields, same values — only the rendering is different.
 *
 * Fields read, matching the old renderer exactly:
 *   brainState, thoughts, adaptParams, blockReason  (useBrainStore)
 */
export function BrainVisionCard() {
  const brainState = useBrainStore((s) => s.brainState)
  const thoughts = useBrainStore((s) => s.thoughts)
  const blockReason = useBrainStore((s) => s.blockReason)
  return (
    <div className="theia-card">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span className="zi-lbl">Brain vision</span>
      </div>
      <ZiMetric label="State" value={brainState || DASH} />
      <ZiMetric label="Blocked by" value={blockReason ? String(blockReason) : DASH} tone={blockReason ? 'warn' : 'neutral'} />
      <div style={{ borderTop: '1px solid var(--zi-hair)', paddingTop: 10 }}>
        <div className="zi-lbl" style={{ color: 'var(--zi-mut)', marginBottom: 7 }}>Last thoughts</div>
        {(thoughts && thoughts.length > 0 ? thoughts : [DASH]).slice(0, 3).map((t, i) => (
          <div key={i} className="zi-num" style={{ fontSize: 11, color: 'var(--zi-lbl)', padding: '2px 0' }}>
            {typeof t === 'string' ? t : DASH}
          </div>
        ))}
      </div>
    </div>
  )
}
```

`BrainDashboardCard.tsx` renders the per-axis bars from the same axis values the old renderer
used. `ActivityCard.tsx` renders the log entries from the same source the Auto Trade panel's
`ui.logEntries` came from — find that source in `AutoTradePanel.tsx`'s hooks and read it
directly rather than threading it through props.

- [ ] **Step 5: Run the test to verify it passes**

Run: `sudo -u zeus bash -c 'cd /opt/zeus-terminal/client && npx vitest run src/components/intel/theia/__tests__/operationsCards.test.tsx'`
Expected: PASS, 5 tests.

- [ ] **Step 6: Add the lanes to THEIA**

Modify `client/src/components/intel/TheiaPage.tsx`: add `className="zi"` to the
`.theia-page` root, keep `VerdictBand` above everything, and group the cards into three
labelled lanes. Replace the single `.theia-grid` with:

```tsx
<div className="theia-page zi">
  <VerdictBand circuitOpen={ep.circuitOpen} halted={null} parityPct={ep.parityPct} testnetPnlTrend={pnlTrend} />

  <div className="zi-lbl" style={{ letterSpacing: '0.2em', color: 'var(--zi-faint)', marginTop: 18 }}>State</div>
  <div className="theia-grid">
    <SinceCard />
    <BrainPulseCard />
    <EnginePositionsCard />
    <SafetyHealthCard ratePressurePct={ep.ratePressurePct} circuitOpen={ep.circuitOpen} />
    <MarketLensCard />
  </div>

  <div className="zi-lbl" style={{ letterSpacing: '0.2em', color: 'var(--zi-faint)', marginTop: 18 }}>Operations</div>
  <div className="theia-grid">
    <ActivityCard />
    <BrainVisionCard />
    <BrainDashboardCard />
  </div>

  <div className="zi-lbl" style={{ letterSpacing: '0.2em', color: 'var(--zi-faint)', marginTop: 18 }}>Record</div>
  <div className="theia-grid">
    <MlDigestCard />
    <MemorySection />
    <RecentDecisionsCard />
  </div>
</div>
```

Add the three new imports at the top alongside the existing card imports.

- [ ] **Step 7: Prove `bootstrapBrainDash.ts` is unreferenced, then delete it**

Run: `grep -rn "bootstrapBrainDash" /opt/zeus-terminal/client/src /opt/zeus-terminal/public --include=*.ts --include=*.tsx --include=*.html | grep -v node_modules`

- If the only hits are the file itself and its own import of the stores, delete it:
  `git rm client/src/core/bootstrapBrainDash.ts`
- If anything else imports it, **do not delete it.** Leave it, remove only the two IIFEs' DOM
  writes, and note in the commit message why the file stayed.

Then confirm nothing still looks for the old DOM ids:
`grep -rn "brainVisionBody\|brainDashBody\|brainVisionWrap\|brainDashWrap" client/src | grep -v __tests__`
Expected: no output.

- [ ] **Step 8: Run the whole suite and the typechecker**

Run: `sudo -u zeus bash -c 'cd /opt/zeus-terminal/client && npx tsc --noEmit -p tsconfig.json && npx vitest run'`
Expected: tsc exit 0; all green.

- [ ] **Step 9: Commit**

```bash
cd /opt/zeus-terminal
git add -A client/src/components/intel client/src/core
git commit -m "feat(zi): Activity, Brain Vision and Brain Dashboard become THEIA cards

They were never React components. bootstrapBrainDash.ts held two polling IIFEs
that built HTML strings and wrote them into #brainVisionBody and #brainDashBody,
two empty divs in the Auto Trade panel. Their data already came from
useBrainStore and useATStore, so the conversion reads the same fields and
renders the same values - only the rendering changed.

THEIA now has three labelled lanes instead of one flat grid: State, Operations
and Record. The three that moved sit together in Operations, because that is
what they are: operational diagnostics.

The cards inherit THEIA's rule that a genuinely unavailable value renders as an
em dash and is never invented, with tests that render them against an empty
store.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Theme containment, build, and the single deploy

**Files:**
- Create: `client/src/components/zi/__tests__/themeContainment.test.ts`
- Modify: `server/version.js`

- [ ] **Step 1: Write the containment test**

Create `client/src/components/zi/__tests__/themeContainment.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// [2026-10-10] The theme is scoped to three surfaces on purpose. The operator
// asked for the three only, and the rest of the app still uses the old tokens
// (app.css :root, --ff: 'Share Tech Mono'). If a --zi-* variable starts
// appearing in a fourth place, the theme has leaked and the app will look
// half-converted. Extending it later is a deliberate act, not an accident.

const SRC = path.join(__dirname, '..', '..', '..')

const ALLOWED = [
  'components/zi/',
  'components/dock/AutoTradePanel.tsx',
  'components/dock/AutoTradeConfigDrawer.tsx',
  'components/dock/ManualTradePanel.tsx',
  'components/intel/TheiaPage.tsx',
  'components/intel/theia/',
  'styles/institutional.css',
]

function walk(dir: string, hit: (p: string) => void): void {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) { walk(p, hit); continue }
    if (/\.(tsx?|css)$/.test(name)) hit(p)
  }
}

describe('the institutional theme stays inside its three surfaces', () => {
  it('no file outside the agreed list references a --zi-* token', () => {
    const offenders: string[] = []
    walk(SRC, (p) => {
      const rel = path.relative(SRC, p).split(path.sep).join('/')
      if (rel.includes('__tests__')) return
      if (ALLOWED.some((a) => rel.startsWith(a))) return
      if (/--zi-/.test(fs.readFileSync(p, 'utf8'))) offenders.push(rel)
    })
    expect(offenders).toEqual([])
  })

  it('the theme never reaches :root, which would restyle the whole app', () => {
    const css = fs.readFileSync(path.join(SRC, 'styles', 'institutional.css'), 'utf8')
    expect(css).not.toMatch(/:root/)
  })
})
```

- [ ] **Step 2: Run it**

Run: `sudo -u zeus bash -c 'cd /opt/zeus-terminal/client && npx vitest run src/components/zi/__tests__/themeContainment.test.ts'`
Expected: PASS, 2 tests. If it fails, a `--zi-*` token leaked — move the usage back inside the
three surfaces rather than widening `ALLOWED`.

- [ ] **Step 3: Full verification**

Run: `sudo -u zeus bash -c 'cd /opt/zeus-terminal/client && npx tsc --noEmit -p tsconfig.json && npx vitest run'`
Expected: tsc exit 0; all tests green.

Run: `sudo -u zeus bash -c 'cd /opt/zeus-terminal && npx jest --forceExit --runInBand tests/unit/server/routes/ tests/unit/settingsValidatorParity.test.js'`
Expected: 20 passed. (No server file changed, but confirm nothing drifted.)

- [ ] **Step 4: Check the Binance state BEFORE touching pm2**

Run: `sqlite3 /opt/zeus-terminal/data/zeus.db "SELECT banned_until, ban_reason FROM binance_rate_state WHERE scope='global';"`

If `banned_until` is in the future, **stop and wait.** Do not build or reload during a ban.

- [ ] **Step 5: Bump the version**

Modify `server/version.js`: `version` → `'1.7.244'`, `build` → `270`, and prepend one
changelog entry to the `changelog` array. **The changelog contains no apostrophes** — the file
is single-quoted JS and an apostrophe breaks it. Validate before going further:

Run: `node -e "const v=require('/opt/zeus-terminal/server/version.js');console.log(v.version,v.build)"`
Expected: `1.7.244 270`

- [ ] **Step 6: Build the client**

Run: `sudo -u zeus bash -c 'cd /opt/zeus-terminal/client && npm run build'`
Expected: `✓ built in …`

If the build fails with `EACCES` on `public/app/assets`, the directory is root-owned from an
earlier root-run build. Fix it: `chown -R zeus:zeus /opt/zeus-terminal/public/app`, then build
again.

- [ ] **Step 7: One reload, the only one in this plan**

Run: `sudo -u zeus pm2 reload zeus --update-env`

Wait 20 seconds, then:
- `sudo -u zeus pm2 jlist | python3 -c "import json,sys;[print(p['name'],p['pm2_env']['status']) for p in json.load(sys.stdin)]"` → `zeus online`
- `curl -s -o /dev/null -w "%{http_code}\n" -k https://localhost/` → `302`
- Binance calls return synthetic 503s for the first **120 seconds** after a restart
  (`BOOT_BLIND_MS`, assumed pressure 85%). That is normal. Only conclude something is wrong if
  it persists past two minutes, and check `binance_rate_state` before blaming the code.

- [ ] **Step 8: Verify what actually shipped**

Run: `grep -c "zi-num\|--zi-" /opt/zeus-terminal/public/app/assets/index-*.js`
Expected: a non-zero count — the theme is in the bundle.

Run: `grep -c "brainVisionBody" /opt/zeus-terminal/public/app/assets/index-*.js`
Expected: `0` — the imperative brain code is gone from the shipped bundle.

- [ ] **Step 9: Commit and close the Book entry**

```bash
cd /opt/zeus-terminal
git add client/src/components/zi/__tests__/themeContainment.test.ts server/version.js
git commit -m "feat(zi): theme containment test, b270 v1.7.244

A test asserts no file outside the three agreed surfaces references a --zi-*
token, and that the theme never reaches :root. The rest of the app still uses
app.css tokens and Share Tech Mono; extending the theme to a fourth panel
should be a deliberate act, not an accident.

One reload for the whole redesign, at the end. Eight reloads on 2026-10-10
earned a Binance 418 IP ban.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Then update `docs/BOOK_OF_ALL.md`: mark the redesign section resolved, naming the build, the
test counts, and the revert path. Commit that separately.

- [ ] **Step 10: Hand back for visual confirmation**

The operator must look at all three surfaces in the live app. List explicitly what to check:
Auto Trade shows no settings; the gear opens the drawer and Save still persists; Manual Trade
still places an order on demo; THEIA shows the three lanes; no icon changed anywhere; numbers
do not jitter as prices tick.

If anything is wrong: `git checkout pre-institutional-redesign -- <path>`, or restore from
`/root/zeus-backups/pre-redesign-20261010-1640`.

---

## Self-review

**Spec coverage.** Token layer → Task 1. Five primitives → Task 1. Manual Trade rebuilt →
Task 2. Auto Trade emptied → Task 3. Config drawer → Task 3. Three THEIA cards + lanes →
Task 4. `bootstrapBrainDash` deletion → Task 4 Step 7, conditional on proof. Theme containment
test → Task 5. The spec's test table is covered item by item, including the Auto Trade "no
settings control" guard (Task 3 Step 5) and the empty-store card tests (Task 4 Step 1). The
spec's error-handling section is covered: `handleSaveAT` keeps its try/catch (Task 3 Step 7),
cards render from an empty store (Task 4 Step 1), the kill switch stays in the panel (Task 3
Step 5, asserted).

**Placeholders.** The JSX blocks in Tasks 2 and 3 carry comment markers where existing blocks
are to be **moved verbatim** with exact source markers given in a table, rather than being
reproduced — moving 60 lines of working JSX is a located operation, not an invention. Every
new file is given in full. No step says "add error handling" or "write tests for the above".

**Type consistency.** `ZiTone` is defined in `ZiMetric.tsx` and imported by `ZiTable.tsx`.
`ZiRail` is separate and defined in `ZiPanel.tsx`. `POSITION_COLUMNS` and `JOURNAL_COLUMNS`
are exported from `ZiTable.tsx` and imported by both panels. `data-zi-grid` and `data-zi-rail`
are the test hooks and are spelled identically in the components and in every test. The
`ZiMetric` prop names (`label`, `value`, `tone`, `secondary`) are the same in Task 1's test, in
the implementation, and at every call site in Tasks 2, 3 and 4.

**Known soft spot, stated rather than hidden.** Tasks 2 and 3 reference `ui.*` and position
fields by plausible names. The real field names must be taken from each file when the task is
executed; both tasks say so explicitly and both forbid inventing a computation. If a value
does not exist, render an em dash.

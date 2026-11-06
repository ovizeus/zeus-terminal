/**
 * [2026-11-06] Admin launcher.
 *
 * What these defend: ONE section list behind both the launcher and the
 * sidebar (two copies drift, as the dock proved), every section reachable
 * from the tiles, and counts that only light up when something is actually
 * waiting — a badge that is always on is a badge nobody reads.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AdminHome } from '../AdminHome'
import { NAV, GROUPS, actionCounts } from '../adminNav'
import { useAdminStore } from '../../../stores/adminStore'
import { useSupportStore } from '../../../stores/supportStore'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response)))
  useAdminStore.setState({ users: [], currentSection: 'home' } as never)
  useSupportStore.setState({ adminUnread: 0 } as never)
})

describe('one list, not two', () => {
  it('every section the sidebar can reach is on the launcher', () => {
    // both render NAV; if someone re-forks the list this still passes, so the
    // next test checks the sidebar actually imports it
    const ids = NAV.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length) // no duplicates
    expect(ids).toContain('indicators')
    expect(ids).toContain('support')
  })

  it('the sidebar imports the shared list rather than keeping its own', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/components/admin/AdminSidebar.tsx'), 'utf8')
    expect(src).toContain("from './adminNav'")
    expect(src).not.toContain('const NAV: NavItem[] = [')
  })

  it('every nav item belongs to a declared group', () => {
    const groups = new Set(GROUPS.map((g) => g.id))
    for (const n of NAV) expect(groups.has(n.group)).toBe(true)
  })
})

describe('the launcher renders every section', () => {
  it('shows a tile for each one', () => {
    render(<AdminHome />)
    for (const n of NAV) expect(screen.getByText(n.label)).toBeTruthy()
  })

  it('shows each group heading', () => {
    render(<AdminHome />)
    for (const g of GROUPS) expect(screen.getByText(g.label)).toBeTruthy()
  })

  it('a tile opens its own section, not another', () => {
    render(<AdminHome />)
    fireEvent.click(screen.getByText('Indicator Requests'))
    expect(useAdminStore.getState().currentSection).toBe('indicators')
    fireEvent.click(screen.getByText('Audit Log'))
    expect(useAdminStore.getState().currentSection).toBe('audit')
  })

  it('marks scaffolds so nobody expects them to work', () => {
    render(<AdminHome />)
    const wip = NAV.filter((n) => n.wip)
    expect(wip.length).toBeGreaterThan(0)
    expect(screen.getAllByText('WIP')).toHaveLength(wip.length)
  })
})

describe('counts are a call to act', () => {
  it('shows nothing when nothing is waiting', () => {
    expect(actionCounts({ pendingApprovals: 0, indicatorRequests: 0, supportUnread: 0 })).toEqual({
      users: undefined, indicators: undefined, support: undefined,
    })
  })

  it('does not badge sections that merely have rows', () => {
    // users total and audit total are reference, not a prompt; badging them
    // would light the launcher permanently and teach the eye to ignore it
    const c = actionCounts({ pendingApprovals: 0, indicatorRequests: 0, supportUnread: 0 })
    expect(c.audit).toBeUndefined()
    expect(c.dashboard).toBeUndefined()
  })

  it('surfaces pending approvals on Users', () => {
    expect(actionCounts({ pendingApprovals: 3, indicatorRequests: 0, supportUnread: 0 }).users).toBe(3)
  })

  it('says how many things are waiting, in total', () => {
    useAdminStore.setState({
      users: [{ id: 2, approved: false, role: 'user' }, { id: 3, approved: false, role: 'user' }],
    } as never)
    useSupportStore.setState({ adminUnread: 1 } as never)
    render(<AdminHome />)
    expect(screen.getByText(/things? waiting/)).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('says so plainly when nothing is', () => {
    render(<AdminHome />)
    expect(screen.getByText(/Nothing is waiting on you/)).toBeTruthy()
  })

  it('renders even when the count endpoint is down', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    render(<AdminHome />)
    expect(screen.getByText('Users')).toBeTruthy()
  })
})

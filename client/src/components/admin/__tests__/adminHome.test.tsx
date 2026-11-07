/**
 * [2026-11-06] Admin launcher.
 *
 * What these defend: ONE section list behind both the launcher and the
 * sidebar (two copies drift, as the dock proved), every section reachable
 * from the tiles, and counts that only light up when something is actually
 * waiting — a badge that is always on is a badge nobody reads.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AdminHome } from '../AdminHome'
import { NAV, GROUPS, actionCounts } from '../adminNav'
import { useAdminStore } from '../../../stores/adminStore'
import { useSupportStore } from '../../../stores/supportStore'
import { act } from '@testing-library/react'

/**
 * The socket itself is not under test here - the wiring is. We capture whatever
 * AdminHome subscribes and hand it frames, which is what the real socket does.
 */
const _frameSinks = new Set<(m: unknown) => void>()
function pushFrame(m: unknown) { for (const f of _frameSinks) f(m) }
vi.mock('../../../services/ws', () => ({
  wsService: {
    subscribe: (fn: (m: unknown) => void) => { _frameSinks.add(fn); return () => _frameSinks.delete(fn) },
    connect: () => {}, disconnect: () => {}, send: () => false, isConnected: () => true,
  },
}))

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

  it('exactly one section list exists in the admin folder', async () => {
    // [2026-11-06] The sidebar that held the second copy is gone. This keeps
    // the door shut: the next person who needs the list must import it.
    const fs = await import('node:fs')
    const path = await import('node:path')
    const dir = path.resolve(process.cwd(), 'src/components/admin')
    const files: string[] = []
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name)
        if (e.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(e.name)) files.push(full)
      }
    }
    walk(dir)
    const definers = files.filter((f) => {
      const src = fs.readFileSync(f, 'utf8')
      return /(const|let|var)\s+NAV\s*(:|=)/.test(src)
    })
    expect(definers.map((f) => path.basename(f))).toEqual(['adminNav.ts'])
  })

  it('the retired sidebar is really gone, not just unrendered', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    expect(fs.existsSync(path.resolve(process.cwd(), 'src/components/admin/AdminSidebar.tsx'))).toBe(false)
    const page = fs.readFileSync(path.resolve(process.cwd(), 'src/components/admin/AdminPage.tsx'), 'utf8')
    expect(page).not.toContain('<AdminSidebar')
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

describe('exchange keys that stopped passing their check', () => {
  // [2026-11-07] The real case: an account read "verified" with a date four
  // months old while the daily check failed the whole time. The user now sees
  // it on their own screen; the operator saw it nowhere.
  function stubKeyHealth(stale: unknown[]) {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const json = (b: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(b) } as Response)
      if (String(url).includes('key-health')) return json({ ok: true, stale, count: stale.length })
      return json({ ok: false })
    }))
  }

  it('says nothing when every key is current', async () => {
    stubKeyHealth([])
    render(<AdminHome />)
    await waitFor(() => expect(screen.queryByText(/stopped passing/i)).toBeNull())
  })

  it('names the user, the exchange and how long it has been failing', async () => {
    stubKeyHealth([{ userId: 2, email: 'someone@test.invalid', exchange: 'bybit', days: 116 }])
    render(<AdminHome />)
    await waitFor(() => expect(screen.getByText(/stopped passing the daily check/i)).toBeTruthy())
    expect(screen.getByText(/someone@test\.invalid/)).toBeTruthy()
    expect(screen.getByText(/BYBIT/)).toBeTruthy()
    expect(screen.getByText(/116 days ago/)).toBeTruthy()
  })

  it('falls back to the user id when there is no email', async () => {
    stubKeyHealth([{ userId: 7, email: null, exchange: 'binance', days: 4 }])
    render(<AdminHome />)
    await waitFor(() => expect(screen.getByText(/user 7/)).toBeTruthy())
  })

  it('renders the launcher even when the endpoint is down', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    render(<AdminHome />)
    expect(screen.getByText('Users')).toBeTruthy()
  })
})

describe('the live push actually arrives', () => {
  // [2026-11-07] The server pushed `byoi.request` to admins for a day with no
  // listener and no type declaration, so it went nowhere and the count only
  // moved on a page load. This holds the wire together.
  it('re-reads the count when an order is pushed', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const u = String(url)
      const json = (b: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(b) } as Response)
      if (u.includes('byoi/admin/count')) { calls++; return json({ ok: true, count: calls }) }
      return json({ ok: true, stale: [], count: 0 })
    }))
    render(<AdminHome />)
    await waitFor(() => expect(calls).toBe(1))      // the mount read

    // the server pushes; the page must notice without a reload
    const before = calls
    await act(async () => { pushFrame({ type: 'byoi.request', data: { id: 1, tier: 'custom', title: 'x' } }) })
    await waitFor(() => expect(calls).toBeGreaterThan(before))
  })

  it('ignores frames that are not an order', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const u = String(url)
      const json = (b: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(b) } as Response)
      if (u.includes('byoi/admin/count')) { calls++; return json({ ok: true, count: calls }) }
      return json({ ok: true, stale: [], count: 0 })
    }))
    render(<AdminHome />)
    await waitFor(() => expect(calls).toBe(1))
    await act(async () => { pushFrame({ type: 'hb', t: Date.now() }) })
    await new Promise((r) => setTimeout(r, 20))
    expect(calls).toBe(1)                            // a heartbeat is not news
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

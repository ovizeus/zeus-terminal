/**
 * [2026-11-06] Admin Control Center moved out of the header's top bar into a
 * dedicated FIRST dock icon, visible to admins only.
 *
 * The two tests that actually matter are the gating ones: this is an access
 * door, not decoration, so a non-admin must never see it, and an unknown role
 * must fail CLOSED rather than open. The rest pin the placement he asked for
 * and the fact that the header no longer carries the shield.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { ZeusDock } from '../layout/ZeusDock'
import { useAuthStore } from '../../stores'

function setRole(role: string | null) {
  useAuthStore.setState({ role } as never)
}
function ids(container: HTMLElement) {
  return Array.from(container.querySelectorAll('[data-dock]')).map((el) => el.getAttribute('data-dock'))
}

beforeEach(() => {
  // the pending-approvals badge is best-effort; it must never decide whether
  // the icon renders, so it is stubbed to fail for every test here
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as unknown as Response)))
})

describe('Admin dock entry — gating', () => {
  it('is hidden for a plain user', () => {
    setRole('user')
    const { container } = render(<ZeusDock active={null} onDockClick={() => {}} />)
    expect(container.querySelector('[data-dock="admin"]')).toBeNull()
  })

  it('fails closed when the role is not known yet', () => {
    setRole(null)
    const { container } = render(<ZeusDock active={null} onDockClick={() => {}} />)
    expect(container.querySelector('[data-dock="admin"]')).toBeNull()
  })

  it('is shown for an admin', () => {
    setRole('admin')
    const { container } = render(<ZeusDock active={null} onDockClick={() => {}} />)
    expect(container.querySelector('[data-dock="admin"]')).not.toBeNull()
  })
})

describe('Admin dock entry — placement', () => {
  it('is the FIRST item, ahead of AutoTrade', () => {
    setRole('admin')
    const { container } = render(<ZeusDock active={null} onDockClick={() => {}} />)
    const list = ids(container)
    expect(list[0]).toBe('admin')
    expect(list.indexOf('admin')).toBeLessThan(list.indexOf('autotrade'))
  })

  it('leaves AutoTrade first for everyone else', () => {
    setRole('user')
    const { container } = render(<ZeusDock active={null} onDockClick={() => {}} />)
    expect(ids(container)[0]).toBe('autotrade')
  })

  it('keeps every other dock item in place for an admin', () => {
    setRole('user')
    const plain = ids(render(<ZeusDock active={null} onDockClick={() => {}} />).container)
    setRole('admin')
    const asAdmin = ids(render(<ZeusDock active={null} onDockClick={() => {}} />).container)
    expect(asAdmin.slice(1)).toEqual(plain)
  })

  it('reports its id to the click handler', () => {
    setRole('admin')
    const onDockClick = vi.fn()
    const { container } = render(<ZeusDock active={null} onDockClick={onDockClick} />)
    ;(container.querySelector('[data-dock="admin"]') as HTMLElement).click()
    expect(onDockClick).toHaveBeenCalledWith('admin')
  })
})

describe('Admin entry is gone from the header', () => {
  it('the legacy dock list does not carry it, so the ungated path cannot leak it', async () => {
    const { DOCK_ITEMS, DOCK_ENABLED } = await import('../../ui/dock')
    expect(DOCK_ITEMS.find((i: { id: string }) => i.id === 'admin')).toBeUndefined()
    expect(DOCK_ENABLED).not.toContain('admin')
  })

  it('Header.tsx no longer renders the adminBtn shield', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    // vitest runs from client/, and import.meta.url is not a file URL here
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/components/layout/Header.tsx'), 'utf8')
    expect(src).not.toContain('adminBtn')
    expect(src).not.toContain("openModal('adminPage')")
  })
})

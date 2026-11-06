import type { AdminSection } from '../../stores/adminStore'

/**
 * [2026-11-06] The one list of admin sections.
 *
 * It used to live inside AdminSidebar. The launcher needs the same list, and
 * two copies drift the first time a section is added — the dock in this very
 * codebase has two independent lists and the lesson was learned there.
 */
export interface NavItem {
  id: AdminSection
  label: string
  icon: string
  group: 'overview' | 'people' | 'system' | 'config'
  /** Scaffold sections stay listed (operator: keep the roadmap visible) but
   *  carry a WIP chip so nobody expects them to work yet. */
  wip?: boolean
  /** One line on the launcher tile. The sidebar has no room for it. */
  blurb?: string
}

export const NAV: NavItem[] = [
  { id: 'book', label: 'Book of All', icon: '▤', group: 'overview', blurb: 'Everything we built, and why' },
  { id: 'uploads', label: 'Uploads', icon: '▥', group: 'overview', blurb: 'Files and attachments' },
  { id: 'backup', label: 'Backup Zeus', icon: '▧', group: 'overview', blurb: 'Encrypted snapshots' },
  { id: 'vault', label: 'Vault', icon: '▦', group: 'overview', blurb: 'Secrets, zero-knowledge' },
  { id: 'dashboard', label: 'Dashboard', icon: '◉', group: 'overview', blurb: 'Health and overview' },
  { id: 'users', label: 'Users', icon: '◐', group: 'people', blurb: 'Accounts, roles, access' },
  { id: 'audit', label: 'Audit Log', icon: '☰', group: 'people', blurb: 'Full activity trail' },
  { id: 'roles', label: 'Roles & Permissions', icon: '◆', group: 'people', wip: true, blurb: 'Access matrix' },
  { id: 'security', label: 'Security', icon: '⬡', group: 'system', blurb: 'Sessions and hardening' },
  { id: 'monitoring', label: 'Monitoring', icon: '◈', group: 'system', blurb: 'Server and modules' },
  { id: 'billing', label: 'Billing / Plans', icon: '❖', group: 'config', wip: true, blurb: 'Subscriptions' },
  { id: 'indicators', label: 'Indicator Requests', icon: '✦', group: 'config', blurb: 'Built-to-order queue' },
  { id: 'support', label: 'Support / Ops', icon: '☍', group: 'config', blurb: 'Messages and ops tools' },
  { id: 'settings', label: 'Settings / Flags', icon: '⚙', group: 'config', blurb: 'Global toggles' },
]

export const GROUPS: Array<{ id: NavItem['group']; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'people', label: 'People' },
  { id: 'system', label: 'System' },
  { id: 'config', label: 'Configuration' },
]

/**
 * The numbers that mean "there is work waiting here".
 *
 * Deliberately NOT every number: a count on a tile is a call to act, and a
 * badge that is always lit is a badge nobody reads. Users and audit carry
 * totals in the sidebar, where they are reference rather than a prompt; the
 * launcher shows only what is outstanding.
 */
export interface NavCountInput {
  pendingApprovals: number
  indicatorRequests: number
  supportUnread: number
}
export function actionCounts(i: NavCountInput): Partial<Record<AdminSection, number>> {
  return {
    users: i.pendingApprovals || undefined,
    indicators: i.indicatorRequests || undefined,
    support: i.supportUnread || undefined,
  }
}

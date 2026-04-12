import { toast } from '../data/marketDataHelpers'
import { openPageView } from './pageview'
// Zeus Terminal — ui/dock.ts (ported from ui/dock.js)
// Icon Dock: module shortcuts grid (Faza A — visual only, no navigation)

// ── DOCK REGISTRY ──────────────────────────────────────────────
// Ordered list of 15 dock items with grouping metadata.
// Each entry: { id, label, group, svg }
// svg = inline SVG path(s) inside a 24x24 viewBox

export var DOCK_ITEMS: any[] = [
  // ── TRADING CORE ──
  { id: 'autotrade',  label: 'AutoTrade',  group: 'trading',
    svg: '<path d="M12 2L2 7l10 5 10-5-10-5z" fill="currentColor" opacity=".12"/><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="7" r="1.2" fill="currentColor" opacity=".5"/>' },

  { id: 'manual-trade', label: 'Manual Trade', group: 'trading',
    svg: '<rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor" opacity=".08"/><path d="M8 16V11l4-5 4 5v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><line x1="8" y1="13" x2="16" y2="13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="12" cy="8" r="1.5" fill="currentColor" opacity=".45"/>' },

  { id: 'dsl',        label: 'DSL',        group: 'trading',
    svg: '<path d="M3 17l4-4 4 4 4-8 6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="21" cy="15" r="2" fill="currentColor" opacity=".5"/><circle cx="3" cy="17" r="1.5" fill="currentColor" opacity=".35"/><path d="M3 20h18" stroke="currentColor" stroke-width="1" opacity=".2" stroke-linecap="round"/>' },

  { id: 'ares',       label: 'ARES',       group: 'trading',
    svg: '<path d="M12 1.5L4.5 6.5v5.5c0 4.8 3.1 9.8 7.5 11 4.4-1.2 7.5-6.2 7.5-11V6.5L12 1.5z" fill="currentColor" opacity=".1"/><path d="M12 1.5L4.5 6.5v5.5c0 4.8 3.1 9.8 7.5 11 4.4-1.2 7.5-6.2 7.5-11V6.5L12 1.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 11.5l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' },

  // ── REVIEW / PERFORMANCE ──
  { id: 'postmortem', label: 'Post-Mortem', group: 'review',
    svg: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" fill="currentColor" opacity=".1"/><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M14 2v6h6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 13h6M9 17h4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' },

  { id: 'pnllab',     label: 'PnL Lab',    group: 'review',
    svg: '<rect x="4" y="3" width="3" height="17" rx="1.5" fill="currentColor" opacity=".12"/><rect x="10.5" y="3" width="3" height="17" rx="1.5" fill="currentColor" opacity=".08"/><rect x="17" y="3" width="3" height="17" rx="1.5" fill="currentColor" opacity=".05"/><path d="M5.5 20V10M12 20V4M18.5 20v-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },

  // ── INTELLIGENCE ──
  { id: 'aria',       label: 'ARIA',       group: 'intel',
    svg: '<ellipse cx="12" cy="12" rx="10" ry="6" fill="currentColor" opacity=".08"/><ellipse cx="12" cy="12" rx="10" ry="6" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="3" fill="currentColor" opacity=".2"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="12" y1="6" x2="12" y2="2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="12" y1="22" x2="12" y2="18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' },

  { id: 'nova',       label: 'Nova',       group: 'intel',
    svg: '<polygon points="12,2 15,9 22,9 16.5,14 18.5,21 12,17 5.5,21 7.5,14 2,9 9,9" fill="currentColor" opacity=".1"/><polygon points="12,2 15,9 22,9 16.5,14 18.5,21 12,17 5.5,21 7.5,14 2,9 9,9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="12" cy="12" r="2" fill="currentColor" opacity=".35"/>' },

  { id: 'adaptive',   label: 'Adaptive',   group: 'intel',
    svg: '<circle cx="12" cy="12" r="10" fill="currentColor" opacity=".07"/><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 12s1.5-4 4-4 4 4 4 4-1.5 4-4 4-4-4-4-4" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="1.5" fill="currentColor" opacity=".4"/>' },

  { id: 'flow',       label: 'Flow',       group: 'intel',
    svg: '<path d="M5 12h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M14 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="5" cy="12" r="2.5" fill="currentColor" opacity=".15"/><circle cx="5" cy="12" r="2.5" fill="none" stroke="currentColor" stroke-width="1.2"/>' },

  { id: 'mtf',        label: 'MTF', group: 'intel',
    svg: '<path d="M3 3v18h18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 16l4-5 4 3 5-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="16" r="1.5" fill="currentColor" opacity=".35"/><circle cx="20" cy="7" r="1.5" fill="currentColor" opacity=".35"/>' },

  { id: 'teacher',    label: 'Teacher',    group: 'intel',
    svg: '<path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" fill="currentColor" opacity=".08"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" fill="currentColor" opacity=".08"/><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2zM22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' },

  { id: 'sigreg',     label: 'Signals', group: 'intel',
    svg: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" fill="currentColor" opacity=".1"/><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="4" y1="22" x2="4" y2="15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' },

  // ── REVIEW (cont.) ──
  { id: 'activity',   label: 'Activity',   group: 'review',
    svg: '<polyline points="22,12 18,12 15,21 9,3 6,12 2,12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="1.5" fill="currentColor" opacity=".3"/>' },

  // ── SYSTEM ──
  { id: 'aub',        label: 'Alien',      group: 'review',
    svg: '<path d="M12 2C8 2 4.5 5.5 4.5 10c0 2.5 1 4.5 2.5 6l-1 4 3.5-1.5c.8.3 1.6.5 2.5.5s1.7-.2 2.5-.5L18 20l-1-4c1.5-1.5 2.5-3.5 2.5-6C19.5 5.5 16 2 12 2z" fill="currentColor" opacity=".1"/><path d="M12 2C8 2 4.5 5.5 4.5 10c0 2.5 1 4.5 2.5 6l-1 4 3.5-1.5c.8.3 1.6.5 2.5.5s1.7-.2 2.5-.5L18 20l-1-4c1.5-1.5 2.5-3.5 2.5-6C19.5 5.5 16 2 12 2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="9" cy="9" r="1.5" fill="currentColor" opacity=".5"/><circle cx="15" cy="9" r="1.5" fill="currentColor" opacity=".5"/><path d="M9 13c1.5 1.5 4.5 1.5 6 0" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' },

  // ── EXPANSION ──
  { id: 'more',       label: 'More',       group: 'expand',
    svg: '<circle cx="12" cy="5" r="2" fill="currentColor" opacity=".2"/><circle cx="12" cy="5" r="2" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="12" cy="12" r="2" fill="currentColor" opacity=".2"/><circle cx="12" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="12" cy="19" r="2" fill="currentColor" opacity=".2"/><circle cx="12" cy="19" r="2" fill="none" stroke="currentColor" stroke-width="1.3"/>' },
];

// ── GROUP ORDER (for visual spacing) ──
export var DOCK_GROUPS: any[] = ['trading', 'review', 'intel', 'expand'];

// ── ENABLED DOCK IDS (modules with page view wired) ──────────
// Add ids here as each module gets its dedicated page view
export var DOCK_ENABLED: any[] = ['autotrade', 'manual-trade', 'dsl', 'ares', 'postmortem', 'pnllab', 'aria', 'nova', 'adaptive', 'flow', 'mtf', 'teacher', 'sigreg', 'activity', 'aub'];

// ── RENDER ─────────────────────────────────────────────────────
export function initZeusDock(): void {
  var dock = document.getElementById('zeus-dock');
  if (!dock) return;
  if (dock.children.length > 0) return; // already rendered

  var lastGroup = '';
  for (var i = 0; i < DOCK_ITEMS.length; i++) {
    var item = DOCK_ITEMS[i];

    // Group separator (extra gap via CSS class)
    if (lastGroup && item.group !== lastGroup) {
      var sep = document.createElement('div');
      sep.className = 'zd-sep';
      dock.appendChild(sep);
    }
    lastGroup = item.group;

    var enabled = DOCK_ENABLED.indexOf(item.id) !== -1;
    var el = document.createElement('div');
    el.className = 'zd-item' + (enabled ? '' : ' zd-disabled');
    el.setAttribute('data-dock', item.id);
    el.innerHTML =
      '<div class="zd-icon"><svg viewBox="0 0 24 24" width="24" height="24">' + item.svg + '</svg></div>' +
      '<span class="zd-label">' + item.label + '</span>';
    dock.appendChild(el);
  }

  // ── Delegated click handler ──
  dock.addEventListener('click', function(e: any) {
    var item = e.target.closest('.zd-item');
    if (!item) return;

    var dockId = item.getAttribute('data-dock');

    // Disabled icons -> toast
    if (item.classList.contains('zd-disabled')) {
      toast('Coming soon', 1500);
      return;
    }

    // Set active state — exactly one icon active at a time
    var allItems = dock!.querySelectorAll('.zd-item');
    for (var i = 0; i < allItems.length; i++) {
      allItems[i].classList.remove('active');
    }
    item.classList.add('active');

    // Delegate to page view system
    openPageView(dockId);
  });
}

// ── Clear active state (called by pageview on close) ──────────
export function dockClearActive(): void {
  var dock = document.getElementById('zeus-dock');
  if (!dock) return;
  var allItems = dock.querySelectorAll('.zd-item');
  for (var i = 0; i < allItems.length; i++) {
    allItems[i].classList.remove('active');
  }
}

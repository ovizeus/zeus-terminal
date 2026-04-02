// Zeus Terminal — ui/pageview.js
// Full-screen dedicated page view for dock modules
'use strict';

// ── MODULE REGISTRY ──────────────────────────────────────────
var PAGE_VIEW_MODULES = {
  'autotrade': {
    panelId: 'atPanel',
    title: 'AutoTrade'
  },
  'manual-trade': {
    title: 'Manual Trade'
  },
  'dsl': {
    panelId: 'dslZone',
    title: 'DSL'
  },
  'ares': {
    title: 'ARES'
  },
  'postmortem': {
    title: 'Post-Mortem'
  },
  'pnllab': {
    title: 'PnL Lab'
  },
  'aria': {
    title: 'ARIA'
  },
  'nova': {
    title: 'Nova'
  },
  'adaptive': {
    title: 'Adaptive'
  },
  'flow': {
    title: 'Flow'
  },
  'mtf': {
    title: 'MTF'
  },
  'teacher': {
    title: 'Teacher'
  },
  'sigreg': {
    title: 'Signals'
  },
  'activity': {
    title: 'Activity'
  },
  'aub': {
    title: 'Alien Upgrade'
  }
};

// ── STATE ────────────────────────────────────────────────────
var _pvState = {
  open: false,
  dockId: null,
  panelEl: null,
  originalParent: null,
  originalNextSibling: null,
  // Extra elements moved into page view (for restore)
  extras: []  // { el, origParent, origNext }
};

// ── INIT (called once from bootstrap) ────────────────────────
function initPageView() {
  var pv = document.getElementById('zeus-page-view');
  if (!pv || pv.children.length > 0) return;

  pv.innerHTML =
    '<div class="zpv-header">' +
      '<button class="zpv-back" onclick="closePageView()">' +
        '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M19 12H5M12 19l-7-7 7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '<span>Back</span>' +
      '</button>' +
      '<span class="zpv-title" id="zpvTitle"></span>' +
    '</div>' +
    '<div class="zpv-content" id="zpvContent"></div>';

}

// ── Helper: save + move element into page view content ───────
function _pvMoveIn(el, content) {
  if (!el) return;
  _pvState.extras.push({
    el: el,
    origParent: el.parentNode,
    origNext: el.nextSibling
  });
  content.appendChild(el);
}

// ── OPEN ─────────────────────────────────────────────────────
function openPageView(dockId) {
  var mod = PAGE_VIEW_MODULES[dockId];
  if (!mod) return;

  // Close previous page view if open (clean switch between docks)
  if (_pvState.open) closePageView();

  var pv = document.getElementById('zeus-page-view');
  var content = document.getElementById('zpvContent');
  var title = document.getElementById('zpvTitle');
  var home = document.getElementById('zeus-groups');
  if (!pv || !content || !home) return;

  // Clear any leftover content from previous page view
  content.innerHTML = '';

  _pvState.dockId = dockId;
  _pvState.extras = [];

  // ── AutoTrade ──
  if (dockId === 'autotrade') {
    var panel = document.getElementById(mod.panelId);
    if (!panel) return;
    _pvState.panelEl = panel;
    _pvState.originalParent = panel.parentNode;
    _pvState.originalNextSibling = panel.nextSibling;

    title.textContent = mod.title;

    // Move full .at-sep (neon lines + label + toggle + status)
    var atSep = document.querySelector('.at-sep');
    _pvMoveIn(atSep, content);

    // Move AT panel below
    content.appendChild(panel);
    panel.style.display = 'block';
  }

  // ── Manual Trade ──
  if (dockId === 'manual-trade') {
    var env = window._resolvedEnv || 'DEMO';
    title.textContent = 'Manual Trade (' + env + ')';

    // Move only panelDemo (unified panel — handles demo + live via JS)
    var demoPanel = document.getElementById('panelDemo');
    _pvMoveIn(demoPanel, content);

    // Ensure panel is visible
    if (typeof _showManualPanel === 'function') _showManualPanel();
    else if (demoPanel) demoPanel.style.display = 'block';
  }

  // ── Adaptive ──
  if (dockId === 'adaptive') {
    var adaptStrip = document.getElementById('adaptive-strip');
    if (!adaptStrip) return;
    title.textContent = mod.title;
    _pvMoveIn(adaptStrip, content);
    if (!adaptStrip.classList.contains('adaptive-open')) {
      adaptStrip.classList.add('adaptive-open');
    }
  }

  // ── Nova ──
  if (dockId === 'nova') {
    var novaStrip = document.getElementById('nova-strip');
    if (!novaStrip) return;
    title.textContent = mod.title;
    _pvMoveIn(novaStrip, content);
    if (!novaStrip.classList.contains('nova-open')) {
      novaStrip.classList.add('nova-open');
    }
  }

  // ── ARIA ──
  if (dockId === 'aria') {
    var ariaStrip = document.getElementById('aria-strip');
    if (!ariaStrip) return;
    title.textContent = mod.title;
    _pvMoveIn(ariaStrip, content);
    if (!ariaStrip.classList.contains('aria-open')) {
      ariaStrip.classList.add('aria-open');
    }
  }

  // ── PnL Lab ──
  if (dockId === 'pnllab') {
    var pnlStrip = document.getElementById('pnl-lab-strip');
    if (!pnlStrip) return;
    title.textContent = mod.title;
    _pvMoveIn(pnlStrip, content);
    var pnlWrap = document.getElementById('pnlLabWrap');
    if (pnlWrap && !pnlWrap.classList.contains('open')) {
      pnlWrap.classList.add('open');
    }
    if (typeof renderPnlLab === 'function') renderPnlLab();
  }

  // ── Post-Mortem ──
  if (dockId === 'postmortem') {
    var pmStrip = document.getElementById('pm-strip');
    if (!pmStrip) return;
    title.textContent = mod.title;
    _pvMoveIn(pmStrip, content);
    if (!pmStrip.classList.contains('open')) {
      pmStrip.classList.add('open');
    }
    if (typeof PM_render === 'function') PM_render();
  }

  // ── ARES ──
  if (dockId === 'ares') {
    var aresStrip = document.getElementById('ares-strip');
    if (!aresStrip) return;
    title.textContent = mod.title;
    _pvMoveIn(aresStrip, content);
    // Ensure panel is expanded
    if (!aresStrip.classList.contains('open')) {
      aresStrip.classList.add('open');
    }
    if (typeof _aresRender === 'function') _aresRender();
  }

  // ── DSL ──
  if (dockId === 'dsl') {
    var dslZone = document.getElementById(mod.panelId);
    if (!dslZone) return;
    title.textContent = mod.title;
    _pvMoveIn(dslZone, content);
    dslZone.style.display = 'block';
  }

  // ── Flow ──
  if (dockId === 'flow') {
    var flowPanel = document.getElementById('flow-panel');
    if (!flowPanel) return;
    title.textContent = mod.title;
    _pvMoveIn(flowPanel, content);
    // Force expanded so body is visible (CSS hides hdr in page view)
    flowPanel.classList.remove('collapsed');
    flowPanel.classList.add('expanded');
  }

  // ── Alien Upgrade Bay ──
  if (dockId === 'aub') {
    var aubEl = document.getElementById('aub');
    if (!aubEl) return;
    title.textContent = mod.title;
    _pvMoveIn(aubEl, content);
    aubEl.classList.remove('collapsed');
    aubEl.classList.add('expanded');
    if (typeof aubRefreshAll === 'function') aubRefreshAll();
  }

  // ── Activity ──
  if (dockId === 'activity') {
    var actStrip = document.getElementById('actfeed-strip');
    if (!actStrip) return;
    title.textContent = mod.title;
    _pvMoveIn(actStrip, content);
    var actPanel = document.getElementById('actfeed-panel');
    if (actPanel) actPanel.style.display = '';
    if (typeof _actfeedRender === 'function') _actfeedRender();
  }

  // ── Signals (Signal Registry) ──
  if (dockId === 'sigreg') {
    var srStrip = document.getElementById('sr-strip');
    if (!srStrip) return;
    title.textContent = mod.title;
    _pvMoveIn(srStrip, content);
    if (!srStrip.classList.contains('sr-strip-open')) {
      srStrip.classList.add('sr-strip-open');
    }
    if (typeof _srRenderList === 'function') _srRenderList();
    if (typeof _srRenderStats === 'function') _srRenderStats();
  }

  // ── Teacher ──
  if (dockId === 'teacher') {
    var teacherStrip = document.getElementById('teacher-strip');
    if (!teacherStrip) return;
    title.textContent = mod.title;
    _pvMoveIn(teacherStrip, content);
    if (!teacherStrip.classList.contains('teacher-open')) {
      teacherStrip.classList.add('teacher-open');
    }
    if (typeof initTeacher === 'function') initTeacher();
  }

  // ── MTF ──
  if (dockId === 'mtf') {
    var mtfStrip = document.getElementById('mtf-strip');
    if (!mtfStrip) return;
    title.textContent = mod.title;
    _pvMoveIn(mtfStrip, content);
    if (!mtfStrip.classList.contains('mtf-open')) {
      mtfStrip.classList.add('mtf-open');
    }
    if (typeof renderMTFPanel === 'function') renderMTFPanel();
  }

  // Hide home, show page view
  home.style.display = 'none';
  pv.style.display = '';
  _pvState.open = true;
  pv.scrollTop = 0;

  // Persist active dock for refresh survival
  try { sessionStorage.setItem('zeusDock', dockId); } catch(e) {}
}

// ── CLOSE ────────────────────────────────────────────────────
function closePageView() {
  var pv = document.getElementById('zeus-page-view');
  var home = document.getElementById('zeus-groups');
  if (!pv || !home) return;
  if (!_pvState.open) return;

  // ── Cleanup: remove classes and inline styles added during open ──
  var did = _pvState.dockId;
  var _el;
  if (did === 'adaptive') { _el = document.getElementById('adaptive-strip'); if (_el) _el.classList.remove('adaptive-open'); }
  if (did === 'nova') { _el = document.getElementById('nova-strip'); if (_el) _el.classList.remove('nova-open'); }
  if (did === 'aria') { _el = document.getElementById('aria-strip'); if (_el) _el.classList.remove('aria-open'); }
  if (did === 'pnllab') { _el = document.getElementById('pnlLabWrap'); if (_el) _el.classList.remove('open'); }
  if (did === 'postmortem') { _el = document.getElementById('pm-strip'); if (_el) _el.classList.remove('open'); }
  if (did === 'ares') { _el = document.getElementById('ares-strip'); if (_el) _el.classList.remove('open'); }
  if (did === 'sigreg') { _el = document.getElementById('sr-strip'); if (_el) _el.classList.remove('sr-strip-open'); }
  if (did === 'teacher') { _el = document.getElementById('teacher-strip'); if (_el) _el.classList.remove('teacher-open'); }
  if (did === 'mtf') { _el = document.getElementById('mtf-strip'); if (_el) _el.classList.remove('mtf-open'); }
  if (did === 'flow') { _el = document.getElementById('flow-panel'); if (_el) { _el.classList.remove('expanded'); _el.classList.add('collapsed'); } }
  if (did === 'aub') { _el = document.getElementById('aub'); if (_el) { _el.classList.remove('expanded'); _el.classList.add('collapsed'); } }
  if (did === 'autotrade') { _el = document.getElementById('atPanel'); if (_el) _el.style.display = ''; }
  if (did === 'dsl') { _el = document.getElementById('dslZone'); if (_el) _el.style.display = ''; }
  if (did === 'activity') { _el = document.getElementById('actfeed-panel'); if (_el) _el.style.display = 'none'; }

  // Restore all extra elements to original positions (reverse order)
  for (var i = _pvState.extras.length - 1; i >= 0; i--) {
    var ex = _pvState.extras[i];
    if (ex.el && ex.origParent) {
      if (ex.origNext) {
        ex.origParent.insertBefore(ex.el, ex.origNext);
      } else {
        ex.origParent.appendChild(ex.el);
      }
    }
  }

  // Restore main panel (AT)
  if (_pvState.panelEl && _pvState.originalParent) {
    if (_pvState.originalNextSibling) {
      _pvState.originalParent.insertBefore(_pvState.panelEl, _pvState.originalNextSibling);
    } else {
      _pvState.originalParent.appendChild(_pvState.panelEl);
    }
  }

  // Hide page view, show home
  pv.style.display = 'none';
  home.style.display = '';

  // Clear dock active state
  if (typeof dockClearActive === 'function') {
    dockClearActive();
  }

  // Clear persisted dock
  try { sessionStorage.removeItem('zeusDock'); } catch(e) {}

  // Reset state
  _pvState.open = false;
  _pvState.dockId = null;
  _pvState.panelEl = null;
  _pvState.originalParent = null;
  _pvState.originalNextSibling = null;
  _pvState.extras = [];
}

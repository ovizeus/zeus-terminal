// Zeus — ui/theme.js
// Theme engine: native (obsidian), dark (onyx), light (ivory)
'use strict';
(function () {
  var THEMES = ['native', 'dark', 'light'];
  var LS_KEY = 'zeus_theme';

  function get() {
    try {
      var t = localStorage.getItem(LS_KEY);
      return (t && THEMES.indexOf(t) !== -1) ? t : 'native';
    } catch (e) { return 'native'; }
  }

  function apply(id) {
    if (!id || THEMES.indexOf(id) === -1) id = 'native';
    try { localStorage.setItem(LS_KEY, id); } catch (e) { /* quota */ }

    // Set or remove data-theme attribute
    if (id === 'native') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', id);
    }

    // Update theme-color meta tag with computed --bg
    requestAnimationFrame(function () {
      var bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      if (bg) {
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', bg);
      }
    });

    // Sync select if visible
    var sel = document.getElementById('themeSelect');
    if (sel) sel.value = id;

    return id;
  }

  window.zeusApplyTheme = apply;
  window.zeusGetTheme = get;

  // Apply saved theme immediately
  apply(get());
})();

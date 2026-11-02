/* App shell: sidebar, theme and density.

   Loaded at the top of <body>, straight after the sidebar markup, so saved
   preferences are applied before the first paint and the layout never jumps.
   Buttons carry data-action attributes instead of inline onclick handlers,
   which keeps the pages compatible with a strict Content Security Policy. */
(function () {
  'use strict';

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (e) {
      /* storage disabled: preferences just don't persist */
    }
    return null;
  }

  function toast(message) {
    if (typeof window.showToast === 'function') window.showToast(message, 'info');
  }

  function toggleSidebar() {
    document.getElementById('appSidebar').classList.toggle('show');
    document.getElementById('sidebarBackdrop').classList.toggle('show');
  }

  function setSidebarCollapsed(collapsed) {
    var sidebar = document.getElementById('appSidebar');
    if (!sidebar) return;
    sidebar.classList.toggle('collapsed', collapsed);
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    var icon = document.getElementById('collapseIcon');
    if (icon) icon.className = collapsed ? 'bi bi-layout-sidebar-inset-reverse' : 'bi bi-layout-sidebar-inset';
    var button = sidebar.querySelector('[data-action="collapse-sidebar"]');
    if (button) {
      button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      button.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    }
  }

  function collapseSidebar() {
    var collapsed = !document.getElementById('appSidebar').classList.contains('collapsed');
    setSidebarCollapsed(collapsed);
    store('opp-sidebar', collapsed ? 'collapsed' : 'expanded');
  }

  function updateThemeIcon(theme) {
    var icon = document.getElementById('themeIcon');
    if (icon) icon.className = theme === 'dark' ? 'bi bi-sun' : 'bi bi-moon';
  }

  function toggleTheme() {
    var html = document.documentElement;
    var next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    store('opp-theme', next);
    updateThemeIcon(next);
    toast('Theme switched to ' + next + ' mode');
  }

  function applyDensity(density) {
    document.body.setAttribute('data-density', density);
    var icon = document.getElementById('densityIcon');
    if (icon) icon.className = density === 'compact' ? 'bi bi-distribute-horizontal' : 'bi bi-distribute-vertical';
  }

  function toggleDensity() {
    var next = document.body.getAttribute('data-density') === 'compact' ? 'comfortable' : 'compact';
    applyDensity(next);
    store('opp-density', next);
    toast('View: ' + next);
  }

  var actions = {
    'toggle-sidebar': toggleSidebar,
    'collapse-sidebar': collapseSidebar,
    'toggle-theme': toggleTheme,
    'toggle-density': toggleDensity
  };

  document.addEventListener('click', function (event) {
    var trigger = event.target.closest && event.target.closest('[data-action]');
    if (!trigger) return;
    var action = actions[trigger.getAttribute('data-action')];
    if (!action) return;
    event.preventDefault();
    action();
  });

  /* Saved preferences, applied immediately. */
  updateThemeIcon(document.documentElement.getAttribute('data-theme'));
  var density = store('opp-density');
  if (density) applyDensity(density);
  // Sidebar: collapsed by default, expanded when the person chose so.
  setSidebarCollapsed(store('opp-sidebar') !== 'expanded');

  window.OPP_shell = { toggleTheme: toggleTheme, toggleDensity: toggleDensity, toggleSidebar: toggleSidebar };
})();

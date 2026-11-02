/* global bootstrap */
/* Page-wide helpers shared by every screen: toasts, the confirmation modal,
   row filters, the quick next-step dialog, the Ctrl+K palette and keyboard
   shortcuts. Everything is wired by delegated listeners and data-* attributes,
   so nothing in the markup needs an inline handler. */
(function () {
  'use strict';

  /* ──── Toast notification system ──── */
  function showToast(message, type) {
    type = type === 'danger' ? 'error' : type || 'info';
    var container = document.getElementById('toastContainer');
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'toast-item toast-' + type;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    var iconMap = { success: 'bi-check-circle-fill text-success', error: 'bi-x-circle-fill text-danger', info: 'bi-info-circle-fill text-primary' };
    toast.innerHTML = '<i class="bi ' + (iconMap[type] || iconMap.info) + '" aria-hidden="true"></i><span></span>';
    toast.querySelector('span').textContent = message;
    container.appendChild(toast);
    setTimeout(function () {
      toast.classList.add('is-leaving');
      setTimeout(function () { toast.remove(); }, 300);
    }, 3500);
  }

  /* ──── Row filters ──── */

  function filterTable(input, tableId) {
    var filter = (input.value || '').toLowerCase();
    document.querySelectorAll('#' + tableId + ' tbody tr').forEach(function (row) {
      var text = (row.getAttribute('data-filter') || row.textContent || '').toLowerCase();
      row.style.display = text.includes(filter) ? '' : 'none';
    });
  }

  /* Hides rows that don't match, and group headers with no visible rows left. */
  function filterGroupedTable(input, tableId) {
    var filter = (input.value || '').toLowerCase();
    var header = null;
    var headerHasMatch = false;
    function closeGroup() {
      if (header) header.style.display = headerHasMatch ? '' : 'none';
    }
    document.querySelectorAll('#' + tableId + ' tbody tr').forEach(function (row) {
      if (row.classList.contains('assignment-group-header')) {
        closeGroup();
        header = row;
        headerHasMatch = false;
        return;
      }
      var match = (row.textContent || '').toLowerCase().includes(filter);
      row.style.display = match ? '' : 'none';
      if (match) headerHasMatch = true;
    });
    closeGroup();
  }

  /* Hides timeline rows where neither the person nor any chip's project matches. */
  function filterTimeline(input) {
    var filter = (input.value || '').toLowerCase();
    var grid = document.getElementById('timelineGrid');
    if (!grid) return;
    grid.querySelectorAll('.timeline-row').forEach(function (row) {
      if (!filter) { row.style.display = ''; return; }
      var personEl = row.querySelector('.person-link');
      var personName = personEl ? (personEl.textContent || '').toLowerCase() : '';
      var chipMatch = false;
      row.querySelectorAll('.timeline-chip').forEach(function (chip) {
        var title = (chip.getAttribute('data-person') || '') + ' ' + (chip.getAttribute('title') || '');
        if (title.toLowerCase().includes(filter)) chipMatch = true;
      });
      row.querySelectorAll('.timeline-free, .timeline-absence').forEach(function (el) {
        var text = (el.getAttribute('title') || el.textContent || '').toLowerCase();
        if (text.includes(filter)) chipMatch = true;
      });
      row.style.display = (personName.includes(filter) || chipMatch) ? '' : 'none';
    });
  }

  document.addEventListener('input', function (event) {
    var el = event.target;
    if (!el || !el.getAttribute) return;
    if (el.hasAttribute('data-filter-table')) filterTable(el, el.getAttribute('data-filter-table'));
    else if (el.hasAttribute('data-filter-grouped')) filterGroupedTable(el, el.getAttribute('data-filter-grouped'));
    else if (el.hasAttribute('data-timeline-filter')) filterTimeline(el);
  });

  function showPageReloading(message) {
    if (window.OPP_busy) window.OPP_busy.begin(message || 'Working...');
  }

  /* Kept for callers that used to force a full reload. Nothing reloads any
     more: the current view is re-fetched and swapped in place, so scroll
     position, open sections and the active tab all survive. */
  function reloadPageWithMessage(message, delayMs) {
    var wait = typeof delayMs === 'number' ? delayMs : 0;
    setTimeout(function () {
      if (window.OPP_refreshView) window.OPP_refreshView(message);
      else window.location.reload();
    }, wait);
  }

  /* ──── Confirmation modal ──── */

  var confirmActionModal;
  var confirmActionCallback = null;
  function showConfirmAction(options) {
    options = options || {};
    var titleEl = document.getElementById('confirmActionTitle');
    var bodyEl = document.getElementById('confirmActionBody');
    var actionBtn = document.getElementById('confirmActionBtn');
    if (!titleEl || !bodyEl || !actionBtn) return;
    titleEl.textContent = options.title || 'Please confirm';
    bodyEl.textContent = options.message || 'Are you sure?';
    actionBtn.textContent = options.confirmText || 'Confirm';
    actionBtn.className = 'btn ' + (options.confirmClass || 'btn-danger');
    confirmActionCallback = typeof options.onConfirm === 'function' ? options.onConfirm : null;
    confirmActionModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('confirmActionModal'));
    confirmActionModal.show();
  }

  // Any form with data-confirm is routed through the confirmation modal.
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form.hasAttribute || !form.hasAttribute('data-confirm') || form.dataset.confirmed === 'true') return;
    event.preventDefault();
    showConfirmAction({
      title: form.getAttribute('data-confirm-title') || 'Please confirm',
      message: form.getAttribute('data-confirm'),
      confirmText: form.getAttribute('data-confirm-text') || 'Delete',
      onConfirm: function () {
        form.dataset.confirmed = 'true';
        /* requestSubmit keeps the submit event alive so the background
           handlers still run - form.submit() would force a full navigation. */
        if (form.requestSubmit) form.requestSubmit();
        else form.submit();
      }
    });
  });

  document.addEventListener('click', function (event) {
    if (event.target.closest && event.target.closest('#confirmActionBtn')) {
      if (confirmActionCallback) confirmActionCallback();
      confirmActionCallback = null;
      if (confirmActionModal) confirmActionModal.hide();
    }
  });

  /* ──── Background requests ──── */

  function postForm(url, data) {
    var body = data instanceof URLSearchParams ? data : new URLSearchParams(data);
    return fetch(url, {
      method: 'POST',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body: body.toString()
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok || json.ok === false) throw new Error(json.error || 'Server returned ' + res.status);
        return json;
      });
    });
  }

  /* Re-renders whatever is on screen after a background change. */
  function refreshCurrentView() {
    if (typeof window.OPP_pipelineSwap === 'function' && document.getElementById('pipelineContent')) return window.OPP_pipelineSwap();
    if (window.OPP_refreshView) return window.OPP_refreshView();
    window.location.reload();
  }

  /* ──── Quick next step (pipeline row, upcoming card) ──── */

  function isoDate(date) {
    var local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function dueFromOffset(offset) {
    var date = new Date();
    if (offset === 'next-monday') {
      var add = ((8 - date.getDay()) % 7) || 7;
      date.setDate(date.getDate() + add);
    } else {
      date.setDate(date.getDate() + Number(offset || 0));
    }
    return isoDate(date);
  }

  function openQuickStep(trigger) {
    var modalEl = document.getElementById('quickStepModal');
    var form = document.getElementById('quickStepForm');
    if (!modalEl || !form) return;
    form.reset();
    form.setAttribute('action', '/opportunities/' + trigger.getAttribute('data-opportunity-id') + '/steps');
    document.getElementById('quickStepFor').textContent = 'For ' + (trigger.getAttribute('data-opportunity-name') || 'this opportunity');
    document.getElementById('quickStepDue').value = dueFromOffset(1);
    var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modalEl.addEventListener('shown.bs.modal', function focusTitle() {
      modalEl.removeEventListener('shown.bs.modal', focusTitle);
      document.getElementById('quickStepTitleInput').focus();
    });
    modal.show();
  }

  document.addEventListener('click', function (event) {
    var trigger = event.target.closest && event.target.closest('[data-quick-step]');
    if (trigger) {
      event.preventDefault();
      openQuickStep(trigger);
      return;
    }
    var shortcut = event.target.closest && event.target.closest('[data-due-offset]');
    if (shortcut) {
      document.getElementById('quickStepDue').value = dueFromOffset(shortcut.getAttribute('data-due-offset'));
      return;
    }
    var done = event.target.closest && event.target.closest('[data-step-done]');
    if (done) {
      event.preventDefault();
      done.disabled = true;
      postForm('/opportunities/' + done.getAttribute('data-opportunity-id') + '/steps/' + done.getAttribute('data-step-done') + '/toggle', { isDone: 'true' })
        .then(function () {
          showToast('Next step marked as done.', 'success');
          refreshCurrentView();
        })
        .catch(function (err) {
          done.disabled = false;
          showToast('Failed: ' + err.message, 'error');
        });
    }
  });

  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || form.id !== 'quickStepForm') return;
    event.preventDefault();
    var submit = form.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    postForm(form.getAttribute('action'), new URLSearchParams(new FormData(form)))
      .then(function () {
        bootstrap.Modal.getOrCreateInstance(document.getElementById('quickStepModal')).hide();
        showToast('Next step added.', 'success');
        refreshCurrentView();
      })
      .catch(function (err) { showToast('Failed: ' + err.message, 'error'); })
      .finally(function () { if (submit) submit.disabled = false; });
  });

  /* ──── Command palette (Ctrl+K) ──── */

  var PAGES = [
    { type: 'page', label: 'Pipeline', url: '/', icon: 'bi-list-task' },
    { type: 'page', label: 'Pipeline board', url: '/?view=board', icon: 'bi-kanban' },
    { type: 'page', label: 'Management', url: '/management', icon: 'bi-bar-chart-steps' },
    { type: 'page', label: 'New opportunity', url: '/opportunities/new', icon: 'bi-plus-circle' },
    { type: 'page', label: 'Configuration', url: '/settings', icon: 'bi-gear' }
  ];
  var ICONS = { opportunity: 'bi-briefcase', person: 'bi-person', page: 'bi-arrow-return-right' };
  var paletteResults = [];
  var paletteIndex = 0;
  var paletteTimer = null;
  var paletteSeq = 0;

  function renderPalette() {
    var list = document.getElementById('paletteResults');
    if (!list) return;
    list.innerHTML = '';
    if (!paletteResults.length) {
      var empty = document.createElement('li');
      empty.className = 'palette-empty';
      empty.textContent = 'No matches.';
      list.appendChild(empty);
      return;
    }
    paletteResults.forEach(function (item, index) {
      var li = document.createElement('li');
      li.id = 'palette-option-' + index;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', index === paletteIndex ? 'true' : 'false');
      li.className = 'palette-item' + (index === paletteIndex ? ' is-active' : '');
      li.setAttribute('data-url', item.url);
      var icon = document.createElement('i');
      icon.className = 'bi ' + (item.icon || ICONS[item.type] || ICONS.page);
      icon.setAttribute('aria-hidden', 'true');
      var label = document.createElement('span');
      label.className = 'palette-label';
      label.textContent = item.label;
      li.appendChild(icon);
      li.appendChild(label);
      if (item.detail) {
        var detail = document.createElement('span');
        detail.className = 'palette-detail';
        detail.textContent = item.detail;
        li.appendChild(detail);
      }
      list.appendChild(li);
    });
    var input = document.getElementById('paletteInput');
    if (input) input.setAttribute('aria-activedescendant', 'palette-option-' + paletteIndex);
  }

  function searchPalette(query) {
    var needle = query.trim().toLowerCase();
    var pages = PAGES.filter(function (p) { return !needle || p.label.toLowerCase().includes(needle); });
    paletteIndex = 0;
    if (!needle) {
      paletteResults = pages;
      renderPalette();
      return;
    }
    var seq = ++paletteSeq;
    fetch('/api/search?q=' + encodeURIComponent(query.trim()), { headers: { 'Accept': 'application/json' } })
      .then(function (res) { return res.ok ? res.json() : { results: [] }; })
      .catch(function () { return { results: [] }; })
      .then(function (data) {
        if (seq !== paletteSeq) return; // a newer keystroke already answered
        paletteResults = (data.results || []).concat(pages);
        renderPalette();
      });
  }

  function openPalette() {
    var modalEl = document.getElementById('paletteModal');
    if (!modalEl) return;
    var input = document.getElementById('paletteInput');
    input.value = '';
    searchPalette('');
    var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modalEl.addEventListener('shown.bs.modal', function focusInput() {
      modalEl.removeEventListener('shown.bs.modal', focusInput);
      input.focus();
    });
    modal.show();
    input.focus();
  }

  function goTo(url) {
    if (url) window.location.href = url;
  }

  document.addEventListener('input', function (event) {
    if (event.target && event.target.id === 'paletteInput') {
      var value = event.target.value;
      clearTimeout(paletteTimer);
      paletteTimer = setTimeout(function () { searchPalette(value); }, 150);
    }
  });

  document.addEventListener('keydown', function (event) {
    if (!event.target || event.target.id !== 'paletteInput') return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!paletteResults.length) return;
      var step = event.key === 'ArrowDown' ? 1 : -1;
      paletteIndex = (paletteIndex + step + paletteResults.length) % paletteResults.length;
      renderPalette();
      var active = document.getElementById('palette-option-' + paletteIndex);
      if (active) active.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      var item = paletteResults[paletteIndex];
      if (item) goTo(item.url);
    }
  });

  document.addEventListener('click', function (event) {
    var option = event.target.closest && event.target.closest('.palette-item');
    if (option) {
      goTo(option.getAttribute('data-url'));
      return;
    }
    var trigger = event.target.closest && event.target.closest('[data-action]');
    if (!trigger) return;
    var action = trigger.getAttribute('data-action');
    if (action === 'open-palette') {
      event.preventDefault();
      openPalette();
    } else if (action === 'show-shortcuts') {
      event.preventDefault();
      bootstrap.Modal.getOrCreateInstance(document.getElementById('kbdModal')).show();
    }
  });

  /* ──── Keyboard shortcuts ──── */
  (function () {
    var gPressed = false;
    var gTimeout = null;

    function isTyping(el) {
      return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    }

    document.addEventListener('keydown', function (e) {
      // Ctrl/Cmd+K works everywhere, even while typing in a field.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        openPalette();
        return;
      }

      if (isTyping(e.target)) return;

      if (e.key === '?' && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        bootstrap.Modal.getOrCreateInstance(document.getElementById('kbdModal')).toggle();
        return;
      }

      if (e.key === 'D' && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        if (window.OPP_shell) window.OPP_shell.toggleTheme();
        return;
      }

      if (e.key === 'd' && e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        if (window.OPP_shell) window.OPP_shell.toggleDensity();
        return;
      }

      if (e.key === '/') {
        var searchInput = document.querySelector('[data-primary-search]') ||
          document.querySelector('.page-content input[type="search"], .page-content input[name="q"], .page-content input[placeholder*="ilter"]');
        if (searchInput) {
          e.preventDefault();
          searchInput.focus();
          return;
        }
      }

      // Shift+N rather than a bare N, so a stray key press never leaves the page.
      if (e.key === 'N' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        window.location.href = '/opportunities/new';
        return;
      }

      if (e.key === 'g' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (gPressed) return;
        gPressed = true;
        clearTimeout(gTimeout);
        gTimeout = setTimeout(function () { gPressed = false; }, 1000);
        return;
      }

      if (gPressed) {
        gPressed = false;
        clearTimeout(gTimeout);
        var navMap = { p: '/', h: '/', b: '/?view=board', m: '/management', s: '/settings', n: '/opportunities/new' };
        var dest = navMap[e.key];
        if (dest) { e.preventDefault(); window.location.href = dest; }
      }
    });
  })();

  /* ──── Page start-up ──── */

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(function (el) {
      if (window.bootstrap && bootstrap.Tooltip) new bootstrap.Tooltip(el);
    });

    document.querySelectorAll('.alert-dismissible[data-auto-dismiss]').forEach(function (alert) {
      window.setTimeout(function () {
        if (window.bootstrap && bootstrap.Alert) bootstrap.Alert.getOrCreateInstance(alert).close();
        else alert.remove();
      }, 6000);
    });

    if (window.location.hash) {
      var target = null;
      try { target = document.querySelector(window.location.hash); } catch (e) { target = null; }
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  window.showToast = showToast;
  window.filterTable = filterTable;
  window.filterGroupedTable = filterGroupedTable;
  window.filterTimeline = filterTimeline;
  window.showPageReloading = showPageReloading;
  window.reloadPageWithMessage = reloadPageWithMessage;
  window.showConfirmAction = showConfirmAction;
  window.OPP_postForm = postForm;
  window.OPP_refreshCurrentView = refreshCurrentView;
})();

/**
 * opportunity-form-dynamic.js
 *
 * The opportunity page:
 * - Saving the details form happens in the background; the page is then
 *   refreshed in place through the shared view-state helper, so the open tab,
 *   open cards and scroll position all stay where they were.
 * - The sticky save bar says whether there are unsaved changes, Ctrl+S saves,
 *   and leaving the page with unsaved edits asks first.
 * - Tabs follow the URL hash (#assignments, #notes, #steps, #activity), so a
 *   link or a redirect after adding a note lands on the right tab.
 */
(function () {
  'use strict';

  var dirty = false;
  var saving = false;

  function form() {
    return document.getElementById('opportunityForm');
  }

  function isNewForm(el) {
    var action = (el && el.getAttribute('action')) || '';
    return action === '/opportunities' || action.endsWith('/opportunities');
  }

  function serialise(el) {
    return new URLSearchParams(new FormData(el)).toString();
  }

  function setStatus(text, state) {
    var status = document.querySelector('[data-save-status]');
    var bar = document.querySelector('[data-save-bar]');
    if (status) status.textContent = text;
    if (bar) {
      bar.classList.toggle('is-dirty', state === 'dirty');
      bar.classList.toggle('is-saving', state === 'saving');
    }
  }

  function markDirty(el) {
    var now = serialise(el) !== el.dataset.initialState;
    if (now === dirty) return;
    dirty = now;
    if (dirty) setStatus('Unsaved changes', 'dirty');
    else setStatus(isNewForm(el) ? 'New opportunity' : 'All changes saved', 'clean');
    syncSaveBar();
  }

  /* The bar saves the Overview form, so it only shows there, or anywhere
     while that form has unsaved changes. */
  function syncSaveBar() {
    var bar = document.querySelector('[data-save-bar]');
    if (!bar) return;
    var active = document.querySelector('#opportunityTabs .nav-link.active');
    var onOverview = !active || active.getAttribute('data-tab-key') === 'overview';
    bar.classList.toggle('is-hidden', !onOverview && !dirty);
  }

  /* ── Tabs follow the hash ────────────────────────────────────── */

  function activateTabFor(hash) {
    if (!hash || hash.length < 2 || !window.bootstrap) return;
    var target = null;
    try {
      target = document.querySelector('[data-tab-key="' + hash.slice(1) + '"]') ||
        document.querySelector(hash);
    } catch (e) {
      return;
    }
    if (!target) return;
    var trigger = target.matches('[data-bs-toggle="tab"]') ? target : null;
    if (!trigger) {
      var pane = target.closest('.tab-pane');
      if (pane) trigger = document.querySelector('[data-bs-toggle="tab"][data-bs-target="#' + pane.id + '"]');
    }
    if (trigger) bootstrap.Tab.getOrCreateInstance(trigger).show();
  }

  function initTabs(root) {
    (root || document).querySelectorAll('#opportunityTabs [data-bs-toggle="tab"]:not([data-tab-init])').forEach(function (tab) {
      tab.setAttribute('data-tab-init', '');
      tab.addEventListener('shown.bs.tab', function () {
        var key = tab.getAttribute('data-tab-key');
        if (key && history.replaceState) history.replaceState(history.state, '', '#' + key);
        syncSaveBar();
      });
    });
    syncSaveBar();
  }

  /* ── Save ────────────────────────────────────────────────────── */

  function initForm(root) {
    var el = form();
    if (!el) return;
    initTabs(root);
    el.dataset.initialState = serialise(el);
    dirty = false;
    if (el.dataset.oppFormInit === 'true') return;
    el.dataset.oppFormInit = 'true';

    el.addEventListener('input', function () { markDirty(el); });
    el.addEventListener('change', function () { markDirty(el); });

    // A new opportunity is a normal post: it redirects to the record it made.
    if (isNewForm(el)) {
      el.addEventListener('submit', function () {
        dirty = false;
      });
      return;
    }

    el.addEventListener('submit', function (e) {
      e.preventDefault();
      if (saving) return;
      saving = true;
      setStatus('Saving…', 'saving');

      fetch(el.action, {
        method: 'POST',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: serialise(el),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data.ok) {
            setStatus('Not saved', 'dirty');
            if (typeof showToast === 'function') showToast(data.error || 'Save failed.', 'error');
            return null;
          }
          dirty = false;
          if (typeof showToast === 'function') showToast('Opportunity saved.', 'success');
          // Re-render in place: summary tiles, title and tabs pick up the change.
          return window.OPP_refreshView ? window.OPP_refreshView() : window.location.reload();
        })
        .catch(function () {
          setStatus('Not saved', 'dirty');
          if (typeof showToast === 'function') showToast('Network error.', 'error');
        })
        .finally(function () {
          saving = false;
        });
    });
  }

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
      var el = form();
      if (!el) return;
      e.preventDefault();
      if (el.requestSubmit) el.requestSubmit();
      else el.submit();
    }
  });

  window.addEventListener('beforeunload', function (e) {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  window.OPP_initOpportunityForm = initForm;

  function start() {
    initForm(document);
    activateTabFor(window.location.hash);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
  window.addEventListener('hashchange', function () { activateTabFor(window.location.hash); });
})();

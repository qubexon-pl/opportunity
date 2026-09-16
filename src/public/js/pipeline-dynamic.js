/* Pipeline page dynamic behaviour: intercepts filter form submit, "save as
   default", clear-filters link, and booking dropdown so the page never fully
   reloads.  Content is fetched with ?partial=pipeline and swapped in place,
   then JS modules are re-initialised on the new DOM. */
(function () {
  'use strict';

  var contentEl = null;
  var swapping = false;

  function init() {
    contentEl = document.getElementById('pipelineContent');
    if (!contentEl) return;

    interceptFilters();
    interceptDefaults();
    interceptClear();
    interceptBooking();

    window.addEventListener('popstate', function () {
      swapContent(window.location.href, false);
    });
  }

  /* ── Collapse state preservation ─────────────────────────────── */

  function saveCollapseState(container) {
    var states = {};
    container.querySelectorAll('.collapse').forEach(function (el) {
      if (el.id) states[el.id] = el.classList.contains('show');
    });
    return states;
  }

  function restoreCollapseState(container, states) {
    Object.keys(states).forEach(function (id) {
      var el = container.querySelector('#' + id);
      if (!el) return;
      var toggle = container.querySelector('[data-bs-target="#' + id + '"]');
      if (states[id]) {
        el.classList.add('show');
        if (toggle) {
          toggle.classList.remove('collapsed');
          toggle.setAttribute('aria-expanded', 'true');
        }
      } else {
        el.classList.remove('show');
        if (toggle) {
          toggle.classList.add('collapsed');
          toggle.setAttribute('aria-expanded', 'false');
        }
      }
    });
  }

  /* ── Content swap ────────────────────────────────────────────── */

  function swapContent(cleanUrl, pushState) {
    if (pushState === undefined) pushState = true;
    if (swapping) return;
    swapping = true;

    var separator = cleanUrl.indexOf('?') === -1 ? '?' : '&';
    var fetchUrl = cleanUrl + separator + 'partial=pipeline';

    fetch(fetchUrl, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .then(function (res) {
        if (!res.ok) throw new Error('Server returned ' + res.status);
        return res.text();
      })
      .then(function (html) {
        /* Remember collapse states of all cards. */
        var collapseStates = saveCollapseState(contentEl);

        /* Remember the row filter text box. */
        var rowFilter = contentEl.querySelector('input[oninput*="filterTable"]');
        var rowFilterVal = rowFilter ? rowFilter.value : '';

        contentEl.innerHTML = html;

        if (pushState && cleanUrl !== window.location.href) {
          history.pushState({ pipeline: true }, '', cleanUrl);
        }

        /* Restore collapse states. */
        restoreCollapseState(contentEl, collapseStates);

        /* Re-init JS modules on the new DOM. */
        if (window.OPP_initMultiselects) window.OPP_initMultiselects(contentEl);
        if (window.OPP_initUpcomingFilter) window.OPP_initUpcomingFilter(contentEl);

        /* Restore row filter. */
        if (rowFilterVal) {
          var newRf = contentEl.querySelector('input[oninput*="filterTable"]');
          if (newRf) { newRf.value = rowFilterVal; newRf.dispatchEvent(new Event('input')); }
        }

        /* Re-attach interceptors. */
        interceptFilters();
        interceptDefaults();
        interceptClear();
        interceptBooking();
      })
      .catch(function (err) {
        if (typeof showToast === 'function') showToast('Failed to update: ' + err.message, 'danger');
      })
      .finally(function () { swapping = false; });
  }

  window.OPP_pipelineSwap = function () {
    swapContent(window.location.href, false);
  };

  /* ── Filter form ─────────────────────────────────────────────── */

  function interceptFilters() {
    var form = contentEl.querySelector('form[data-pipeline-filter]:not([data-pipeline-bound])');
    if (!form) return;
    form.setAttribute('data-pipeline-bound', '');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var params = new URLSearchParams(new FormData(form));
      swapContent('/?' + params.toString());
    });
  }

  /* ── Save as default ─────────────────────────────────────────── */

  function interceptDefaults() {
    var form = contentEl.querySelector('form[data-pipeline-defaults]:not([data-pipeline-bound])');
    if (!form) return;
    form.setAttribute('data-pipeline-bound', '');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      fetch(form.getAttribute('action') || '/pipeline/defaults', {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        body: new FormData(form)
      })
        .then(function (res) {
          if (!res.ok) return res.json().then(function (d) { throw new Error(d.error || 'Server error'); });
          return res.json();
        })
        .then(function () {
          if (typeof showToast === 'function') showToast('Saved as your default.', 'success');
          swapContent(window.location.href, false);
        })
        .catch(function (err) {
          if (typeof showToast === 'function') showToast('Failed: ' + err.message, 'danger');
        });
    });
  }

  /* ── Clear filters ───────────────────────────────────────────── */

  function interceptClear() {
    var link = contentEl.querySelector('a[data-pipeline-clear]:not([data-pipeline-bound])');
    if (!link) return;
    link.setAttribute('data-pipeline-bound', '');
    link.addEventListener('click', function (e) {
      e.preventDefault();
      swapContent(link.getAttribute('href'));
    });
  }

  /* ── Booking dropdown ────────────────────────────────────────── */

  function interceptBooking() {
    contentEl.querySelectorAll('select[data-pipeline-booking]:not([data-pipeline-bound])').forEach(function (select) {
      select.setAttribute('data-pipeline-bound', '');
      select.addEventListener('change', function () {
        var form = select.closest('form');
        if (!form) return;

        var action = form.getAttribute('action') || '';
        var formData = new FormData(form);

        fetch(action, {
          method: 'POST',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          body: formData
        })
          .then(function (res) {
            if (!res.ok) return res.json().then(function (d) { throw new Error(d.error || 'Server error'); });
            return res.json();
          })
          .then(function () {
            if (typeof showToast === 'function') showToast('Capacity booking updated.', 'success');
            swapContent(window.location.href, false);
          })
          .catch(function (err) {
            if (typeof showToast === 'function') showToast('Failed: ' + err.message, 'danger');
          });
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

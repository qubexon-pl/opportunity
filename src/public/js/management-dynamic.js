/* Management page dynamic behaviour: intercepts perspective filters, sort
   links, quick-assign, visibility toggle, and legend chips so that the page
   never fully reloads.  Content is fetched with ?partial=1 and swapped in
   place, then all JS modules are re-initialised on the new DOM. */
(function () {
  'use strict';

  var STORAGE_KEY = 'mgmt-active-tab';
  var contentEl = null;
  var swapping = false;

  function init() {
    contentEl = document.getElementById('managementContent');
    if (!contentEl) return;
    updateExportHref();

    initTabPersistence();
    interceptForms();
    interceptLinks();
    interceptVisibility();
    interceptDefaults();
    interceptQuickAssign();

    window.addEventListener('popstate', function () {
      swapContent(window.location.href, false);
    });
  }

  /* ── Tab persistence ───────────────────────────────────────────── */

  function initTabPersistence() {
    var tabs = contentEl.querySelectorAll('[data-bs-toggle="tab"]');
    tabs.forEach(function (tab) {
      tab.addEventListener('shown.bs.tab', function (e) {
        var target = e.target.getAttribute('data-bs-target');
        try { sessionStorage.setItem(STORAGE_KEY, target); } catch (err) { /* ignore */ }
      });
    });

    var saved = null;
    try { saved = sessionStorage.getItem(STORAGE_KEY); } catch (err) { /* ignore */ }
    if (saved) {
      var trigger = contentEl.querySelector('[data-bs-target="' + saved + '"]');
      if (trigger && !trigger.classList.contains('active')) {
        var tab = bootstrap.Tab.getInstance(trigger) || new bootstrap.Tab(trigger);
        tab.show();
      }
    }
  }

  /* ── Content swap ────────────────────────────────────────────── */

  /* State capture, restore and re-initialisation are shared with every other
     screen through live-update.js (OPP_viewState), which is loaded on every
     page, so the management view behaves the same as the rest of the app. */
  function captureState(container) {
    return window.OPP_viewState.capture(container);
  }

  function restoreState(container, state) {
    window.OPP_viewState.restore(container, state);
  }

  function swapContent(cleanUrl, pushState) {
    if (pushState === undefined) pushState = true;
    if (swapping) return;
    swapping = true;

    var separator = cleanUrl.indexOf('?') === -1 ? '?' : '&';
    var fetchUrl = cleanUrl + separator + 'partial=1';

    return fetch(fetchUrl, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .then(function (res) {
        if (!res.ok) throw new Error('Server returned ' + res.status);
        return res.text();
      })
      .then(function (html) {
        /* Remember everything about how the page is currently arranged, so
           the swap is invisible apart from the numbers changing. */
        var state = captureState(contentEl);

        /* Remember filter input values that live outside the server-rendered
           form (the assignment filter and timeline filter text boxes). */
        var assignmentFilter = contentEl.querySelector('#collapseAssignments input[data-filter-grouped]');
        var assignmentFilterVal = assignmentFilter ? assignmentFilter.value : '';
        var timelineFilter = contentEl.querySelector('[data-timeline-filter]');
        var timelineFilterVal = timelineFilter ? timelineFilter.value : '';

        contentEl.innerHTML = html;

        if (pushState && cleanUrl !== window.location.href) {
          history.pushState({ mgmt: true }, '', cleanUrl);
        }

        /* Re-initialise every JS module on the new DOM. */
        reinitAll(contentEl);

        /* Restore filter text boxes before the scroll is put back, because
           filtering rows changes the page height. */
        if (assignmentFilterVal) {
          var newAf = contentEl.querySelector('#collapseAssignments input[data-filter-grouped]');
          if (newAf) { newAf.value = assignmentFilterVal; newAf.dispatchEvent(new Event('input')); }
        }
        if (timelineFilterVal) {
          var newTf = contentEl.querySelector('[data-timeline-filter]');
          if (newTf) { newTf.value = timelineFilterVal; newTf.dispatchEvent(new Event('input')); }
        }

        restoreState(contentEl, state);

        /* Re-attach all interceptors. */
        interceptForms();
        interceptLinks();
        interceptVisibility();
        interceptDefaults();
        interceptQuickAssign();
      })
      .catch(function (err) {
        if (typeof showToast === 'function') {
          showToast('Failed to update: ' + err.message, 'danger');
        }
      })
      .finally(function () { swapping = false; });
  }

  /* Exposed for timeline.js to call after a drag-resize save. */
  window.OPP_mgmtSwap = function () {
    swapContent(window.location.href, false);
  };

  function reinitAll(container) {
    window.OPP_viewState.reinit(container);
    updateExportHref();
  }

  /* The export button always downloads what the filters currently show. */
  function updateExportHref() {
    var btn = document.getElementById('exportAssignmentsBtn');
    if (!btn) return;
    var params = new URLSearchParams(window.location.search);
    params.delete('partial');
    params.set('applied', '1');
    btn.href = '/management/assignments/export?' + params.toString();
  }
  window.OPP_updateExportHref = updateExportHref;

  /* ── Perspective GET form ────────────────────────────────────── */

  function interceptForms() {
    contentEl.querySelectorAll('form[data-mgmt-form]:not([data-mgmt-bound])').forEach(function (form) {
      form.setAttribute('data-mgmt-bound', '');
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var action = form.getAttribute('action') || '/management';
        var params = new URLSearchParams(new FormData(form));
        var url = action + '?' + params.toString();

        /* Every tab reads the same filter state, so all of them are
           refreshed together. Updating only the tab that was submitted used
           to leave the others - and the URL, and the export link - showing
           the previous selection. */
        swapContent(url);
      });
    });
  }

  /* ── Sort links & legend chips ───────────────────────────────── */

  function interceptLinks() {
    contentEl.querySelectorAll('a[data-mgmt-link]:not([data-mgmt-bound])').forEach(function (link) {
      link.setAttribute('data-mgmt-bound', '');
      link.addEventListener('click', function (e) {
        e.preventDefault();
        swapContent(link.getAttribute('href'));
      });
    });
  }

  /* ── Visibility toggle ───────────────────────────────────────── */

  function interceptVisibility() {
    contentEl.querySelectorAll('form[data-mgmt-visibility]:not([data-mgmt-bound])').forEach(function (form) {
      form.setAttribute('data-mgmt-bound', '');
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var assignmentId = form.getAttribute('data-assignment-id');
        var nextVisible = form.getAttribute('data-next-visible') === 'true';

        fetch('/api/assignments/' + encodeURIComponent(assignmentId), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isTimelineVisible: nextVisible })
        })
          .then(function (res) {
            if (!res.ok) throw new Error('Server returned ' + res.status);
            return res.json();
          })
          .then(function () {
            if (typeof showToast === 'function') showToast('Visibility updated.', 'success');
            swapContent(window.location.href, false);
          })
          .catch(function (err) {
            if (typeof showToast === 'function') showToast('Failed: ' + err.message, 'danger');
          });
      });
    });
  }

  /* ── Save defaults ───────────────────────────────────────────── */

  function interceptDefaults() {
    contentEl.querySelectorAll('form[data-mgmt-defaults]:not([data-mgmt-bound])').forEach(function (form) {
      form.setAttribute('data-mgmt-bound', '');
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        fetch(form.getAttribute('action') || '/management/defaults', {
          method: 'POST',
          body: new FormData(form)
        })
          .then(function (res) {
            if (!res.ok) throw new Error('Server returned ' + res.status);
          })
          .then(function () {
            if (typeof showToast === 'function') showToast('Saved as your default.', 'success');
            swapContent(window.location.href, false);
          })
          .catch(function (err) {
            if (typeof showToast === 'function') showToast('Failed: ' + err.message, 'danger');
          });
      });
    });
  }

  /* ── Quick assign ─────────────────────────────────────────────── */

  function interceptQuickAssign() {
    contentEl.querySelectorAll('.allocation-form:not([data-mgmt-bound])').forEach(function (form) {
      var action = form.getAttribute('action') || '';
      if (action.indexOf('/management/assignments') === -1) return;

      form.setAttribute('data-mgmt-bound', '');
      form.addEventListener('submit', function (e) {
        e.preventDefault();

        var opportunityId = form.querySelector('[name="opportunityId"]');
        opportunityId = opportunityId ? opportunityId.value : '';
        if (!opportunityId) {
          if (typeof showToast === 'function') showToast('Please select an opportunity.', 'warning');
          return;
        }

        var body = {
          personName: (form.querySelector('[name="personName"]') || {}).value || '',
          plannedStartDate: (form.querySelector('[name="plannedStartDate"]') || {}).value || '',
          plannedEndDate: (form.querySelector('[name="plannedEndDate"]') || {}).value || '',
          isTimelineVisible: true
        };
        var pct = parseFloat((form.querySelector('[name="allocationPercent"]') || {}).value);
        var hrs = parseFloat((form.querySelector('[name="allocatedHours"]') || {}).value);
        if (Number.isFinite(pct) && pct > 0) body.allocationPercent = pct;
        if (Number.isFinite(hrs) && hrs > 0) body.allocatedHours = hrs;

        var btn = form.querySelector('button[type="submit"]');
        var origHtml = '';
        if (btn) { origHtml = btn.innerHTML; btn.disabled = true; btn.textContent = '...'; }

        fetch('/api/opportunities/' + encodeURIComponent(opportunityId) + '/assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
          .then(function (res) {
            if (!res.ok) return res.json().then(function (d) { throw new Error(d.error || 'Server error'); });
            return res.json();
          })
          .then(function () {
            if (typeof showToast === 'function') showToast('Assignment created.', 'success');
            swapContent(window.location.href, false);
          })
          .catch(function (err) {
            if (typeof showToast === 'function') showToast('Failed: ' + err.message, 'danger');
          })
          .finally(function () {
            if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
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

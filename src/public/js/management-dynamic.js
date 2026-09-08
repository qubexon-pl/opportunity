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

  function swapContent(cleanUrl, pushState = true) {
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
        /* Remember which tab was active so it survives the swap. */
        var activeTab = contentEl.querySelector('.nav-link.active');
        var activeTarget = activeTab ? activeTab.getAttribute('data-bs-target') : null;

        /* Remember filter input values that live outside the server-rendered
           form (the assignment filter and timeline filter text boxes). */
        var assignmentFilter = contentEl.querySelector('#collapseAssignments input[oninput*="filterGroupedTable"]');
        var assignmentFilterVal = assignmentFilter ? assignmentFilter.value : '';
        var timelineFilter = contentEl.querySelector('[data-timeline-filter]');
        var timelineFilterVal = timelineFilter ? timelineFilter.value : '';

        contentEl.innerHTML = html;

        if (pushState && cleanUrl !== window.location.href) {
          history.pushState({ mgmt: true }, '', cleanUrl);
        }

        /* Update people daily hours from the embedded JSON script. */
        var hoursScript = contentEl.querySelector('#mgmtPeopleDailyHours');
        if (hoursScript) {
          try { window.OPP_PEOPLE_DAILY_HOURS = JSON.parse(hoursScript.textContent); }
          catch (err) { /* ignore */ }
        }

        /* Re-initialise every JS module on the new DOM. */
        reinitAll(contentEl);

        /* Restore the active tab. */
        if (activeTarget) {
          var trigger = contentEl.querySelector('[data-bs-target="' + activeTarget + '"]');
          if (trigger) {
            var tab = bootstrap.Tab.getInstance(trigger) || new bootstrap.Tab(trigger);
            tab.show();
          }
        }

        /* Restore filter text boxes. */
        if (assignmentFilterVal) {
          var newAf = contentEl.querySelector('#collapseAssignments input[oninput*="filterGroupedTable"]');
          if (newAf) { newAf.value = assignmentFilterVal; newAf.dispatchEvent(new Event('input')); }
        }
        if (timelineFilterVal) {
          var newTf = contentEl.querySelector('[data-timeline-filter]');
          if (newTf) { newTf.value = timelineFilterVal; newTf.dispatchEvent(new Event('input')); }
        }

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
    if (window.OPP_initMultiselects) window.OPP_initMultiselects(container);
    if (window.OPP_initAllocationForms) window.OPP_initAllocationForms(container);
    if (window.OPP_initTimelineScroll) window.OPP_initTimelineScroll(container);
    if (window.OPP_initTimelineDrag) window.OPP_initTimelineDrag();
    if (window.OPP_initViewState) window.OPP_initViewState(container);
  }

  /* ── Perspective GET form ────────────────────────────────────── */

  function interceptForms() {
    contentEl.querySelectorAll('form[data-mgmt-form]:not([data-mgmt-bound])').forEach(function (form) {
      form.setAttribute('data-mgmt-bound', '');
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var action = form.getAttribute('action') || '/management';
        var params = new URLSearchParams(new FormData(form));
        swapContent(action + '?' + params.toString());
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

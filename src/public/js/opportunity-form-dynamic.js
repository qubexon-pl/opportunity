/**
 * opportunity-form-dynamic.js
 *
 * Intercepts the opportunity detail form save so the page doesn't reload.
 * After a successful save, fetches the updated content as a partial and
 * swaps it in while preserving the collapse state of all cards.
 */
(function () {
  'use strict';

  var swapUrl = window.location.pathname + '?partial=detail';

  function saveCollapseState(container) {
    var states = {};
    container.querySelectorAll('.collapse[id]').forEach(function (el) {
      states[el.id] = el.classList.contains('show');
    });
    return states;
  }

  function syncSessionStorage(container) {
    var key = 'opp-collapsed:' + window.location.pathname;
    var data = {};
    container.querySelectorAll('.collapse[id]').forEach(function (el) {
      var toggle = container.querySelector('[data-bs-target="#' + el.id + '"]');
      if (toggle && toggle.classList.contains('card-collapse-toggle')) {
        if (!el.classList.contains('show')) data['#' + el.id] = true;
      }
    });
    try { sessionStorage.setItem(key, JSON.stringify(data)); } catch (e) { /* storage disabled */ }
  }

  function restoreCollapseState(container, states) {
    container.querySelectorAll('.collapse[id]').forEach(function (el) {
      var isOpen = !!states[el.id];
      if (isOpen) {
        el.classList.add('show');
      } else {
        el.classList.remove('show');
      }
      var toggle = container.querySelector('[data-bs-target="#' + el.id + '"]');
      if (toggle) {
        if (isOpen) {
          toggle.classList.remove('collapsed');
          toggle.setAttribute('aria-expanded', 'true');
        } else {
          toggle.classList.add('collapsed');
          toggle.setAttribute('aria-expanded', 'false');
        }
      }
    });
  }

  function init() {
    var form = document.getElementById('opportunityForm');
    if (!form) return;
    // Only intercept on edit pages (action contains an ID), not new
    var action = form.getAttribute('action') || '';
    if (action === '/opportunities' || action.endsWith('/opportunities')) return;
    if (form.dataset.oppFormInit === 'true') return;
    form.dataset.oppFormInit = 'true';

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var container = document.getElementById('opportunityDetail');
      if (!container) return;

      var submitBtn = form.querySelector('button[type="submit"]');
      var originalHtml = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
      }

      var formData = new FormData(form);
      var params = new URLSearchParams();
      formData.forEach(function (value, key) {
        params.append(key, value);
      });

      fetch(form.action, {
        method: 'POST',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data.ok) {
            if (typeof showToast === 'function') showToast(data.error || 'Save failed.', 'error');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = originalHtml; }
            return;
          }
          // Fetch updated partial
          return fetch(swapUrl).then(function (r) { return r.text(); }).then(function (html) {
            var states = saveCollapseState(container);
            // Parse the fetched HTML — it includes the #opportunityDetail wrapper
            var temp = document.createElement('div');
            temp.innerHTML = html;
            var newContainer = temp.querySelector('#opportunityDetail');
            if (!newContainer) {
              // Fallback: use whatever was returned
              container.innerHTML = html;
            } else {
              container.replaceWith(newContainer);
              container = newContainer;
            }
            // Sync sessionStorage so OPP_initViewState applies correct state
            syncSessionStorage(container);
            // Re-init view state (reads sessionStorage, adds click listeners)
            if (window.OPP_initViewState) window.OPP_initViewState(container);
            // Override with captured states for non-card-collapse elements
            restoreCollapseState(container, states);
            // Re-init allocation.js
            if (window.OPP_initAllocationForms) window.OPP_initAllocationForms(container);
            // Re-init multiselects
            if (window.OPP_initMultiselects) {
              window.OPP_initMultiselects(container);
            }
            // Re-init the form interceptor on the new DOM
            init();
            if (typeof showToast === 'function') showToast('Opportunity saved.', 'success');
          });
        })
        .catch(function () {
          if (typeof showToast === 'function') showToast('Network error.', 'error');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = originalHtml; }
        });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/**
 * Upcoming actions period filter: intercepts the period dropdown so only the
 * card content refreshes via AJAX instead of reloading the whole page.
 */
(function () {
  'use strict';

  function init(container) {
    container = container || document;
    var form = container.querySelector('[data-upcoming-filter]');
    if (!form || form.dataset.upcomingInit) return;
    form.dataset.upcomingInit = '1';

    var select = form.querySelector('select[name="period"]');
    if (!select) return;

    select.addEventListener('change', async function () {
      var params = new URLSearchParams();
      // Collect hidden fields from the form (preserves search, stage, status, sort)
      var formData = new FormData(form);
      formData.forEach(function (val, key) { params.append(key, val); });
      params.set('partial', 'upcoming');

      var url = '/?' + params.toString();
      try {
        var resp = await fetch(url, { headers: { 'Accept': 'text/html' } });
        if (!resp.ok) throw new Error('Failed to fetch upcoming actions');
        var html = await resp.text();
        var wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        var newCard = wrapper.querySelector('#upcomingCard');
        var oldCard = document.getElementById('upcomingCard');
        if (newCard && oldCard) {
          // Preserve collapse state
          var wasOpen = oldCard.querySelector('#collapseUpcoming.show');
          if (wasOpen) {
            var body = newCard.querySelector('#collapseUpcoming');
            if (body) body.classList.add('show');
            var toggle = newCard.querySelector('[data-bs-target="#collapseUpcoming"]');
            if (toggle) { toggle.classList.remove('collapsed'); toggle.setAttribute('aria-expanded', 'true'); }
          }
          oldCard.replaceWith(newCard);
          init(newCard);
        }
      } catch (e) {
        if (typeof showToast === 'function') showToast('Could not refresh: ' + e.message, 'error');
      }
    });
  }

  window.OPP_initUpcomingFilter = init;

  document.addEventListener('DOMContentLoaded', function () {
    init(document);
  });
})();

/* The team-health pill in the top bar.

   Chargeability over the selected period, fetched in the background so no page
   render waits on a second capacity build. The pill lives outside the region
   the live-update swap replaces, so it is refreshed explicitly whenever the
   content underneath it changes. */
(function () {
  'use strict';

  var TONE_CLASSES = ['is-good', 'is-warn', 'is-bad', 'is-loading', 'is-unknown'];

  function pill() {
    return document.querySelector('[data-team-health]');
  }

  /* On the management page the reader has usually changed the period, so ask
     about the window actually on screen rather than their saved default. */
  function endpoint() {
    if (window.location.pathname.indexOf('/management') !== 0) return '/api/team-health';
    var search = window.location.search.replace(/^\?/, '');
    return search ? '/api/team-health?' + search : '/api/team-health';
  }

  function paint(el, tone, text, title) {
    TONE_CLASSES.forEach(function (name) { el.classList.remove(name); });
    el.classList.add(tone);
    el.hidden = false;
    var label = el.querySelector('[data-team-health-text]');
    if (label) label.textContent = text;
    el.setAttribute('title', title || text);
  }

  var inFlight = null;

  function refresh() {
    var el = pill();
    if (!el) return Promise.resolve();
    if (inFlight) return inFlight;

    inFlight = fetch(endpoint(), { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data || !data.ok) {
          /* No data is not the same as bad data: say nothing rather than
             reporting a team that looks like it is at 0%. */
          el.hidden = true;
          return;
        }
        var detail = data.peopleCount + ' people · ' + data.activeHours + 'h of ' + data.capacityHours +
          'h · ' + data.windowLabel + (data.isPast ? ' (past period)' : '') +
          ' · ' + data.predicted + '% including soft bookings';
        paint(el, 'is-' + data.tone, data.summary, detail);
      })
      .catch(function () {
        el.hidden = true;
      })
      .then(function () {
        inFlight = null;
      });

    return inFlight;
  }

  window.OPP_refreshTeamHealth = refresh;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh);
  } else {
    refresh();
  }
})();

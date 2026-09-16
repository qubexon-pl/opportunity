/* Global busy indicator.

   Every data request in this app goes through fetch, so fetch itself is
   wrapped: anything that loads from or saves to the database lights the
   spinner, including code written later that knows nothing about this file.

   The indicator is a small floating circle rather than a blocking curtain,
   because the point is to show that work is happening without taking the
   page away from the person looking at it. */
(function () {
  'use strict';

  /* Requests often overlap (a save followed by a refresh), so this is a count
     rather than a flag - the spinner stops only when the last one finishes. */
  var pending = 0;
  var shownAt = 0;
  var hideTimer = null;

  /* Long enough to register as a deliberate signal, short enough not to feel
     like a delay. Without it a fast response makes the circle flicker. */
  var MIN_VISIBLE_MS = 400;

  function indicator() {
    return document.getElementById('reloadOverlay');
  }

  function label(text) {
    var el = document.getElementById('reloadOverlayText');
    if (el && text) el.textContent = text;
  }

  function show(text) {
    var el = indicator();
    if (!el) return;
    window.clearTimeout(hideTimer);
    label(text || 'Working...');
    if (!el.classList.contains('d-none')) return;
    el.classList.remove('d-none');
    el.setAttribute('aria-busy', 'true');
    shownAt = Date.now();
  }

  function hide() {
    var el = indicator();
    if (!el) return;
    var elapsed = Date.now() - shownAt;
    var wait = Math.max(0, MIN_VISIBLE_MS - elapsed);
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(function () {
      if (pending > 0) return;
      el.classList.add('d-none');
      el.removeAttribute('aria-busy');
      releaseButtons();
    }, wait);
  }

  function begin(text) {
    pending += 1;
    show(text);
  }

  function end() {
    pending = Math.max(0, pending - 1);
    if (pending === 0) hide();
  }

  /* Wrap a promise so the spinner always stops, successfully or not. */
  function wrap(promise, text) {
    begin(text);
    return Promise.resolve(promise).finally(end);
  }

  /* ── Per-control feedback ──────────────────────────────────────────
     The floating circle says "something is happening"; spinning the control
     that was actually pressed says "your click landed on this". */

  var busyControls = [];

  function holdButton(btn) {
    if (!btn || btn.disabled || btn.dataset.busyHeld === 'true') return;
    btn.dataset.busyHeld = 'true';
    btn.dataset.busyHtml = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('is-busy');
    /* Keep the original width so the row does not jump as the label changes. */
    var width = btn.getBoundingClientRect().width || btn.offsetWidth;
    if (width) btn.style.minWidth = Math.round(width) + 'px';
    btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
    busyControls.push(btn);
  }

  function releaseButtons() {
    busyControls.forEach(function (btn) {
      if (btn.dataset.busyHtml !== undefined) btn.innerHTML = btn.dataset.busyHtml;
      btn.disabled = false;
      btn.classList.remove('is-busy');
      btn.style.minWidth = '';
      delete btn.dataset.busyHeld;
      delete btn.dataset.busyHtml;
    });
    busyControls = [];
  }

  /* ── fetch wrapper ────────────────────────────────────────────────── */

  if (window.fetch && !window.fetch.__oppBusy) {
    var nativeFetch = window.fetch.bind(window);
    var wrapped = function (input, opts) {
      var method = ((opts && opts.method) || 'GET').toUpperCase();
      begin(method === 'GET' ? 'Loading...' : 'Saving...');
      return nativeFetch(input, opts).finally(end);
    };
    wrapped.__oppBusy = true;
    window.fetch = wrapped;
  }

  /* Spin the pressed control for any form submit that is handled in the
     background. A form left to navigate natively is not touched, so the
     button is not stuck disabled while the browser leaves the page. */
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || form.dataset.confirmed === 'true') return;
    var submitter = event.submitter || form.querySelector('button[type="submit"], button:not([type])');
    /* Let the page-specific handlers run first, then check whether one of
       them took over. Only then is it safe to hold the button. */
    window.setTimeout(function () {
      if (event.defaultPrevented && pending > 0) holdButton(submitter);
    }, 0);
  }, true);

  window.OPP_busy = { begin: begin, end: end, wrap: wrap, hold: holdButton };
})();

(function () {
  'use strict';

  // The page scrolls inside .main-content, not the window, so that is what has
  // to be measured and put back.
  function scroller() {
    return document.querySelector('.main-content');
  }

  /*
   * Changing a filter reloads the page, which would otherwise drop the reader
   * back at the top and make them scroll to the board again. The position is
   * stashed on the way out and restored on the way in, per page.
   */
  function keepScrollPosition() {
    var key = 'opp-scroll:' + window.location.pathname;
    var pane = scroller();
    if (!pane) return;

    document.addEventListener('submit', function (event) {
      // Only for navigations that reload this same page.
      var form = event.target;
      if (!form || form.hasAttribute('data-no-scroll-restore')) return;
      try {
        sessionStorage.setItem(key, String(pane.scrollTop));
      } catch (error) {
        /* storage disabled: the position is a convenience, never a requirement */
      }
    }, true);

    var saved = null;
    try {
      saved = sessionStorage.getItem(key);
      sessionStorage.removeItem(key);
    } catch (error) {
      saved = null;
    }
    if (saved === null) return;

    var target = Number(saved);
    if (!isFinite(target) || target <= 0) return;

    // Cards and the timeline settle after layout, so the position is reapplied
    // until it takes rather than set once against a shorter page.
    var attempts = 0;
    (function settle() {
      pane.scrollTop = target;
      attempts += 1;
      if (attempts < 5 && Math.abs(pane.scrollTop - target) > 1) {
        window.requestAnimationFrame(settle);
      }
    })();

    // Late layout (fonts, the timeline sizing itself) can shorten the page
    // after the first attempts, so the position is claimed once more.
    window.addEventListener('load', function () {
      if (Math.abs(pane.scrollTop - target) > 1) pane.scrollTop = target;
    });
  }

  /*
   * Docked filters: the card condenses to its header once it has been scrolled
   * past, so it stays reachable without covering the board. Expanding it while
   * docked opens the full form over the page, like a panel.
   */
  function dockedFilters() {
    var dock = document.getElementById('perspectiveDock');
    var pane = scroller();
    if (!dock || !pane) return;

    var toggle = dock.querySelector('[data-perspective-toggle]');
    // The top bar's height changes with display density, so the dock's offset is
    // measured rather than assumed; a stale offset would leave a gap that page
    // content slides through, or hide the dock behind the bar.
    var offset = function () {
      var topbar = document.querySelector('.topbar');
      return topbar ? Math.round(topbar.getBoundingClientRect().height) : 0;
    };

    var applyOffset = function () {
      dock.style.top = offset() + 'px';
    };

    var queued = false;
    var refresh = function () {
      queued = false;
      var stuck = dock.getBoundingClientRect().top <= offset() + 1;
      if (stuck === dock.classList.contains('is-stuck')) return;
      dock.classList.toggle('is-stuck', stuck);
      // Coming back to the top shows the whole form again, so the open state
      // does not linger and hide the filters behind a click.
      if (!stuck) dock.classList.remove('is-open');
    };

    applyOffset();

    pane.addEventListener('scroll', function () {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(refresh);
    }, { passive: true });
    window.addEventListener('resize', function () {
      applyOffset();
      refresh();
    });
    refresh();

    if (!toggle) return;
    toggle.addEventListener('click', function () {
      var open = !dock.classList.contains('is-open');
      dock.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.title = open ? 'Hide the filters' : 'Show the filters';
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    keepScrollPosition();
    dockedFilters();
  });
})();

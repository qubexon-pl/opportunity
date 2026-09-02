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

  /*
   * Full page timeline: the board is the point of this screen, so it can take
   * over the viewport. The state survives the reload that a filter change
   * causes, otherwise every adjustment would drop the reader back out of it.
   */
  function timelineFullPage() {
    var card = document.getElementById('timelineCard');
    if (!card) return;

    var toggle = card.querySelector('[data-timeline-fullpage]');
    var label = card.querySelector('[data-timeline-fullpage-label]');
    var key = 'opp-timeline-fullpage:' + window.location.pathname;

    function apply(on) {
      card.classList.toggle('timeline-card-fullpage', on);
      document.body.classList.toggle('has-timeline-fullpage', on);
      if (toggle) {
        toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
        toggle.title = on ? 'Back to the page (Esc)' : 'Show the timeline full page (F)';
        var icon = toggle.querySelector('i');
        if (icon) icon.className = on ? 'bi bi-fullscreen-exit me-1' : 'bi bi-arrows-fullscreen me-1';
      }
      if (label) label.textContent = on ? 'Exit full page' : 'Full page';
      try {
        if (on) sessionStorage.setItem(key, '1');
        else sessionStorage.removeItem(key);
      } catch (error) {
        /* storage disabled: the toggle still works, it just does not persist */
      }
      // The floating scrollbar measures the board, which has just resized.
      window.dispatchEvent(new Event('resize'));
    }

    function set(on) {
      apply(on);
      if (on) card.scrollIntoView({ block: 'nearest' });
    }

    if (toggle) {
      toggle.addEventListener('click', function () {
        set(!card.classList.contains('timeline-card-fullpage'));
      });
    }

    document.addEventListener('keydown', function (event) {
      // Never steal a key from someone filling in a filter or an hours field.
      var el = event.target;
      var typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;

      var on = card.classList.contains('timeline-card-fullpage');
      if (event.key === 'Escape' && on) {
        set(false);
      } else if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        set(!on);
      }
    });

    try {
      if (sessionStorage.getItem(key) === '1') apply(true);
    } catch (error) {
      /* storage disabled */
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    keepScrollPosition();
    dockedFilters();
    timelineFullPage();
  });
})();

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

    var attempts = 0;
    (function settle() {
      pane.scrollTop = target;
      attempts += 1;
      if (attempts < 5 && Math.abs(pane.scrollTop - target) > 1) {
        window.requestAnimationFrame(settle);
      }
    })();

    window.addEventListener('load', function () {
      if (Math.abs(pane.scrollTop - target) > 1) pane.scrollTop = target;
    });
  }

  /*
   * Full page timeline: the board is the point of this screen, so it can take
   * over the viewport. The state survives the reload that a filter change
   * causes, otherwise every adjustment would drop the reader back out of it.
   */
  var _tfp_card, _tfp_toggle, _tfp_label, _tfp_key;
  var _tfp_keyAdded = false;

  function _tfp_apply(on) {
    if (!_tfp_card) return;
    _tfp_card.classList.toggle('timeline-card-fullpage', on);
    document.body.classList.toggle('has-timeline-fullpage', on);
    if (_tfp_toggle) {
      _tfp_toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
      _tfp_toggle.title = on ? 'Back to the page (Esc)' : 'Show the timeline full page (F)';
      var icon = _tfp_toggle.querySelector('i');
      if (icon) icon.className = on ? 'bi bi-fullscreen-exit me-1' : 'bi bi-arrows-fullscreen me-1';
    }
    if (_tfp_label) _tfp_label.textContent = on ? 'Exit full page' : 'Full page';
    try {
      if (on) sessionStorage.setItem(_tfp_key, '1');
      else sessionStorage.removeItem(_tfp_key);
    } catch (error) {
      /* storage disabled: the toggle still works, it just does not persist */
    }
    window.dispatchEvent(new Event('resize'));
  }

  function _tfp_set(on) {
    _tfp_apply(on);
    if (on && _tfp_card) _tfp_card.scrollIntoView({ block: 'nearest' });
  }

  function timelineFullPage() {
    _tfp_card = document.getElementById('timelineCard');
    if (!_tfp_card) return;

    _tfp_toggle = _tfp_card.querySelector('[data-timeline-fullpage]:not([data-tfp-init])');
    if (!_tfp_toggle) {
      // Already initialized; just re-check sessionStorage state.
      try {
        if (sessionStorage.getItem(_tfp_key) === '1') _tfp_apply(true);
      } catch (error) { }
      return;
    }
    _tfp_toggle.setAttribute('data-tfp-init', '');
    _tfp_label = _tfp_card.querySelector('[data-timeline-fullpage-label]');
    _tfp_key = 'opp-timeline-fullpage:' + window.location.pathname;

    _tfp_toggle.addEventListener('click', function () {
      _tfp_set(!_tfp_card.classList.contains('timeline-card-fullpage'));
    });

    if (!_tfp_keyAdded) {
      document.addEventListener('keydown', function (event) {
        var el = event.target;
        var typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
        if (typing || event.ctrlKey || event.metaKey || event.altKey) return;

        var on = _tfp_card && _tfp_card.classList.contains('timeline-card-fullpage');
        if (event.key === 'Escape' && on) {
          _tfp_set(false);
        } else if (event.key === 'f' || event.key === 'F') {
          event.preventDefault();
          _tfp_set(!on);
        }
      });
      _tfp_keyAdded = true;
    }

    try {
      if (sessionStorage.getItem(_tfp_key) === '1') _tfp_apply(true);
    } catch (error) {
      /* storage disabled */
    }
  }

  /*
   * Collapsible card sections open by default; whatever the person opens or
   * closes is remembered per screen (all opportunity pages share one memory),
   * across reloads and visits, so each page comes back the way they left it.
   */
  function cardMemoryKey() {
    var path = window.location.pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id');
    return 'opp-cards:' + path;
  }

  function readCardMemory() {
    try {
      return JSON.parse(localStorage.getItem(cardMemoryKey()) || '{}') || {};
    } catch (error) {
      return {};
    }
  }

  function writeCardMemory(targetId, open) {
    try {
      var data = readCardMemory();
      data[targetId] = open;
      localStorage.setItem(cardMemoryKey(), JSON.stringify(data));
    } catch (error) {
      /* storage disabled: the cards just start in their default state */
    }
  }

  function setCardOpen(toggle, target, open) {
    target.classList.toggle('show', open);
    toggle.classList.toggle('collapsed', !open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function collapsibleCards(root) {
    var toggles = (root || document).querySelectorAll('.card-collapse-toggle[data-bs-target]:not([data-cc-init])');
    if (!toggles.length) return;

    var saved = readCardMemory();
    toggles.forEach(function (toggle) {
      toggle.setAttribute('data-cc-init', '');
      var targetId = toggle.getAttribute('data-bs-target');
      var target = targetId && document.querySelector(targetId);
      if (!target) return;
      if (typeof saved[targetId] === 'boolean') setCardOpen(toggle, target, saved[targetId]);

      target.addEventListener('shown.bs.collapse', function (event) {
        if (event.target === target) writeCardMemory(targetId, true);
      });
      target.addEventListener('hidden.bs.collapse', function (event) {
        if (event.target === target) writeCardMemory(targetId, false);
      });
    });
  }

  /*
   * Live-sort the people summary cards without reloading the page.
   * Each card carries data-* attributes that mirror the server-side sort
   * fields, so the client can re-sort the DOM in place.
   */
  function peopleSort() {
    var grid = document.getElementById('peopleGrid');
    if (!grid) return;
    var sortSelect = document.getElementById('peopleSort');
    var dirSelect = document.getElementById('peopleDir');
    if (!sortSelect || !dirSelect) return;

    var key = sortSelect.value;
    var dir = dirSelect.value;
    var attr = 'data-' + key;
    var cards = Array.prototype.slice.call(grid.children);

    cards.sort(function(a, b) {
      var av = a.getAttribute(attr) || '';
      var bv = b.getAttribute(attr) || '';
      var an = parseFloat(av);
      var bn = parseFloat(bv);
      var cmp;
      if (!isNaN(an) && !isNaN(bn)) cmp = an - bn;
      else cmp = av.localeCompare(bv);
      return dir === 'desc' ? -cmp : cmp;
    });

    cards.forEach(function(card) { grid.appendChild(card); });
  }

  function initViewState(container) {
    container = container || document;
    collapsibleCards(container);
    timelineFullPage();

    var sortSelect = container.querySelector('#peopleSort:not([data-ps-init])');
    var dirSelect = container.querySelector('#peopleDir:not([data-ps-init])');
    if (sortSelect) {
      sortSelect.setAttribute('data-ps-init', '');
      sortSelect.addEventListener('change', peopleSort);
    }
    if (dirSelect) {
      dirSelect.setAttribute('data-ps-init', '');
      dirSelect.addEventListener('change', peopleSort);
    }
  }

  window.OPP_initViewState = initViewState;
  window.OPP_cardMemory = { read: readCardMemory, key: cardMemoryKey };

  document.addEventListener('DOMContentLoaded', function () {
    keepScrollPosition();
    initViewState();
  });
})();

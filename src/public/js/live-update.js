/* Keeps the page still while data moves underneath it.

   Every form that is not already handled by a page-specific module is
   submitted in the background and the result is swapped into place, so
   saving or filtering no longer throws the reader back to the top of a
   freshly reloaded page. Scroll position, open sections, the active tab and
   the focused field are all carried across the swap.

   Exposes OPP_viewState so the other dynamic modules preserve state the same
   way, and OPP_refreshView so anything can ask for a silent refresh. */
(function () {
  'use strict';

  /* Containers are tried in order; the first one present is what gets
     replaced. Swapping the narrowest region keeps the rest of the DOM, and
     therefore its state, completely untouched. */
  var CONTAINERS = ['#managementContent', '#pipelineContent', '.page-content'];

  /* Handled elsewhere, with their own refresh behaviour. */
  var CLAIMED = [
    '[data-mgmt-form]',
    '[data-mgmt-defaults]',
    '[data-mgmt-visibility]',
    '[data-pipeline-filter]',
    '[data-pipeline-defaults]',
    '[data-upcoming-filter]',
    '[data-no-live]'
  ].join(',');

  function container(root) {
    root = root || document;
    for (var i = 0; i < CONTAINERS.length; i += 1) {
      var el = root.querySelector(CONTAINERS[i]);
      if (el) return el;
    }
    return null;
  }

  /* ── State capture ───────────────────────────────────────────────── */

  function describeFocus() {
    var el = document.activeElement;
    if (!el || el === document.body) return null;
    if (!el.matches('input, textarea, select')) return null;
    return {
      id: el.id || '',
      name: el.getAttribute('name') || '',
      start: el.selectionStart,
      end: el.selectionEnd
    };
  }

  /* The layout scrolls an inner pane rather than the window, so the position
     worth preserving lives on .main-content. Falls back to the document for
     any page that scrolls normally. */
  function pageScroller() {
    var pane = document.querySelector('.main-content');
    if (pane && pane.scrollHeight - pane.clientHeight > 4) return pane;
    return document.scrollingElement || document.documentElement;
  }

  function readScroll() {
    var el = pageScroller();
    return { top: el.scrollTop, left: el.scrollLeft };
  }

  function writeScroll(pos) {
    if (!pos) return;
    var el = pageScroller();
    el.scrollTop = pos.top;
    el.scrollLeft = pos.left;
  }

  function capture(root) {
    var collapses = {};
    root.querySelectorAll('.collapse').forEach(function (el) {
      if (el.id) collapses[el.id] = el.classList.contains('show');
    });

    var detailsOpen = {};
    root.querySelectorAll('details[id]').forEach(function (el) {
      detailsOpen[el.id] = el.open;
    });

    var activeTab = root.querySelector('.nav-link.active[data-bs-target]');

    /* Inner scrollers (the timeline board) scroll independently of the page. */
    var scrollers = {};
    root.querySelectorAll('[data-scroll-key]').forEach(function (el) {
      scrollers[el.getAttribute('data-scroll-key')] = el.scrollLeft;
    });

    return {
      collapses: collapses,
      detailsOpen: detailsOpen,
      activeTab: activeTab ? activeTab.getAttribute('data-bs-target') : null,
      scroll: readScroll(),
      scrollers: scrollers,
      focus: describeFocus()
    };
  }

  function restore(root, state) {
    if (!state) return;

    Object.keys(state.collapses).forEach(function (id) {
      var el = root.querySelector('#' + CSS.escape(id));
      if (!el) return;
      var toggle = root.querySelector('[data-bs-target="#' + id + '"]');
      var open = state.collapses[id];
      el.classList.toggle('show', open);
      if (toggle) {
        toggle.classList.toggle('collapsed', !open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
    });

    Object.keys(state.detailsOpen).forEach(function (id) {
      var el = root.querySelector('#' + CSS.escape(id));
      if (el) el.open = state.detailsOpen[id];
    });

    if (state.activeTab) {
      var trigger = root.querySelector('[data-bs-target="' + state.activeTab + '"]');
      if (trigger && window.bootstrap && bootstrap.Tab) {
        (bootstrap.Tab.getInstance(trigger) || new bootstrap.Tab(trigger)).show();
      }
    }

    Object.keys(state.scrollers).forEach(function (key) {
      var el = root.querySelector('[data-scroll-key="' + key + '"]');
      if (el) el.scrollLeft = state.scrollers[key];
    });

    if (state.focus && (state.focus.id || state.focus.name)) {
      var selector = state.focus.id
        ? '#' + CSS.escape(state.focus.id)
        : '[name="' + state.focus.name + '"]';
      var field = root.querySelector(selector);
      if (field) {
        try {
          field.focus({ preventScroll: true });
          if (field.setSelectionRange && state.focus.start !== null && state.focus.start !== undefined) {
            field.setSelectionRange(state.focus.start, state.focus.end);
          }
        } catch (err) { /* not all field types support selection */ }
      }
    }

    /* Scroll last: restoring tabs and collapses changes the page height, so
       an earlier restore would be undone by the reflow. A second pass after
       layout settles catches content that grows as images and charts size. */
    writeScroll(state.scroll);
    requestAnimationFrame(function () { writeScroll(state.scroll); });
  }

  function reinit(root) {
    if (window.OPP_initMultiselects) window.OPP_initMultiselects(root);
    if (window.OPP_initAllocationForms) window.OPP_initAllocationForms(root);
    if (window.OPP_initTimelineScroll) window.OPP_initTimelineScroll(root);
    if (window.OPP_initTimelineDrag) window.OPP_initTimelineDrag();
    if (window.OPP_initViewState) window.OPP_initViewState(root);
    if (window.OPP_initAbsenceCard) window.OPP_initAbsenceCard(root);
    if (window.OPP_updateExportHref) window.OPP_updateExportHref();
    if (window.bootstrap && bootstrap.Tooltip) {
      root.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(function (el) {
        bootstrap.Tooltip.getOrCreateInstance(el);
      });
    }
  }

  /* ── Swapping ────────────────────────────────────────────────────── */

  /* Same path means the action came back to the view the reader is already
     on, which is the case worth keeping in place. Query strings differ all
     the time (filters), so only the path is compared. */
  function samePage(url) {
    try {
      return new URL(url, window.location.origin).pathname === window.location.pathname;
    } catch (err) {
      return false;
    }
  }

  function swapFrom(html, finalUrl) {
    var target = container(document);
    if (!target) return false;

    var parsed = new DOMParser().parseFromString(html, 'text/html');
    var incoming = container(parsed);
    if (!incoming) return false;

    var state = capture(target);
    target.innerHTML = incoming.innerHTML;

    /* Flash messages live outside the swapped region, so carry them over
       rather than leaving a stale banner from the previous action. */
    var oldFlash = document.querySelector('[data-flash-region]');
    var newFlash = parsed.querySelector('[data-flash-region]');
    if (oldFlash && newFlash) oldFlash.innerHTML = newFlash.innerHTML;

    var title = parsed.querySelector('title');
    if (title) document.title = title.textContent;

    if (finalUrl && finalUrl !== window.location.href) {
      history.pushState({ live: true }, '', finalUrl);
    }

    reinit(target);
    restore(target, state);
    return true;
  }

  function load(url, options) {
    return fetch(url, Object.assign({ headers: { 'X-Requested-With': 'XMLHttpRequest' } }, options || {}))
      .then(function (res) {
        if (!res.ok) throw new Error('Server returned ' + res.status);
        return res.text().then(function (html) {
          return { html: html, url: res.url || url };
        });
      })
      .then(function (result) {
        /* Each view loads its own scripts, so content from a different page
           cannot simply be dropped in - the JS it depends on would be
           missing. Going somewhere else stays a real navigation; only
           staying put is handled in the background. */
        if (samePage(result.url)) {
          if (swapFrom(result.html, result.url)) return;
        }
        window.location.href = result.url;
      })
      .catch(function (err) {
        if (typeof showToast === 'function') showToast('Failed: ' + err.message, 'error');
        else throw err;
      });
  }

  /* Re-fetch whatever is on screen right now. */
  function refreshView(message) {
    if (message && typeof showToast === 'function') showToast(message, 'info');
    return load(window.location.href);
  }

  /* ── Generic form interception ───────────────────────────────────── */

  document.addEventListener('submit', function (event) {
    /* A page-specific module already claimed this one. */
    if (event.defaultPrevented) return;

    var form = event.target;
    if (!form || !form.matches('form')) return;
    if (form.matches(CLAIMED)) return;
    if (form.hasAttribute('data-confirm') && form.dataset.confirmed !== 'true') return;
    if (form.hasAttribute('target')) return;
    if (!container(document)) return;

    var method = (form.getAttribute('method') || 'get').toLowerCase();
    var action = form.getAttribute('action') || window.location.pathname;
    var data = new FormData(form);
    var submitter = event.submitter;
    if (submitter && submitter.name) data.append(submitter.name, submitter.value);

    event.preventDefault();
    if (window.OPP_busy && submitter) window.OPP_busy.hold(submitter);

    if (method === 'get') {
      load(action + '?' + new URLSearchParams(data).toString());
      return;
    }

    /* The routes are built on express.urlencoded, so the body has to be form
       encoded - a raw FormData would arrive as multipart and read as empty. */
    load(action, {
      method: 'POST',
      body: new URLSearchParams(data).toString(),
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      redirect: 'follow'
    });
  });

  /* Back and forward reload the view in place. Management has its own
     popstate handling, so this steps aside there rather than both of them
     fetching the same page. */
  window.addEventListener('popstate', function () {
    if (typeof window.OPP_mgmtSwap === 'function') return;
    load(window.location.href);
  });

  window.OPP_viewState = { capture: capture, restore: restore, reinit: reinit, container: container };
  window.OPP_refreshView = refreshView;
  window.OPP_liveLoad = load;
})();

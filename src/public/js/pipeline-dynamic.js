/* Pipeline page behaviour.

   Filters, search, sorting, paging, the table/board switch and every inline
   edit update the list in the background: the content is fetched with
   ?partial=pipeline and swapped in place through the shared view-state helper
   (live-update.js), so scroll position, open cards and the focused search box
   all survive. Listeners are delegated from the container, so nothing has to
   be re-bound after a swap. */
(function () {
  'use strict';

  var contentEl = null;
  var swapping = false;
  var pendingUrl = null;
  var searchTimer = null;

  function toast(message, type) {
    if (typeof window.showToast === 'function') window.showToast(message, type);
  }

  /* ── Content swap ────────────────────────────────────────────── */

  function cleanUrl(url) {
    var parsed = new URL(url, window.location.origin);
    parsed.searchParams.delete('partial');
    return parsed.pathname + parsed.search;
  }

  function swapContent(url, pushState) {
    if (pushState === undefined) pushState = true;
    var target = cleanUrl(url || window.location.href);
    // Typing fast fires several searches; only the latest one matters.
    if (swapping) { pendingUrl = { url: target, push: pushState }; return Promise.resolve(); }
    swapping = true;

    var fetchUrl = target + (target.indexOf('?') === -1 ? '?' : '&') + 'partial=pipeline';
    var viewState = window.OPP_viewState;

    return fetch(fetchUrl, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .then(function (res) {
        if (!res.ok) throw new Error('Server returned ' + res.status);
        return res.text();
      })
      .then(function (html) {
        var state = viewState ? viewState.capture(contentEl) : null;
        contentEl.innerHTML = html;
        if (pushState && target !== window.location.pathname + window.location.search) {
          history.pushState({ pipeline: true }, '', target);
        }
        if (viewState) {
          viewState.reinit(contentEl);
          viewState.restore(contentEl, state);
        } else if (window.OPP_initMultiselects) {
          window.OPP_initMultiselects(contentEl);
        }
      })
      .catch(function (err) {
        toast('Failed to update: ' + err.message, 'error');
      })
      .finally(function () {
        swapping = false;
        if (pendingUrl) {
          var next = pendingUrl;
          pendingUrl = null;
          swapContent(next.url, next.push);
        }
      });
  }

  window.OPP_pipelineSwap = function () {
    return swapContent(window.location.href, false);
  };

  function post(url, data) {
    return window.OPP_postForm(url, data);
  }

  /* ── Filters and search ──────────────────────────────────────── */

  function submitFilters(form) {
    var params = new URLSearchParams(new FormData(form));
    swapContent('/?' + params.toString());
  }

  function onSubmit(event) {
    var form = event.target;
    if (form.matches('form[data-pipeline-filter]')) {
      event.preventDefault();
      clearTimeout(searchTimer);
      submitFilters(form);
      return;
    }
    if (form.matches('form[data-pipeline-defaults]')) {
      event.preventDefault();
      post(form.getAttribute('action') || '/pipeline/defaults', new URLSearchParams(new FormData(form)))
        .then(function () {
          toast('Saved as your default.', 'success');
          swapContent(window.location.href, false);
        })
        .catch(function (err) { toast('Failed: ' + err.message, 'error'); });
    }
  }

  function onInput(event) {
    var el = event.target;
    if (!el.matches('[data-live-search]')) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      var form = el.closest('form');
      if (form) submitFilters(form);
    }, 300);
  }

  /* ── Inline edits ────────────────────────────────────────────── */

  var FIELD_LABELS = { stage: 'Stage', status: 'Status', techOwner: 'Lead consultant' };

  function onChange(event) {
    var el = event.target;

    if (el.matches('[data-auto-submit]')) {
      var filterForm = el.closest('form');
      if (filterForm) submitFilters(filterForm);
      return;
    }

    if (el.matches('[data-upcoming-filter] select[name="period"]')) {
      refreshUpcoming(el.closest('form'));
      return;
    }

    if (el.matches('select[data-quick-field]')) {
      quickUpdate(el.getAttribute('data-opportunity-id'), el.getAttribute('data-quick-field'), el.value, el);
      return;
    }

    if (el.matches('select[data-pipeline-booking]')) {
      var form = el.closest('form');
      if (!form) return;
      el.disabled = true;
      post(form.getAttribute('action'), new URLSearchParams(new FormData(form)))
        .then(function () {
          toast('Capacity booking updated.', 'success');
          return swapContent(window.location.href, false);
        })
        .catch(function (err) {
          el.disabled = false;
          toast('Failed: ' + err.message, 'error');
        });
    }
  }

  function quickUpdate(id, field, value, control) {
    if (!id || !field) return Promise.resolve();
    var data = {};
    data[field] = value;
    if (control) control.disabled = true;
    return post('/opportunities/' + id + '/quick', data)
      .then(function () {
        toast((FIELD_LABELS[field] || 'Field') + ' updated.', 'success');
        return swapContent(window.location.href, false);
      })
      .catch(function (err) {
        if (control) control.disabled = false;
        toast('Failed: ' + err.message, 'error');
        return swapContent(window.location.href, false);
      });
  }

  /* ── Upcoming period ─────────────────────────────────────────── */

  function refreshUpcoming(form) {
    if (!form) return;
    var params = new URLSearchParams(new FormData(form));
    params.set('partial', 'upcoming');
    fetch('/?' + params.toString(), { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .then(function (res) {
        if (!res.ok) throw new Error('Server returned ' + res.status);
        return res.text();
      })
      .then(function (html) {
        var wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        var incoming = wrapper.querySelector('#upcomingCard');
        var current = document.getElementById('upcomingCard');
        if (!incoming || !current) return;
        var wasOpen = !!current.querySelector('#collapseUpcoming.show');
        current.replaceWith(incoming);
        var body = incoming.querySelector('#collapseUpcoming');
        var toggle = incoming.querySelector('[data-bs-target="#collapseUpcoming"]');
        if (body) body.classList.toggle('show', wasOpen);
        if (toggle) {
          toggle.classList.toggle('collapsed', !wasOpen);
          toggle.setAttribute('aria-expanded', wasOpen ? 'true' : 'false');
        }
        if (window.OPP_initViewState) window.OPP_initViewState(incoming);
      })
      .catch(function (err) { toast('Could not refresh: ' + err.message, 'error'); });
  }

  /* ── Links and row clicks ────────────────────────────────────── */

  var INTERACTIVE = 'a, button, select, input, textarea, label, form, [data-bs-toggle]';

  function onClick(event) {
    if (event.defaultPrevented || event.button !== 0) return;
    var link = event.target.closest('a[data-pipeline-link], a[data-pipeline-clear]');
    if (link && !(event.ctrlKey || event.metaKey || event.shiftKey)) {
      event.preventDefault();
      swapContent(link.getAttribute('href'));
      return;
    }

    // The whole row opens the opportunity, except where the click lands on a
    // control, or when the reader is selecting text to copy.
    var row = event.target.closest('tr[data-href]');
    if (!row || event.target.closest(INTERACTIVE)) return;
    var selection = window.getSelection && window.getSelection();
    if (selection && String(selection).length) return;
    var href = row.getAttribute('data-href');
    if (event.ctrlKey || event.metaKey) window.open(href, '_blank');
    else window.location.href = href;
  }

  /* ── Board drag and drop ─────────────────────────────────────── */

  var dragged = null;

  function onDragStart(event) {
    var card = event.target.closest && event.target.closest('.board-card[draggable="true"]');
    if (!card) return;
    dragged = card;
    card.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', card.getAttribute('data-opportunity-id'));
  }

  function onDragEnd() {
    if (dragged) dragged.classList.remove('is-dragging');
    dragged = null;
    contentEl.querySelectorAll('.board-column.is-drop-target').forEach(function (col) {
      col.classList.remove('is-drop-target');
    });
  }

  function columnFrom(event) {
    return event.target.closest && event.target.closest('.board-column[data-board-stage]');
  }

  function onDragOver(event) {
    var column = columnFrom(event);
    if (!column || !dragged || column.getAttribute('data-board-stage') === '') return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    contentEl.querySelectorAll('.board-column.is-drop-target').forEach(function (col) {
      if (col !== column) col.classList.remove('is-drop-target');
    });
    column.classList.add('is-drop-target');
  }

  function onDrop(event) {
    var column = columnFrom(event);
    if (!column || !dragged) return;
    event.preventDefault();
    var stage = column.getAttribute('data-board-stage');
    var id = dragged.getAttribute('data-opportunity-id');
    var from = dragged.closest('.board-column');
    if (!stage || (from && from === column)) { onDragEnd(); return; }
    // Move the card straight away so the board feels immediate; the swap that
    // follows the save brings the counts and totals up to date.
    var body = column.querySelector('[data-board-dropzone]');
    if (body) {
      var empty = body.querySelector('.board-empty');
      if (empty) empty.remove();
      body.prepend(dragged);
    }
    onDragEnd();
    quickUpdate(id, 'stage', stage);
  }

  function init() {
    contentEl = document.getElementById('pipelineContent');
    if (!contentEl) return;

    contentEl.addEventListener('submit', onSubmit);
    contentEl.addEventListener('input', onInput);
    contentEl.addEventListener('change', onChange);
    contentEl.addEventListener('click', onClick);
    contentEl.addEventListener('dragstart', onDragStart);
    contentEl.addEventListener('dragend', onDragEnd);
    contentEl.addEventListener('dragover', onDragOver);
    contentEl.addEventListener('drop', onDrop);

    window.addEventListener('popstate', function () {
      swapContent(window.location.href, false);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/* Timeline drag-to-resize: broaden or squeeze an assignment bar to change its
   planned window. Allocated hours are recalculated server side on save. */
(function () {
  'use strict';

  var DAY_MS = 24 * 60 * 60 * 1000;
  var grid = null;
  var rangeStartMs, rangeEndMs, totalDays, windowStartMs, windowEndMs;
  var suppressClickUntil = 0;
  var drag = null;
  var windowListenersAdded = false;

  function toDateText(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  function parseDate(text) {
    var ms = Date.parse(text + 'T00:00:00Z');
    return isFinite(ms) ? ms : null;
  }

  function round2(value) {
    return Math.round(value * 100) / 100;
  }

  /* Inclusive working-day count, matching countBusinessDaysInclusive on the server. */
  function businessDays(startMs, endMs) {
    if (endMs < startMs) return 0;
    var days = 0;
    for (var ms = startMs; ms <= endMs; ms += DAY_MS) {
      var weekday = new Date(ms).getUTCDay();
      if (weekday !== 0 && weekday !== 6) days += 1;
    }
    return days;
  }

  /*
   * Mirrors rescaleHoursToWindow on the server: the daily intensity the
   * assignment already had is preserved and the real hours follow the window.
   */
  function hoursFor(chip, startMs, endMs) {
    var storedHours = Number(chip.dataset.hours) || 0;
    var storedDays = businessDays(parseDate(chip.dataset.start), parseDate(chip.dataset.end));
    var nextDays = businessDays(startMs, endMs);
    if (nextDays <= 0) return 0;
    if (storedDays <= 0) return round2(storedHours);
    return round2((storedHours / storedDays) * nextDays);
  }

  /* Mirrors assignmentHoursInWindow: the slice of the bar inside the visible
     capacity window, skipping any days the assignment is on hold. */
  function hoursInWindow(chip, startMs, endMs, totalHours) {
    if (windowStartMs === null || windowEndMs === null) return totalHours;

    var overlapStart = Math.max(startMs, windowStartMs);
    var overlapEnd = Math.min(endMs + DAY_MS, windowEndMs) - DAY_MS;
    if (overlapEnd < overlapStart) return 0;

    var totalDays = businessDays(startMs, endMs);
    if (totalDays <= 0) return 0;

    var overlapDays = businessDays(overlapStart, overlapEnd);

    /* Parse holds from the data-holds JSON attribute (supports multiple holds). */
    var holds = [];
    try { holds = JSON.parse(chip.dataset.holds || '[]'); } catch (e) { holds = []; }
    for (var i = 0; i < holds.length; i++) {
      var holdStart = parseDate(holds[i].startDate);
      var holdEnd = parseDate(holds[i].endDate);
      if (holdStart !== null && holdEnd !== null) {
        var heldStart = Math.max(holdStart, overlapStart);
        var heldEnd = Math.min(holdEnd, overlapEnd);
        if (heldEnd >= heldStart) overlapDays -= businessDays(heldStart, heldEnd);
      }
    }
    if (overlapDays <= 0) return 0;

    return round2(totalHours * (overlapDays / totalDays));
  }

  /* Live readout inside the bar so the effect of a resize is visible while dragging. */
  function paintLabel(chip, startMs, endMs) {
    var meta = chip.querySelector('[data-role="meta"]');
    if (!meta) return;

    var initialHours = Number(chip.dataset.initialHours) || 0;
    var hours = hoursFor(chip, startMs, endMs);
    var capacityHours = Number(chip.dataset.capacityHours) || 0;
    var windowHours = hoursInWindow(chip, startMs, endMs, hours);
    var capacityPercent = capacityHours > 0 ? round2((windowHours / capacityHours) * 100) : 0;
    var days = businessDays(startMs, endMs);
    var resized = Math.abs(hours - initialHours) >= 0.01;

    meta.textContent = initialHours + 'h' + (resized ? ' \u2192 ' + hours + 'h' : '') +
      ' \u00b7 ' + capacityPercent + '% cap';

    chip.title = (chip.dataset.person || '') + ' \u00b7 ' + toDateText(startMs) + ' \u2192 ' + toDateText(endMs) +
      ' (' + days + ' working days)\n' +
      'Assigned: ' + initialHours + 'h = ' + (Number(chip.dataset.initialPercent) || 0) + '% of the ' +
      (Number(chip.dataset.opportunityHours) || 0) + 'h project\n' +
      'Now on the bar: ' + hours + 'h\n' +
      'In this window: ' + windowHours + 'h = ' + capacityPercent + '% of ' + capacityHours + 'h capacity';
  }

  function restoreLabel(chip) {
    var meta = chip.querySelector('[data-role="meta"]');
    if (!meta) return;
    var initialHours = Number(chip.dataset.initialHours) || 0;
    var hours = Number(chip.dataset.hours) || 0;
    var resized = Math.abs(hours - initialHours) >= 0.01;
    meta.textContent = initialHours + 'h' + (resized ? ' \u2192 ' + hours + 'h' : '') +
      ' \u00b7 ' + (Number(chip.dataset.capacityPercent) || 0) + '% cap';
  }

  /* Position the chip live while dragging, mirroring the server geometry maths. */
  function paint(chip, startMs, endMs) {
    var span = rangeEndMs - rangeStartMs;
    var left = ((Math.max(startMs, rangeStartMs) - rangeStartMs) / span) * 100;
    var right = ((Math.min(endMs + DAY_MS, rangeEndMs) - rangeStartMs) / span) * 100;
    chip.style.left = Math.max(0, left).toFixed(3) + '%';
    chip.style.width = Math.max(0.4, right - left).toFixed(3) + '%';
    paintLabel(chip, startMs, endMs);
  }

  /* ── Floating drag tooltip ───────────────────────────────────── */

  var tooltip = null;

  function ensureTooltip() {
    if (tooltip) return tooltip;
    tooltip = document.createElement('div');
    tooltip.className = 'timeline-drag-tooltip';
    tooltip.style.cssText =
      'position:fixed;z-index:1080;pointer-events:none;display:none;' +
      'background:var(--bs-body-bg,#fff);color:var(--bs-body-color,#212529);' +
      'border:1px solid var(--bs-border-color,#dee2e6);border-radius:.375rem;' +
      'padding:.5rem .75rem;font-size:.8125rem;box-shadow:0 .25rem .5rem rgba(0,0,0,.15);' +
      'white-space:nowrap;line-height:1.4;';
    document.body.appendChild(tooltip);
    return tooltip;
  }

  function showTooltip(chip, startMs, endMs, clientX, clientY) {
    var tip = ensureTooltip();
    var hours = hoursFor(chip, startMs, endMs);
    var days = businessDays(startMs, endMs);
    tip.innerHTML =
      '<strong>' + toDateText(startMs) + ' &rarr; ' + toDateText(endMs) + '</strong><br>' +
      '<span class="text-muted">' + days + ' working days &middot; ' + hours + 'h</span>';
    tip.style.display = 'block';
    /* Position above the cursor, clamped to viewport. */
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var x = clientX - w / 2;
    var y = clientY - h - 12;
    if (x < 8) x = 8;
    if (x + w > window.innerWidth - 8) x = window.innerWidth - w - 8;
    if (y < 8) y = clientY + 16;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }

  function hideTooltip() {
    if (tooltip) tooltip.style.display = 'none';
  }

  function beginDrag(event) {
    if (event.button !== 0) return;

    var handle = event.target.closest('.timeline-chip-resizer');
    var body = null;
    var edge = null;

    if (handle) {
      edge = handle.dataset.edge; /* 'start' or 'end' */
    } else {
      /* Allow grabbing the chip body to move the whole bar left/right. */
      body = event.target.closest('.timeline-chip-body');
      if (body) edge = 'move';
    }
    if (!edge) return;

    var chip = (handle || body).closest('.timeline-chip');
    var lane = chip && chip.closest('.timeline-lane');
    var startMs = chip && parseDate(chip.dataset.start);
    var endMs = chip && parseDate(chip.dataset.end);
    if (!lane || startMs === null || endMs === null) return;

    event.preventDefault();
    drag = {
      chip: chip,
      edge: edge,
      pointerStartX: event.clientX,
      laneWidth: lane.clientWidth || 1,
      originalStartMs: startMs,
      originalEndMs: endMs,
      startMs: startMs,
      endMs: endMs,
    };
    chip.classList.add('is-resizing');
    document.body.classList.add('timeline-resizing');
    showTooltip(chip, startMs, endMs, event.clientX, event.clientY);
  }

  function moveDrag(event) {
    if (!drag) return;
    var deltaDays = Math.round(((event.clientX - drag.pointerStartX) / drag.laneWidth) * totalDays);

    if (drag.edge === 'move') {
      /* Slide the whole bar: shift both start and end by the same delta. */
      var span = drag.originalEndMs - drag.originalStartMs;
      drag.startMs = drag.originalStartMs + deltaDays * DAY_MS;
      drag.endMs = drag.startMs + span;
    } else if (drag.edge === 'start') {
      var nextStart = drag.originalStartMs + deltaDays * DAY_MS;
      drag.startMs = Math.min(nextStart, drag.endMs);
    } else {
      var nextEnd = drag.originalEndMs + deltaDays * DAY_MS;
      drag.endMs = Math.max(nextEnd, drag.startMs);
    }
    paint(drag.chip, drag.startMs, drag.endMs);
    showTooltip(drag.chip, drag.startMs, drag.endMs, event.clientX, event.clientY);
  }

  function endDrag() {
    if (!drag) return;
    var current = drag;
    drag = null;
    current.chip.classList.remove('is-resizing');
    document.body.classList.remove('timeline-resizing');
    hideTooltip();

    var changed = current.startMs !== current.originalStartMs || current.endMs !== current.originalEndMs;
    if (!changed) {
      restoreLabel(current.chip);
      return;
    }

    /* Only suppress the click after an actual drag so a simple click on the
       chip body still follows the opportunity link. */
    suppressClickUntil = Date.now() + 350;

    var payload = {
      plannedStartDate: toDateText(current.startMs),
      plannedEndDate: toDateText(current.endMs),
    };
    var nextHours = hoursFor(current.chip, current.startMs, current.endMs);

    fetch('/api/assignments/' + encodeURIComponent(current.chip.dataset.assignmentId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (response) {
        if (!response.ok) {
          return response
            .json()
            .catch(function () { return null; })
            .then(function (data) {
              throw new Error((data && data.error) || 'Could not save the new dates (HTTP ' + response.status + ').');
            });
        }
        return null;
      })
      .then(function () {
        if (typeof showToast === 'function') {
          showToast(
            payload.plannedStartDate + ' - ' + payload.plannedEndDate + ' \u00b7 ' + nextHours + 'h allocated',
            'success'
          );
        }
        if (typeof window.OPP_mgmtSwap === 'function') {
          window.OPP_mgmtSwap();
        } else if (typeof window.OPP_refreshView === 'function') {
          /* The person page has no management swap, but it can still refresh
             its own content instead of throwing the reader back to the top. */
          window.OPP_refreshView();
        } else {
          window.location.reload();
        }
      })
      .catch(function (error) {
        paint(current.chip, current.originalStartMs, current.originalEndMs);
        restoreLabel(current.chip);
        if (typeof showToast === 'function') showToast(error.message, 'error');
      });
  }

  function clickSuppressor(event) {
    if (Date.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function init() {
    grid = document.getElementById('timelineGrid');
    if (!grid) return;

    rangeStartMs = Date.parse(grid.dataset.rangeStart + 'T00:00:00Z');
    rangeEndMs = Date.parse(grid.dataset.rangeEndExclusive + 'T00:00:00Z');
    if (!isFinite(rangeStartMs) || !isFinite(rangeEndMs) || rangeEndMs <= rangeStartMs) return;

    windowStartMs = parseDate(grid.dataset.windowStart);
    windowEndMs = parseDate(grid.dataset.windowEndExclusive);
    totalDays = Math.round((rangeEndMs - rangeStartMs) / DAY_MS);

    grid.addEventListener('mousedown', beginDrag);
    grid.addEventListener('click', clickSuppressor, true);

    if (!windowListenersAdded) {
      window.addEventListener('mousemove', moveDrag);
      window.addEventListener('mouseup', endDrag);
      windowListenersAdded = true;
    }
  }

  window.OPP_initTimelineDrag = init;

  document.addEventListener('DOMContentLoaded', init);
})();

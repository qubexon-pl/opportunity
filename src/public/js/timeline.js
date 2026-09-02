/* Timeline drag-to-resize: broaden or squeeze an assignment bar to change its
   planned window. Allocated hours are recalculated server side on save. */
(function () {
  'use strict';

  var DAY_MS = 24 * 60 * 60 * 1000;
  var grid = document.getElementById('timelineGrid');
  if (!grid) return;

  var rangeStartMs = Date.parse(grid.dataset.rangeStart + 'T00:00:00Z');
  var rangeEndMs = Date.parse(grid.dataset.rangeEndExclusive + 'T00:00:00Z');
  if (!isFinite(rangeStartMs) || !isFinite(rangeEndMs) || rangeEndMs <= rangeStartMs) return;

  var hoursPerDay = Number(grid.dataset.hoursPerDay);
  if (!isFinite(hoursPerDay) || hoursPerDay <= 0) hoursPerDay = 8;

  var totalDays = Math.round((rangeEndMs - rangeStartMs) / DAY_MS);
  var suppressClickUntil = 0;
  var drag = null;

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
   * Mirrors calculateAllocatedHoursByDuration: the allocation percentage stays put
   * and the hours follow the length of the window.
   */
  function hoursFor(chip, startMs, endMs) {
    var percent = Number(chip.dataset.percent) || 0;
    return round2(businessDays(startMs, endMs) * hoursPerDay * (percent / 100));
  }

  /* Live readout inside the bar so the effect of a resize is visible while dragging. */
  function paintLabel(chip, startMs, endMs) {
    var meta = chip.querySelector('[data-role="meta"]');
    if (!meta) return;

    var percent = Number(chip.dataset.percent) || 0;
    var days = businessDays(startMs, endMs);
    var hours = hoursFor(chip, startMs, endMs);
    var stage = chip.dataset.stageLabel || '';

    meta.textContent = percent + '% \u00b7 ' + hours + 'h \u00b7 ' + days + 'd' + (stage ? ' \u00b7 ' + stage : '');
    chip.title = (chip.dataset.person || '') + ' \u00b7 ' + toDateText(startMs) + ' \u2192 ' + toDateText(endMs) +
      ' \u00b7 ' + hours + 'h over ' + days + ' working days';
  }

  function restoreLabel(chip) {
    var meta = chip.querySelector('[data-role="meta"]');
    if (!meta) return;
    var percent = Number(chip.dataset.percent) || 0;
    var stage = chip.dataset.stageLabel || '';
    meta.textContent = percent + '% \u00b7 ' + (chip.dataset.hours || 0) + 'h' + (stage ? ' \u00b7 ' + stage : '');
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

  function beginDrag(event) {
    var handle = event.target.closest('.timeline-chip-resizer');
    if (!handle || event.button !== 0) return;

    var chip = handle.closest('.timeline-chip');
    var lane = chip && chip.closest('.timeline-lane');
    var startMs = chip && parseDate(chip.dataset.start);
    var endMs = chip && parseDate(chip.dataset.end);
    if (!lane || startMs === null || endMs === null) return;

    event.preventDefault();
    drag = {
      chip: chip,
      edge: handle.dataset.edge,
      pointerStartX: event.clientX,
      laneWidth: lane.clientWidth || 1,
      originalStartMs: startMs,
      originalEndMs: endMs,
      startMs: startMs,
      endMs: endMs,
    };
    chip.classList.add('is-resizing');
    document.body.classList.add('timeline-resizing');
  }

  function moveDrag(event) {
    if (!drag) return;
    var deltaDays = Math.round(((event.clientX - drag.pointerStartX) / drag.laneWidth) * totalDays);

    if (drag.edge === 'start') {
      var nextStart = drag.originalStartMs + deltaDays * DAY_MS;
      drag.startMs = Math.min(nextStart, drag.endMs);
    } else {
      var nextEnd = drag.originalEndMs + deltaDays * DAY_MS;
      drag.endMs = Math.max(nextEnd, drag.startMs);
    }
    paint(drag.chip, drag.startMs, drag.endMs);
  }

  function endDrag() {
    if (!drag) return;
    var current = drag;
    drag = null;
    current.chip.classList.remove('is-resizing');
    document.body.classList.remove('timeline-resizing');
    suppressClickUntil = Date.now() + 350;

    var changed = current.startMs !== current.originalStartMs || current.endMs !== current.originalEndMs;
    if (!changed) {
      restoreLabel(current.chip);
      return;
    }

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
        if (!response.ok) throw new Error('Save failed with status ' + response.status);
        if (typeof showToast === 'function') {
          showToast(
            payload.plannedStartDate + ' - ' + payload.plannedEndDate + ' \u00b7 ' + nextHours + 'h allocated',
            'success'
          );
        }
        if (typeof reloadPageWithMessage === 'function') {
          reloadPageWithMessage('Recalculating allocation...', 400);
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

  grid.addEventListener('mousedown', beginDrag);
  window.addEventListener('mousemove', moveDrag);
  window.addEventListener('mouseup', endDrag);

  // A drag that ends over the chip body must not navigate to the opportunity.
  grid.addEventListener(
    'click',
    function (event) {
      if (Date.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true
  );
})();

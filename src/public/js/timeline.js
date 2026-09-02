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

  /* Position the chip live while dragging, mirroring the server geometry maths. */
  function paint(chip, startMs, endMs) {
    var span = rangeEndMs - rangeStartMs;
    var left = ((Math.max(startMs, rangeStartMs) - rangeStartMs) / span) * 100;
    var right = ((Math.min(endMs + DAY_MS, rangeEndMs) - rangeStartMs) / span) * 100;
    chip.style.left = Math.max(0, left).toFixed(3) + '%';
    chip.style.width = Math.max(0.4, right - left).toFixed(3) + '%';
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
    if (!changed) return;

    var payload = {
      plannedStartDate: toDateText(current.startMs),
      plannedEndDate: toDateText(current.endMs),
    };

    fetch('/api/assignments/' + encodeURIComponent(current.chip.dataset.assignmentId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (response) {
        if (!response.ok) throw new Error('Save failed with status ' + response.status);
        if (typeof showToast === 'function') {
          showToast('Assignment moved to ' + payload.plannedStartDate + ' - ' + payload.plannedEndDate, 'success');
        }
        if (typeof reloadPageWithMessage === 'function') {
          reloadPageWithMessage('Recalculating allocation...', 400);
        } else {
          window.location.reload();
        }
      })
      .catch(function (error) {
        paint(current.chip, current.originalStartMs, current.originalEndMs);
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

(function () {
  'use strict';

  var HOURS_PER_DAY_FALLBACK = 8;
  var MODES = ['percent', 'total-hours', 'monthly-hours'];

  function dailyHoursFor(person) {
    var map = window.OPP_PEOPLE_DAILY_HOURS || {};
    var value = Number(map[person]);
    return Number.isFinite(value) && value > 0 ? value : HOURS_PER_DAY_FALLBACK;
  }

  function countBusinessDays(startText, endText) {
    var start = startText ? new Date(startText + 'T00:00:00') : null;
    var end = endText ? new Date(endText + 'T00:00:00') : null;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;

    var days = 0;
    var cursor = new Date(start.getTime());
    while (cursor <= end) {
      var day = cursor.getDay();
      if (day !== 0 && day !== 6) days += 1;
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }

  /** Mirrors dateService.countMonthsInclusive: calendar months touched by the window. */
  function countMonths(startText, endText) {
    var start = startText ? new Date(startText + 'T00:00:00') : null;
    var end = endText ? new Date(endText + 'T00:00:00') : null;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
    return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
  }

  function round2(value) {
    return Math.round(Number(value) * 100) / 100;
  }

  function labelFor(modeKey) {
    if (modeKey === 'total-hours') return 'Total hours';
    if (modeKey === 'monthly-hours') return 'Hours per month';
    return 'Allocation %';
  }

  /** Expresses an already resolved allocation in the unit of the given mode. */
  function valueForMode(modeKey, percent, hours, months) {
    if (modeKey === 'total-hours') return round2(hours);
    if (modeKey === 'monthly-hours') return months > 0 ? round2(hours / months) : round2(hours);
    return round2(percent);
  }

  function setupForm(form) {
    var person = form.querySelector('[data-role="person"]');
    var start = form.querySelector('[data-role="start"]');
    var end = form.querySelector('[data-role="end"]');
    var mode = form.querySelector('[data-role="mode"]');
    var value = form.querySelector('[data-role="value"]');
    var label = form.querySelector('[data-role="value-label"]');
    var preview = form.querySelector('[data-role="preview"]');
    var percentField = form.querySelector('[data-role="percent-field"]');
    var hoursField = form.querySelector('[data-role="hours-field"]');
    var opportunity = form.querySelector('[data-role="opportunity"]');
    if (!mode || !value || !percentField || !hoursField) return;

    function opportunityHoursFor() {
      if (opportunity) {
        var option = opportunity.options[opportunity.selectedIndex];
        return Number((option && option.dataset.hours) || 0);
      }
      return Number(form.dataset.opportunityHours || 0);
    }

    var last = { percent: 0, hours: 0 };

    function paintPreview(state) {
      if (state.opportunityHours <= 0) {
        preview.textContent = opportunity && !opportunity.value
          ? 'Select an opportunity to convert between percent and hours.'
          : 'Set the opportunity total hours to convert between percent and hours.';
        preview.classList.add('is-warning');
        return;
      }

      if (state.percent > 100) {
        preview.textContent =
          state.hours + 'h is ' + state.percent + '% of the ' + round2(state.opportunityHours) +
          'h scope \u2014 that is more than the whole opportunity.';
        preview.classList.add('is-warning');
        return;
      }

      preview.classList.remove('is-warning');

      var businessDays = countBusinessDays(start && start.value, end && end.value);
      var capacityHours = businessDays * dailyHoursFor(person && person.value);
      var load = capacityHours > 0
        ? ' \u2014 ' + round2((state.hours / capacityHours) * 100) + '% of the ' + round2(capacityHours) +
          'h available over ' + businessDays + ' working days'
        : '';
      var perMonth = state.months > 0
        ? ', about ' + round2(state.hours / state.months) + 'h per month over ' + state.months +
          ' month' + (state.months === 1 ? '' : 's')
        : '';

      preview.textContent =
        state.hours + 'h = ' + state.percent + '% of the ' + round2(state.opportunityHours) + 'h scope' + perMonth + load + '.';
    }

    function compute() {
      var opportunityHours = opportunityHoursFor();
      var months = countMonths(start && start.value, end && end.value);
      var raw = Number(value.value);
      var input = Number.isFinite(raw) && raw > 0 ? raw : 0;

      var percent = 0;
      var hours = 0;

      if (mode.value === 'total-hours') {
        hours = input;
        percent = opportunityHours > 0 ? (hours / opportunityHours) * 100 : 0;
      } else if (mode.value === 'monthly-hours') {
        hours = input * (months > 0 ? months : 1);
        percent = opportunityHours > 0 ? (hours / opportunityHours) * 100 : 0;
      } else {
        percent = input;
        hours = opportunityHours * (percent / 100);
      }

      percent = Math.max(0, round2(percent));
      hours = Math.max(0, round2(hours));

      percentField.value = percent;
      hoursField.value = hours;
      last = { percent: percent, hours: hours };

      if (label) label.textContent = labelFor(mode.value);
      if (preview) paintPreview({ opportunityHours: opportunityHours, months: months, percent: percent, hours: hours });
    }

    mode.addEventListener('change', function () {
      value.value = valueForMode(mode.value, last.percent, last.hours, countMonths(start && start.value, end && end.value));
      compute();
    });

    [person, start, end, value, opportunity].forEach(function (el) {
      if (!el) return;
      el.addEventListener('change', compute);
      el.addEventListener('input', compute);
    });
    form.addEventListener('submit', compute);

    var storedHours = Number(form.dataset.allocatedHours);
    if (Number.isFinite(storedHours) && storedHours > 0) {
      var storedPercent = Number(form.dataset.allocationPercent) || 0;
      var modeKey = MODES.indexOf(mode.value) === -1 ? 'percent' : mode.value;
      value.value = valueForMode(modeKey, storedPercent, storedHours, countMonths(start && start.value, end && end.value));
    }

    compute();
  }

  function initAllocationForms(container) {
    container = container || document;
    container.querySelectorAll('.allocation-form:not([data-alloc-init])').forEach(function (form) {
      form.setAttribute('data-alloc-init', '');
      setupForm(form);
    });
  }

  window.OPP_initAllocationForms = initAllocationForms;
  window.OPP_setupAllocationForm = setupForm;

  document.addEventListener('DOMContentLoaded', function () {
    initAllocationForms();
  });
})();

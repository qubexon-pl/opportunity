(function () {
  'use strict';

  const HOURS_PER_DAY_FALLBACK = 8;
  const MODES = ['percent', 'total-hours', 'monthly-hours'];

  function dailyHoursFor(person) {
    const map = window.OPP_PEOPLE_DAILY_HOURS || {};
    const value = Number(map[person]);
    return Number.isFinite(value) && value > 0 ? value : HOURS_PER_DAY_FALLBACK;
  }

  function countBusinessDays(startText, endText) {
    const start = startText ? new Date(startText + 'T00:00:00') : null;
    const end = endText ? new Date(endText + 'T00:00:00') : null;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;

    let days = 0;
    const cursor = new Date(start.getTime());
    while (cursor <= end) {
      const day = cursor.getDay();
      if (day !== 0 && day !== 6) days += 1;
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }

  /** Mirrors dateService.countMonthsInclusive: calendar months touched by the window. */
  function countMonths(startText, endText) {
    const start = startText ? new Date(startText + 'T00:00:00') : null;
    const end = endText ? new Date(endText + 'T00:00:00') : null;
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
    const person = form.querySelector('[data-role="person"]');
    const start = form.querySelector('[data-role="start"]');
    const end = form.querySelector('[data-role="end"]');
    const mode = form.querySelector('[data-role="mode"]');
    const value = form.querySelector('[data-role="value"]');
    const label = form.querySelector('[data-role="value-label"]');
    const preview = form.querySelector('[data-role="preview"]');
    const percentField = form.querySelector('[data-role="percent-field"]');
    const hoursField = form.querySelector('[data-role="hours-field"]');
    // Quick assign picks the opportunity inside the form, so the scope it is a
    // percentage of changes as the user chooses; the detail form has it fixed.
    const opportunity = form.querySelector('[data-role="opportunity"]');
    if (!mode || !value || !percentField || !hoursField) return;

    function opportunityHoursFor() {
      if (opportunity) {
        const option = opportunity.options[opportunity.selectedIndex];
        return Number((option && option.dataset.hours) || 0);
      }
      return Number(form.dataset.opportunityHours || 0);
    }

    let last = { percent: 0, hours: 0 };

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

      const businessDays = countBusinessDays(start && start.value, end && end.value);
      const capacityHours = businessDays * dailyHoursFor(person && person.value);
      const load = capacityHours > 0
        ? ' \u2014 ' + round2((state.hours / capacityHours) * 100) + '% of the ' + round2(capacityHours) +
          'h available over ' + businessDays + ' working days'
        : '';
      const perMonth = state.months > 0
        ? ', about ' + round2(state.hours / state.months) + 'h per month over ' + state.months +
          ' month' + (state.months === 1 ? '' : 's')
        : '';

      preview.textContent =
        state.hours + 'h = ' + state.percent + '% of the ' + round2(state.opportunityHours) + 'h scope' + perMonth + load + '.';
    }

    function compute() {
      const opportunityHours = opportunityHoursFor();
      const months = countMonths(start && start.value, end && end.value);
      const raw = Number(value.value);
      const input = Number.isFinite(raw) && raw > 0 ? raw : 0;

      let percent = 0;
      let hours = 0;

      // The percentage is always a share of the opportunity total hours, never of
      // the capacity implied by the planned start and end dates.
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

    // Switching the unit converts the current allocation instead of reinterpreting the number.
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

    // Reopen a saved assignment showing the number in the unit it was entered with.
    const storedHours = Number(form.dataset.allocatedHours);
    if (Number.isFinite(storedHours) && storedHours > 0) {
      const storedPercent = Number(form.dataset.allocationPercent) || 0;
      const modeKey = MODES.indexOf(mode.value) === -1 ? 'percent' : mode.value;
      value.value = valueForMode(modeKey, storedPercent, storedHours, countMonths(start && start.value, end && end.value));
    }

    compute();
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.allocation-form').forEach(setupForm);
  });
})();

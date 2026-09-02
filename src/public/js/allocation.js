(function () {
  'use strict';

  const HOURS_PER_DAY_FALLBACK = 8;
  const MONTHLY_CAPACITY = 160;

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

  function round2(value) {
    return Math.round(Number(value) * 100) / 100;
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
    if (!mode || !value || !percentField || !hoursField) return;

    function compute() {
      const businessDays = countBusinessDays(start && start.value, end && end.value);
      const daily = dailyHoursFor(person && person.value);
      const capacityHours = businessDays * daily;
      const opportunityHours = Number(form.dataset.opportunityHours || 0);
      const raw = Number(value.value);
      const input = Number.isFinite(raw) && raw > 0 ? raw : 0;

      let percent = 0;
      let hours = 0;

      if (mode.value === 'total-hours') {
        hours = input;
        percent = capacityHours > 0 ? (hours / capacityHours) * 100 : 0;
      } else if (mode.value === 'monthly-hours') {
        percent = (input / MONTHLY_CAPACITY) * 100;
        hours = capacityHours * (percent / 100);
      } else {
        percent = input;
        hours = capacityHours * (percent / 100);
      }

      percent = Math.max(0, Math.min(100, round2(percent)));
      hours = Math.max(0, round2(hours));

      percentField.value = percent;
      hoursField.value = hours;

      if (label) {
        label.textContent =
          mode.value === 'total-hours' ? 'Total hours' : mode.value === 'monthly-hours' ? 'Hours per month' : 'Allocation %';
      }

      if (preview) {
        if (!businessDays) {
          preview.textContent = 'Select a person and a valid date range to preview the allocation.';
        } else {
          const share = opportunityHours > 0 ? ` (${round2((hours / opportunityHours) * 100)}% of opportunity scope)` : '';
          preview.textContent =
            `${businessDays} working days x ${daily}h = ${round2(capacityHours)}h capacity -> ` +
            `${percent}% allocation, ${hours}h assigned${share}.`;
        }
      }
    }

    [person, start, end, mode, value].forEach(function (el) {
      if (!el) return;
      el.addEventListener('change', compute);
      el.addEventListener('input', compute);
    });
    form.addEventListener('submit', compute);
    compute();
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.allocation-form').forEach(setupForm);
  });
})();

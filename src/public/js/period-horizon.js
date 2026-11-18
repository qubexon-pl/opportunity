/* Period "Current" means this unit only, so the horizon box beside it shows 0
   and is greyed out. The typed horizon is kept in a hidden field so it is
   still submitted and comes back when Back or Next is picked again. Delegated,
   so forms swapped in later behave the same. */
(function () {
  'use strict';

  function sync(form) {
    var select = form.querySelector('select[name="period"]');
    var input = form.querySelector('[data-horizon-input]');
    if (!select || !input) return;
    var keep = form.querySelector('[data-horizon-keep]');
    if (select.value === 'current') {
      if (input.disabled) return;
      input.setAttribute('data-horizon', input.value || '1');
      if (!keep) {
        keep = document.createElement('input');
        keep.type = 'hidden';
        keep.name = 'units';
        keep.setAttribute('data-horizon-keep', '');
        input.insertAdjacentElement('afterend', keep);
      }
      keep.value = input.value || '1';
      input.min = '0';
      input.value = '0';
      input.disabled = true;
      input.title = 'Current covers this unit only';
    } else if (input.disabled) {
      input.disabled = false;
      input.min = '1';
      input.value = input.getAttribute('data-horizon') || '1';
      input.removeAttribute('title');
      if (keep) keep.remove();
    }
  }

  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el && el.matches && el.matches('select[name="period"]') && el.form) sync(el.form);
  });
})();

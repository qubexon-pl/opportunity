/* Keeps the dropdown multi-select button label in sync with the ticked boxes. */
(function () {
  'use strict';

  function summarise(root) {
    var boxes = root.querySelectorAll('input[type="checkbox"]');
    var summary = root.querySelector('[data-role="summary"]');
    if (!summary) return;

    var chosen = [];
    boxes.forEach(function (box) {
      if (box.checked) {
        var label = root.querySelector('label[for="' + box.id + '"]');
        chosen.push(label ? label.textContent.trim() : box.value);
      }
    });

    if (chosen.length === 0) summary.textContent = root.dataset.allLabel || 'All';
    else if (chosen.length === 1) summary.textContent = chosen[0];
    else summary.textContent = chosen.length + ' selected';

    root.classList.toggle('has-selection', chosen.length > 0);
  }

  function initMultiselects(container) {
    container = container || document;
    container.querySelectorAll('[data-multiselect]:not([data-ms-init])').forEach(function (root) {
      root.setAttribute('data-ms-init', '');
      root.addEventListener('change', function () {
        summarise(root);
      });

      var clear = root.querySelector('[data-role="clear"]');
      if (clear) {
        clear.addEventListener('click', function () {
          root.querySelectorAll('input[type="checkbox"]').forEach(function (box) {
            box.checked = false;
          });
          summarise(root);
        });
      }

      summarise(root);
    });
  }

  window.OPP_initMultiselects = initMultiselects;

  document.addEventListener('DOMContentLoaded', function () {
    initMultiselects();
  });
})();
